// 2-step login facts and the bootstrap command (36b) against real Postgres, with the RBAC catalogue
// loaded from the database and the real audit port.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { isDomainError } from "@igs/kernel";
import { type KernelTestHandles, actors, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ENROLMENT_TTL_MS,
  bootstrapStaff,
  clearOtherSessionsMfa,
  grantRole,
  loadActor,
  loadRbacCatalogue,
  markSessionMfaVerified,
  mfaFactors,
  recordSecurityEvent,
  redeemEnrolmentToken,
  registerAuditActions,
  reissueEnrolment,
} from "../src";
import {
  accounts,
  passkeys,
  sessions,
  twoFactors,
  userRoles,
  users,
  verifications,
} from "../src/schema";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerAuditActions(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(async () => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date()); // audit partitions exist around "now"
  // the bootstrap refuses a second holder: start every test without owners or titulars
  await iso.db.delete(userRoles).where(eq(userRoles.roleKey, "owner"));
  await iso.db.delete(userRoles).where(eq(userRoles.roleKey, "pharmacist_titular"));
});

const bootstrapper = () => actors.system({ id: "bootstrap-cli", roles: ["system_bootstrap"] });
const authHook = () => actors.system({ id: "auth", roles: ["system_auth"] });

async function createUser(kind: "customer" | "staff" = "staff") {
  const [user] = await iso.db
    .insert(users)
    .values({ name: "Test Person", email: `${crypto.randomUUID()}@example.test`, kind })
    .returning({ id: users.id });
  if (!user) throw new Error("insert failed");
  return user.id;
}

async function createSession(userId: string, mfaVerifiedAt: Date | null = null) {
  const [row] = await iso.db
    .insert(sessions)
    .values({
      userId,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
      mfaVerifiedAt,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error("insert failed");
  return row.id;
}

const addPasskey = (userId: string) =>
  iso.db
    .insert(passkeys)
    .values({
      userId,
      publicKey: "pk",
      credentialID: crypto.randomUUID(),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
    })
    .returning({ id: passkeys.id });

async function enableTotp(userId: string, verified = true) {
  await iso.db.insert(twoFactors).values({ userId, secret: "s", backupCodes: "b", verified });
  if (verified) {
    await iso.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, userId));
  }
}

const auditFor = (userId: string) =>
  iso.sql<{ action: string; actor_type: string; data: Record<string, unknown> }[]>`
    SELECT action, actor_type, data FROM audit.events WHERE entity_id = ${userId} ORDER BY seq`;

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

describe("second-factor facts", () => {
  it("counts passkeys and a confirmed TOTP only", async () => {
    const id = await createUser();
    expect(await mfaFactors(iso.db, id)).toEqual({ passkeys: 0, totp: false });
    await enableTotp(id, false); // started, never confirmed with a code
    expect(await mfaFactors(iso.db, id)).toEqual({ passkeys: 0, totp: false });
    await iso.db.delete(twoFactors).where(eq(twoFactors.userId, id));
    await enableTotp(id);
    await addPasskey(id);
    await addPasskey(id);
    expect(await mfaFactors(iso.db, id)).toEqual({ passkeys: 2, totp: true });
  });

  it("an actor is MFA-verified only on a marked session of theirs with a factor still enrolled", async () => {
    const id = await createUser();
    const marked = await createSession(id, new Date());
    const unmarked = await createSession(id);
    const someoneElses = await createSession(await createUser(), new Date());

    // marked but no factor enrolled (all removed since): not verified
    expect((await loadActor(iso.db, id, { sessionId: marked }))?.mfaVerified).toBe(false);
    await addPasskey(id);
    expect((await loadActor(iso.db, id, { sessionId: marked }))?.mfaVerified).toBe(true);
    expect((await loadActor(iso.db, id, { sessionId: unmarked }))?.mfaVerified).toBe(false);
    expect((await loadActor(iso.db, id, { sessionId: someoneElses }))?.mfaVerified).toBe(false);
    expect((await loadActor(iso.db, id))?.mfaVerified).toBe(false);
    expect((await loadActor(iso.db, id, { sessionId: marked }))?.profile.factors).toEqual({
      passkeys: 1,
      totp: false,
    });
  });

  it("removing a factor clears every other session's mark, keeping the acting one", async () => {
    const id = await createUser();
    await addPasskey(id);
    const acting = await createSession(id);
    await markSessionMfaVerified(iso.db, acting);
    const other = await createSession(id, new Date());
    const bystander = await createUser();
    const bystanderSession = await createSession(bystander, new Date());

    await clearOtherSessionsMfa(iso.db, id, acting);
    const marks = await iso.db
      .select({ id: sessions.id, at: sessions.mfaVerifiedAt })
      .from(sessions)
      .where(eq(sessions.userId, id));
    expect(marks.find((s) => s.id === acting)?.at).toBeInstanceOf(Date);
    expect(marks.find((s) => s.id === other)?.at).toBeNull();
    const [kept] = await iso.db
      .select({ at: sessions.mfaVerifiedAt })
      .from(sessions)
      .where(eq(sessions.id, bystanderSession));
    expect(kept?.at).toBeInstanceOf(Date);
  });
});

