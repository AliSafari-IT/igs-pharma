// igs-pharma#100: the fresh proof for sensitive changes must come from a PASSKEY check only. These
// tests go through the real Better Auth handler on real Postgres, with a software passkey that
// answers the real WebAuthn ceremony (test-support.ts), and then through the real kernel command.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import {
  grantRole,
  identitySchema,
  loadActor,
  loadRbacCatalogue,
  registerAuditActions as registerIdentityAudit,
} from "@igs/module-identity";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type SecurityEvent, createAuth } from "@igs/auth";
import {
  BASE_URL,
  SoftwarePasskey,
  type TestAuth,
  type TestBrowser,
  createBrowser,
  totpCodeFor,
} from "./support/auth";

const { sessions, userRoles, users } = identitySchema;

let iso: IsolatedDatabase;
let auth: TestAuth;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerIdentityAudit(registerAuditAction);
  auth = createAuth({
    db: iso.db,
    secret: "test-secret-test-secret-test-secret-0123",
    baseURL: BASE_URL,
    onSecurityEvent: async (_event: SecurityEvent) => {},
  });
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  configureKernelForTests({ db: iso.db, audit: createAuditPort() }).clock.set(new Date());
});

const HOUR = 60 * 60 * 1000;

async function staff(...roles: string[]) {
  const [user] = await iso.db
    .insert(users)
    .values({ name: "Staff Person", email: `${crypto.randomUUID()}@example.test`, kind: "staff" })
    .returning({ id: users.id });
  if (!user) throw new Error("insert failed");
  for (const roleKey of roles) await iso.db.insert(userRoles).values({ userId: user.id, roleKey });
  return user.id;
}

/** An owner who signed in with a real passkey ceremony. */
async function signedInOwner() {
  const userId = await staff("owner");
  const passkey = new SoftwarePasskey();
  await passkey.register(iso, userId);
  const browser = createBrowser(auth, iso);
  const answer = await passkey.signIn(browser);
  expect(answer.status).toBe(200);
  return { userId, passkey, browser };
}

/** The kernel actor of the browser's current session, as `resolveActor` builds it. */
async function actorOf(userId: string, browser: TestBrowser): Promise<Actor> {
  const session = await browser.session();
  const actor = await loadActor(iso.db, userId, { sessionId: session?.id ?? "" });
  if (!actor) throw new Error("no actor");
  return actor as unknown as Actor;
}

