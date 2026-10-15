import "server-only";

import { passkey } from "@better-auth/passkey";
import { getEnv } from "@igs/config/env";
import type { Db } from "@igs/db";
import { getDb } from "@igs/db/client";
import { newId } from "@igs/db/ids";
import {
  type ResolvedActor,
  STAFF_SESSION_MAX_MS,
  type SessionEnd,
  disableTotp,
  enforceSessionLimits,
  ensureRbacCatalogue,
  identitySchema,
  loadActor,
  sessionAllowed,
  sessionByToken,
  userKind,
} from "@igs/module-identity";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";

import {
  CUSTOMER_FRESH_MS,
  type CustomerAuth,
  type RequestMail,
  createCustomerAuth,
} from "./customer";
import {
  MFA_ERROR_CODES,
  type OnSecurityEvent,
  igsMfa,
  requireUserVerification,
} from "./mfa-plugin";

export interface AuthDeps {
  readonly db: Db;
  readonly secret: string;
  readonly baseURL: string;
  readonly onSecurityEvent: OnSecurityEvent;
}

/**
 * The STAFF Better Auth instance (the platform). Exported for tests (real Postgres, injected deps);
 * apps use `getAuth()`. It refuses customer accounts: customers sign in on the storefront's own
 * instance (`createCustomerAuth`, D-044).
 */
export function createStaffAuth({ db, secret, baseURL, onSecurityEvent }: AuthDeps) {
  return betterAuth({
    appName: "IGS-Pharma",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: identitySchema,
      usePlural: true,
    }),
    secret,
    baseURL,
    advanced: {
      // UUIDv7 primary keys, generated app-side (D-003)
      database: { generateId: () => newId() },
      // 36b: Better Auth skips its Origin/CSRF checks when NODE_ENV=test; keep them on everywhere,
      // so tests exercise the same protection as production (e.g. login CSRF on /enrolment/redeem)
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      // #91 (#64 E): nobody signs up. Staff are created by the bootstrap CLI or an owner; customer
      // accounts (Phase 1b) will open sign-up on purpose, with their own rules
      disableSignUp: true,
    },
    session: {
      // T-016 Q2: no roles/status in a signed cookie; every request re-reads the session row
      cookieCache: { enabled: false },
      // #95: a session ends 8 hours after sign-in and is never renewed (Better Auth's default is
      // 7 days, renewed on every visit). The 30-minute idle limit is the igs-mfa plugin's and
      // `resolveActor`'s: they read `identity.sessions.last_activity_at`.
      expiresIn: STAFF_SESSION_MAX_MS / 1000,
      disableSessionRefresh: true,
      // 36b: written by the igs-mfa plugin only, never from a request body
      additionalFields: {
        mfaVerifiedAt: { type: "date", input: false, required: false },
        // set by /enrolment/redeem only: the session may enrol a staff user's first factor
        enrolmentAt: { type: "date", input: false, required: false },
      },
    },
    user: {
      // T-016: profile columns are server-owned. `input: false` keeps them out of every client
      // body (a sign-up request cannot make itself `staff`); the DB defaults apply.
      additionalFields: {
        locale: { type: "string", input: false, required: false },
        kind: { type: "string", input: false, required: false },
        status: { type: "string", input: false, required: false },
        identityAssurance: { type: "string", input: false, required: false },
      },
    },
    rateLimit: {
      // 36b: Better Auth counts TOTP failures only on the sign-in path; this caps the
      // "verify on an existing session" path too (per IP, in memory, production only by default)
      customRules: { "/two-factor/verify-totp": { window: 60, max: 5 } },
    },
    databaseHooks: {
      session: {
        create: {
          // T-016 Q6: suspended or deleted users get no new session
          // D-044: the staff instance signs in staff only
          before: async (session) =>
            (await userKind(db, session.userId)) === "staff" &&
            (await sessionAllowed(db, session.userId))
              ? undefined
              : false,
        },
      },
      user: {
        update: {
          // 36b: confirming a TOTP secret (the only user update /two-factor/verify-totp makes)
          after: async (user, ctx) => {
            if (ctx?.path !== "/two-factor/verify-totp" || user.twoFactorEnabled !== true) return;
            try {
              await onSecurityEvent({ type: "mfa.enrolled", userId: user.id, method: "totp" });
            } catch {
              // #90 C5: no audit entry, no authenticator app; the request fails
              await disableTotp(db, user.id);
              throw new APIError("INTERNAL_SERVER_ERROR", {
                code: MFA_ERROR_CODES.AUDIT_FAILED,
                message: MFA_ERROR_CODES.AUDIT_FAILED,
              });
            }
          },
        },
      },
    },
    plugins: [
      // staff have no password (bootstrap), so TOTP is set up on a signed-in session without one;
      // Better Auth still asks for the password when the user has one
      twoFactor({ allowPasswordless: true, issuer: "IGS-Pharma" }),
      passkey({
        rpName: "IGS-Pharma",
        origin: new URL(baseURL).origin,
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        // the library verifies with requireUserVerification: false; refuse without UV here
        registration: {
          afterVerification: ({ verification }) => requireUserVerification(verification),
        },
        authentication: {
          afterVerification: ({ verification }) => requireUserVerification(verification),
        },
      }),
      igsMfa({ db, onSecurityEvent }),
    ],
  });
}

