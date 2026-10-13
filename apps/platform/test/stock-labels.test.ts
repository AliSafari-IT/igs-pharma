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
