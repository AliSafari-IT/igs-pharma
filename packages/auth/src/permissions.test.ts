import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PHARMACIST_ONLY,
  ROLES,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  codeRolePermissions,
  hasPermission,
  setRbacCatalogue,
  useCodeRbacCatalogue,
} from "./permissions";

describe("hasPermission (code catalogue installed)", () => {
  beforeEach(() => useCodeRbacCatalogue());

  it("owner has every staff permission except the pharmacist-only ones (K2, D-030)", () => {
    for (const permission of ALL_PERMISSIONS) {
      const expected = !PHARMACIST_ONLY.includes(permission) && !permission.endsWith(".own");
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
    expect(hasPermission(["pharmacist_titular"], PERMISSIONS.pharmacy.pharmacistsManage)).toBe(true);
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

  it("answers from the installed rows, not from the code map", () => {
    setRbacCatalogue([{ roleKey: "customer", permissionKey: "catalog.read" }]);
    expect(hasPermission(["customer"], PERMISSIONS.catalog.read)).toBe(true);
    expect(hasPermission(["customer"], PERMISSIONS.orders.create)).toBe(false);
  });
});

describe("catalogue invariants (T-016)", () => {
  const staff = ROLE_KEYS.filter((r) => ROLES[r].kind === "staff");

  it("no staff role holds an .own permission; customer roles hold no staff-only .any", () => {
    for (const role of staff) {
      expect(ROLE_PERMISSIONS[role].filter((p) => p.endsWith(".own")), role).toEqual([]);
    }
  });

  it("every .own permission has a .any counterpart held by some staff role", () => {
    for (const own of ALL_PERMISSIONS.filter((p) => p.endsWith(".own"))) {
      const any = own.slice(0, -".own".length);
      expect(ALL_PERMISSIONS, own).toContain(any);
      expect(staff.some((r) => (ROLE_PERMISSIONS[r] as readonly string[]).includes(any)), own).toBe(
        true,
      );
    }
  });

  it("pharmacist-only permissions are held by pharmacist roles only (D-030)", () => {
    for (const permission of PHARMACIST_ONLY) {
      const holders = ROLE_KEYS.filter((r) => ROLE_PERMISSIONS[r].includes(permission));
      expect(holders.every((r) => r === "pharmacist" || r === "pharmacist_titular")).toBe(true);
    }
    expect(ROLE_KEYS.filter((r) => ROLE_PERMISSIONS[r].includes("pharmacy.pharmacists.manage"))).toEqual(
      ["pharmacist_titular"],
    );
  });

  it("codeRolePermissions lists each pair exactly once", () => {
    const rows = codeRolePermissions().map((r) => `${r.roleKey}:${r.permissionKey}`);
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows.length).toBe(ROLE_KEYS.reduce((n, r) => n + ROLE_PERMISSIONS[r].length, 0));
  });
});

describe("before the catalogue is loaded", () => {
  it("hasPermission throws rbac.catalogue_not_loaded", async () => {
    vi.resetModules();
    const fresh = await import("./permissions");
    expect(() => fresh.hasPermission(["owner"], "catalog.read")).toThrow(
      /rbac\.catalogue_not_loaded/,
    );
  });
});
