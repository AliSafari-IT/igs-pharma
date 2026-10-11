// 2-step login flows (36b) through a real Better Auth instance (HTTP handler, hooks, cookies) on
// real Postgres. Passkey ceremonies are covered end to end by the e2e suite (virtual authenticator);
// here passkeys are inserted as rows to exercise the factor rules around them.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import {
  ENROLMENT_TTL_MS,
  identitySchema,
  loadActor,
  newEnrolmentToken,
  storeEnrolmentToken,
} from "@igs/module-identity";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type SecurityEvent, createAuth } from "./index";
import { requireUserVerification } from "./mfa-plugin";

const { passkeys, sessions, twoFactors, users } = identitySchema;
const BASE_URL = "http://localhost:3001";

let iso: IsolatedDatabase;
let auth: ReturnType<typeof createAuth>;
let events: SecurityEvent[] = [];

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  auth = createAuth({
    db: iso.db,
    secret: "test-secret-test-secret-test-secret-0123",
    baseURL: BASE_URL,
    onSecurityEvent: async (event) => void events.push(event),
  });
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  events = [];
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

describe("TOTP (backup factor)", () => {
  it("enrolling TOTP on the link session verifies the new session and reports mfa.enrolled", async () => {
    const userId = await createStaff();
    const b = await enrolledBrowser(userId);
    await enrolTotp(b);

    const session = await b.session();
    expect(session?.mfaVerifiedAt).toBeInstanceOf(Date);
    expect((await loadActor(iso.db, userId, { sessionId: session?.id ?? null }))?.mfaVerified).toBe(
      true,
    );
    expect(events).toEqual([{ type: "mfa.enrolled", userId, method: "totp" }]);
  });

  it("a TOTP code verifies an existing unverified session; a wrong code does not", async () => {
    const userId = await createStaff();
    const uri = await enrolTotp(await enrolledBrowser(userId));
    events = [];

    const later = await enrolledBrowser(userId); // e.g. a recovery link: not verified
    expect((await later.session())?.mfaVerifiedAt).toBeNull();
    expect((await later.call("/two-factor/verify-totp", { code: "000000" })).status).toBe(401);
    expect((await later.session())?.mfaVerifiedAt).toBeNull();
    expect((await later.call("/two-factor/verify-totp", { code: await codeFor(uri) })).status).toBe(
      200,
    );
    expect((await later.session())?.mfaVerifiedAt).toBeInstanceOf(Date);
    expect(events).toEqual([]); // verifying is not enrolling
  });

  it("an unverified staff session cannot read the TOTP secret or add a factor once one exists", async () => {
    const userId = await createStaff();
    await enrolTotp(await enrolledBrowser(userId));
    const later = await enrolledBrowser(userId);
    for (const path of ["/two-factor/get-totp-uri", "/two-factor/enable"]) {
      expect(await later.call(path, {}), path).toMatchObject({
        status: 403,
        json: { code: "MFA_REQUIRED" },
      });
    }
    expect((await later.call("/passkey/generate-register-options")).status).toBe(403);
  });
});

describe("removing a factor", () => {
  it("a staff user cannot remove their last factor", async () => {
    const userId = await createStaff();
    const b = await enrolledBrowser(userId);
    await enrolTotp(b);
    expect(await b.call("/two-factor/disable", {})).toMatchObject({
      status: 400,
      json: { code: "LAST_FACTOR" },
    });
    const [user] = await iso.db.select().from(users).where(eq(users.id, userId));
    expect(user?.twoFactorEnabled).toBe(true);
  });

  it("removal needs a verified session", async () => {
    const userId = await createStaff();
    await enrolTotp(await enrolledBrowser(userId));
    await addPasskeyRow(userId);
    const later = await enrolledBrowser(userId);
    expect(await later.call("/two-factor/disable", {})).toMatchObject({
      status: 403,
      json: { code: "MFA_REQUIRED" },
    });
  });

  it("with another factor left: removed, other sessions lose their mark, mfa.removed reported", async () => {
    const userId = await createStaff();
    const acting = await enrolledBrowser(userId);
    await enrolTotp(acting);
    await addPasskeyRow(userId);
    const other = await enrolledBrowser(userId);
    await iso.db
      .update(sessions)
      .set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, String((await other.session())?.id)));
    events = [];

    expect((await acting.call("/two-factor/disable", {})).status).toBe(200);
    expect(events).toEqual([{ type: "mfa.removed", userId, method: "totp" }]);
    expect(await iso.db.select().from(twoFactors).where(eq(twoFactors.userId, userId))).toEqual([]);
    // Better Auth replaced the acting session; the replacement keeps its mark
    expect((await acting.session())?.mfaVerifiedAt).toBeInstanceOf(Date);
    expect((await other.session())?.mfaVerifiedAt).toBeNull();
  });

  it("disabling TOTP that was never enabled is refused (no false mfa.removed)", async () => {
    const userId = await createStaff();
    const b = await enrolledBrowser(userId);
    expect(await b.call("/two-factor/disable", {})).toMatchObject({
      status: 400,
      json: { code: "TOTP_NOT_ENABLED" },
    });
    expect(events).toEqual([]);
  });
});

describe("server-owned fields", () => {
  it("a request body cannot set mfaVerifiedAt", async () => {
    const userId = await createStaff();
    const b = await enrolledBrowser(userId);
    await b.call("/update-session", { mfaVerifiedAt: new Date().toISOString() });
    await b.call("/update-user", { mfaVerifiedAt: new Date().toISOString(), kind: "staff" });
    expect((await b.session())?.mfaVerifiedAt).toBeNull();
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
