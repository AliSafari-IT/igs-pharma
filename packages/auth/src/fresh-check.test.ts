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

import { type SecurityEvent, createAuth } from "./index";
import {
  BASE_URL,
  SoftwarePasskey,
  type TestAuth,
  type TestBrowser,
  createBrowser,
  totpCodeFor,
} from "./test-support";

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

/** Ages the proof of the current session: "verified `ms` ago" (an unlocked workstation). */
async function ageProof(browser: TestBrowser, ms: number) {
  const session = await browser.session();
  await iso.db
    .update(sessions)
    .set({ mfaVerifiedAt: new Date(Date.now() - ms) })
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

describe("the gap, before the fix (igs-pharma#100)", () => {
  it("TODAY: enrolling an authenticator app on a session verified 3 hours ago makes it 'fresh', and a role grant goes through", async () => {
    const { userId, browser } = await signedInOwner();
    const target = await staff("pharmacy_assistant");
    await ageProof(browser, 3 * HOUR);
    // not fresh yet: the grant is refused
    expect(
      await codeOf(
        grantRole({ userId: target, roleKey: "content_editor" }, await actorOf(userId, browser)),
      ),
    ).toBe("identity.fresh_mfa_required");

    // the attack: someone at the unlocked workstation adds an authenticator app of their own
    const enabled = await browser.call("/two-factor/enable", {});
    const uri = String(enabled.json?.["totpURI"] ?? "");
    const confirmed = await browser.call("/two-factor/verify-totp", {
      code: await totpCodeFor(auth, uri),
    });
    expect([enabled.status, confirmed.status]).toEqual([200, 200]);

    // ... and the session counts as freshly proven: the role is granted
    expect(
      await codeOf(
        grantRole({ userId: target, roleKey: "content_editor" }, await actorOf(userId, browser)),
      ),
    ).toBe("ok");
  });
});
