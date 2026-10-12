import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PHARMACIST_ONLY,
  ROLES,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  SYSTEM_ONLY,
  codeRolePermissions,
  hasPermission,
  rbacDrift,
} from "./index";
import { useCodeRbacCatalogue } from "./testing";

/** A fresh module instance: nothing installed yet (the real catalogue is once per process). */
async function fresh() {
  vi.resetModules();
  const rbac = await import("./index");
  const testing = await import("./testing");
  return { ...rbac, ...testing };
}

describe("hasPermission (code catalogue installed)", () => {
  beforeAll(() => useCodeRbacCatalogue());

  it("owner has every staff permission except the pharmacist- and system-only ones (K2, D-030)", () => {
    for (const permission of ALL_PERMISSIONS) {
      const expected =
        !PHARMACIST_ONLY.includes(permission) &&
        !SYSTEM_ONLY.includes(permission) &&
        !permission.endsWith(".own");
      expect(hasPermission(["owner"], permission), permission).toBe(expected);
    }
    expect(hasPermission(["owner"], PERMISSIONS.orders.reviewDecide)).toBe(false);
    expect(hasPermission(["owner"], PERMISSIONS.pharmacy.pharmacistsManage)).toBe(false);
  });

  it("an owner who is also a pharmacist holds both (K2)", () => {
    expect(hasPermission(["owner", "pharmacist"], PERMISSIONS.orders.reviewDecide)).toBe(true);
    expect(hasPermission(["owner", "pharmacist"], PERMISSIONS.staff.manage)).toBe(true);
    expect(hasPermission(["pharmacist"], PERMISSIONS.staff.manage)).toBe(false);
  });

  it("only the titular manages pharmacists (Q7)", () => {
    expect(hasPermission(["pharmacist_titular"], PERMISSIONS.pharmacy.pharmacistsManage)).toBe(
      true,
    );
    expect(hasPermission(["pharmacist"], PERMISSIONS.pharmacy.pharmacistsManage)).toBe(false);
  });

  it("customers hold only the .own scope of orders.read (K3)", () => {
    expect(hasPermission(["customer"], PERMISSIONS.orders.readOwn)).toBe(true);
    expect(hasPermission(["customer"], PERMISSIONS.orders.read)).toBe(false);
    expect(hasPermission(["customer_service"], PERMISSIONS.orders.read)).toBe(true);
    expect(hasPermission(["customer_service"], PERMISSIONS.orders.readOwn)).toBe(false);
  });

  it("any one matching role is enough; unknown roles and no roles grant nothing", () => {
    expect(hasPermission(["unknown", "customer_service"], PERMISSIONS.orders.read)).toBe(true);
    expect(hasPermission(["unknown"], PERMISSIONS.orders.read)).toBe(false);
    expect(hasPermission([], PERMISSIONS.catalog.read)).toBe(false);
  });

  it("answers from the installed rows, not from the code map", async () => {
    const rbac = await fresh();
    rbac.setRbacCatalogue([{ roleKey: "customer", permissionKey: "catalog.read" }]);
    expect(rbac.hasPermission(["customer"], PERMISSIONS.catalog.read)).toBe(true);
    expect(rbac.hasPermission(["customer"], PERMISSIONS.orders.create)).toBe(false);
  });

  it("inherited object keys are not roles", () => {
    expect(hasPermission(["__proto__", "constructor", "toString"], PERMISSIONS.catalog.read)).toBe(
      false,
    );
  });
});

