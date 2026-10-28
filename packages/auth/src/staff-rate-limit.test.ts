// The staff instance on the open internet: per-IP rate limits on every unauthenticated or
// second-factor endpoint, the client address read from ONE `X-Forwarded-For` value, and staff
// sessions only. Real Better Auth handler on real Postgres; the limiter counts in memory.
import type { Db } from "@igs/db";
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import {
  ENROLMENT_TTL_MS,
  identitySchema,
  loadRbacCatalogue,
  newEnrolmentToken,
  storeEnrolmentToken,
} from "@igs/module-identity";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createCustomerAuth } from "./customer";
import {
  type Auth,
  MFA_ERROR_CODES,
  STAFF_RATE_LIMIT_RULES,
  configureAuth,
  createStaffAuth,
  resolveSession,
} from "./index";
import { CLIENT_IP_FROM_EDGE } from "./rate-limits";

// `resolveSession` uses the app's lazy instance (`getAuth()`, `getDb()`): point it at this database
const testDb = vi.hoisted(() => ({ current: undefined as Db | undefined }));
vi.mock("@igs/db/client", () => ({
  getDb: () => {
    if (!testDb.current) throw new Error("no test database yet");
    return testDb.current;
  },
}));

const { accounts, users } = identitySchema;
const SECRET = "test-secret-test-secret-test-secret-0123";
const PLATFORM = "http://localhost:3001";
const STOREFRONT = "http://localhost:3000";

let iso: IsolatedDatabase;
let staffAuth: Auth;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  testDb.current = iso.db;
  await loadRbacCatalogue(iso.db);
  process.env.DATABASE_URL ??= "postgres://unused@localhost:5432/unused";
  process.env.AUTH_SECRET ??= SECRET;
  process.env.AUTH_URL ??= PLATFORM;
  configureAuth({ onSecurityEvent: async () => {} });
  // no `rateLimit` option: the default, as `getAuth()` builds it
  staffAuth = createStaffAuth({
    db: iso.db,
    secret: SECRET,
    baseURL: PLATFORM,
    onSecurityEvent: async () => {},
  });
});
afterAll(async () => {
  await iso?.drop();
});

/** One request to the staff instance, as the edge forwards it (`forwardedFor` = the header value). */
async function post(auth: Auth, path: string, forwardedFor: string | null, body: unknown = {}) {
  const response = await auth.handler(
    new Request(`${PLATFORM}/api/auth${path}`, {
      method: "POST",
      headers: {
        origin: PLATFORM,
        "content-type": "application/json",
        ...(forwardedFor === null ? {} : { "x-forwarded-for": forwardedFor }),
      },
      body: JSON.stringify(body),
    }),
  );
  return response.status;
}

/** A body each endpoint parses (wrong credentials), so the attempts look like real ones. */
const BODIES: Record<string, unknown> = {
  "/sign-in/*": { email: "nobody@example.test", password: "wrong password 123" },
  "/enrolment/redeem": { token: "not-a-real-token" },
  "/two-factor/verify-totp": { code: "000000" },
  "/two-factor/verify-backup-code": { code: "aaaaa-bbbbb" },
  "/two-factor/verify-otp": { code: "000000" },
};

/** Distinct documentation addresses (RFC 5737), so tests never share a bucket by accident. */
let nextHost = 1;
const freshIp = () => `198.51.100.${nextHost++}`;

describe("staff client address (X-Forwarded-For)", () => {
  it("both instances read the same single header", () => {
    expect(CLIENT_IP_FROM_EDGE).toEqual({ ipAddressHeaders: ["x-forwarded-for"] });
    expect(staffAuth.options.advanced?.ipAddress).toBe(CLIENT_IP_FROM_EDGE);
    const customer = createCustomerAuth({
      db: iso.db,
      secret: SECRET,
      baseURL: STOREFRONT,
      requestMail: async () => {},
    });
    expect(customer.options.advanced?.ipAddress).toBe(CLIENT_IP_FROM_EDGE);
  });

  it("counts per address: one noisy client does not lock out another", async () => {
    const noisy = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push(await post(staffAuth, "/sign-in/email", noisy));
    expect(statuses.slice(0, 5)).not.toContain(429);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(await post(staffAuth, "/sign-in/email", freshIp())).not.toBe(429);
  });

  it("a forwarded chain gets no bucket of its own: made-up prefixes cannot dodge the limit", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      // a different made-up chain on every attempt, all resolving to "no trusted address"
      statuses.push(
        await post(staffAuth, "/enrolment/redeem", `10.9.${i}.1, 203.0.113.${i}`, {
          token: "x",
        }),
      );
    }
    expect(statuses).toContain(429);
  });
});

