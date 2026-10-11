// Identity commands (T-016, 36a) against real Postgres, with the RBAC catalogue loaded from the
// database (not the code seam) and the real audit port, so the registered audit shapes are exercised.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { isDomainError } from "@igs/kernel";
import { type KernelTestHandles, actors, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  deleteUser,
  grantPharmacistRole,
  grantRole,
  loadActor,
  loadRbacCatalogue,
  reactivateUser,
  registerAuditActions,
  revokePharmacistRole,
  revokeRole,
  sessionAllowed,
  suspendUser,
} from "../src";
import { sessions, userRoles, users } from "../src/schema";

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

async function createUser(kind: "customer" | "staff" = "staff") {
  const [user] = await iso.db
    .insert(users)
    .values({ name: "Test Person", email: `${crypto.randomUUID()}@example.test`, kind })
    .returning({ id: users.id });
  if (!user) throw new Error("insert failed");
  return user.id;
}

async function createSession(userId: string) {
  await iso.db.insert(sessions).values({
    userId,
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
}

/** A `user` actor whose roles come from the database, as `resolveActor` builds it. */
async function actorFor(userId: string) {
  const resolved = await loadActor(iso.db, userId);
  if (!resolved) throw new Error("no actor");
  return { type: resolved.type, id: resolved.id, roles: resolved.roles, kind: resolved.kind };
}

async function staffWith(...roleKeys: string[]) {
  const id = await createUser("staff");
  for (const roleKey of roleKeys) await iso.db.insert(userRoles).values({ userId: id, roleKey });
  return actorFor(id);
}

const auditFor = (userId: string) =>
  iso.sql<{ action: string; actor_id: string; entity_id: string; data: Record<string, unknown> }[]>`
    SELECT action, actor_id, entity_id, data FROM audit.events WHERE entity_id = ${userId}
    ORDER BY seq`;

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

describe("role grants (Q7, D-030)", () => {
  it("the owner grants and revokes a staff role; both are audited with ids only", async () => {
    const owner = await staffWith("owner");
    const target = await createUser("staff");

    await grantRole({ userId: target, roleKey: "pharmacy_assistant" }, owner);
    expect((await actorFor(target)).roles).toEqual(["pharmacy_assistant"]);

    await revokeRole({ userId: target, roleKey: "pharmacy_assistant" }, owner);
    expect((await actorFor(target)).roles).toEqual([]); // the very next resolution (Q2)

    const data = { userId: target, roleKey: "pharmacy_assistant", locationId: null };
    expect(await auditFor(target)).toEqual([
      { action: "identity.role.granted", actor_id: owner.id, entity_id: target, data },
      { action: "identity.role.revoked", actor_id: owner.id, entity_id: target, data },
    ]);
    const [row] = await iso.db.select().from(userRoles).where(eq(userRoles.userId, owner.id));
    expect(row?.grantedBy).toBeNull(); // seeded directly; command grants record the granter
  });

  it("records who granted the role", async () => {
    const owner = await staffWith("owner");
    const target = await createUser("staff");
    await grantRole({ userId: target, roleKey: "content_editor" }, owner);
    const [row] = await iso.db.select().from(userRoles).where(eq(userRoles.userId, target));
    expect(row).toMatchObject({ grantedBy: owner.id, locationId: null });
  });

  it("the owner cannot make anyone a pharmacist, through either command", async () => {
    const owner = await staffWith("owner");
    const target = await createUser("staff");
    expect(await codeOf(grantRole({ userId: target, roleKey: "pharmacist" }, owner))).toBe(
      "identity.pharmacist_role_requires_titular",
    );
    expect(
      await codeOf(grantPharmacistRole({ userId: target, roleKey: "pharmacist" }, owner)),
    ).toBe("kernel.forbidden");
    expect((await actorFor(target)).roles).toEqual([]);
    expect(await auditFor(target)).toEqual([]);
  });

  it("only the titular grants and revokes pharmacist roles, and nothing else", async () => {
    const titular = await staffWith("pharmacist_titular");
    const target = await createUser("staff");

    await grantPharmacistRole({ userId: target, roleKey: "pharmacist" }, titular);
    expect((await actorFor(target)).roles).toEqual(["pharmacist"]);
    await revokePharmacistRole({ userId: target, roleKey: "pharmacist" }, titular);
    expect((await actorFor(target)).roles).toEqual([]);

    expect(await codeOf(grantPharmacistRole({ userId: target, roleKey: "owner" }, titular))).toBe(
      "identity.not_a_pharmacist_role",
    );
    expect(await codeOf(grantRole({ userId: target, roleKey: "owner" }, titular))).toBe(
      "kernel.forbidden",
    );
    const pharmacist = await staffWith("pharmacist");
    expect(
      await codeOf(grantPharmacistRole({ userId: target, roleKey: "pharmacist" }, pharmacist)),
    ).toBe("kernel.forbidden");
  });

  it("an owner who is also titular can do both (holds both roles)", async () => {
    const both = await staffWith("owner", "pharmacist_titular");
    const target = await createUser("staff");
    await grantRole({ userId: target, roleKey: "customer_service" }, both);
    await grantPharmacistRole({ userId: target, roleKey: "pharmacist_titular" }, both);
    expect((await actorFor(target)).roles).toEqual(["customer_service", "pharmacist_titular"]);
  });

  it("customers get the customer role only; staff never get it", async () => {
    const owner = await staffWith("owner");
    const customer = await createUser("customer");
    const staff = await createUser("staff");
    expect(await codeOf(grantRole({ userId: customer, roleKey: "owner" }, owner))).toBe(
      "identity.role_kind_mismatch",
    );
    expect(await codeOf(grantRole({ userId: staff, roleKey: "customer" }, owner))).toBe(
      "identity.role_kind_mismatch",
    );
    await grantRole({ userId: customer, roleKey: "customer" }, owner);
    expect((await actorFor(customer)).roles).toEqual(["customer"]);
  });

  it("duplicates conflict, missing grants and users are NotFound, unknown roles fail validation", async () => {
    const owner = await staffWith("owner");
    const target = await createUser("staff");
    await grantRole({ userId: target, roleKey: "content_editor" }, owner);
    expect(await codeOf(grantRole({ userId: target, roleKey: "content_editor" }, owner))).toBe(
      "identity.role_already_granted",
    );
    expect(await codeOf(revokeRole({ userId: target, roleKey: "customer_service" }, owner))).toBe(
      "identity.role_not_granted",
    );
    expect(
      await codeOf(grantRole({ userId: crypto.randomUUID(), roleKey: "content_editor" }, owner)),
    ).toBe("identity.user_not_found");
    expect(await codeOf(grantRole({ userId: target, roleKey: "superuser" }, owner))).toBe(
      "kernel.validation_failed",
    );
  });

  it("location-scoped grants are separate from all-location ones", async () => {
    const owner = await staffWith("owner");
    const target = await createUser("staff");
    const here = crypto.randomUUID();
    await grantRole({ userId: target, roleKey: "pharmacy_assistant", locationId: here }, owner);
    await grantRole({ userId: target, roleKey: "pharmacy_assistant" }, owner);
    await revokeRole({ userId: target, roleKey: "pharmacy_assistant" }, owner);
    const resolved = await loadActor(iso.db, target, { locationId: here });
    expect(resolved?.profile.grants).toEqual([{ roleKey: "pharmacy_assistant", locationId: here }]);
    expect((await auditFor(target))[0]?.data).toEqual({
      userId: target,
      roleKey: "pharmacy_assistant",
      locationId: here,
    });
  });

  it("customers and anonymous callers are forbidden before any database work", async () => {
    const target = await createUser("staff");
    for (const actor of [
      actors.anonymous(),
      actors.user({ roles: ["customer"] }),
      actors.user({ roles: ["pharmacist"] }),
    ]) {
      expect(await codeOf(grantRole({ userId: target, roleKey: "owner" }, actor))).toBe(
        "kernel.forbidden",
      );
    }
  });
});

describe("user status (Q6)", () => {
  it("suspend ends access at once: no actor, sessions deleted in the same tx, none allowed", async () => {
    const owner = await staffWith("owner");
    const target = await createUser("staff");
    await createSession(target);
    await createSession(target);

    await suspendUser({ userId: target }, owner);

    expect(await loadActor(iso.db, target)).toBeNull();
    expect(await iso.db.select().from(sessions).where(eq(sessions.userId, target))).toEqual([]);
    expect(await sessionAllowed(iso.db, target)).toBe(false);

    await reactivateUser({ userId: target }, owner);
    expect(await loadActor(iso.db, target)).not.toBeNull();
    expect(await sessionAllowed(iso.db, target)).toBe(true);

    expect((await auditFor(target)).map((r) => [r.action, r.data])).toEqual([
      ["identity.user.suspended", { userId: target }],
      ["identity.user.reactivated", { userId: target }],
    ]);
  });

  it("delete ends access for good: no reactivation, no new role grants", async () => {
    const owner = await staffWith("owner");
    const target = await createUser("staff");
    await createSession(target);

    await deleteUser({ userId: target }, owner);
    expect(await iso.db.select().from(sessions).where(eq(sessions.userId, target))).toEqual([]);
    expect(await loadActor(iso.db, target)).toBeNull();
    expect(await codeOf(reactivateUser({ userId: target }, owner))).toBe("identity.user_not_found");
    expect(await codeOf(grantRole({ userId: target, roleKey: "owner" }, owner))).toBe(
      "identity.user_not_found",
    );
    expect((await auditFor(target)).map((r) => r.action)).toEqual(["identity.user.deleted"]);
  });

  it("rejects invalid transitions and changing one's own status", async () => {
    const owner = await staffWith("owner");
    const target = await createUser("staff");
    expect(await codeOf(reactivateUser({ userId: target }, owner))).toBe(
      "identity.invalid_status_transition",
    );
    await suspendUser({ userId: target }, owner);
    expect(await codeOf(suspendUser({ userId: target }, owner))).toBe(
      "identity.invalid_status_transition",
    );
    expect(await codeOf(suspendUser({ userId: owner.id }, owner))).toBe(
      "identity.cannot_change_own_status",
    );
    expect(await codeOf(deleteUser({ userId: owner.id }, owner))).toBe(
      "identity.cannot_change_own_status",
    );
  });

  it("a failed command rolls back: the status and the sessions stay", async () => {
    const owner = await staffWith("owner");
    const target = await createUser("staff");
    await createSession(target);
    // an unregistered audit action would fail the flush; simulate with a port that throws
    configureKernelForTests({
      db: iso.db,
      audit: {
        async record() {
          throw new Error("audit down");
        },
      },
    });
    await expect(suspendUser({ userId: target }, owner)).rejects.toThrow("audit down");
    expect(await loadActor(iso.db, target)).not.toBeNull();
    expect(await iso.db.select().from(sessions).where(eq(sessions.userId, target))).toHaveLength(1);
  });

  it("only staff.manage may change a status", async () => {
    const titular = await staffWith("pharmacist_titular");
    const target = await createUser("staff");
    expect(await codeOf(suspendUser({ userId: target }, titular))).toBe("kernel.forbidden");
  });
});

describe("registerAuditActions", () => {
  it("registers exactly the five identity actions", () => {
    const seen: string[] = [];
    registerAuditActions((action) => void seen.push(action));
    expect(seen).toEqual([
      "identity.role.granted",
      "identity.role.revoked",
      "identity.user.suspended",
      "identity.user.reactivated",
      "identity.user.deleted",
    ]);
  });
});
