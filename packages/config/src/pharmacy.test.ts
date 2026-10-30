import { describe, expect, it } from "vitest";

import { PHARMACY_IDENTITY, type PharmacyIdentity, identityValues, isStandIn } from "./pharmacy";

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

  it("guards every value, the VAT number included (milestone 5.1, C11)", () => {
    const values = identityValues(PHARMACY_IDENTITY);
    expect(values).toContain(PHARMACY_IDENTITY.vatNumber);
    // a real-looking identity with only the VAT number left as a stand-in still counts as a placeholder
    const real: PharmacyIdentity = {
      isPlaceholder: false,
      name: "IGS-Pharma",
      address: {
        street: "Rue Example 1",
        postalCode: "1000",
        city: "Brussels",
        country: "Belgium",
      },
      phone: "+32 2 000 00 00",
      email: "info@example.be",
      pharmacistTitular: "A. Pharmacist",
      authorisationNumber: "123456",
      vatNumber: "BE 0123.456.789",
      openingHours: "Mon-Fri 9:00-18:00",
    };
    expect(identityValues(real).filter(isStandIn)).toEqual([]);
    const almost = { ...real, vatNumber: "[VAT number]" };
    expect(identityValues(almost).filter(isStandIn)).toEqual(["[VAT number]"]);
  });

  it("recognises a stand-in by its brackets only", () => {
    expect(isStandIn("[city]")).toBe(true);
    expect(isStandIn(" [city] ")).toBe(true);
    expect(isStandIn("Brussels")).toBe(false);
    expect(isStandIn("[a] and [b]")).toBe(true); // still bracketed at both ends: treated as a stand-in
  });
});
