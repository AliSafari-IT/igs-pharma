import "server-only";

import type { Db } from "@igs/db";
import { newId } from "@igs/db/ids";
import { type MailTemplate, identitySchema, sessionAllowed, userKind } from "@igs/module-identity";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";

/** Webshop customers' session (D-044): 7 days, extended at most once a day. */
export const CUSTOMER_SESSION_MAX_S = 7 * 24 * 60 * 60;
export const CUSTOMER_SESSION_REFRESH_S = 24 * 60 * 60;
/** A sign-in younger than this counts as fresh for sensitive actions (change e-mail or password, data export or erasure). */
export const CUSTOMER_FRESH_MS = 10 * 60 * 1000;
/** Passwords: length is the rule, no composition rules (D-044). */
export const CUSTOMER_PASSWORD_MIN = 12;
export const CUSTOMER_COOKIE_PREFIX = "igs-c";

/**
 * A mail the customer flows want sent. The composition root runs it as the `identity.mail.request`
 * kernel command (store the link, publish `identity.mail.requested` through the outbox), so a request
 * never talks to a mail server (D-019) and this package never depends on the kernel.
 */
export type RequestMail = (input: {
  readonly userId: string;
  readonly template: MailTemplate;
  readonly url?: string;
}) => Promise<void>;

export interface CustomerAuthDeps {
  readonly db: Db;
  readonly secret: string;
  /** The STOREFRONT origin: the customer instance lives there, never on the platform's. */
  readonly baseURL: string;
  readonly requestMail: RequestMail;
}

/**
 * The customer Better Auth instance (igs-pharma#114, D-044). Same `identity` tables as staff, but:
 * e-mail + password with sign-up open, e-mail verification required, no account enumeration, its own
 * cookies (`igs-c.*`) and a database-backed rate limiter. It refuses staff accounts, and the staff
 * instance refuses customers. Exported for tests (real Postgres, injected deps); apps use
 * `getCustomerAuth()`.
 */
export function createCustomerAuth({ db, secret, baseURL, requestMail }: CustomerAuthDeps) {
  const origin = new URL(baseURL).origin;
  /**
   * D-044: this instance serves customers only. Every mail flow does nothing for any other kind, and
   * the response stays the one an unknown e-mail gets, so a staff address is neither mailed nor
   * recognisable from here.
   */
  const isCustomer = async (userId: string) => (await userKind(db, userId)) === "customer";
  return betterAuth({
    appName: "IGS-Pharma",
    database: drizzleAdapter(db, { provider: "pg", schema: identitySchema, usePlural: true }),
    secret,
    baseURL,
    trustedOrigins: [origin],
    advanced: {
      database: { generateId: () => newId() },
      // keep Better Auth's Origin/CSRF checks on in every environment, tests included
      disableOriginCheck: false,
      disableCSRFCheck: false,
      // `igs-c.*`, Secure + HttpOnly + SameSite=Lax + path=/ and no Domain (host-only). Better Auth
      // puts `__Secure-` in front over HTTPS; a `__Host-` name is not possible through its API.
      cookiePrefix: CUSTOMER_COOKIE_PREFIX,
      // The rate limiter counts per client, so it must read the client's address. The edge (Caddy)
      // sets `X-Forwarded-For` to ONE address. Better Auth trusts a single-value header only: a chain
      // (a client-supplied prefix, an unexpected extra hop) resolves to no address and shares one
      // bucket per path (fails closed: slower for everyone, never a bypass by spoofing). Without
      // this setting the default is the same header; naming it keeps the dependency visible.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: CUSTOMER_PASSWORD_MIN,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      // an existing address gets a notice mail instead of a second account; the sign-up response is
      // the same either way (Better Auth builds the synthetic user)
      onExistingUserSignUp: async ({ user }) => {
        if (!(await isCustomer(user.id))) return;
        await requestMail({ userId: user.id, template: "account_exists" });
      },
      sendResetPassword: async ({ user, url }) => {
        if (!(await isCustomer(user.id))) return;
        await requestMail({ userId: user.id, template: "reset_password", url });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: async ({ user, url }) => {
        if (!(await isCustomer(user.id))) return;
        await requestMail({ userId: user.id, template: "verify_email", url });
      },
    },
    session: {
      cookieCache: { enabled: false },
      expiresIn: CUSTOMER_SESSION_MAX_S,
      updateAge: CUSTOMER_SESSION_REFRESH_S,
      freshAge: CUSTOMER_FRESH_MS / 1000,
    },
    user: {
      additionalFields: {
        locale: { type: "string", input: false, required: false },
        kind: { type: "string", input: false, required: false },
        status: { type: "string", input: false, required: false },
        identityAssurance: { type: "string", input: false, required: false },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 3600, max: 5 },
        "/request-password-reset": { window: 3600, max: 5 },
        "/send-verification-email": { window: 3600, max: 5 },
      },
    },
    hooks: {
      // A reset token of a non-customer (a staff e-mail asked for one) must never set a password,
      // even if the token reached someone: it is refused as an invalid token.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/reset-password") return;
        const token = ctx.body?.token ?? ctx.query?.token;
        if (typeof token !== "string") return;
        const found = await ctx.context.internalAdapter.findVerificationValue(
          `reset-password:${token}`,
        );
        if (found && !(await isCustomer(found.value))) {
          throw new APIError("BAD_REQUEST", { code: "INVALID_TOKEN", message: "Invalid token" });
        }
      }),
    },
    databaseHooks: {
      account: {
        // belt and braces: no credential is ever written for a non-customer through this instance
        create: {
          before: async (account) => ((await isCustomer(account.userId)) ? undefined : false),
        },
      },
      session: {
        create: {
          // the customer instance signs in customers only; a staff account gets no session here
          before: async (session) =>
            (await userKind(db, session.userId)) === "customer" &&
            (await sessionAllowed(db, session.userId))
              ? undefined
              : false,
        },
      },
      user: {
        create: {
          // every account made here is a customer (the column default), and holds the `customer` role
          after: async (user) => {
            await db
              .insert(identitySchema.userRoles)
              .values({ userId: user.id, roleKey: "customer" })
              .onConflictDoNothing();
          },
        },
      },
    },
  });
}

export type CustomerAuth = ReturnType<typeof createCustomerAuth>;
