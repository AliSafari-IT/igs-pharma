// igs-pharma#90: staff sign-in recovery (owner reset, operator reset), factor removal that commits
// with its audit entry, and the Staff list. Real Postgres, the RBAC catalogue from the database, the
// real audit port.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { isDomainError } from "@igs/kernel";
import { type KernelTestHandles, actors, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  FRESH_MFA_MS,
  applySecurityEvent,
  listStaff,
  loadRbacCatalogue,
  mfaFactors,
  redeemEnrolmentToken,
  registerAuditActions,
  removeFactor,
  resetSignInByOperator,
  resetStaffSignIn,
} from "../src";
import { passkeys, sessions, twoFactors, userRoles, users, verifications } from "../src/schema";

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
beforeEach(() => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date()); // audit partitions exist around "now"
});

const authHook = () => actors.system({ id: "auth", roles: ["system_auth"] });
const operator = () => actors.system({ id: "bootstrap-cli", roles: ["system_bootstrap"] });

async function createStaff(...roleKeys: string[]) {
  const email = `${crypto.randomUUID()}@example.test`;
  const [user] = await iso.db
    .insert(users)
    .values({ name: "Staff Person", email, kind: "staff" })
    .returning({ id: users.id });
  if (!user) throw new Error("insert failed");
  for (const roleKey of roleKeys)
    await iso.db.insert(userRoles).values({ userId: user.id, roleKey });
  return { id: user.id, email };
}

/** The acting owner: an MFA-verified staff actor whose proof is `ageMs` old. */
function actorOf(id: string, roles: string[], ageMs = 0) {
  return actors.user({
    id,
    roles,
    kind: "staff",
    mfaVerified: true,
    mfaVerifiedAt: new Date(kernel.clock.now().getTime() - ageMs),
    passkeyCheckedAt: new Date(kernel.clock.now().getTime() - ageMs),
  });
}

async function addPasskey(userId: string) {
  const [row] = await iso.db
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
  if (!row) throw new Error("insert failed");
  return row.id;
}

async function enableTotp(userId: string) {
  await iso.db.insert(twoFactors).values({ userId, secret: "s", backupCodes: "b", verified: true });
  await iso.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, userId));
}

