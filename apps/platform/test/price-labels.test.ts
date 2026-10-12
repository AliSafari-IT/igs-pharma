import { describe, expect, it } from "vitest";

import {
  brusselsLocalToDate,
  formatEuros,
  formatRate,
  priceErrorMessage,
  toBrusselsLocal,
  vatLine,
} from "../src/components/price-labels";

describe("price labels (igs-pharma#59)", () => {
  it("formats whole cents as euros", () => {
    expect(formatEuros(1)).toBe("€0.01");
    expect(formatEuros(599)).toBe("€5.99");
    expect(formatEuros(10_000_000)).toBe("€100,000.00");
  });

  it("writes the VAT line of the Price panel", () => {
    expect(formatRate(600)).toBe("6 %");
    expect(formatRate(2100)).toBe("21 %");
    expect(formatRate(550)).toBe("5.5 %");
    expect(vatLine(600, 34)).toBe("incl. 6 % VAT, €0.34");
  });

  it("reads a Brussels date and time, in summer and in winter", () => {
    expect(brusselsLocalToDate("2026-07-01T09:00")?.toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(brusselsLocalToDate("2026-12-01T09:00")?.toISOString()).toBe("2026-12-01T08:00:00.000Z");
    // the night the clocks go back: 02:30 happens twice; either is fine, it stays that night
    expect(brusselsLocalToDate("2026-10-25T02:30")?.toISOString().slice(0, 10)).toBe("2026-10-25");
    for (const bad of ["", "2026-02-31T09:00", "2026-13-01T09:00", "2026-07-01 09:00", "x"]) {
      expect(brusselsLocalToDate(bad), bad).toBeNull();
    }
  });

  it("round-trips a moment through the dialog's datetime-local value", () => {
    const moment = new Date("2026-10-12T18:45:00Z");
    expect(toBrusselsLocal(moment)).toBe("2026-10-12T20:45");
    expect(brusselsLocalToDate(toBrusselsLocal(moment))?.getTime()).toBe(moment.getTime());
  });

  it("has a message for every pricing error and a fallback", () => {
    expect(priceErrorMessage("pricing.amount_invalid")).toContain("€0.01");
    expect(priceErrorMessage("nope")).toBe("That didn't work. Try again.");
    expect(priceErrorMessage(undefined)).toBe("That didn't work. Try again.");
  });
});
