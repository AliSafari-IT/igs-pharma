import { describe, expect, it } from "vitest";

import {
  DELIVERY_DEFAULTS,
  MAX_DELIVERY_PRICE_CENTS,
  MAX_FREE_FROM_CENTS,
  deliveryFeeCents,
  deliveryVatCents,
  formatEuroAmount,
  freeDeliveryMissingCents,
  isValidDeliveryPrice,
  isValidFreeFrom,
  parseEuroAmount,
} from "./delivery-domain";

const rates = { priceCents: 495, freeFromCents: 4900 };

describe("deliveryFeeCents (igs-pharma#202)", () => {
  it("charges the price below the free-delivery value", () => {
    expect(deliveryFeeCents(rates, 0)).toBe(495);
    expect(deliveryFeeCents(rates, 4899)).toBe(495);
  });

  it("is free exactly AT the free-delivery value, and above it", () => {
    expect(deliveryFeeCents(rates, 4900)).toBe(0);
    expect(deliveryFeeCents(rates, 4901)).toBe(0);
    expect(deliveryFeeCents(rates, 250_000)).toBe(0);
  });

  it("never gives free delivery when there is no free-delivery value", () => {
    expect(deliveryFeeCents({ priceCents: 495, freeFromCents: null }, 1_000_000)).toBe(495);
  });

  it("a free-delivery value of 0 makes every order free; a price of 0 makes delivery free", () => {
    expect(deliveryFeeCents({ priceCents: 495, freeFromCents: 0 }, 0)).toBe(0);
    expect(deliveryFeeCents({ priceCents: 0, freeFromCents: null }, 100)).toBe(0);
  });

  it("the defaults are the plan's placeholders: 4.95, free from 49.00", () => {
    expect(DELIVERY_DEFAULTS).toEqual({ priceCents: 495, freeFromCents: 4900 });
  });
});

describe("freeDeliveryMissingCents", () => {
  it("says how much more is needed, and nothing once reached or when it is never free", () => {
    expect(freeDeliveryMissingCents(rates, 3000)).toBe(1900);
    expect(freeDeliveryMissingCents(rates, 4899)).toBe(1);
    expect(freeDeliveryMissingCents(rates, 4900)).toBeNull();
    expect(freeDeliveryMissingCents(rates, 6000)).toBeNull();
    expect(freeDeliveryMissingCents({ priceCents: 495, freeFromCents: null }, 100)).toBeNull();
  });
});

describe("deliveryVatCents", () => {
  it("cuts the 21 % part out of a price that includes VAT", () => {
    expect(deliveryVatCents(0)).toBe(0);
    expect(deliveryVatCents(121)).toBe(21);
    expect(deliveryVatCents(495)).toBe(86); // 495 × 21 / 121 = 85.909…
    expect(deliveryVatCents(1210)).toBe(210);
  });

  it("never exceeds the price, and the parts add up", () => {
    for (const fee of [0, 1, 99, 495, 4999, MAX_DELIVERY_PRICE_CENTS]) {
      const vat = deliveryVatCents(fee);
      expect(vat).toBeGreaterThanOrEqual(0);
      expect(vat).toBeLessThanOrEqual(fee);
    }
  });
});

describe("the limits", () => {
  it("a price is 0 to the limit in whole cents", () => {
    expect(isValidDeliveryPrice(0)).toBe(true);
    expect(isValidDeliveryPrice(MAX_DELIVERY_PRICE_CENTS)).toBe(true);
    for (const bad of [
      -1,
      MAX_DELIVERY_PRICE_CENTS + 1,
      4.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(isValidDeliveryPrice(bad), String(bad)).toBe(false);
    }
  });

  it("the free-delivery value may be empty (never free), else 0 to the limit", () => {
    expect(isValidFreeFrom(null)).toBe(true);
    expect(isValidFreeFrom(0)).toBe(true);
    expect(isValidFreeFrom(MAX_FREE_FROM_CENTS)).toBe(true);
    for (const bad of [-1, MAX_FREE_FROM_CENTS + 1, 49.5, Number.NaN]) {
      expect(isValidFreeFrom(bad), String(bad)).toBe(false);
    }
  });
});

describe("parseEuroAmount / formatEuroAmount", () => {
  it("reads euros with a comma or a point and at most two decimals", () => {
    expect(parseEuroAmount("4,95")).toBe(495);
    expect(parseEuroAmount("4.95")).toBe(495);
    expect(parseEuroAmount("5")).toBe(500);
    expect(parseEuroAmount("5,5")).toBe(550);
    expect(parseEuroAmount(" 49.00 ")).toBe(4900);
    expect(parseEuroAmount("0")).toBe(0);
    expect(parseEuroAmount("0,05")).toBe(5);
  });

  it("refuses everything else instead of guessing", () => {
    for (const bad of [
      "",
      " ",
      "-1",
      "+4",
      "4,955",
      "4,",
      ",95",
      "1.000,00",
      "4 95",
      "abc",
      "1e3",
    ]) {
      expect(parseEuroAmount(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("formats cents the way staff type them", () => {
    expect(formatEuroAmount(495)).toBe("4.95");
    expect(formatEuroAmount(4900)).toBe("49.00");
    expect(formatEuroAmount(0)).toBe("0.00");
    expect(parseEuroAmount(formatEuroAmount(1234))).toBe(1234);
  });
});
