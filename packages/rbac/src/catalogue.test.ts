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

  // The owner's exact set (#64 C7). Changing the owner's permissions must change this list in the
  // same PR, so every addition is reviewed; a new permission is NOT granted to the owner by default.
  const OWNER_PERMISSIONS = [
    "catalog.manage",
    "catalog.products.manage",
    "catalog.products.read",
    "catalog.read",
    "catalog.storefront.read",
    "inventory.availability.read",
    "inventory.stock.manage",
    "inventory.stock.read",
    "orders.delivery_settings.manage",
    "orders.order.manage",
    "orders.read",
    "orders.refund.request",
    "pricing.price.manage",
    "pricing.price.read",
    "privacy.consent.read",
    "privacy.consent.record",
    "privacy.dsr.manage",
    "privacy.dsr.read",
    "staff.invite",
    "staff.manage",
    "storefront.early_access.manage",
  ];

  it("the owner's permission set is pinned exactly (C7, D-030)", () => {
    const held = ALL_PERMISSIONS.filter((permission) => hasPermission(["owner"], permission));
    expect([...held].sort()).toEqual([...OWNER_PERMISSIONS].sort());
  });

  it("the owner never holds a pharmacist-only, system-only or customer-scoped permission", () => {
    for (const permission of ALL_PERMISSIONS) {
      const forbidden =
        PHARMACIST_ONLY.includes(permission) ||
        SYSTEM_ONLY.includes(permission) ||
        permission.endsWith(".own") ||
        permission.includes(".self.") ||
        permission === PERMISSIONS.orders.create;
      if (forbidden) expect(hasPermission(["owner"], permission), permission).toBe(false);
    }
    expect(hasPermission(["owner"], PERMISSIONS.orders.reviewDecide)).toBe(false);
    expect(hasPermission(["owner"], PERMISSIONS.pharmacy.pharmacistsManage)).toBe(false);
  });

  it("the owner set against the previous 'everything except …' derivation (#79 C7 review diff)", () => {
    // How the owner used to be computed, kept here only to print and pin what changed.
    const previous = ALL_PERMISSIONS.filter(
      (p) =>
        !PHARMACIST_ONLY.includes(p) &&
        !SYSTEM_ONLY.includes(p) &&
        !p.endsWith(".own") &&
        !p.includes(".self."),
    );
    const current = ALL_PERMISSIONS.filter((p) => hasPermission(["owner"], p));
    const removed = previous.filter((p) => !current.includes(p)).sort();
    const added = current.filter((p) => !previous.includes(p)).sort();
    // eslint-disable-next-line no-console -- the PR body quotes this output
    console.info(`owner permissions: previous=${previous.length} current=${current.length}`);
    // eslint-disable-next-line no-console
    console.info(
      `owner removed: ${removed.join(", ") || "(none)"}; added: ${added.join(", ") || "(none)"}`,
    );
    // the one removal: orders.create is a customer action (customers hold it); nothing was added
    expect(removed).toEqual(["orders.create"]);
    expect(added).toEqual([]);
  });

  it("regulated product fields are pharmacist-only (D-034, D-030)", () => {
    const regulated = PERMISSIONS.catalog.productsRegulatedManage;
    expect(PHARMACIST_ONLY).toContain(regulated);
    for (const role of ["pharmacist", "pharmacist_titular", "system_seed"]) {
      expect(hasPermission([role], regulated), role).toBe(true);
    }
    for (const role of [
      "owner",
      "content_editor",
      "pharmacy_assistant",
      "customer_service",
      "customer",
    ]) {
      expect(hasPermission([role], regulated), role).toBe(false);
    }
    // editors keep the content permission, so they edit text but not the regulated fields
    expect(hasPermission(["content_editor"], PERMISSIONS.catalog.productsManage)).toBe(true);
  });

  it("every permission is held by at least one role (no orphaned permission)", () => {
    for (const permission of ALL_PERMISSIONS) {
      const holders = ROLE_KEYS.filter((role) => hasPermission([role], permission));
      expect(holders.length, permission).toBeGreaterThan(0);
    }
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

  it("only the owner decides early access; customers ask for their own (#199)", () => {
    const manage = PERMISSIONS.storefront.earlyAccessManage;
    const self = PERMISSIONS.storefront.earlyAccessSelf;
    for (const role of ROLE_KEYS) {
      expect(hasPermission([role], manage), role).toBe(role === "owner");
      expect(hasPermission([role], self), role).toBe(role === "customer");
    }
  });

  it("only the owner and the pharmacist-titular set the delivery price and threshold (#202)", () => {
    expect(
      ROLE_KEYS.filter((r) =>
        ROLE_PERMISSIONS[r].includes(PERMISSIONS.orders.deliverySettingsManage),
      ),
    ).toEqual(["owner", "pharmacist_titular"]);
  });

  it("fulfilment is staff work; customer service only reads (#116)", () => {
    for (const role of [
      "owner",
      "pharmacist_titular",
      "pharmacist",
      "pharmacy_assistant",
    ] as const) {
      expect(hasPermission([role], PERMISSIONS.orders.manage), role).toBe(true);
    }
    expect(hasPermission(["customer_service"], PERMISSIONS.orders.manage)).toBe(false);
    expect(hasPermission(["customer"], PERMISSIONS.orders.manage)).toBe(false);
  });

  it("lots are quarantined by pharmacists; only the titular sets the expiry buffer (#164)", () => {
    for (const role of ["pharmacist_titular", "pharmacist"] as const) {
      expect(hasPermission([role], PERMISSIONS.inventory.lotsQuarantine), role).toBe(true);
    }
    for (const role of ["owner", "pharmacy_assistant", "customer_service"] as const) {
      expect(hasPermission([role], PERMISSIONS.inventory.lotsQuarantine), role).toBe(false);
      expect(hasPermission([role], PERMISSIONS.inventory.settingsManage), role).toBe(false);
    }
    expect(
      ROLE_KEYS.filter((r) => ROLE_PERMISSIONS[r].includes(PERMISSIONS.inventory.settingsManage)),
    ).toEqual(["pharmacist_titular"]);
  });

  it("recalls and stop-sales are started and ended by pharmacists only (#187)", () => {
    for (const permission of [
      PERMISSIONS.inventory.recallsManage,
      PERMISSIONS.catalog.stopSalesManage,
    ]) {
      expect(
        ROLE_KEYS.filter((r) => ROLE_PERMISSIONS[r].includes(permission)),
        permission,
      ).toEqual(["pharmacist_titular", "pharmacist"]);
      expect(PHARMACIST_ONLY, permission).toContain(permission);
    }
  });

  it("refunds are asked by the owner and pharmacists only (#156)", () => {
    for (const role of ["owner", "pharmacist_titular", "pharmacist"] as const) {
      expect(hasPermission([role], PERMISSIONS.orders.refundRequest), role).toBe(true);
    }
    for (const role of ["pharmacy_assistant", "customer_service", "customer"] as const) {
      expect(hasPermission([role], PERMISSIONS.orders.refundRequest), role).toBe(false);
    }
    // a medicine order's refund also needs the pharmacist permission, which the owner never holds
    expect(hasPermission(["owner"], PERMISSIONS.orders.reviewDecide)).toBe(false);
  });

  it("customers hold only the .own scope of orders.read (K3)", () => {
    expect(hasPermission(["customer"], PERMISSIONS.orders.readOwn)).toBe(true);
    expect(hasPermission(["customer"], PERMISSIONS.orders.read)).toBe(false);
    expect(hasPermission(["customer_service"], PERMISSIONS.orders.read)).toBe(true);
    expect(hasPermission(["customer_service"], PERMISSIONS.orders.readOwn)).toBe(false);
  });

  it("the .self. permissions belong to the customer role alone (D-044)", () => {
    const self = ALL_PERMISSIONS.filter((permission) => permission.includes(".self."));
    expect(self.sort()).toEqual([
      "account.self.read",
      "account.self.update",
      "privacy.self.consent.manage",
      "privacy.self.dsr.create",
      "storefront.early_access.self.request",
    ]);
    for (const permission of self) {
      const holders = ROLE_KEYS.filter((role) => hasPermission([role], permission));
      expect(holders, permission).toEqual(["customer"]);
    }
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
    // stock, prices, demo privacy records and demo orders through the same commands staff use (and reads what it wrote, to run twice safely),
    // nothing else; no user can hold a system role
    expect(ROLE_PERMISSIONS.system_seed).toEqual([
      "catalog.products.read",
      "catalog.products.manage",
      "catalog.products.regulated.manage",
      "inventory.stock.read",
      "inventory.stock.manage",
      "pricing.price.read",
      "pricing.price.manage",
      "privacy.consent.read",
      "privacy.consent.record",
      "privacy.dsr.read",
      "privacy.dsr.manage",
      "orders.read",
      "orders.order.manage",
      "orders.review.decide",
    ]);
    // the storefront preview (igs-pharma#62) only reads: active products, prices, in/out of stock
    expect(ROLE_PERMISSIONS.system_storefront).toEqual([
      "catalog.storefront.read",
      "inventory.availability.read",
      "pricing.storefront.read",
    ]);
    // the worker's maintenance jobs (igs-pharma#88) may purge expired personal data and do nothing else
    expect(ROLE_PERMISSIONS.system_maintenance).toEqual(["privacy.retention.purge"]);
    // reservations (igs-pharma#99): the checkout and the expiry job; no human holds it, staff release with stock.manage
    expect(ROLE_PERMISSIONS.system_reservations).toEqual(["inventory.reservation.manage"]);
    for (const role of ROLE_KEYS) {
      if (role !== "system_reservations" && role !== "system_seed") {
        expect(ROLE_PERMISSIONS[role] as readonly string[], role).not.toContain(
          "inventory.reservation.manage",
        );
      }
    }
    for (const role of ROLE_KEYS) {
      const perms = ROLE_PERMISSIONS[role] as readonly string[];
      if (role === "system_seed" || role === "system_storefront") continue;
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
      // the synthetic seed CLI (a system role, dev and staging only) creates Rx products and decides
      // the demo orders' reviews (recorded as the seed, never as a pharmacist); no user role
      const allowed =
        permission === PERMISSIONS.catalog.productsRegulatedManage ||
        permission === PERMISSIONS.orders.reviewDecide
          ? ["pharmacist", "pharmacist_titular", "system_seed"]
          : ["pharmacist", "pharmacist_titular"];
      expect(
        holders.every((r) => allowed.includes(r)),
        permission,
      ).toBe(true);
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
