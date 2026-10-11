import type { Db } from "@igs/db";
import {
  type MfaMethod,
  clearOtherSessionsMfa,
  factorCount,
  markSessionMfaVerified,
  mfaFactors,
  redeemEnrolmentToken,
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
 *   a factor (the first one is anchored on the single-use enrolment link; later ones need an
 *   already verified session, below).
 * - **Staff rules:** adding a factor when one exists, reading the TOTP secret or backup codes, and
 *   removing a factor all need a verified session (a stolen first factor cannot add its own second
 *   factor), and a staff user can never remove their last factor.
 * - **Removal** clears the mark on the user's other sessions.
 * - Reports `mfa.enrolled|removed` through `onSecurityEvent`, which each composition root turns into
 *   an audit entry (dependency inversion: `@igs/auth` never imports `@igs/module-audit`).
 * - `/enrolment/redeem`: consumes a bootstrap enrolment token (single use) and starts a session.
 */

export interface SecurityEvent {
  readonly type: "mfa.enrolled" | "mfa.removed";
  readonly userId: string;
  readonly method: MfaMethod;
}

export type OnSecurityEvent = (event: SecurityEvent) => Promise<void>;

/** Endpoints after which the current (or newly created) session has proved a second factor. */
const VERIFYING_PATHS = new Set([
  "/passkey/verify-authentication",
  "/passkey/verify-registration",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
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
  TOTP_NOT_ENABLED: "TOTP_NOT_ENABLED",
  ENROLMENT_LINK_INVALID: "ENROLMENT_LINK_INVALID",
  USER_VERIFICATION_REQUIRED: "USER_VERIFICATION_REQUIRED",
} as const;

const fail = (status: "FORBIDDEN" | "BAD_REQUEST" | "UNAUTHORIZED", code: string) =>
  new APIError(status, { code, message: code });

type HookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** The session that made this request, or the one the endpoint just created in its place. */
async function actingSession(ctx: HookCtx) {
  const created = ctx.context.newSession;
  if (created) return { userId: created.user.id, sessionId: created.session.id };
  const session = await getSessionFromCtx(ctx).catch(() => null);
  return session ? { userId: session.user.id, sessionId: session.session.id } : null;
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
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ status: true });
        },
      ),
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => ADDING_PATHS.has(ctx.path ?? "") || REMOVING_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx).catch(() => null);
            if (!session) return; // the endpoint's own session middleware answers 401
            const userId = session.user.id;
            const factors = await mfaFactors(db, userId);
            const removing = REMOVING_PATHS.get(ctx.path ?? "");
            if (removing === "totp" && !factors.totp) {
              // nothing to disable: refuse, so no `mfa.removed` is reported for it
              throw fail("BAD_REQUEST", MFA_ERROR_CODES.TOTP_NOT_ENABLED);
            }
            if ((await userKind(db, userId)) !== "staff") return;
            const count = factorCount(factors);
            if (count === 0 && !removing) return; // the first factor: enrolment link session
            if (!(await sessionMfaVerified(db, userId, session.session.id))) {
              throw fail("FORBIDDEN", MFA_ERROR_CODES.MFA_REQUIRED);
            }
            if (removing && count <= 1) throw fail("BAD_REQUEST", MFA_ERROR_CODES.LAST_FACTOR);
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) =>
            VERIFYING_PATHS.has(ctx.path ?? "") || REMOVING_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            if (isAPIError(ctx.context.returned)) return;
            const acting = await actingSession(ctx);
            if (!acting) return;
            const path = ctx.path ?? "";
            const removed = REMOVING_PATHS.get(path);
            if (removed) {
              // another device that verified with the removed factor must verify again (Q5); with
              // no factor left (only possible for customers, or a lost race) none stays verified
              const left = factorCount(await mfaFactors(db, acting.userId));
              await clearOtherSessionsMfa(db, acting.userId, left > 0 ? acting.sessionId : null);
              await onSecurityEvent({
                type: "mfa.removed",
                userId: acting.userId,
                method: removed,
              });
              return;
            }
            await markSessionMfaVerified(db, acting.sessionId);
            if (path === "/passkey/verify-registration") {
              await onSecurityEvent({
                type: "mfa.enrolled",
                userId: acting.userId,
                method: "passkey",
              });
            }
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
