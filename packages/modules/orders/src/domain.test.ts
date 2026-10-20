import { describe, expect, it } from "vitest";

import {
  MAX_PER_ORDER_MEDICINE,
  MAX_PER_ORDER_OTHER,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
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

  it("every order can still be cancelled until it is collected", () => {
    for (const from of ORDER_STATUSES) {
      const open = !["collected", "cancelled", "expired"].includes(from);
      expect(canTransition(from, "cancelled", { needsReview: false })).toBe(open);
    }
  });
});

describe("per-order limits (O-3)", () => {
  it("two packs of a medicine, ten of anything else", () => {
    expect(maxPerOrder(true)).toBe(MAX_PER_ORDER_MEDICINE);
    expect(maxPerOrder(false)).toBe(MAX_PER_ORDER_OTHER);
    expect([MAX_PER_ORDER_MEDICINE, MAX_PER_ORDER_OTHER]).toEqual([2, 10]);
  });
});
