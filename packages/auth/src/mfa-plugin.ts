import type { Db } from "@igs/db";
import {
  type MfaMethod,
  deleteNewestPasskey,
  deletePasskey,
  enforceSessionLimits,
  factorCount,
  markSessionFromEnrolment,
  markSessionMfaVerified,
  mfaFactors,
  redeemEnrolmentToken,
  sessionFromEnrolment,
  sessionMfaVerified,
  userKind,
} from "@igs/module-identity";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  formCsrfMiddleware,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

/**
 * 2-step login for staff (36b). Better Auth only RECORDS the facts here; the kernel enforces them
 * (`Actor.mfaVerified` → `kernel.mfa_required`). What this plugin does:
 *
 * - **Marks** a session `mfa_verified_at` after it proves a second factor: a passkey assertion
 *   (user verification enforced in the passkey options), a TOTP or backup code, or the enrolment of
 *   a factor. A staff user's FIRST factor can only be enrolled on a session started by the
 *   single-use enrolment link (`enrolment_at`); later ones need an already verified session.
 * - **Passkey first (#90 C4):** staff sign in with a passkey only, so a staff user's first factor
 *   must be a passkey; an authenticator app (TOTP) can be added afterwards, as an extra.
 * - **Staff rules:** adding a factor when one exists, reading the TOTP secret or backup codes, and
 *   removing a factor all need a verified session (a stolen first factor cannot add its own second
 *   factor), and a staff user always keeps at least one passkey.
 * - **Audit that cannot go missing (#90 C5):** a removal is done by `onSecurityEvent` itself, in
 *   the SAME transaction as its audit entry, instead of by Better Auth's endpoint (which is then
 *   skipped). An enrolment is reported right after Better Auth saved it; if that audit fails, the
 *   new factor is deleted again and the request fails. New backup codes are audited BEFORE they
 *   are written. `onSecurityEvent` is the composition root's (dependency inversion: `@igs/auth`
 *   never imports `@igs/module-audit`).
 * - `/enrolment/redeem`: consumes a bootstrap enrolment token (single use) and starts a session.
 */

/**
 * What `onSecurityEvent` receives. For `mfa.removed` the callback REMOVES the factor and audits it
 * in one transaction (`removeFactor` in `@igs/module-identity`); it throws a domain error with a
 * stable `code` to refuse (`identity.last_passkey`, `identity.factor_not_found`, …). The others
 * only audit (`recordSecurityEvent`).
 */
export type SecurityEvent =
  | { readonly type: "mfa.enrolled"; readonly userId: string; readonly method: MfaMethod }
  | {
      readonly type: "mfa.backup_codes_regenerated";
      readonly userId: string;
      readonly method: "totp";
    }
  | {
      readonly type: "mfa.removed";
      readonly userId: string;
      readonly method: "passkey";
      readonly passkeyId: string;
      /** The acting session: it keeps its verified mark; the user's other sessions lose theirs. */
      readonly keepSessionId: string | null;
    }
  | {
      readonly type: "mfa.removed";
      readonly userId: string;
      readonly method: "totp";
      readonly keepSessionId: string | null;
    };

export type OnSecurityEvent = (event: SecurityEvent) => Promise<void>;

