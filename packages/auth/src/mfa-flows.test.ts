// 2-step login flows (36b) through a real Better Auth instance (HTTP handler, hooks, cookies) on
// real Postgres. Passkey ceremonies are covered end to end by the e2e suite (virtual authenticator);
// here passkeys are inserted as rows to exercise the factor rules around them.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import {
  ENROLMENT_TTL_MS,
  clearOtherSessionsMfa,
  deletePasskey,
  disableTotp,
  factorCount,
  identitySchema,
  loadActor,
  markSessionPasskeyChecked,
  mfaFactors,
  newEnrolmentToken,
  storeEnrolmentToken,
} from "@igs/module-identity";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { type SecurityEvent, createAuth } from "./index";
import { requireUserVerification } from "./mfa-plugin";

const { passkeys, sessions, twoFactors, users } = identitySchema;
const BASE_URL = "http://localhost:3001";

let iso: IsolatedDatabase;
let auth: ReturnType<typeof createAuth>;
let events: SecurityEvent[] = [];
/** Simulates the audit store being down: the next `onSecurityEvent` throws, changing nothing. */
let auditDown = false;

/**
 * The composition root's job, without the kernel: a removal is done HERE (the real one runs
 * `removeFactor`, removal and audit in one transaction: identity's recovery.test.ts).
 */
async function onSecurityEvent(event: SecurityEvent) {
  if (auditDown) throw new Error("audit store unavailable");
  events.push(event);
  if (event.type !== "mfa.removed") return;
  if (event.method === "passkey") await deletePasskey(iso.db, event.userId, event.passkeyId);
  else await disableTotp(iso.db, event.userId);
  const left = factorCount(await mfaFactors(iso.db, event.userId));
  await clearOtherSessionsMfa(iso.db, event.userId, left > 0 ? event.keepSessionId : null);
}

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  auth = createAuth({
    db: iso.db,
    secret: "test-secret-test-secret-test-secret-0123",
    baseURL: BASE_URL,
    onSecurityEvent,
  });
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  events = [];
  auditDown = false;
});

