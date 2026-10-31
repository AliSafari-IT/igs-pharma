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

  it("holds the real pharmacist-titular and VAT number (igs-pharma#203), and still counts as a placeholder", () => {
    expect(PHARMACY_IDENTITY.pharmacistTitular).toBe("Djavad Salehi");
    expect(PHARMACY_IDENTITY.vatNumber).toBe("BE 0739.742.487");
    // the address, phone, e-mail, authorisation number and opening hours are still to come from the
    // owner: they stay marked stand-ins, so the identity stays a placeholder and the note stays on
    expect(identityValues(PHARMACY_IDENTITY).filter(isStandIn)).toEqual([
      "[street and number]",
      "[postal code]",
      "[city]",
      "[phone number]",
      "[e-mail address]",
      "[authorisation number]",
      "[opening hours]",
    ]);
    expect(PHARMACY_IDENTITY.isPlaceholder).toBe(true);
  });

  it("writes the VAT number in the display format and its Belgian check digits add up", () => {
    // "BE 0123.456.789": the country, a space, then ten digits in groups of 4, 3 and 3
    const match = /^BE (\d{4})\.(\d{3})\.(\d{3})$/.exec(PHARMACY_IDENTITY.vatNumber);
    expect(match).not.toBeNull();
    const digits = (match ?? []).slice(1).join("");
    // the last two digits are 97 minus the first eight digits modulo 97
    const check = 97 - (Number(digits.slice(0, 8)) % 97);
    expect(Number(digits.slice(8))).toBe(check);
  });

  it("recognises a stand-in by its brackets only", () => {
    expect(isStandIn("[city]")).toBe(true);
    expect(isStandIn(" [city] ")).toBe(true);
    expect(isStandIn("Brussels")).toBe(false);
    expect(isStandIn("[a] and [b]")).toBe(true); // still bracketed at both ends: treated as a stand-in
  });
});