/** The previous name of {@link createStaffAuth}, kept so existing callers and tests keep working. */
export const createAuth = createStaffAuth;

export type Auth = ReturnType<typeof createStaffAuth>;

let onSecurityEvent: OnSecurityEvent | undefined;

/**
 * Composition root hook (36b), the same pattern as `configureKernel`: each app calls it once, before
 * the first `getAuth()`, with a callback that audits the event (`recordSecurityEvent` from
 * `@igs/module-identity`, run as a `system_auth` actor). `getAuth()` refuses to start without it,
 * so a factor change can never go unaudited by omission.
 */
export function configureAuth(options: { onSecurityEvent: OnSecurityEvent }): void {
  onSecurityEvent = options.onSecurityEvent;
}

let _auth: Auth | undefined;

/**
 * Lazy, memoised Better Auth instance. Never call at module top level:
 * it reads env and opens the DB pool on first use (not on import).
 */
export function getAuth(): Auth {
  if (!_auth) {
    const env = getEnv();
    if (!onSecurityEvent) {
      throw new Error("auth.not_configured: call configureAuth({ onSecurityEvent }) first");
    }
    _auth = createStaffAuth({
      db: getDb(),
      secret: env.AUTH_SECRET,
      baseURL: env.AUTH_URL,
      onSecurityEvent,
    });
  }
  return _auth;
}

export type Session = Auth["$Infer"]["Session"];
export type User = Session["user"];

export type { ResolvedActor, RoleGrant } from "@igs/module-identity";
export { MFA_ERROR_CODES, type OnSecurityEvent, type SecurityEvent } from "./mfa-plugin";

/** What the edge learns about a request's session: the actor, or why a staff session just ended. */
export type SessionResolution =
  | { readonly actor: ResolvedActor; readonly ended?: undefined }
  | { readonly actor?: undefined; readonly ended: SessionEnd };

/** The Better Auth session token in a `Cookie` header (`__Secure-` prefixed over HTTPS), or `null`. */
export function sessionTokenFromCookies(cookie: string | null): string | null {
  const match = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/.exec(cookie ?? "");
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]).split(".")[0] || null;
  } catch {
    return null;
  }
}

/**
 * The edge adapter's actor for this request (T-016 Q2): validates the Better Auth session, applies
 * the staff session limits (#95: 8 hours after sign-in, 30 minutes without activity), then loads
 * the user's status, kind and role grants from the database. `null` when there is no valid session
 * or the user is not `active`; `{ ended }` when a staff session has just run out (it is deleted
 * here, so nothing can revive it) so the sign-in page can say why.
 *
 * `interactive` says whether the request is something the person did (a navigation, a form or
 * Server Action): only then does it restart the idle clock. Background requests (the browser's own
 * session check, prefetches, polling) pass `false` and never keep a session alive. `mfaVerified` is
 * for THIS session (36b). Loads the RBAC catalogue on first use. Memoise per request in the app
 * (React `cache()`), never across requests.
 */
export async function resolveSession(
  headers: Headers,
  options: { locationId?: string | null; interactive: boolean; now?: Date },
): Promise<SessionResolution | null> {
  const token = sessionTokenFromCookies(headers.get("cookie"));
  if (token) {
    const db = getDb();
    const named = await sessionByToken(db, token);
    if (named) {
      const ended = await enforceSessionLimits(db, {
        userId: named.userId,
        sessionId: named.id,
        now: options.now ?? new Date(),
        touch: options.interactive,
      });
      if (ended) return { ended };
    }
  }
  // no session cookie → no database work at all (public pages stay cheap)
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  const db = getDb();
  await ensureRbacCatalogue(db);
  const actor = await loadActor(db, session.user.id, {
    ...(options.locationId === undefined ? {} : { locationId: options.locationId }),
    sessionId: session.session.id,
  });
  return actor ? { actor } : null;
}

