import { withTestTx } from "@igs/db/testing";
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLES,
  ROLE_KEYS,
  codeRolePermissions,
  rbacDrift,
} from "@igs/rbac";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { loadActor, readRbacCatalogue, sessionAllowed } from "../src/rbac";
import { permissions, rolePermissions, roles, userRoles, users } from "../src/schema";

/** Fresh module instances: no catalogue installed yet (it is installed once per process). */
async function fresh() {
  vi.resetModules();
  const rbac = await import("@igs/rbac");
  const identity = await import("../src/rbac");
  return { rbac, identity };
}

type Tx = Parameters<Parameters<typeof withTestTx>[0]>[0];

async function createUser(
  tx: Tx,
  fields: { kind?: "customer" | "staff"; status?: "active" | "suspended" | "deleted" } = {},
) {
  const [user] = await tx
    .insert(users)
    .values({
      name: "Test Person",
      email: `${crypto.randomUUID()}@example.test`,
      ...fields,
    })
    .returning({ id: users.id });
  if (!user) throw new Error("insert failed");
  return user.id;
}

const grant = (tx: Tx, userId: string, roleKey: string, locationId: string | null = null) =>
  tx.insert(userRoles).values({ userId, roleKey, locationId });

describe("RBAC catalogue: database (seed migration) = code (T-016 Q1)", () => {
  it("roles, kinds and descriptions match", async () => {
    await withTestTx(async (tx) => {
      const rows = await tx.select().from(roles).orderBy(roles.key);
      expect(rows).toEqual([...ROLE_KEYS].sort().map((key) => ({ key, ...ROLES[key] })));
    });
  });

  it("permissions match", async () => {
    await withTestTx(async (tx) => {
      const rows = await tx.select().from(permissions);
      expect(rows.map((r) => r.key).sort()).toEqual([...ALL_PERMISSIONS].sort());
    });
  });

  it("role → permission pairs match (no drift)", async () => {
    await withTestTx(async (tx) => {
      const rows = await tx.select().from(rolePermissions);
      expect(rbacDrift(rows)).toEqual({ missing: [], extra: [] });
      expect(rows).toHaveLength(codeRolePermissions().length);
    });
  });

  it("invariants hold in the database: no staff role holds .own; D-030", async () => {
    await withTestTx(async (tx) => {
      const staffOwn = await tx.execute(sql`
        SELECT rp.role_key, rp.permission_key FROM identity.role_permissions rp
        JOIN identity.roles r ON r.key = rp.role_key
        WHERE r.kind = 'staff' AND rp.permission_key LIKE '%.own'`);
      expect([...staffOwn]).toEqual([]);
      const deciders = await tx
        .select({ role: rolePermissions.roleKey })
        .from(rolePermissions)
        .where(eq(rolePermissions.permissionKey, PERMISSIONS.orders.reviewDecide));
      expect(deciders.map((r) => r.role).sort()).toEqual(["pharmacist", "pharmacist_titular"]);
      const pharmacistManagers = await tx
        .select({ role: rolePermissions.roleKey })
        .from(rolePermissions)
        .where(eq(rolePermissions.permissionKey, PERMISSIONS.pharmacy.pharmacistsManage));
      expect(pharmacistManagers.map((r) => r.role)).toEqual(["pharmacist_titular"]);
    });
  });

  it("loadRbacCatalogue installs the DB rows; hasPermission then answers from them", async () => {
    const { rbac, identity } = await fresh();
    await withTestTx(async (tx) => {
      expect(() => rbac.hasPermission(["owner"], PERMISSIONS.staff.manage)).toThrow(
        /rbac\.catalogue_not_loaded/,
      );
      await identity.loadRbacCatalogue(tx);
      const { hasPermission } = rbac;
      expect(hasPermission(["owner"], PERMISSIONS.staff.manage)).toBe(true);
      expect(hasPermission(["owner"], PERMISSIONS.orders.reviewDecide)).toBe(false);
      expect(hasPermission(["owner", "pharmacist"], PERMISSIONS.orders.reviewDecide)).toBe(true);
      expect(hasPermission(["customer"], PERMISSIONS.orders.readOwn)).toBe(true);
      expect(hasPermission(["customer"], PERMISSIONS.orders.read)).toBe(false);
      // once per process
      await expect(identity.loadRbacCatalogue(tx)).rejects.toThrow(
        /rbac\.catalogue_already_loaded/,
      );
      await expect(identity.ensureRbacCatalogue(tx)).resolves.toBeUndefined();
    });
  });

  it("ensureRbacCatalogue shares one load between concurrent callers", async () => {
    const { rbac, identity } = await fresh();
    await withTestTx(async (tx) => {
      await Promise.all([identity.ensureRbacCatalogue(tx), identity.ensureRbacCatalogue(tx)]);
      expect(rbac.rbacCatalogueLoaded()).toBe(true);
    });
  });

  it("a drifted database fails the load and installs nothing (fail closed)", async () => {
    const { rbac, identity } = await fresh();
    await withTestTx(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleKey, "content_editor"));
      await expect(identity.ensureRbacCatalogue(tx)).rejects.toThrow(/rbac\.catalogue_drift/);
      expect(rbac.rbacCatalogueLoaded()).toBe(false);
      expect(() => rbac.hasPermission(["owner"], PERMISSIONS.staff.manage)).toThrow(
        /rbac\.catalogue_not_loaded/,
      );
    });
  });

  it("readRbacCatalogue fails fast when the database and the code disagree", async () => {
    await withTestTx(async (tx) => {
      await tx
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleKey, "customer"),
            eq(rolePermissions.permissionKey, "orders.create"),
          ),
        );
      await tx
        .insert(rolePermissions)
        .values({ roleKey: "customer", permissionKey: "staff.manage" });
      await expect(readRbacCatalogue(tx)).rejects.toThrow(
        /rbac\.catalogue_drift.*missing=\[customer:orders\.create\] extra=\[customer:staff\.manage\]/,
      );
    });
  });
});