/** Ages the proof of the current session: "checked `ms` ago" (an unlocked workstation). */
async function ageProof(browser: TestBrowser, ms: number) {
  const session = await browser.session();
  const at = new Date(Date.now() - ms);
  await iso.db
    .update(sessions)
    .set({ mfaVerifiedAt: at, passkeyCheckedAt: at })
    .where(eq(sessions.id, session?.id ?? ""));
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

describe("the software passkey", () => {
  it("signs in through the real ceremony: a verified session", async () => {
    const { userId, browser } = await signedInOwner();
    const session = await browser.session();
    expect(session?.userId).toBe(userId);
    expect(session?.mfaVerifiedAt).toBeInstanceOf(Date);
  });

  it("is refused without user verification", async () => {
    const userId = await staff("owner");
    const passkey = new SoftwarePasskey();
    await passkey.register(iso, userId);
    const browser = createBrowser(auth, iso);
    expect((await passkey.signIn(browser, { userVerified: false })).status).toBe(401);
    expect(await browser.session()).toBeUndefined();
  });
});

describe("the fresh proof comes from a passkey check only (igs-pharma#100)", () => {
  it("an authenticator app cannot be added on a session whose passkey check is 3 hours old, so it cannot make it fresh", async () => {
    const { userId, browser } = await signedInOwner();
    const target = await staff("pharmacy_assistant");
    await ageProof(browser, 3 * HOUR);
    const grant = async () =>
      codeOf(
        grantRole({ userId: target, roleKey: "content_editor" }, await actorOf(userId, browser)),
      );
    expect(await grant()).toBe("identity.fresh_mfa_required");

    // the old attack: someone at the unlocked workstation adds an authenticator app of their own
    const enabled = await browser.call("/two-factor/enable", {});
    expect(enabled.status).toBe(403);
    expect(enabled.json?.["code"]).toBe("FRESH_PASSKEY_REQUIRED");
    expect(await grant()).toBe("identity.fresh_mfa_required");
  });

  it("an authenticator app that already exists (a TOTP code) verifies the session but never makes it fresh", async () => {
    const { userId, browser, passkey } = await signedInOwner();
    const target = await staff("pharmacy_assistant");
    // enrol the app while the passkey check is fresh
    const enabled = await browser.call("/two-factor/enable", {});
    expect(enabled.status).toBe(200);
    const uri = String(enabled.json?.["totpURI"] ?? "");
    expect(
      (await browser.call("/two-factor/verify-totp", { code: await totpCodeFor(auth, uri) }))
        .status,
    ).toBe(200);
    await ageProof(browser, 3 * HOUR);
    const again = await browser.call("/two-factor/verify-totp", {
      code: await totpCodeFor(auth, uri),
    });
    expect(again.status).toBe(200);
    expect((await browser.session())?.mfaVerifiedAt?.getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
    expect(
      await codeOf(
        grantRole({ userId: target, roleKey: "content_editor" }, await actorOf(userId, browser)),
      ),
    ).toBe("identity.fresh_mfa_required");
    // a passkey check does
    expect((await passkey.signIn(browser)).status).toBe(200);
    expect(
      await codeOf(
        grantRole({ userId: target, roleKey: "content_editor" }, await actorOf(userId, browser)),
      ),
    ).toBe("ok");
  });

  it("a passkey check inside a live session rotates the token but never moves the 8-hour clock", async () => {
    const { userId, browser, passkey } = await signedInOwner();
    const before = await browser.session();
    const created = new Date(Date.now() - 3 * HOUR);
    const active = new Date(Date.now() - 5 * 60 * 1000);
    await iso.db
      .update(sessions)
      .set({ createdAt: created, lastActivityAt: active, passkeyCheckedAt: created })
      .where(eq(sessions.id, before?.id ?? ""));
    const oldToken = browser.jar.get("better-auth.session_token");
    expect((await passkey.signIn(browser)).status).toBe(200);
    const after = await browser.session();
    expect(after?.userId).toBe(userId);
    expect(after?.id).not.toBe(before?.id);
    expect(browser.jar.get("better-auth.session_token")).not.toBe(oldToken);
    expect(after?.createdAt.getTime()).toBe(created.getTime());
    // the check is the person's own request, so the idle clock restarts; the 8 hours never move
    expect(after?.lastActivityAt?.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(after?.passkeyCheckedAt?.getTime()).toBeGreaterThan(Date.now() - 60_000);
    // the old session is gone
    const old = await iso.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, before?.id ?? ""));
    expect(old).toEqual([]);
  });

  it("confirming an authenticator app inside a live session rotates the token, keeps the 8-hour clock and the old passkey check", async () => {
    const { browser } = await signedInOwner();
    const before = await browser.session();
    const created = new Date(Date.now() - 3 * HOUR);
    const checked = new Date(Date.now() - 2 * 60 * 1000);
    await iso.db
      .update(sessions)
      .set({ createdAt: created, lastActivityAt: new Date(), passkeyCheckedAt: checked })
      .where(eq(sessions.id, before?.id ?? ""));
    const enabled = await browser.call("/two-factor/enable", {});
    await browser.call("/two-factor/verify-totp", {
      code: await totpCodeFor(auth, String(enabled.json?.["totpURI"])),
    });
    const after = await browser.session();
    expect(after?.id).not.toBe(before?.id);
    expect(after?.createdAt.getTime()).toBe(created.getTime());
    expect(after?.passkeyCheckedAt?.getTime()).toBe(checked.getTime());
  });

  it("a user without a passkey check in the last 10 minutes gets FRESH_PASSKEY_REQUIRED for a second passkey; with one it goes through", async () => {
    const { browser, passkey } = await signedInOwner();
    await ageProof(browser, 11 * 60 * 1000);
    const refused = await browser.call("/passkey/generate-register-options");
    expect(refused.status).toBe(403);
    expect(refused.json?.["code"]).toBe("FRESH_PASSKEY_REQUIRED");
    expect((await passkey.signIn(browser)).status).toBe(200);
    expect((await browser.call("/passkey/generate-register-options")).status).toBe(200);
  });
});
