import { PERMISSIONS, type Permission } from "@igs/rbac";
import { describe, expect, it } from "vitest";

import { NAV, isActive, visibleNav } from "../src/lib/nav";

/** A stand-in for `hasPermission`: these roles hold exactly these permissions. */
const holding =
  (...granted: Permission[]) =>
  (_roles: readonly string[], permission: Permission) =>
    granted.includes(permission);

const labels = (groups: ReturnType<typeof visibleNav>) =>
  groups.map((g) => `${g.label}: ${g.items.map((i) => i.label).join(", ")}`);

describe("visibleNav", () => {
  it("shows everything to someone who holds every permission, in the fixed group order", () => {
    const all = holding(
      PERMISSIONS.orders.read,
      PERMISSIONS.catalog.productsRead,
      PERMISSIONS.inventory.stockRead,
      PERMISSIONS.privacy.dsrRead,
      PERMISSIONS.privacy.consentRead,
      PERMISSIONS.staff.manage,
    );
    expect(labels(visibleNav([], all))).toEqual([
      "Orders: Orders",
      "Catalogue: Products, Categories",
      "Stock: Stock",
      "Privacy: Data requests, Consents",
      "Staff: Staff",
      "Account: Your account",
    ]);
  });

  it("leaves out an item without its permission, and a group with no item left", () => {
    expect(labels(visibleNav([], holding(PERMISSIONS.catalog.productsRead)))).toEqual([
      "Catalogue: Products, Categories",
      "Account: Your account",
    ]);
    expect(labels(visibleNav([], holding(PERMISSIONS.privacy.consentRead)))).toEqual([
      "Privacy: Consents",
      "Account: Your account",
    ]);
  });

  it("always keeps the account page, which needs no permission", () => {
    expect(labels(visibleNav([], holding()))).toEqual(["Account: Your account"]);
  });

  it("lists every page once (no link appears in two groups)", () => {
    const hrefs = NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("isActive", () => {
  it("marks the page itself and the pages below it, not a page that merely starts the same", () => {
    expect(isActive("/products", "/products")).toBe(true);
    expect(isActive("/products/0192", "/products")).toBe(true);
    expect(isActive("/privacy/requests/9", "/privacy/requests")).toBe(true);
    expect(isActive("/products-old", "/products")).toBe(false);
    expect(isActive("/privacy/consents", "/privacy/requests")).toBe(false);
  });
});