/** Endpoints after which the current (or newly created) session has proved a second factor. */
const VERIFYING_PATHS = new Set([
  "/passkey/verify-authentication",
  "/passkey/verify-registration",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

/** Endpoints that set up TOTP or its backup codes: never a staff user's first factor (#90 C4). */
const TOTP_ADDING_PATHS = new Set([
  "/two-factor/enable",
  "/two-factor/get-totp-uri",
  "/two-factor/generate-backup-codes",
]);

/** Endpoints that add a factor or reveal factor secrets: staff need a verified session if they have one. */
const ADDING_PATHS = new Set([
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/two-factor/enable",
  "/two-factor/get-totp-uri",
  "/two-factor/generate-backup-codes",
]);

const REMOVING_PATHS: ReadonlyMap<string, MfaMethod> = new Map([
  ["/passkey/delete-passkey", "passkey"],
  ["/two-factor/disable", "totp"],
]);

/** Stable codes the platform UI maps to text (no user-facing text here, D-006). */
export const MFA_ERROR_CODES = {
  MFA_REQUIRED: "MFA_REQUIRED",
  LAST_FACTOR: "LAST_FACTOR",
  LAST_PASSKEY: "LAST_PASSKEY",
  PASSKEY_FIRST: "PASSKEY_FIRST",
  PASSKEY_NOT_FOUND: "PASSKEY_NOT_FOUND",
  INVALID_PASSWORD: "INVALID_PASSWORD",
  AUDIT_FAILED: "AUDIT_FAILED",
  TOTP_NOT_ENABLED: "TOTP_NOT_ENABLED",
  ENROLMENT_LINK_INVALID: "ENROLMENT_LINK_INVALID",
  USER_VERIFICATION_REQUIRED: "USER_VERIFICATION_REQUIRED",
} as const;

/**
 * Staff session limits (#95) on every Better Auth request that carries a session cookie: an
 * over-limit session is deleted before the endpoint looks at it, so the endpoint sees no session
 * (401 / `null`). Only a POST counts as the person's own activity: the browser's session check
 * (`/get-session`) and any other GET never restart the idle clock.
 */
const BACKGROUND_PATHS = new Set(["/get-session"]);

const fail = (
  status: "FORBIDDEN" | "BAD_REQUEST" | "UNAUTHORIZED" | "NOT_FOUND" | "INTERNAL_SERVER_ERROR",
  code: string,
) => new APIError(status, { code, message: code });

/** A refusal from `removeFactor` (a kernel `DomainError`, matched by its stable code). */
const REMOVAL_REFUSALS: Readonly<Record<string, () => APIError>> = {
  "identity.last_passkey": () => fail("BAD_REQUEST", MFA_ERROR_CODES.LAST_PASSKEY),
  "identity.factor_not_found": () => fail("NOT_FOUND", MFA_ERROR_CODES.PASSKEY_NOT_FOUND),
  "identity.totp_not_enabled": () => fail("BAD_REQUEST", MFA_ERROR_CODES.TOTP_NOT_ENABLED),
};

const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

type HookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * Better Auth asks a user who HAS a password for it before TOTP changes (`allowPasswordless`); our
 * hooks act before the endpoint, so they check it the same way first.
 */
async function requirePasswordIfSet(ctx: HookCtx, userId: string): Promise<void> {
  const account = await ctx.context.internalAdapter.findCredentialAccount(userId);
  if (!account?.password) return;
  const password = (ctx.body as { password?: unknown } | undefined)?.password;
  if (
    typeof password !== "string" ||
    !(await ctx.context.password.verify({ hash: account.password, password }))
  ) {
    throw fail("BAD_REQUEST", MFA_ERROR_CODES.INVALID_PASSWORD);
  }
}

/** The new passkey's id from `/passkey/verify-registration`'s response. */
const createdPasskeyId = (returned: unknown) =>
  typeof returned === "object" && returned !== null && "id" in returned
    ? String((returned as { id: unknown }).id)
    : undefined;

/** The session that made this request, or the one the endpoint just created in its place. */
async function actingSession(ctx: HookCtx) {
  const created = ctx.context.newSession;
  if (created) return { userId: created.user.id, sessionId: created.session.id };
  const session = await getSessionFromCtx(ctx).catch(() => null);
  return session ? { userId: session.user.id, sessionId: session.session.id } : null;
}

/**
 * The session this request arrived with (from its signed cookie), if it still exists. Not the one
 * an endpoint may have just created.
 */
async function requestSession(ctx: HookCtx) {
  const name = ctx.context.authCookies.sessionToken.name;
  const signed = await ctx.getSignedCookie(name, ctx.context.secret).catch(() => null);
  if (!signed) return null;
  return ctx.context.internalAdapter.findSession(signed);
}

/**
 * #95: a passkey check made inside a session that is still within its limits is a fresh proof for
 * THAT session, not a new sign-in. Better Auth's `/passkey/verify-authentication` always creates a
 * new session; that would restart the 8-hour clock, so the new one is dropped and the browser keeps
 * the session it had (now marked as verified). An ended session was already deleted by the limits
 * hook, so nothing is revived: the check is then an ordinary sign-in with a new session. A passkey
 * of ANOTHER user is a plain sign-in as that user.
 */
async function keepPriorSession(
  ctx: HookCtx,
  created: { userId: string; sessionId: string },
): Promise<{ userId: string; sessionId: string } | null> {
  const prior = await requestSession(ctx);
  if (!prior || prior.user.id !== created.userId || prior.session.id === created.sessionId) {
    return null;
  }
  const newToken = ctx.context.newSession?.session.token;
  if (newToken) await ctx.context.internalAdapter.deleteSession(newToken);
  await setSessionCookie(ctx, { session: prior.session, user: prior.user });
  return { userId: prior.user.id, sessionId: prior.session.id };
}

export function igsMfa(options: { db: Db; onSecurityEvent: OnSecurityEvent }): BetterAuthPlugin {
  const { db, onSecurityEvent } = options;

  return {
    id: "igs-mfa",
    endpoints: {
      redeemEnrolment: createAuthEndpoint(
        "/enrolment/redeem",
        {
          method: "POST",
          body: z.object({ token: z.string().min(1).max(200) }),
          // a sign-in without cookies: Better Auth's own login-CSRF check (Fetch Metadata + Origin),
          // so a cross-site page cannot sign the victim's browser in to an attacker's account
          use: [formCsrfMiddleware],
        },
        async (ctx) => {
          const userId = await redeemEnrolmentToken(db, ctx.body.token);
          if (!userId) throw fail("BAD_REQUEST", MFA_ERROR_CODES.ENROLMENT_LINK_INVALID);
          // the session-create hook still refuses a suspended or deleted user (Q6)
          const session = await ctx.context.internalAdapter.createSession(userId);
          const user = await ctx.context.internalAdapter.findUserById(userId);
          if (!session || !user) throw fail("BAD_REQUEST", MFA_ERROR_CODES.ENROLMENT_LINK_INVALID);
          // the only kind of session that may enrol a staff user's first factor (before-hook)
          await markSessionFromEnrolment(db, session.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ status: true });
        },
      ),
    },
    hooks: {
      before: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            const prior = await requestSession(ctx);
            if (!prior) return;
            await enforceSessionLimits(db, {
              userId: prior.user.id,
              sessionId: prior.session.id,
              now: new Date(),
              touch: ctx.request?.method === "POST" && !BACKGROUND_PATHS.has(ctx.path ?? ""),
            });
          }),
        },
        {
          matcher: (ctx) => ADDING_PATHS.has(ctx.path ?? "") || REMOVING_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx).catch(() => null);
            if (!session) return; // the endpoint's own session middleware answers 401
            const userId = session.user.id;
            const sessionId = session.session.id;
            const path = ctx.path ?? "";
            const factors = await mfaFactors(db, userId);
            const removing = REMOVING_PATHS.get(path);
            const needsTotp = removing === "totp" || path === "/two-factor/generate-backup-codes";
            if (needsTotp && !factors.totp) {
              // nothing to disable or regenerate: refuse, so no audit entry is written for it
              throw fail("BAD_REQUEST", MFA_ERROR_CODES.TOTP_NOT_ENABLED);
            }
            if ((await userKind(db, userId)) === "staff") {
              const count = factorCount(factors);
              // #90 C4: staff sign in with a passkey only, so TOTP is never their first factor
              if (factors.passkeys === 0 && TOTP_ADDING_PATHS.has(path)) {
                throw fail("BAD_REQUEST", MFA_ERROR_CODES.PASSKEY_FIRST);
              }
              // the first factor: only on a session the enrolment link started, never on one from
              // any other sign-in method a staff user might gain later
              const firstFactor =
                count === 0 && !removing && (await sessionFromEnrolment(db, userId, sessionId));
              if (!firstFactor && !(await sessionMfaVerified(db, userId, sessionId))) {
                throw fail("FORBIDDEN", MFA_ERROR_CODES.MFA_REQUIRED);
              }
              // fast refusals; `removeFactor` checks again under a row lock (concurrent removals)
              if (removing && count <= 1) throw fail("BAD_REQUEST", MFA_ERROR_CODES.LAST_FACTOR);
              if (removing === "passkey" && factors.passkeys <= 1) {
                throw fail("BAD_REQUEST", MFA_ERROR_CODES.LAST_PASSKEY);
              }
            }
            if (needsTotp) await requirePasswordIfSet(ctx, userId);

            if (path === "/two-factor/generate-backup-codes") {
              // #90 C5: audited before the codes change, so they never change without an entry
              await onSecurityEvent({
                type: "mfa.backup_codes_regenerated",
                userId,
                method: "totp",
              });
              return;
            }
            if (!removing) return;

            // #90 C5: the removal and its audit entry commit together, here; the endpoint is skipped
            const passkeyId = (ctx.body as { id?: unknown } | undefined)?.id;
            if (removing === "passkey" && (typeof passkeyId !== "string" || passkeyId === "")) {
              throw fail("BAD_REQUEST", MFA_ERROR_CODES.PASSKEY_NOT_FOUND);
            }
            try {
              await onSecurityEvent(
                removing === "passkey"
                  ? {
                      type: "mfa.removed",
                      userId,
                      method: "passkey",
                      passkeyId: passkeyId as string,
                      keepSessionId: sessionId,
                    }
                  : { type: "mfa.removed", userId, method: "totp", keepSessionId: sessionId },
              );
            } catch (error) {
              const refusal = REMOVAL_REFUSALS[errorCode(error) ?? ""];
              if (refusal) throw refusal();
              throw error;
            }
            return ctx.json({ status: true });
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => VERIFYING_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            if (isAPIError(ctx.context.returned)) return;
            let acting = await actingSession(ctx);
            if (!acting) return;
            if (ctx.path === "/passkey/verify-authentication") {
              acting = (await keepPriorSession(ctx, acting)) ?? acting;
            }
            if (ctx.path === "/passkey/verify-registration") {
              try {
                await onSecurityEvent({
                  type: "mfa.enrolled",
                  userId: acting.userId,
                  method: "passkey",
                });
              } catch {
                // #90 C5: no audit entry, no new passkey (the session stays unverified)
                const id = createdPasskeyId(ctx.context.returned);
                if (!(id && (await deletePasskey(db, acting.userId, id)))) {
                  await deleteNewestPasskey(db, acting.userId);
                }
                throw fail("INTERNAL_SERVER_ERROR", MFA_ERROR_CODES.AUDIT_FAILED);
              }
            }
            await markSessionMfaVerified(db, acting.sessionId);
          }),
        },
      ],
    },
    rateLimit: [{ pathMatcher: (path) => path === "/enrolment/redeem", window: 60, max: 5 }],
  } satisfies BetterAuthPlugin;
}

/** Passkey settings: user verification is REQUIRED, so a passkey alone is two factors (36b). */
export function requireUserVerification(verification: {
  authenticationInfo?: { userVerified: boolean };
  registrationInfo?: { userVerified: boolean };
}): void {
  const info = verification.authenticationInfo ?? verification.registrationInfo;
  if (!info?.userVerified) {
    throw fail("UNAUTHORIZED", MFA_ERROR_CODES.USER_VERIFICATION_REQUIRED);
  }
}
