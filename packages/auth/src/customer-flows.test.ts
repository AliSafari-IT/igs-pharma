// Customer accounts (igs-pharma#114, D-044) through a real Better Auth instance on real Postgres:
// sign-up and verification, no account enumeration, the two kind guards, the database-backed rate
// limiter and the fresh-session rule.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { identitySchema, loadRbacCatalogue } from "@igs/module-identity";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type RequestMail, createCustomerAuth } from "./customer";
import {
  FreshSessionRequiredError,
  createStaffAuth,
  isFreshSession,
  requireFreshSession,
} from "./index";

const { accounts, rateLimits, sessions, userRoles, users } = identitySchema;
const STOREFRONT = "http://localhost:3000";
const PLATFORM = "http://localhost:3001";
const SECRET = "test-secret-test-secret-test-secret-0123";
const PASSWORD = "correct horse battery staple";

let iso: IsolatedDatabase;
let customerAuth: ReturnType<typeof createCustomerAuth>;
let staffAuth: ReturnType<typeof createStaffAuth>;
let mails: Parameters<RequestMail>[0][] = [];

const requestMail: RequestMail = async (input) => {
  mails.push(input);
};

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  customerAuth = createCustomerAuth({
    db: iso.db,
    secret: SECRET,
    baseURL: STOREFRONT,
    requestMail,
  });
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
beforeEach(async () => {
  mails = [];
  await iso.db.delete(rateLimits);
});