describe("catalogue invariants (T-016)", () => {
  const staff = ROLE_KEYS.filter((r) => ROLES[r].kind === "staff");

  it("no staff role holds an .own permission; customer roles hold no staff-only .any", () => {
    for (const role of staff) {
      expect(
        ROLE_PERMISSIONS[role].filter((p) => p.endsWith(".own")),
        role,
      ).toEqual([]);
    }
  });

  it("every .own permission has a .any counterpart held by some staff role", () => {
    for (const own of ALL_PERMISSIONS.filter((p) => p.endsWith(".own"))) {
      const any = own.slice(0, -".own".length);
      expect(ALL_PERMISSIONS, own).toContain(any);
      expect(
        staff.some((r) => (ROLE_PERMISSIONS[r] as readonly string[]).includes(any)),
        own,
      ).toBe(true);
    }
  });

  it("system-only permissions are held by system roles only, and system roles hold nothing else (36b)", () => {
    // the one exception: the synthetic seed CLI (igs-pharma#50, #53, #58, #59) writes products, demo
    // stock, prices and demo privacy records through the same commands staff use (and reads what it wrote, to run twice safely),
    // nothing else; no user can hold a system role
    expect(ROLE_PERMISSIONS.system_seed).toEqual([
      "catalog.products.read",
      "catalog.products.manage",
      "inventory.stock.read",
      "inventory.stock.manage",
      "pricing.price.read",
      "pricing.price.manage",
      "privacy.consent.read",
      "privacy.consent.record",
      "privacy.dsr.read",
      "privacy.dsr.manage",
    ]);
    for (const role of ROLE_KEYS) {
      const perms = ROLE_PERMISSIONS[role] as readonly string[];
      if (role === "system_seed") continue;
      if (ROLES[role].kind === "system") {
        expect(
          perms.every((p) => (SYSTEM_ONLY as readonly string[]).includes(p)),
          role,
        ).toBe(true);
      } else {
        expect(
          perms.filter((p) => (SYSTEM_ONLY as readonly string[]).includes(p)),
          role,
        ).toEqual([]);
      }
    }
  });

  it("pharmacist-only permissions are held by pharmacist roles only (D-030)", () => {
    for (const permission of PHARMACIST_ONLY) {
      const holders = ROLE_KEYS.filter((r) => ROLE_PERMISSIONS[r].includes(permission));
      expect(holders.every((r) => r === "pharmacist" || r === "pharmacist_titular")).toBe(true);
    }
    expect(
      ROLE_KEYS.filter((r) => ROLE_PERMISSIONS[r].includes("pharmacy.pharmacists.manage")),
    ).toEqual(["pharmacist_titular"]);
  });

  it("codeRolePermissions lists each pair exactly once", () => {
    const rows = codeRolePermissions().map((r) => `${r.roleKey}:${r.permissionKey}`);
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows.length).toBe(ROLE_KEYS.reduce((n, r) => n + ROLE_PERMISSIONS[r].length, 0));
  });
});

describe("fail closed and set once (option C)", () => {
  it("hasPermission throws rbac.catalogue_not_loaded before setRbacCatalogue, for every role", async () => {
    const rbac = await fresh();
    expect(rbac.rbacCatalogueLoaded()).toBe(false);
    for (const role of [...ROLE_KEYS, "unknown"]) {
      expect(() => rbac.hasPermission([role], PERMISSIONS.catalog.read)).toThrow(
        /rbac\.catalogue_not_loaded/,
      );
    }
    expect(() => rbac.hasPermission([], PERMISSIONS.catalog.read)).toThrow(
      /rbac\.catalogue_not_loaded/,
    );
  });

  it("a second setRbacCatalogue throws and leaves the first mapping in place", async () => {
    const rbac = await fresh();
    rbac.setRbacCatalogue([{ roleKey: "customer", permissionKey: "catalog.read" }]);
    expect(() => rbac.setRbacCatalogue(codeRolePermissions())).toThrow(
      /rbac\.catalogue_already_loaded/,
    );
    expect(rbac.hasPermission(["owner"], PERMISSIONS.catalog.read)).toBe(false);
    expect(rbac.hasPermission(["customer"], PERMISSIONS.catalog.read)).toBe(true);
  });

  it("useCodeRbacCatalogue is a no-op once a catalogue is installed", async () => {
    const rbac = await fresh();
    rbac.setRbacCatalogue([]);
    expect(() => rbac.useCodeRbacCatalogue()).not.toThrow();
    expect(rbac.hasPermission(["owner"], PERMISSIONS.catalog.read)).toBe(false);
  });

  it("the caller's rows cannot change the installed mapping afterwards (frozen copy)", async () => {
    const rbac = await fresh();
    const rows = [{ roleKey: "customer", permissionKey: "catalog.read" }];
    rbac.setRbacCatalogue(rows);
    rows.push({ roleKey: "customer", permissionKey: "staff.manage" });
    (rows[0] as { permissionKey: string }).permissionKey = "staff.invite";
    expect(rbac.hasPermission(["customer"], PERMISSIONS.staff.manage)).toBe(false);
    expect(rbac.hasPermission(["customer"], PERMISSIONS.staff.invite)).toBe(false);
    expect(rbac.hasPermission(["customer"], PERMISSIONS.catalog.read)).toBe(true);
  });
});

describe("rbacDrift", () => {
  it("is empty for the code rows and names missing and extra pairs", () => {
    expect(rbacDrift(codeRolePermissions())).toEqual({ missing: [], extra: [] });
    const rows = codeRolePermissions().filter(
      (r) => !(r.roleKey === "customer" && r.permissionKey === "orders.create"),
    );
    rows.push({ roleKey: "customer", permissionKey: "staff.manage" });
    expect(rbacDrift(rows)).toEqual({
      missing: ["customer:orders.create"],
      extra: ["customer:staff.manage"],
    });
  });
});