describe("staff actors and the kernel guard", () => {
  it("staff without a verified second factor cannot run identity commands", async () => {
    const owner = await createUser();
    await iso.db.insert(userRoles).values({ userId: owner, roleKey: "owner" });
    const target = await createUser();
    const session = await createSession(owner);
    const actor = await loadActor(iso.db, owner, { sessionId: session });
    if (!actor) throw new Error("no actor");
    expect(await codeOf(grantRole({ userId: target, roleKey: "content_editor" }, actor))).toBe(
      "kernel.mfa_required",
    );

    await addPasskey(owner);
    await markSessionMfaVerified(iso.db, session);
    const verified = await loadActor(iso.db, owner, { sessionId: session });
    if (!verified) throw new Error("no actor");
    expect(await codeOf(grantRole({ userId: target, roleKey: "content_editor" }, verified))).toBe(
      "ok",
    );
  });

  it("no user can be granted a system role", async () => {
    const owner = await createUser();
    await iso.db.insert(userRoles).values({ userId: owner, roleKey: "owner" });
    const actor = { ...(await loadActor(iso.db, owner)), mfaVerified: true } as never;
    const target = await createUser();
    expect(await codeOf(grantRole({ userId: target, roleKey: "system_bootstrap" }, actor))).toBe(
      "identity.role_kind_mismatch",
    );
  });
});

describe("bootstrap (Q4)", () => {
  it("creates a credential-less staff owner, a 15-minute single-use link, and audits it", async () => {
    const email = `${crypto.randomUUID()}@example.test`;
    const before = kernel.clock.now();
    const { userId, token, expiresAt } = await bootstrapStaff(
      { email, name: "First Owner" },
      bootstrapper(),
    );

    const [user] = await iso.db.select().from(users).where(eq(users.id, userId));
    expect(user).toMatchObject({ email, kind: "staff", status: "active", name: "First Owner" });
    expect(await iso.db.select().from(accounts).where(eq(accounts.userId, userId))).toEqual([]);
    const grants = await iso.db
      .select({ roleKey: userRoles.roleKey, locationId: userRoles.locationId })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));
    expect(grants).toEqual([{ roleKey: "owner", locationId: null }]);
    expect(expiresAt.getTime() - before.getTime()).toBe(ENROLMENT_TTL_MS);

    // the token itself is never stored
    const stored = await iso.db.select().from(verifications);
    expect(JSON.stringify(stored)).not.toContain(token);

    expect(await auditFor(userId)).toEqual([
      {
        action: "identity.owner.bootstrapped",
        actor_type: "system",
        data: { userId, roleKey: "owner" },
      },
    ]);

    expect(await redeemEnrolmentToken(iso.db, token)).toBe(userId);
    expect(await redeemEnrolmentToken(iso.db, token)).toBeNull(); // single use
  });

  it("refuses a second owner and a taken e-mail, writing nothing", async () => {
    const first = await bootstrapStaff(
      { email: `${crypto.randomUUID()}@example.test`, name: "Owner" },
      bootstrapper(),
    );
    const email = `${crypto.randomUUID()}@example.test`;
    expect(await codeOf(bootstrapStaff({ email, name: "Second" }, bootstrapper()))).toBe(
      "identity.role_already_held",
    );
    expect(await iso.db.select().from(users).where(eq(users.email, email))).toEqual([]);

    const [existing] = await iso.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, first.userId));
    expect(
      await codeOf(
        bootstrapStaff(
          { email: existing?.email, name: "Titular", roleKey: "pharmacist_titular" },
          bootstrapper(),
        ),
      ),
    ).toBe("identity.email_taken");
  });

  it("creates the titular pharmacist only while there is none", async () => {
    const input = () => ({
      email: `${crypto.randomUUID()}@example.test`,
      name: "Titular",
      roleKey: "pharmacist_titular",
    });
    const { userId } = await bootstrapStaff(input(), bootstrapper());
    expect((await loadActor(iso.db, userId))?.roles).toEqual(["pharmacist_titular"]);
    expect(await codeOf(bootstrapStaff(input(), bootstrapper()))).toBe(
      "identity.role_already_held",
    );
    expect(
      await codeOf(bootstrapStaff({ ...input(), roleKey: "pharmacist" }, bootstrapper())),
    ).toBe("kernel.validation_failed");
  });

  it("concurrent runs create exactly one owner", async () => {
    const run = () =>
      codeOf(
        bootstrapStaff(
          { email: `${crypto.randomUUID()}@example.test`, name: "Owner" },
          bootstrapper(),
        ),
      );
    const results = await Promise.all([run(), run(), run()]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "identity.role_already_held")).toHaveLength(2);
  });

  it("only the system_bootstrap role may run it; not even an MFA-verified owner", async () => {
    const owner = actors.user({ roles: ["owner"], kind: "staff", mfaVerified: true });
    const input = { email: `${crypto.randomUUID()}@example.test`, name: "X" };
    expect(await codeOf(bootstrapStaff(input, owner))).toBe("kernel.forbidden");
    expect(await codeOf(bootstrapStaff(input, authHook()))).toBe("kernel.forbidden");
  });

  it("an expired or unknown link redeems to nothing", async () => {
    const { token } = await bootstrapStaff(
      { email: `${crypto.randomUUID()}@example.test`, name: "Owner" },
      bootstrapper(),
    );
    const later = new Date(Date.now() + ENROLMENT_TTL_MS + 1_000);
    expect(await redeemEnrolmentToken(iso.db, token, later)).toBeNull();
    expect(await redeemEnrolmentToken(iso.db, "not-a-token")).toBeNull();
    expect(await redeemEnrolmentToken(iso.db, "")).toBeNull();
  });
});