async function createSession(userId: string, verified = true) {
  const [row] = await iso.db
    .insert(sessions)
    .values({
      userId,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
      mfaVerifiedAt: verified ? new Date() : null,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error("insert failed");
  return row.id;
}

const sessionsOf = (userId: string) =>
  iso.db.select().from(sessions).where(eq(sessions.userId, userId));

const auditFor = (userId: string) =>
  iso.sql<{ action: string; actor_id: string; data: Record<string, unknown> }[]>`
    SELECT action, actor_id, data FROM audit.events WHERE entity_id = ${userId} ORDER BY seq`;

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

/** The kernel with an audit port that fails at flush: the command's transaction must roll back. */
function breakAudit() {
  const real = createAuditPort();
  kernel = configureKernelForTests({
    db: iso.db,
    audit: {
      ...real,
      record: async () => {
        throw new Error("audit store unavailable");
      },
    },
  });
  kernel.clock.set(new Date());
}

describe("owner resets another staff member's sign-in (#90 C4)", () => {
  it("deletes every factor and session, issues one fresh link, audits ids only", async () => {
    const owner = await createStaff("owner");
    const target = await createStaff("pharmacy_assistant");
    await addPasskey(target.id);
    await addPasskey(target.id);
    await enableTotp(target.id);
    await createSession(target.id);
    await createSession(target.id, false);
    const { token: oldLink } = await resetSignInByOperatorFor(target.email).catch(() => ({
      token: "none",
    }));
    expect(oldLink).toBe("none"); // a pharmacy assistant is not an operator-reset target

    const { userId, token, expiresAt } = await resetStaffSignIn(
      { userId: target.id },
      actorOf(owner.id, ["owner"]),
    );

    expect(userId).toBe(target.id);
    expect(await mfaFactors(iso.db, target.id)).toEqual({ passkeys: 0, totp: false });
    expect(await iso.db.select().from(twoFactors).where(eq(twoFactors.userId, target.id))).toEqual(
      [],
    );
    expect(await sessionsOf(target.id)).toEqual([]);
    expect(expiresAt.getTime() - kernel.clock.now().getTime()).toBe(15 * 60 * 1000);
    const links = await iso.db
      .select()
      .from(verifications)
      .where(eq(verifications.value, target.id));
    expect(links).toHaveLength(1);
    expect(links[0]?.identifier).not.toContain(token); // only the hash is stored
    expect(await auditFor(target.id)).toEqual([
      { action: "identity.factors.reset", actor_id: owner.id, data: { userId: target.id } },
    ]);
    expect(await redeemEnrolmentToken(iso.db, token)).toBe(target.id);
  });

  it("a second reset replaces the first link", async () => {
    const owner = actorOf((await createStaff("owner")).id, ["owner"]);
    const target = await createStaff("content_editor");
    const first = await resetStaffSignIn({ userId: target.id }, owner);
    const second = await resetStaffSignIn({ userId: target.id }, owner);
    expect(await redeemEnrolmentToken(iso.db, first.token)).toBeNull();
    expect(await redeemEnrolmentToken(iso.db, second.token)).toBe(target.id);
  });

  it("never one's own sign-in, and only with a 2-step proof from the last 10 minutes", async () => {
    const owner = await createStaff("owner");
    await addPasskey(owner.id);
    expect(await codeOf(resetStaffSignIn({ userId: owner.id }, actorOf(owner.id, ["owner"])))).toBe(
      "identity.cannot_reset_own_sign_in",
    );

    const target = await createStaff("pharmacy_assistant");
    const keyId = await addPasskey(target.id);
    const stale = actorOf(owner.id, ["owner"], FRESH_MFA_MS + 1_000);
    expect(await codeOf(resetStaffSignIn({ userId: target.id }, stale))).toBe(
      "identity.fresh_mfa_required",
    );
    const never = actors.user({ id: owner.id, roles: ["owner"], kind: "staff", mfaVerified: true });
    expect(await codeOf(resetStaffSignIn({ userId: target.id }, never))).toBe(
      "identity.fresh_mfa_required",
    );
    // nothing was touched
    expect((await iso.db.select().from(passkeys).where(eq(passkeys.id, keyId))).length).toBe(1);
    expect(await auditFor(target.id)).toEqual([]);
  });

  it("only staff.manage may reset; customers, deleted and unknown users are not targets", async () => {
    const assistant = await createStaff("pharmacy_assistant");
    const target = await createStaff("content_editor");
    expect(
      await codeOf(
        resetStaffSignIn({ userId: target.id }, actorOf(assistant.id, ["pharmacy_assistant"])),
      ),
    ).toBe("kernel.forbidden");

    const owner = actorOf((await createStaff("owner")).id, ["owner"]);
    const [customer] = await iso.db
      .insert(users)
      .values({ name: "C", email: `${crypto.randomUUID()}@example.test`, kind: "customer" })
      .returning({ id: users.id });
    expect(await codeOf(resetStaffSignIn({ userId: String(customer?.id) }, owner))).toBe(
      "identity.user_not_found",
    );
    await iso.db.update(users).set({ status: "suspended" }).where(eq(users.id, target.id));
    expect(await codeOf(resetStaffSignIn({ userId: target.id }, owner))).toBe(
      "identity.user_not_found",
    );
    expect(await codeOf(resetStaffSignIn({ userId: crypto.randomUUID() }, owner))).toBe(
      "identity.user_not_found",
    );
  });

  it("a pharmacist or the titular needs pharmacy.pharmacists.manage as well (R-2)", async () => {
    const owner = await createStaff("owner");
    for (const role of ["pharmacist", "pharmacist_titular"]) {
      const target = await createStaff(role);
      await addPasskey(target.id);
      expect(
        await codeOf(resetStaffSignIn({ userId: target.id }, actorOf(owner.id, ["owner"]))),
        role,
      ).toBe("identity.pharmacist_access_requires_titular");
      expect((await mfaFactors(iso.db, target.id)).passkeys, role).toBe(1);
      // the titular alone lacks staff.manage
      const titular = await createStaff("pharmacist_titular");
      expect(
        await codeOf(
          resetStaffSignIn({ userId: target.id }, actorOf(titular.id, ["pharmacist_titular"])),
        ),
        role,
      ).toBe("kernel.forbidden");
      // an owner who is also titular holds both
      const both = actorOf(owner.id, ["owner", "pharmacist_titular"]);
      expect(await codeOf(resetStaffSignIn({ userId: target.id }, both)), role).toBe("ok");
    }
  });

  it("a failed audit rolls the whole reset back", async () => {
    const owner = actorOf((await createStaff("owner")).id, ["owner"]);
    const target = await createStaff("content_editor");
    await addPasskey(target.id);
    await createSession(target.id);
    breakAudit();
    await expect(resetStaffSignIn({ userId: target.id }, owner)).rejects.toThrow();
    expect((await mfaFactors(iso.db, target.id)).passkeys).toBe(1);
    expect(await sessionsOf(target.id)).toHaveLength(1);
    expect(
      await iso.db.select().from(verifications).where(eq(verifications.value, target.id)),
    ).toEqual([]);
  });
});

async function resetSignInByOperatorFor(email: string) {
  return resetSignInByOperator({ email }, operator());
}

describe("operator reset from the server (#90 C4, last resort)", () => {
  it("resets an owner or titular, audited the same way", async () => {
    for (const role of ["owner", "pharmacist_titular"]) {
      const holder = await createStaff(role);
      await addPasskey(holder.id);
      await enableTotp(holder.id);
      await createSession(holder.id);
      const { userId, token } = await resetSignInByOperatorFor(holder.email);
      expect(userId).toBe(holder.id);
      expect(await mfaFactors(iso.db, holder.id)).toEqual({ passkeys: 0, totp: false });
      expect(await sessionsOf(holder.id)).toEqual([]);
      expect(await auditFor(holder.id)).toEqual([
        { action: "identity.factors.reset", actor_id: "bootstrap-cli", data: { userId } },
      ]);
      expect(await redeemEnrolmentToken(iso.db, token)).toBe(holder.id);
    }
  });

  it("refuses anyone else, and anyone but the system_bootstrap role", async () => {
    const assistant = await createStaff("pharmacy_assistant");
    expect(await codeOf(resetSignInByOperatorFor(assistant.email))).toBe(
      "identity.not_a_bootstrap_holder",
    );
    expect(await codeOf(resetSignInByOperatorFor("nobody@example.test"))).toBe(
      "identity.user_not_found",
    );
    const owner = await createStaff("owner");
    await iso.db.update(users).set({ status: "deleted" }).where(eq(users.id, owner.id));
    expect(await codeOf(resetSignInByOperatorFor(owner.email))).toBe("identity.user_not_found");

    const active = await createStaff("owner");
    expect(
      await codeOf(resetSignInByOperator({ email: active.email }, actorOf(active.id, ["owner"]))),
    ).toBe("kernel.forbidden");
  });
});

describe("removing a factor commits with its audit entry (#90 C5)", () => {
  it("removes a passkey, clears the other sessions' mark, audits; the acting session keeps it", async () => {
    const user = await createStaff("pharmacy_assistant");
    const keep = await addPasskey(user.id);
    const remove = await addPasskey(user.id);
    const acting = await createSession(user.id);
    const other = await createSession(user.id);
    await applySecurityEvent(
      {
        type: "mfa.removed",
        userId: user.id,
        method: "passkey",
        passkeyId: remove,
        keepSessionId: acting,
      },
      authHook(),
    );
    const left = await iso.db.select().from(passkeys).where(eq(passkeys.userId, user.id));
    expect(left.map((row) => row.id)).toEqual([keep]);
    const marks = new Map((await sessionsOf(user.id)).map((s) => [s.id, s.mfaVerifiedAt]));
    expect(marks.get(acting)).toBeInstanceOf(Date);
    expect(marks.get(other)).toBeNull();
    expect(await auditFor(user.id)).toEqual([
      {
        action: "identity.mfa.removed",
        actor_id: "auth",
        data: { userId: user.id, method: "passkey" },
      },
    ]);
  });

  it("a staff user keeps their last passkey, even with TOTP; a customer may remove anything", async () => {
    const staff = await createStaff("pharmacy_assistant");
    const only = await addPasskey(staff.id);
    await enableTotp(staff.id);
    expect(
      await codeOf(
        removeFactor(
          { method: "passkey", userId: staff.id, passkeyId: only, keepSessionId: null },
          authHook(),
        ),
      ),
    ).toBe("identity.last_passkey");
    // TOTP may go: the passkey stays
    expect(
      await codeOf(
        removeFactor({ method: "totp", userId: staff.id, keepSessionId: null }, authHook()),
      ),
    ).toBe("ok");
    expect(await mfaFactors(iso.db, staff.id)).toEqual({ passkeys: 1, totp: false });

    const [customer] = await iso.db
      .insert(users)
      .values({ name: "C", email: `${crypto.randomUUID()}@example.test`, kind: "customer" })
      .returning({ id: users.id });
    const customerId = String(customer?.id);
    const key = await addPasskey(customerId);
    expect(
      await codeOf(
        removeFactor(
          { method: "passkey", userId: customerId, passkeyId: key, keepSessionId: null },
          authHook(),
        ),
      ),
    ).toBe("ok");
  });

  it("never removes another user's passkey; TOTP that is not on is refused", async () => {
    const owner = await createStaff("pharmacy_assistant");
    await addPasskey(owner.id);
    const victim = await createStaff("pharmacy_assistant");
    await addPasskey(victim.id);
    const victimKey = await addPasskey(victim.id);
    expect(
      await codeOf(
        removeFactor(
          { method: "passkey", userId: owner.id, passkeyId: victimKey, keepSessionId: null },
          authHook(),
        ),
      ),
    ).toBe("identity.last_passkey"); // the owner's own count decides first
    await addPasskey(owner.id);
    expect(
      await codeOf(
        removeFactor(
          { method: "passkey", userId: owner.id, passkeyId: victimKey, keepSessionId: null },
          authHook(),
        ),
      ),
    ).toBe("identity.factor_not_found");
    expect((await mfaFactors(iso.db, victim.id)).passkeys).toBe(2);
    expect(
      await codeOf(
        removeFactor({ method: "totp", userId: owner.id, keepSessionId: null }, authHook()),
      ),
    ).toBe("identity.totp_not_enabled");
  });

  it("two concurrent removals of the last two passkeys: exactly one succeeds", async () => {
    const user = await createStaff("pharmacy_assistant");
    const a = await addPasskey(user.id);
    const b = await addPasskey(user.id);
    const results = await Promise.all(
      [a, b].map((passkeyId) =>
        codeOf(
          removeFactor(
            { method: "passkey", userId: user.id, passkeyId, keepSessionId: null },
            authHook(),
          ),
        ),
      ),
    );
    expect(results.sort()).toEqual(["identity.last_passkey", "ok"]);
    expect((await mfaFactors(iso.db, user.id)).passkeys).toBe(1);
  });

  it("a failed audit leaves the factor in place", async () => {
    const user = await createStaff("pharmacy_assistant");
    await addPasskey(user.id);
    const key = await addPasskey(user.id);
    await enableTotp(user.id);
    breakAudit();
    await expect(
      removeFactor(
        { method: "passkey", userId: user.id, passkeyId: key, keepSessionId: null },
        authHook(),
      ),
    ).rejects.toThrow();
    await expect(
      removeFactor({ method: "totp", userId: user.id, keepSessionId: null }, authHook()),
    ).rejects.toThrow();
    expect(await mfaFactors(iso.db, user.id)).toEqual({ passkeys: 2, totp: true });
  });

  it("users cannot call it", async () => {
    const user = await createStaff("owner");
    await addPasskey(user.id);
    const key = await addPasskey(user.id);
    expect(
      await codeOf(
        removeFactor(
          { method: "passkey", userId: user.id, passkeyId: key, keepSessionId: null },
          actorOf(user.id, ["owner"]),
        ),
      ),
    ).toBe("kernel.forbidden");
  });
});

describe("the Staff list (#90)", () => {
  it("shows active and suspended staff with roles and sign-in methods, for staff.manage only", async () => {
    const owner = await createStaff("owner");
    const member = await createStaff("pharmacy_assistant", "content_editor");
    await addPasskey(member.id);
    await enableTotp(member.id);
    const gone = await createStaff("content_editor");
    await iso.db.update(users).set({ status: "deleted" }).where(eq(users.id, gone.id));

    const list = await listStaff({}, actorOf(owner.id, ["owner"]));
    expect(list.find((m) => m.id === member.id)).toEqual({
      id: member.id,
      name: "Staff Person",
      email: member.email,
      status: "active",
      roles: ["content_editor", "pharmacy_assistant"],
      passkeys: 1,
      totp: true,
    });
    expect(list.some((m) => m.id === gone.id)).toBe(false);
    expect(
      await codeOf(listStaff({}, actorOf(member.id, ["pharmacy_assistant", "content_editor"]))),
    ).toBe("kernel.forbidden");
  });
});
