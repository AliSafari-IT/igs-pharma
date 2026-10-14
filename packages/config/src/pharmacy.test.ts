import { describe, expect, it } from "vitest";

import { PHARMACY_IDENTITY, identityValues, isStandIn } from "./pharmacy";

describe("the pharmacy identity", () => {
  it("is marked as placeholder exactly while some value is still a bracketed stand-in", () => {
    const standIns = identityValues(PHARMACY_IDENTITY).filter(isStandIn);
    // the guard: switching `isPlaceholder` off with a stand-in left behind fails here
    expect(PHARMACY_IDENTITY.isPlaceholder).toBe(standIns.length > 0);
  });

  it("has a name and a country that are real, not stand-ins", () => {
    expect(isStandIn(PHARMACY_IDENTITY.name)).toBe(false);
    expect(isStandIn(PHARMACY_IDENTITY.address.country)).toBe(false);
  });

  it("recognises a stand-in by its brackets only", () => {
    expect(isStandIn("[city]")).toBe(true);
    expect(isStandIn(" [city] ")).toBe(true);
    expect(isStandIn("Brussels")).toBe(false);
    expect(isStandIn("[a] and [b]")).toBe(true); // still bracketed at both ends: treated as a stand-in
  });
});