describe("re-issuing an enrolment link (Q4 recovery)", () => {
  const bootstrapOwner = async () => {
    const email = `${crypto.randomUUID()}@example.test`;
    const first = await bootstrapStaff({ email, name: "Owner" }, bootstrapper());
    return { email, ...first };
  };

  it("replaces the expired link of a holder with no factor, and audits it", async () => {
    const { email, userId, token: expired } = await bootstrapOwner();
    const { userId: same, token, expiresAt } = await reissueEnrolment({ email }, bootstrapper());
    expect(same).toBe(userId);
    expect(expiresAt.getTime() - kernel.clock.now().getTime()).toBe(ENROLMENT_TTL_MS);
    expect(await redeemEnrolmentToken(iso.db, expired)).toBeNull(); // the earlier link is gone
    expect(await redeemEnrolmentToken(iso.db, token)).toBe(userId);
    expect((await auditFor(userId)).map((row) => row.action)).toEqual([
      "identity.owner.bootstrapped",
      "identity.enrolment.reissued",
    ]);
    const [entry] = (await auditFor(userId)).slice(-1);
    expect(entry?.data).toEqual({ userId });
  });

  it("refuses a holder who already has a second factor, writing nothing", async () => {
    const { email, userId, token } = await bootstrapOwner();
    await addPasskey(userId);
    expect(await codeOf(reissueEnrolment({ email }, bootstrapper()))).toBe(
      "identity.already_enrolled",
    );
    expect(await redeemEnrolmentToken(iso.db, token)).toBe(userId); // earlier link untouched
    expect((await auditFor(userId)).map((row) => row.action)).toEqual([
      "identity.owner.bootstrapped",
    ]);
  });

  it("refuses anyone who is not an active staff owner or titular", async () => {
    const plainStaff = await createUser("staff");
    const [row] = await iso.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, plainStaff));
    expect(await codeOf(reissueEnrolment({ email: String(row?.email) }, bootstrapper()))).toBe(
      "identity.not_a_bootstrap_holder",
    );
    expect(await codeOf(reissueEnrolment({ email: "nobody@example.test" }, bootstrapper()))).toBe(
      "identity.user_not_found",
    );

    const { email, userId } = await bootstrapOwner();
    await iso.db.update(users).set({ status: "suspended" }).where(eq(users.id, userId));
    expect(await codeOf(reissueEnrolment({ email }, bootstrapper()))).toBe(
      "identity.user_not_found",
    );
  });

  it("only the system_bootstrap role may run it", async () => {
    const { email } = await bootstrapOwner();
    const owner = actors.user({ roles: ["owner"], kind: "staff", mfaVerified: true });
    expect(await codeOf(reissueEnrolment({ email }, owner))).toBe("kernel.forbidden");
  });
});

describe("security events (onSecurityEvent → audit)", () => {
  it("records identity.mfa.enrolled|removed with the user id and method only", async () => {
    const id = await createUser();
    await recordSecurityEvent({ userId: id, type: "mfa.enrolled", method: "passkey" }, authHook());
    await recordSecurityEvent({ userId: id, type: "mfa.removed", method: "totp" }, authHook());
    expect(await auditFor(id)).toEqual([
      {
        action: "identity.mfa.enrolled",
        actor_type: "system",
        data: { userId: id, method: "passkey" },
      },
      {
        action: "identity.mfa.removed",
        actor_type: "system",
        data: { userId: id, method: "totp" },
      },
    ]);
  });

  it("users cannot forge one", async () => {
    const id = await createUser();
    const owner = actors.user({ id, roles: ["owner"], kind: "staff", mfaVerified: true });
    expect(
      await codeOf(recordSecurityEvent({ userId: id, type: "mfa.removed", method: "totp" }, owner)),
    ).toBe("kernel.forbidden");
  });
});