describe("staff rate limits", () => {
  it("are on by default (production included) and kept in memory", () => {
    expect(staffAuth.options.rateLimit).toMatchObject({
      enabled: true,
      storage: "memory",
      customRules: STAFF_RATE_LIMIT_RULES,
    });
  });

  it("cover every sign-in, enrolment and second-factor endpoint", () => {
    expect(Object.keys(STAFF_RATE_LIMIT_RULES).sort()).toEqual(
      [
        "/sign-in/*",
        "/passkey/generate-authenticate-options",
        "/passkey/verify-authentication",
        "/enrolment/redeem",
        "/two-factor/verify-totp",
        "/two-factor/verify-backup-code",
        "/two-factor/verify-otp",
        "/two-factor/send-otp",
      ].sort(),
    );
  });

  for (const [rule, { max }] of Object.entries(STAFF_RATE_LIMIT_RULES)) {
    it(`${rule}: ${max} attempts per address, then 429`, async () => {
      const path = rule.replace("*", "email");
      const ip = freshIp();
      const statuses: number[] = [];
      for (let i = 0; i <= max; i++) statuses.push(await post(staffAuth, path, ip, BODIES[rule]));
      expect(statuses.slice(0, max)).not.toContain(429);
      expect(statuses[max]).toBe(429);
    });
  }

  it("`rateLimit: false` (tests only) turns them off", async () => {
    const unlimited = createStaffAuth({
      db: iso.db,
      secret: SECRET,
      baseURL: PLATFORM,
      onSecurityEvent: async () => {},
      rateLimit: false,
    });
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push(await post(unlimited, "/sign-in/email", ip));
    expect(statuses).not.toContain(429);
  });
});

describe("staff sessions only", () => {
  /** A customer signed in on the storefront, and their session cookie renamed to the staff one. */
  async function replayedCustomerCookie() {
    const customerAuth = createCustomerAuth({
      db: iso.db,
      secret: SECRET,
      baseURL: STOREFRONT,
      requestMail: async () => {},
    });
    const email = `customer-${crypto.randomUUID()}@example.test`;
    const [user] = await iso.db
      .insert(users)
      .values({ name: "Customer", email, emailVerified: true, kind: "customer" })
      .returning();
    if (!user) throw new Error("no user");
    const password = "correct horse battery staple";
    await iso.db.insert(accounts).values({
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await (await customerAuth.$context).password.hash(password),
    });
    const signedIn = await customerAuth.handler(
      new Request(`${STOREFRONT}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          origin: STOREFRONT,
          "content-type": "application/json",
          "x-forwarded-for": freshIp(),
        },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0] ?? "")
      .find((c) => c.startsWith("igs-c.session_token="));
    if (!cookie) throw new Error("no customer session cookie");
    // the same signed value under the staff cookie name (both instances share AUTH_SECRET)
    return cookie.replace("igs-c.session_token=", "better-auth.session_token=");
  }

  /** A staff member signed in through an enrolment link, and their session cookie. */
  async function staffCookie() {
    const [user] = await iso.db
      .insert(users)
      .values({ name: "Staff", email: `${crypto.randomUUID()}@example.test`, kind: "staff" })
      .returning({ id: users.id });
    if (!user) throw new Error("no user");
    const token = newEnrolmentToken();
    await storeEnrolmentToken(iso.db, user.id, token, new Date(Date.now() + ENROLMENT_TTL_MS));
    const response = await staffAuth.handler(
      new Request(`${PLATFORM}/api/auth/enrolment/redeem`, {
        method: "POST",
        headers: {
          origin: PLATFORM,
          "content-type": "application/json",
          "x-forwarded-for": freshIp(),
        },
        body: JSON.stringify({ token }),
      }),
    );
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0] ?? "")
      .find((c) => c.startsWith("better-auth.session_token="));
    if (!cookie) throw new Error("no staff session cookie");
    return cookie;
  }

  it("a customer's session cookie, renamed, is no back-office actor", async () => {
    const replayed = await replayedCustomerCookie();
    const headers = new Headers({ cookie: replayed });
    expect(await resolveSession(headers, { interactive: true })).toBeNull();
    // the same check lets a staff session through
    const staff = new Headers({ cookie: await staffCookie() });
    expect((await resolveSession(staff, { interactive: true }))?.actor?.kind).toBe("staff");
  });

  it("a customer's session cookie, renamed, is refused by the staff endpoints", async () => {
    const replayed = await replayedCustomerCookie();
    const response = await staffAuth.handler(
      new Request(`${PLATFORM}/api/auth/passkey/generate-register-options`, {
        headers: { origin: PLATFORM, cookie: replayed, "x-forwarded-for": freshIp() },
      }),
    );
    expect(response.status).toBe(401);
    expect(((await response.json()) as { code?: string }).code).toBe(MFA_ERROR_CODES.STAFF_ONLY);
  });
});