/** A browser: keeps the cookies Better Auth sets, sends them back, and the Origin it checks. */
function browser() {
  const jar = new Map<string, string>();
  return {
    jar,
    async call(path: string, body?: unknown) {
      const response = await auth.handler(
        new Request(`${BASE_URL}/api/auth${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            origin: BASE_URL,
            "content-type": "application/json",
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
    /** The current session row (by the token in the cookie). */
    async session() {
      const raw = jar.get("better-auth.session_token");
      const token = raw ? decodeURIComponent(raw).split(".")[0] : undefined;
      if (!token) return undefined;
      const [row] = await iso.db.select().from(sessions).where(eq(sessions.token, token));
      return row;
    },
  };
}

/** An enrolment token for `userId`, as `bootstrapStaff` issues one. */
async function newEnrolmentTokenForTests(db: IsolatedDatabase["db"], userId: string) {
  const token = newEnrolmentToken();
  await storeEnrolmentToken(db, userId, token, new Date(Date.now() + ENROLMENT_TTL_MS));
  return token;
}

async function createStaff() {
  const [user] = await iso.db
    .insert(users)
    .values({ name: "Staff Person", email: `${crypto.randomUUID()}@example.test`, kind: "staff" })
    .returning({ id: users.id });
  if (!user) throw new Error("insert failed");
  return user.id;
}

/** Signs in through a fresh enrolment link, as the bootstrap CLI hands one out. */
async function enrolledBrowser(userId: string) {
  const b = browser();
  const token = await newEnrolmentTokenForTests(iso.db, userId);
  const res = await b.call("/enrolment/redeem", { token });
  expect(res.status).toBe(200);
  return b;
}

const base32Decode = (input: string) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of input.replace(/=+$/, ""))
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes).toString("utf8");
};

/** The current TOTP code for an `otpauth://` URI. */
async function codeFor(totpURI: string) {
  const secret = base32Decode(new URL(totpURI).searchParams.get("secret") ?? "");
  const { code } = await auth.api.generateTOTP({ body: { secret } });
  return code;
}

/** Enrols TOTP on `b` (enable + confirm) and returns the otpauth URI. */
async function enrolTotp(b: ReturnType<typeof browser>) {
  const enabled = await b.call("/two-factor/enable", {});
  expect(enabled.status).toBe(200);
  const uri = String(enabled.json?.totpURI);
  const verified = await b.call("/two-factor/verify-totp", { code: await codeFor(uri) });
  expect(verified.status).toBe(200);
  return uri;
}

const addPasskeyRow = (userId: string) =>
  iso.db.insert(passkeys).values({
    userId,
    publicKey: "pk",
    credentialID: crypto.randomUUID(),
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
  });

/** The passkey row's id. */
async function addPasskey(userId: string) {
  const [row] = await addPasskeyRow(userId).returning({ id: passkeys.id });
  return String(row?.id);
}

/**
 * A staff user who enrolled a passkey through the link: the passkey row plus what
 * `/passkey/verify-registration` does to the session plus a passkey check (the real ceremonies:
 * fresh-check.test.ts and e2e two-step.spec.ts).
 */
async function passkeyBrowser(userId: string) {
  const b = await enrolledBrowser(userId);
  await addPasskeyRow(userId);
  await markSessionPasskeyChecked(iso.db, String((await b.session())?.id));
  return b;
}

describe("enrolment link", () => {
  it("starts one session that has NOT proved a second factor; the link works once", async () => {
    const userId = await createStaff();
    const b = browser();
    const token = await newEnrolmentTokenForTests(iso.db, userId);
    expect((await b.call("/enrolment/redeem", { token })).status).toBe(200);
    const session = await b.session();
    expect(session?.userId).toBe(userId);
    expect(session?.mfaVerifiedAt).toBeNull();
    expect((await loadActor(iso.db, userId, { sessionId: session?.id ?? null }))?.mfaVerified).toBe(
      false,
    );

    const again = await browser().call("/enrolment/redeem", { token });
    expect(again).toMatchObject({ status: 400, json: { code: "ENROLMENT_LINK_INVALID" } });
  });

  it("a cross-site page cannot redeem a link in the victim's browser (login CSRF)", async () => {
    const userId = await createStaff();
    const token = await newEnrolmentTokenForTests(iso.db, userId);
    // with and without cookies (a first sign-in has none: Fetch Metadata decides there)
    for (const cookie of ["better-auth.session_token=anything", ""]) {
      const response = await auth.handler(
        new Request(`${BASE_URL}/api/auth/enrolment/redeem`, {
          method: "POST",
          headers: {
            origin: "https://evil.example",
            "sec-fetch-site": "cross-site",
            "sec-fetch-mode": "cors",
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify({ token }),
        }),
      );
      expect(response.status, cookie || "no cookie").toBe(403);
    }
    expect((await browser().call("/enrolment/redeem", { token })).status).toBe(200); // unused
  });

  it("a suspended user gets no session from a valid link", async () => {
    const userId = await createStaff();
    await iso.db.update(users).set({ status: "suspended" }).where(eq(users.id, userId));
    const b = browser();
    const token = await newEnrolmentTokenForTests(iso.db, userId);
    expect((await b.call("/enrolment/redeem", { token })).status).toBe(400);
    expect(await b.session()).toBeUndefined();
  });
});

describe("passkey first (#90 C4)", () => {
  it("a staff user's first factor cannot be TOTP: enable, URI and backup codes are refused", async () => {
    const userId = await createStaff();
    const b = await enrolledBrowser(userId);
    for (const path of ["/two-factor/enable", "/two-factor/get-totp-uri"]) {
      expect(await b.call(path, {}), path).toMatchObject({
        status: 400,
        json: { code: "PASSKEY_FIRST" },
      });
    }
    // registering a passkey is what the link session is for
    expect((await b.call("/passkey/generate-register-options")).status).toBe(200);
    expect(await mfaFactors(iso.db, userId)).toEqual({ passkeys: 0, totp: false });
    expect(events).toEqual([]);
  });

  it("the first factor needs a session the enrolment link started", async () => {
    const userId = await createStaff();
    const b = await enrolledBrowser(userId);
    expect((await b.session())?.enrolmentAt).toBeInstanceOf(Date);
    // a session from any other sign-in method (simulated: same session without the link origin)
    await iso.db
      .update(sessions)
      .set({ enrolmentAt: null })
      .where(eq(sessions.id, String((await b.session())?.id)));
    expect(await b.call("/passkey/generate-register-options")).toMatchObject({
      status: 403,
      json: { code: "MFA_REQUIRED" },
    });
  });
});

describe("TOTP (an extra, after a passkey)", () => {
  it("added on a verified session after a passkey: verifies and reports mfa.enrolled", async () => {
    const userId = await createStaff();
    const b = await passkeyBrowser(userId);
    await enrolTotp(b);

    const session = await b.session();
    expect(session?.mfaVerifiedAt).toBeInstanceOf(Date);
    expect((await loadActor(iso.db, userId, { sessionId: session?.id ?? null }))?.mfaVerified).toBe(
      true,
    );
    expect(await mfaFactors(iso.db, userId)).toEqual({ passkeys: 1, totp: true });
    expect(events).toEqual([{ type: "mfa.enrolled", userId, method: "totp" }]);
  });

  it("if the enrolment cannot be audited, TOTP is not turned on (#90 C5)", async () => {
    const userId = await createStaff();
    const b = await passkeyBrowser(userId);
    const enabled = await b.call("/two-factor/enable", {});
    expect(enabled.status).toBe(200);
    auditDown = true;
    const verified = await b.call("/two-factor/verify-totp", {
      code: await codeFor(String(enabled.json?.totpURI)),
    });
    expect(verified).toMatchObject({ status: 500, json: { code: "AUDIT_FAILED" } });
    expect(await mfaFactors(iso.db, userId)).toEqual({ passkeys: 1, totp: false });
    const [user] = await iso.db.select().from(users).where(eq(users.id, userId));
    expect(user?.twoFactorEnabled).toBe(false);
  });

  it("a TOTP code verifies an existing unverified session and ends its link origin", async () => {
    const userId = await createStaff();
    const uri = await enrolTotp(await passkeyBrowser(userId));
    events = [];

    const later = await enrolledBrowser(userId); // e.g. a recovery link: not verified
    expect((await later.session())?.mfaVerifiedAt).toBeNull();
    expect((await later.call("/two-factor/verify-totp", { code: "000000" })).status).toBe(401);
    expect((await later.session())?.mfaVerifiedAt).toBeNull();
    expect((await later.call("/two-factor/verify-totp", { code: await codeFor(uri) })).status).toBe(
      200,
    );
    const session = await later.session();
    expect(session?.mfaVerifiedAt).toBeInstanceOf(Date);
    expect(session?.enrolmentAt).toBeNull();
    expect(events).toEqual([]); // verifying is not enrolling
  });

  it("an unverified staff session cannot read the TOTP secret or add a factor once one exists", async () => {
    const userId = await createStaff();
    await enrolTotp(await passkeyBrowser(userId));
    const later = await enrolledBrowser(userId);
    for (const path of ["/two-factor/get-totp-uri", "/two-factor/enable"]) {
      expect(await later.call(path, {}), path).toMatchObject({
        status: 403,
        json: { code: "MFA_REQUIRED" },
      });
    }
    expect((await later.call("/passkey/generate-register-options")).status).toBe(403);
  });

  it("new backup codes are audited before they are written; no audit, no new codes (#90 C5)", async () => {
    const userId = await createStaff();
    const b = await passkeyBrowser(userId);
    await enrolTotp(b);
    events = [];
    const codes = async () =>
      (await iso.db.select().from(twoFactors).where(eq(twoFactors.userId, userId)))[0]?.backupCodes;

    const before = await codes();
    auditDown = true;
    expect((await b.call("/two-factor/generate-backup-codes", {})).status).toBe(500);
    expect(await codes()).toBe(before);

    auditDown = false;
    expect((await b.call("/two-factor/generate-backup-codes", {})).status).toBe(200);
    expect(await codes()).not.toBe(before);
    expect(events).toEqual([{ type: "mfa.backup_codes_regenerated", userId, method: "totp" }]);
  });
});

describe("removing a factor", () => {
  it("a staff user cannot remove their last passkey, even with TOTP on", async () => {
    const userId = await createStaff();
    const b = await passkeyBrowser(userId);
    const [only] = await iso.db.select().from(passkeys).where(eq(passkeys.userId, userId));
    expect(await b.call("/passkey/delete-passkey", { id: only?.id })).toMatchObject({
      status: 400,
      json: { code: "LAST_FACTOR" },
    });
    await enrolTotp(b);
    expect(await b.call("/passkey/delete-passkey", { id: only?.id })).toMatchObject({
      status: 400,
      json: { code: "LAST_PASSKEY" },
    });
    expect((await mfaFactors(iso.db, userId)).passkeys).toBe(1);
    expect(events.filter((e) => e.type === "mfa.removed")).toEqual([]);
  });

  it("removal needs a verified session", async () => {
    const userId = await createStaff();
    await enrolTotp(await passkeyBrowser(userId));
    await addPasskeyRow(userId);
    const later = await enrolledBrowser(userId);
    expect(await later.call("/two-factor/disable", {})).toMatchObject({
      status: 403,
      json: { code: "MFA_REQUIRED" },
    });
  });

  it("TOTP removed through onSecurityEvent (removal + audit together); other sessions lose their mark", async () => {
    const userId = await createStaff();
    const acting = await passkeyBrowser(userId);
    await enrolTotp(acting);
    const other = await enrolledBrowser(userId);
    await iso.db
      .update(sessions)
      .set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, String((await other.session())?.id)));
    events = [];

    expect(await acting.call("/two-factor/disable", {})).toMatchObject({
      status: 200,
      json: { status: true },
    });
    const keepSessionId = String((await acting.session())?.id);
    expect(events).toEqual([{ type: "mfa.removed", userId, method: "totp", keepSessionId }]);
    expect(await iso.db.select().from(twoFactors).where(eq(twoFactors.userId, userId))).toEqual([]);
    expect((await acting.session())?.mfaVerifiedAt).toBeInstanceOf(Date);
    expect((await other.session())?.mfaVerifiedAt).toBeNull();
  });

  it("a passkey is removed through onSecurityEvent, never by Better Auth's endpoint", async () => {
    const userId = await createStaff();
    const b = await passkeyBrowser(userId);
    const second = await addPasskey(userId);
    events = [];
    expect(await b.call("/passkey/delete-passkey", { id: second })).toMatchObject({
      status: 200,
      json: { status: true },
    });
    expect(events).toEqual([
      {
        type: "mfa.removed",
        userId,
        method: "passkey",
        passkeyId: second,
        keepSessionId: String((await b.session())?.id),
      },
    ]);
    expect((await mfaFactors(iso.db, userId)).passkeys).toBe(1);
  });

  it("when the removal cannot be audited, the factor stays (#90 C5)", async () => {
    const userId = await createStaff();
    const b = await passkeyBrowser(userId);
    await enrolTotp(b);
    const second = await addPasskey(userId);
    auditDown = true;
    expect((await b.call("/passkey/delete-passkey", { id: second })).status).toBe(500);
    expect((await b.call("/two-factor/disable", {})).status).toBe(500);
    expect(await mfaFactors(iso.db, userId)).toEqual({ passkeys: 2, totp: true });
  });

  it("someone else's passkey is never removed", async () => {
    const userId = await createStaff();
    const b = await passkeyBrowser(userId);
    await addPasskeyRow(userId);
    const victim = await createStaff();
    await addPasskeyRow(victim);
    const victimKey = await addPasskey(victim);
    await b.call("/passkey/delete-passkey", { id: victimKey });
    expect((await mfaFactors(iso.db, victim)).passkeys).toBe(2);
  });

  it("disabling TOTP that was never enabled is refused (no false mfa.removed)", async () => {
    const userId = await createStaff();
    const b = await passkeyBrowser(userId);
    expect(await b.call("/two-factor/disable", {})).toMatchObject({
      status: 400,
      json: { code: "TOTP_NOT_ENABLED" },
    });
    expect(events).toEqual([]);
  });
});

describe("staff session limits (#95)", () => {
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const row = async (b: ReturnType<typeof browser>) => {
    const session = await b.session();
    if (!session) throw new Error("no session");
    return session;
  };
  const setSession = (id: string, values: Partial<typeof sessions.$inferInsert>) =>
    iso.db.update(sessions).set(values).where(eq(sessions.id, id));
  /**
   * Signs a new staff user in with `Date` held still (igs-pharma#107). Better Auth stamps a session
   * with `createdAt = new Date()` and `expiresAt = now + expiresIn` from two separate clock reads, so
   * on a busy machine they differ by a millisecond or two and an exact "8 hours" comparison fails
   * at random. With one instant both reads agree and the assertion can stay exact: the limit is
   * checked to the millisecond, with no tolerance that could hide a real drift. Only `Date` is
   * faked; timers and I/O run for real, and the clock runs again before this returns.
   */
  const signInAtFrozenInstant = async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
    try {
      return await passkeyBrowser(await createStaff());
    } finally {
      vi.useRealTimers();
    }
  };

  it("a session lasts 8 hours from sign-in, not Better Auth's 7 days", async () => {
    const b = await signInAtFrozenInstant();
    const session = await row(b);
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(8 * HOUR);
  });

  it("the browser's own session check (GET get-session) never moves the idle clock", async () => {
    const b = await signInAtFrozenInstant();
    const id = (await row(b)).id;
    await setSession(id, { lastActivityAt: new Date(Date.now() - 20 * MINUTE) });
    const before = (await row(b)).lastActivityAt?.getTime();
    for (let i = 0; i < 3; i += 1) expect((await b.call("/get-session")).json).not.toBeNull();
    expect((await row(b)).lastActivityAt?.getTime()).toBe(before);
    // and an expiry time Better Auth would have pushed back stays put
    expect((await row(b)).expiresAt.getTime()).toBe((await row(b)).createdAt.getTime() + 8 * HOUR);
  });

  it("an interactive request (a POST) moves it", async () => {
    const b = await passkeyBrowser(await createStaff());
    const id = (await row(b)).id;
    await setSession(id, { lastActivityAt: new Date(Date.now() - 20 * MINUTE) });
    expect((await b.call("/two-factor/enable", {})).status).toBe(200);
    const moved = (await row(b)).lastActivityAt?.getTime() ?? 0;
    expect(Date.now() - moved).toBeLessThan(MINUTE);
  });

  it("30 minutes without activity: the session is refused and gone, even with a valid cookie", async () => {
    const b = await passkeyBrowser(await createStaff());
    const id = (await row(b)).id;
    await setSession(id, { lastActivityAt: new Date(Date.now() - 30 * MINUTE - 1000) });
    expect((await b.call("/get-session")).json).toBeNull();
    expect((await iso.db.select().from(sessions).where(eq(sessions.id, id))).length).toBe(0);
    expect((await b.call("/two-factor/enable", {})).status).toBe(401);
  });

  it("29 minutes without activity is still fine", async () => {
    const b = await passkeyBrowser(await createStaff());
    await setSession((await row(b)).id, {
      lastActivityAt: new Date(Date.now() - 29 * MINUTE),
    });
    expect((await b.call("/get-session")).json).not.toBeNull();
  });

  it("8 hours after sign-in the session is refused however active it was", async () => {
    const b = await passkeyBrowser(await createStaff());
    const id = (await row(b)).id;
    await setSession(id, {
      createdAt: new Date(Date.now() - 8 * HOUR - 1000),
      lastActivityAt: new Date(),
    });
    expect((await b.call("/get-session")).json).toBeNull();
    expect((await iso.db.select().from(sessions).where(eq(sessions.id, id))).length).toBe(0);
  });

  it("two sessions of one person have separate idle clocks", async () => {
    const userId = await createStaff();
    const counter = await passkeyBrowser(userId);
    const office = await passkeyBrowser(userId);
    await setSession((await row(counter)).id, {
      lastActivityAt: new Date(Date.now() - 31 * MINUTE),
    });
    // activity on the office workstation does not rescue the counter one
    expect((await office.call("/two-factor/enable", {})).status).toBe(200);
    expect((await counter.call("/get-session")).json).toBeNull();
    expect((await office.call("/get-session")).json).not.toBeNull();
  });
});

describe("sign-up (#91)", () => {
  it("is closed: no account can be created through Better Auth", async () => {
    const email = `${crypto.randomUUID()}@example.test`;
    const res = await browser().call("/sign-up/email", {
      email,
      password: "a-long-enough-password-123",
      name: "Someone",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await iso.db.select().from(users).where(eq(users.email, email))).toEqual([]);
  });
});

describe("server-owned fields", () => {
  it("a request body cannot set mfaVerifiedAt or enrolmentAt", async () => {
    const userId = await createStaff();
    const b = await enrolledBrowser(userId);
    await iso.db
      .update(sessions)
      .set({ enrolmentAt: null })
      .where(eq(sessions.id, String((await b.session())?.id)));
    const now = new Date().toISOString();
    await b.call("/update-session", { mfaVerifiedAt: now, enrolmentAt: now });
    await b.call("/update-user", { mfaVerifiedAt: now, kind: "staff" });
    const session = await b.session();
    expect(session?.mfaVerifiedAt).toBeNull();
    expect(session?.enrolmentAt).toBeNull();
  });
});

describe("passkey user verification (36b)", () => {
  // the library verifies with requireUserVerification: false; both afterVerification hooks call
  // this, before any passkey row or session is written (full ceremony: e2e two-step.spec.ts)
  it("refuses an assertion or registration without the UV flag", () => {
    for (const verification of [
      { authenticationInfo: { userVerified: false } },
      { registrationInfo: { userVerified: false } },
      {},
    ]) {
      expect(() => requireUserVerification(verification)).toThrow(
        expect.objectContaining({
          body: expect.objectContaining({ code: "USER_VERIFICATION_REQUIRED" }),
        }),
      );
    }
    expect(() =>
      requireUserVerification({ authenticationInfo: { userVerified: true } }),
    ).not.toThrow();
    expect(() =>
      requireUserVerification({ registrationInfo: { userVerified: true } }),
    ).not.toThrow();
  });
});