/** A browser on one origin: keeps the cookies, sends the Origin Better Auth checks. */
function browser(
  handler: (request: Request) => Promise<Response>,
  origin: string,
  ip = "203.0.113.7",
) {
  const jar = new Map<string, string>();
  return {
    jar,
    async call(path: string, body?: unknown) {
      const response = await handler(
        new Request(path.startsWith("http") ? path : `${origin}/api/auth${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "x-forwarded-for": ip,
            cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
      for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(";");
        const [name, ...value] = (pair ?? "").split("=");
        if (!name) continue;
        if (/max-age=0/i.test(header)) jar.delete(name);
        else jar.set(name, value.join("="));
      }
      const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      return { status: response.status, json };
    },
  };
}

const customerBrowser = (ip?: string) =>
  browser((request) => customerAuth.handler(request), STOREFRONT, ip);

let nextEmail = 1;
const newEmail = () => `customer${nextEmail++}@example.test`;

async function signUp(b: ReturnType<typeof customerBrowser>, email: string, password = PASSWORD) {
  return b.call("/sign-up/email", { email, password, name: "Test Customer" });
}

/** Sign-up and the verification link of the mail it asked for. */
async function verifiedCustomer(email = newEmail()) {
  const b = customerBrowser();
  await signUp(b, email);
  const verify = mails.find((m) => m.template === "verify_email");
  if (!verify?.url) throw new Error("no verification mail was requested");
  const result = await b.call(verify.url);
  expect([200, 302]).toContain(result.status);
  mails = [];
  return { email, browser: b };
}

describe("customer sign-up (#114)", () => {
  it("creates a customer with the customer role, signs nobody in, and asks for a verification mail", async () => {
    const b = customerBrowser();
    const email = newEmail();
    const result = await signUp(b, email);
    expect(result.status).toBe(200);

    const [user] = await iso.db.select().from(users).where(eq(users.email, email));
    expect(user?.kind).toBe("customer");
    expect(user?.emailVerified).toBe(false);
    const roles = await iso.db
      .select()
      .from(userRoles)
      .where(eq(userRoles.userId, user?.id ?? ""));
    expect(roles.map((r) => r.roleKey)).toEqual(["customer"]);
    expect([...b.jar.keys()].filter((k) => k.includes("session_token"))).toEqual([]);

    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ userId: user?.id, template: "verify_email" });
    expect(mails[0]?.url).toContain("/api/auth/verify-email");
  });

  it("refuses to sign in before the e-mail is verified, then signs in with igs-c cookies after", async () => {
    const b = customerBrowser();
    const email = newEmail();
    await signUp(b, email);
    const blocked = await b.call("/sign-in/email", { email, password: PASSWORD });
    expect(blocked.status).toBe(403);

    const link = mails.find((m) => m.template === "verify_email")?.url ?? "";
    await b.call(link);
    const signedIn = await b.call("/sign-in/email", { email, password: PASSWORD });
    expect(signedIn.status).toBe(200);
    const names = [...b.jar.keys()];
    expect(names.some((n) => n.includes("igs-c.session_token"))).toBe(true);
    expect(names.some((n) => n.includes("better-auth"))).toBe(false);
  });

  it("wants at least 12 characters and nothing else", async () => {
    const b = customerBrowser();
    expect((await signUp(b, newEmail(), "elevenchars")).status).toBe(400);
    expect((await signUp(b, newEmail(), "aaaaaaaaaaaa")).status).toBe(200); // no composition rules
  });

  it("does not let a request choose its kind, status or locale", async () => {
    const b = customerBrowser();
    const email = newEmail();
    await b.call("/sign-up/email", {
      email,
      password: PASSWORD,
      name: "Sneaky",
      kind: "staff",
      status: "suspended",
    });
    // refused outright, or made as the plain customer it would be anyway: never as a staff user
    const [user] = await iso.db.select().from(users).where(eq(users.email, email));
    if (user) expect(user).toMatchObject({ kind: "customer", status: "active" });
  });

  it("answers the same for an existing e-mail, makes no second account and asks for the notice mail", async () => {
    const email = newEmail();
    const first = await signUp(customerBrowser(), email);
    mails = [];
    const again = await signUp(customerBrowser(), email);

    expect(again.status).toBe(first.status);
    expect(Object.keys(again.json ?? {}).sort()).toEqual(Object.keys(first.json ?? {}).sort());
    expect(Object.keys((again.json?.["user"] as object) ?? {}).sort()).toEqual(
      Object.keys((first.json?.["user"] as object) ?? {}).sort(),
    );
    const rows = await iso.db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ userId: rows[0]?.id, template: "account_exists" });
    expect(mails[0]?.url).toBeUndefined();
  });

  it("a password reset request answers the same for an unknown e-mail and sends nothing", async () => {
    const known = (await verifiedCustomer()).email;
    const a = await customerBrowser().call("/request-password-reset", {
      email: known,
      redirectTo: `${STOREFRONT}/reset`,
    });
    const known1 = mails.filter((m) => m.template === "reset_password").length;
    const b = await customerBrowser().call("/request-password-reset", {
      email: "nobody@example.test",
      redirectTo: `${STOREFRONT}/reset`,
    });
    expect(b.status).toBe(a.status);
    expect(b.json).toEqual(a.json);
    expect(known1).toBe(1);
    expect(mails.filter((m) => m.template === "reset_password")).toHaveLength(1);
  });
});

describe("the two kinds stay apart (D-044)", () => {
  async function insertUser(kind: "staff" | "customer") {
    const email = newEmail();
    const [user] = await iso.db
      .insert(users)
      .values({ name: `${kind} user`, email, emailVerified: true, kind })
      .returning();
    if (!user) throw new Error("no user");
    const context = await customerAuth.$context;
    await iso.db.insert(accounts).values({
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await context.password.hash(PASSWORD),
    });
    return { id: user.id, email };
  }
  const sessionCount = async (userId: string) =>
    (await iso.db.select().from(sessions).where(eq(sessions.userId, userId))).length;

  it("a staff account cannot sign in on the customer instance", async () => {
    const staff = await insertUser("staff");
    const result = await customerBrowser().call("/sign-in/email", {
      email: staff.email,
      password: PASSWORD,
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(await sessionCount(staff.id)).toBe(0);
  });

  it("a customer account cannot sign in on the staff instance", async () => {
    const customer = await insertUser("customer");
    const b = browser((request) => staffAuth.handler(request), PLATFORM);
    const result = await b.call("/sign-in/email", { email: customer.email, password: PASSWORD });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(await sessionCount(customer.id)).toBe(0);
  });

  it("the customer instance still signs the customer in (the guard is about kind, not about being closed)", async () => {
    const customer = await insertUser("customer");
    const result = await customerBrowser().call("/sign-in/email", {
      email: customer.email,
      password: PASSWORD,
    });
    expect(result.status).toBe(200);
    expect(await sessionCount(customer.id)).toBe(1);
  });

  it("a suspended customer gets no session", async () => {
    const customer = await insertUser("customer");
    await iso.db.update(users).set({ status: "suspended" }).where(eq(users.id, customer.id));
    const result = await customerBrowser().call("/sign-in/email", {
      email: customer.email,
      password: PASSWORD,
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(await sessionCount(customer.id)).toBe(0);
  });
});

describe("rate limit (database-backed)", () => {
  it("stops the sixth sign-in attempt within a minute and keeps its counter in the database", async () => {
    const { email } = await verifiedCustomer();
    await iso.db.delete(rateLimits);
    const b = customerBrowser("198.51.100.9");
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push(
        (await b.call("/sign-in/email", { email, password: "wrong password 123" })).status,
      );
    }
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
    const rows = await iso.db.select().from(rateLimits);
    expect(rows.some((r) => r.key.includes("/sign-in/email"))).toBe(true);
  });

  it("counts per address: another IP is not limited by the first", async () => {
    const { email } = await verifiedCustomer();
    await iso.db.delete(rateLimits);
    const noisy = customerBrowser("198.51.100.10");
    for (let i = 0; i < 6; i++) {
      await noisy.call("/sign-in/email", { email, password: "wrong password 123" });
    }
    const other = await customerBrowser("198.51.100.11").call("/sign-in/email", {
      email,
      password: "wrong password 123",
    });
    expect(other.status).not.toBe(429);
  });
});

describe("fresh session (D-044)", () => {
  const at = (ms: number) => ({ signedInAt: new Date(ms) });
  const now = new Date("2026-10-14T12:00:00Z");

  it("is fresh up to 10 minutes after sign-in, inclusive, and not after", () => {
    const tenMinutes = 10 * 60 * 1000;
    expect(isFreshSession(at(now.getTime() - tenMinutes), undefined, now)).toBe(true);
    expect(isFreshSession(at(now.getTime() - tenMinutes - 1), undefined, now)).toBe(false);
  });

  it("requireFreshSession passes a fresh sign-in and throws a typed error for a stale one", () => {
    expect(() => requireFreshSession(at(now.getTime() - 1000), 60_000, now)).not.toThrow();
    expect(() => requireFreshSession(at(now.getTime() - 61_000), 60_000, now)).toThrow(
      FreshSessionRequiredError,
    );
    try {
      requireFreshSession(at(0), 60_000, now);
    } catch (error) {
      expect((error as FreshSessionRequiredError).code).toBe("auth.fresh_session_required");
    }
  });
});
