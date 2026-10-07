import { describe, expect, it } from "vitest";

import { PERMISSIONS, hasPermission } from "./permissions";

describe("hasPermission (provisional static map, B-02 replaces it)", () => {
  it("owner has every permission", () => {
    for (const group of Object.values(PERMISSIONS)) {
      for (const permission of Object.values(group)) {
        expect(hasPermission(["owner"], permission)).toBe(true);
      }
    }
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