/** `resolveSession` for callers that only need the actor (an ended session is "no actor"). */
export async function resolveActor(
  headers: Headers,
  options: { locationId?: string | null; interactive?: boolean; now?: Date } = {},
): Promise<ResolvedActor | null> {
  const resolved = await resolveSession(headers, { interactive: false, ...options });
  return resolved?.actor ?? null;
}

// --- customers (igs-pharma#114, D-044) -------------------------------------------------------------------------

export {
  CUSTOMER_COOKIE_PREFIX,
  CUSTOMER_FRESH_MS,
  CUSTOMER_PASSWORD_MIN,
  CUSTOMER_SESSION_MAX_S,
  CUSTOMER_SESSION_REFRESH_S,
  type CustomerAuth,
  type CustomerAuthDeps,
  type RequestMail,
  createCustomerAuth,
} from "./customer";

let requestMail: RequestMail | undefined;

/**
 * Composition root hook for the storefront (like `configureAuth`): the callback that turns a mail
 * request into the `identity.mail.request` command. `getCustomerAuth()` refuses to start without it,
 * so a verification or reset mail can never be silently dropped.
 */
export function configureCustomerAuth(options: { requestMail: RequestMail }): void {
  requestMail = options.requestMail;
}

let _customerAuth: CustomerAuth | undefined;

/**
 * Lazy, memoised customer instance on the STOREFRONT origin (`STOREFRONT_URL`). Never call at module
 * top level: it reads env and opens the DB pool on first use.
 */
export function getCustomerAuth(): CustomerAuth {
  if (!_customerAuth) {
    const env = getEnv();
    if (!requestMail) {
      throw new Error("auth.not_configured: call configureCustomerAuth({ requestMail }) first");
    }
    if (!env.STOREFRONT_URL) {
      throw new Error("auth.not_configured: STOREFRONT_URL is not set");
    }
    _customerAuth = createCustomerAuth({
      db: getDb(),
      secret: env.AUTH_SECRET,
      baseURL: env.STOREFRONT_URL,
      requestMail,
    });
  }
  return _customerAuth;
}

/** A signed-in customer, as the storefront's Server Actions need them. */
export interface CustomerSession {
  readonly actor: ResolvedActor;
  readonly sessionId: string;
  /** When the person signed in (a refresh does not move it): the base of {@link requireFreshSession}. */
  readonly signedInAt: Date;
}

/**
 * The customer for this request, or `null`: no session, a suspended account, or an account that is
 * not a customer (a staff session cookie never works here; kind is checked again on every request,
 * not only at sign-in). Memoise per request in the app, never across requests.
 */
export async function resolveCustomerSession(headers: Headers): Promise<CustomerSession | null> {
  const session = await getCustomerAuth().api.getSession({ headers });
  if (!session) return null;
  const db = getDb();
  if ((await userKind(db, session.user.id)) !== "customer") return null;
  await ensureRbacCatalogue(db);
  const actor = await loadActor(db, session.user.id, { sessionId: session.session.id });
  if (!actor || actor.kind !== "customer") return null;
  return { actor, sessionId: session.session.id, signedInAt: new Date(session.session.createdAt) };
}

/** Whether the customer signed in at most `maxAgeMs` before `now`. */
export function isFreshSession(
  session: Pick<CustomerSession, "signedInAt">,
  maxAgeMs: number = CUSTOMER_FRESH_MS,
  now: Date = new Date(),
): boolean {
  return now.getTime() - session.signedInAt.getTime() <= maxAgeMs;
}

/** Thrown by {@link requireFreshSession}: the person must sign in again before this action. */
export class FreshSessionRequiredError extends Error {
  readonly code = "auth.fresh_session_required";
  constructor() {
    super("auth.fresh_session_required");
  }
}

/**
 * Guard for sensitive customer commands (change e-mail or password, data export or erasure): passes
 * for a sign-in at most `maxAgeMs` old (default 10 minutes), otherwise throws
 * {@link FreshSessionRequiredError}, which the caller maps to "please sign in again".
 */
export function requireFreshSession(
  session: Pick<CustomerSession, "signedInAt">,
  maxAgeMs: number = CUSTOMER_FRESH_MS,
  now: Date = new Date(),
): void {
  if (!isFreshSession(session, maxAgeMs, now)) throw new FreshSessionRequiredError();
}
