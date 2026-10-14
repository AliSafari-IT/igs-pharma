import { describe, expect, it } from "vitest";

import { stockErrorMessage } from "../src/components/stock-labels";

describe("stockErrorMessage", () => {
  it("has a specific message for every import refusal", () => {
    for (const code of [
      "inventory.import_stale",
      "inventory.import_plan_expired",
      "inventory.import_plan_not_found",
      "inventory.negative_stock",
    ]) {
      expect(stockErrorMessage(code), code).not.toBe(stockErrorMessage("inventory.unknown_code"));
    }
    expect(stockErrorMessage("inventory.import_stale")).toMatch(/Upload the file again/);
  });
});

describe("reservations (igs-pharma#99)", () => {
  it("labels the new movement reason, the kinds and the release reasons", async () => {
    const labels = await import("../src/components/stock-labels");
    expect(labels.REASON_LABELS.sale).toBe("Sale (picked for an order)");
    expect(labels.KIND_LABELS).toEqual({ hold: "Checkout in progress", order: "Order" });
    expect(Object.keys(labels.RELEASE_REASON_LABELS).sort()).toEqual(
      [...labels.RELEASE_REASON_OPTIONS].sort(),
    );
  });

  it("explains the reservation refusals", () => {
    for (const code of [
      "inventory.reservation_not_found",
      "inventory.reservation_not_active",
      "inventory.insufficient_stock",
      "inventory.reservation_expired",
      "inventory.reservation_mismatch",
      "inventory.reservation_quantity_mismatch",
    ]) {
      expect(stockErrorMessage(code), code).not.toBe(stockErrorMessage("inventory.unknown_code"));
    }
  });

  it("says how long ago something was", async () => {
    const { formatAge } = await import("../src/components/stock-labels");
    const now = new Date("2026-10-14T12:00:00Z");
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
    expect(formatAge(ago(0), now)).toBe("just now");
    expect(formatAge(ago(14), now)).toBe("14 min");
    expect(formatAge(ago(60), now)).toBe("1 h");
    expect(formatAge(ago(125), now)).toBe("2 h 5 min");
    expect(formatAge(ago(60 * 24 * 3), now)).toBe("3 days");
    // a clock a little behind never prints a negative age
    expect(formatAge(new Date(now.getTime() + 5_000), now)).toBe("just now");
  });
});
