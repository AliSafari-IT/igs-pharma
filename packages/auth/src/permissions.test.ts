import { describe, expect, it } from "vitest";

import { PERMISSIONS, hasPermission } from "./permissions";

describe("hasPermission (provisional static map, B-02 replaces it)", () => {
  it("owner has every permission except the pharmacist-only ones (K2, D-030)", () => {
    for (const group of Object.values(PERMISSIONS)) {
      for (const permission of Object.values(group)) {
        expect(hasPermission(["owner"], permission)).toBe(permission !== "orders.review.decide");
      }
    }
    expect(hasPermission(["owner"], PERMISSIONS.orders.reviewDecide)).toBe(false);
  });

  it("an owner who is also a pharmacist holds both (K2)", () => {
    expect(hasPermission(["owner", "pharmacist"], PERMISSIONS.orders.reviewDecide)).toBe(true);
    expect(hasPermission(["owner", "pharmacist"], PERMISSIONS.staff.manage)).toBe(true);
    expect(hasPermission(["pharmacist"], PERMISSIONS.staff.manage)).toBe(false);
  });

  it("customers hold only the .own scope of orders.read (K3)", () => {
    expect(hasPermission(["customer"], PERMISSIONS.orders.readOwn)).toBe(true);
    expect(hasPermission(["customer"], PERMISSIONS.orders.read)).toBe(false);
    expect(hasPermission(["customer_service"], PERMISSIONS.orders.read)).toBe(true);
    expect(hasPermission(["customer_service"], PERMISSIONS.orders.readOwn)).toBe(false);
  });

  it("grants only what the role maps to", () => {
    expect(hasPermission(["pharmacist"], PERMISSIONS.orders.reviewDecide)).toBe(true);
    expect(hasPermission(["pharmacist"], PERMISSIONS.staff.manage)).toBe(false);
    expect(hasPermission(["customer"], PERMISSIONS.orders.create)).toBe(true);
    expect(hasPermission(["customer"], PERMISSIONS.orders.reviewDecide)).toBe(false);
  });

  it("any one matching role is enough; unknown roles and no roles grant nothing", () => {
    expect(hasPermission(["unknown", "customer_service"], PERMISSIONS.orders.read)).toBe(true);
    expect(hasPermission(["unknown"], PERMISSIONS.orders.read)).toBe(false);
    expect(hasPermission([], PERMISSIONS.catalog.read)).toBe(false);
  });
});
