import { describe, expect, it } from "vitest";

import {
  type RegulatedValues,
  changedRegulatedFields,
  depthOf,
  isGeneralEnvelope,
  isMedicine,
  isValidCnk,
  legalStatusFits,
  missingForActivation,
  subtreeHeight,
  wouldCycle,
} from "./domain";

describe("isValidCnk", () => {
  it.each(["0000000", "1234567", "9900001"])("accepts %s", (cnk) => {
    expect(isValidCnk(cnk)).toBe(true);
  });

  it.each(["", "123456", "12345678", "123 456", "12345a7", " 1234567", "1234567\n", "١٢٣٤٥٦٧"])(
    "rejects %j",
    (cnk) => {
      expect(isValidCnk(cnk)).toBe(false);
    },
  );
});

describe("missingForActivation", () => {
  it("needs Dutch and French", () => {
    expect(missingForActivation([])).toEqual(["nl", "fr"]);
    expect(missingForActivation(["nl"])).toEqual(["fr"]);
    expect(missingForActivation(["fr", "de", "en"])).toEqual(["nl"]);
  });

  it("is complete with both, whatever else is there", () => {
    expect(missingForActivation(["fr", "nl"])).toEqual([]);
    expect(missingForActivation(new Set(["nl", "fr", "de", "en"]))).toEqual([]);
  });
});

describe("category tree rules", () => {
  // a ─ b ─ c   and   d
  const links = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "d", parentId: null },
  ];

  it("finds a cycle: under itself or under a descendant", () => {
    expect(wouldCycle(links, "a", "a")).toBe(true);
    expect(wouldCycle(links, "a", "c")).toBe(true);
    expect(wouldCycle(links, "b", "c")).toBe(true);
  });

  it("allows a move to the root, to a sibling branch or up the tree", () => {
    expect(wouldCycle(links, "b", null)).toBe(false);
    expect(wouldCycle(links, "b", "d")).toBe(false);
    expect(wouldCycle(links, "c", "a")).toBe(false);
  });

  it("never loops on a tree that is already broken", () => {
    const broken = [
      { id: "x", parentId: "y" },
      { id: "y", parentId: "x" },
    ];
    expect(wouldCycle(broken, "z", "x")).toBe(true);
    expect(depthOf(broken, "x")).toBe(2);
  });

  it("measures depth and subtree height", () => {
    expect(depthOf(links, null)).toBe(0);
    expect(depthOf(links, "a")).toBe(1);
    expect(depthOf(links, "c")).toBe(3);
    expect(subtreeHeight(links, "a")).toBe(3);
    expect(subtreeHeight(links, "c")).toBe(1);
    expect(subtreeHeight(links, "d")).toBe(1);
  });
});

describe("regulated fields", () => {
  const general: RegulatedValues = {
    productType: "general",
    legalStatus: "general_sale",
    vatClass: "BE_21",
    requiresPharmacistReview: false,
    ageMin: null,
  };

  it("lists only the fields that differ, in a fixed order", () => {
    expect(changedRegulatedFields(general, general)).toEqual([]);
    expect(
      changedRegulatedFields(general, { ...general, ageMin: 18, productType: "cosmetic" }),
    ).toEqual(["productType", "ageMin"]);
  });

  it("calls a product a medicine by type or by legal status", () => {
    expect(isMedicine("otc_medicine", "otc")).toBe(true);
    expect(isMedicine("rx_medicine", "rx")).toBe(true);
    expect(isMedicine("cosmetic", "otc")).toBe(true);
    expect(isMedicine("otc_medicine", "general_sale")).toBe(true);
    expect(isMedicine("cosmetic", "pharmacy_only")).toBe(false);
    expect(isMedicine("general", "general_sale")).toBe(false);
  });

  it("fits legal status to product type", () => {
    expect(legalStatusFits("otc_medicine", "otc")).toBe(true);
    expect(legalStatusFits("otc_medicine", "pharmacy_only")).toBe(false);
    expect(legalStatusFits("rx_medicine", "rx")).toBe(true);
    expect(legalStatusFits("rx_medicine", "otc")).toBe(false);
    expect(legalStatusFits("cosmetic", "pharmacy_only")).toBe(true);
    expect(legalStatusFits("cosmetic", "general_sale")).toBe(true);
    expect(legalStatusFits("cosmetic", "otc")).toBe(false);
    expect(legalStatusFits("cosmetic", "rx")).toBe(false);
  });

  it("limits the general envelope to non-medicines at general sale, 21 % VAT, no review or age", () => {
    expect(isGeneralEnvelope(general)).toBe(true);
    expect(isGeneralEnvelope({ ...general, legalStatus: "pharmacy_only" })).toBe(false);
    expect(isGeneralEnvelope({ ...general, vatClass: "BE_6" })).toBe(false);
    expect(isGeneralEnvelope({ ...general, requiresPharmacistReview: true })).toBe(false);
    expect(isGeneralEnvelope({ ...general, ageMin: 16 })).toBe(false);
    expect(isGeneralEnvelope({ ...general, productType: "otc_medicine" })).toBe(false);
  });
});