describe("loadActor (T-016 Q2/Q3/Q6)", () => {
  it("resolves kind, profile and all-location role grants", async () => {
    await withTestTx(async (tx) => {
      const id = await createUser(tx, { kind: "staff" });
      await grant(tx, id, "pharmacist");
      await grant(tx, id, "owner");
      const actor = await loadActor(tx, id);
      expect(actor).toMatchObject({
        type: "user",
        id,
        kind: "staff",
        locationId: null,
        roles: ["owner", "pharmacist"],
        profile: { name: "Test Person", status: "active", locale: "nl" },
      });
      expect(actor?.profile.grants).toEqual([
        { roleKey: "owner", locationId: null },
        { roleKey: "pharmacist", locationId: null },
      ]);
    });
  });

  it("scopes by location: all-location grants always apply, others only at their location", async () => {
    await withTestTx(async (tx) => {
      const id = await createUser(tx, { kind: "staff" });
      const here = crypto.randomUUID();
      const elsewhere = crypto.randomUUID();
      await grant(tx, id, "pharmacy_assistant");
      await grant(tx, id, "pharmacist", here);
      await grant(tx, id, "content_editor", elsewhere);
      expect((await loadActor(tx, id))?.roles).toEqual(["pharmacy_assistant"]);
      expect((await loadActor(tx, id, { locationId: here }))?.roles).toEqual([
        "pharmacist",
        "pharmacy_assistant",
      ]);
    });
  });

  it("a revoked role is gone on the next resolution (no cache)", async () => {
    await withTestTx(async (tx) => {
      const id = await createUser(tx, { kind: "staff" });
      await grant(tx, id, "owner");
      expect((await loadActor(tx, id))?.roles).toEqual(["owner"]);
      await tx.delete(userRoles).where(eq(userRoles.userId, id));
      expect((await loadActor(tx, id))?.roles).toEqual([]);
    });
  });

  it("suspended, deleted and unknown users resolve to no actor; sessions are refused", async () => {
    await withTestTx(async (tx) => {
      const suspended = await createUser(tx, { status: "suspended" });
      const deleted = await createUser(tx, { status: "deleted" });
      const active = await createUser(tx);
      expect(await loadActor(tx, suspended)).toBeNull();
      expect(await loadActor(tx, deleted)).toBeNull();
      expect(await loadActor(tx, crypto.randomUUID())).toBeNull();
      expect(await sessionAllowed(tx, suspended)).toBe(false);
      expect(await sessionAllowed(tx, deleted)).toBe(false);
      expect(await sessionAllowed(tx, active)).toBe(true);
    });
  });

  it("the profile columns default safely and reject unknown values", async () => {
    await withTestTx(async (tx) => {
      const id = await createUser(tx);
      const [row] = await tx.select().from(users).where(eq(users.id, id));
      expect(row).toMatchObject({
        locale: "nl",
        kind: "customer",
        status: "active",
        identityAssurance: "none",
      });
      await expect(
        tx.execute(sql`UPDATE identity.users SET status = 'banned' WHERE id = ${id}`),
      ).rejects.toThrow(/users_status_check/);
    });
  });

  it("a role can be granted once per location scope (NULLS NOT DISTINCT)", async () => {
    await withTestTx(async (tx) => {
      const id = await createUser(tx, { kind: "staff" });
      await grant(tx, id, "owner");
      await expect(grant(tx, id, "owner")).rejects.toThrow(/user_roles_user_role_location_unique/);
    });
  });
});
