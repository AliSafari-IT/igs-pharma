import { describe, expect, it } from "vitest";

import {
  END_STATUSES,
  MAX_PER_ORDER_MEDICINE,
  MAX_PER_ORDER_OTHER,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  SHIPPING_STATUSES,
  canTransition,
  maxPerOrder,
} from "./domain";

describe("order transitions", () => {
  it("end states have no way out, and nothing returns to pending_payment", () => {
    for (const end of ["collected", "cancelled", "expired"] as const) {
      expect(ORDER_TRANSITIONS[end]).toEqual([]);
    }
    for (const from of ORDER_STATUSES) {
      expect(ORDER_TRANSITIONS[from]).not.toContain("pending_payment");
      expect(ORDER_TRANSITIONS[from]).not.toContain(from);
    }
  });

  it("a medicine reaches ready_to_prepare only through in_review", () => {
    for (const from of ORDER_STATUSES) {
      expect(canTransition(from, "ready_to_prepare", { needsReview: true })).toBe(
        from === "in_review",
      );
    }
    expect(canTransition("pending_payment", "ready_to_prepare", { needsReview: false })).toBe(true);
  });

  it("every order can still be cancelled until its goods leave the pharmacy", () => {
    for (const from of ORDER_STATUSES) {
      const open = ![
        "collected",
        "shipped",
        "delivered",
        "returned",
        "cancelled",
        "expired",
      ].includes(from);
      const method = (SHIPPING_STATUSES as readonly string[]).includes(from)
        ? "delivery"
        : "pickup";
      expect(canTransition(from, "cancelled", { needsReview: false, deliveryMethod: method })).toBe(
        open,
      );
    }
  });

  it("the pickup states are for pickup orders, the shipping states for delivery orders (#202)", () => {
    expect(canTransition("preparing", "ready_for_pickup", { needsReview: false })).toBe(true);
    expect(canTransition("preparing", "ready_to_ship", { needsReview: false })).toBe(false);
    const delivery = { needsReview: false, deliveryMethod: "delivery" } as const;
    expect(canTransition("preparing", "ready_to_ship", delivery)).toBe(true);
    expect(canTransition("preparing", "ready_for_pickup", delivery)).toBe(false);
    expect(canTransition("shipped", "returned", delivery)).toBe(true);
    // the end states have no way out, and a returned parcel never "comes back" to shipped
    for (const end of END_STATUSES) expect(ORDER_TRANSITIONS[end]).toEqual([]);
  });
});

describe("per-order limits (O-3)", () => {
  it("two packs of a medicine, ten of anything else", () => {
    expect(maxPerOrder(true)).toBe(MAX_PER_ORDER_MEDICINE);
    expect(maxPerOrder(false)).toBe(MAX_PER_ORDER_OTHER);
    expect([MAX_PER_ORDER_MEDICINE, MAX_PER_ORDER_OTHER]).toEqual([2, 10]);
  });
});
