import { describe, expect, it } from "vitest";

import {
  type PricePoint,
  centsToDecimal,
  isValidAmount,
  lowestPriceInWindow,
  parseEuros,
  priceAt,
  splitVat,
  vatPartCents,
} from "./domain";

const DAY = 86_400_000;
const at = new Date("2026-10-12T12:00:00Z");
const daysAgo = (n: number) => new Date(at.getTime() - n * DAY);
let seq = 0;
const point = (amountCents: number, validFrom: Date): PricePoint => ({
  // UUIDv7-like: later rows sort after earlier ones
  id: `00000000-0000-7000-8000-${String(seq++).padStart(12, "0")}`,
  amountCents,
  validFrom,
});

describe("vatPartCents (price includes VAT)", () => {
  it.each([
    // [amount, rate, VAT part]: amount × rate / (10000 + rate), rounded
    [1, 600, 0], // 0.057
    [1, 2100, 0], // 0.174
    [9, 600, 1], // 0.509
    [3, 2100, 1], // 0.521
    [999, 600, 57], // 56.547
    [999, 2100, 173], // 173.380
    [1000, 600, 57], // 56.604
    [10_000, 600, 566], // 566.038
    [10_000, 2100, 1736], // 1735.537
    [10_000_000, 2100, 1_735_537], // 1735537.190
  ])("%i cents at %i bp → %i", (amount, rate, vat) => {
    expect(vatPartCents(amount, rate)).toBe(vat);
  });

  it("matches round(a × r / (10000 + r)) for every amount up to € 200", () => {
    for (const rate of [600, 2100]) {
      for (let amount = 1; amount <= 20_000; amount++) {
        const exact = (amount * rate) / (10_000 + rate);
        // no exact half cent exists for these rates, so Math.round is the reference
        expect(vatPartCents(amount, rate)).toBe(Math.round(exact));
      }
    }
  });

  it("splits a price into VAT and ex-VAT that add up", () => {
    expect(splitVat(599, 600)).toEqual({ vatCents: 34, exVatCents: 565 });
    expect(splitVat(1_210, 2100)).toEqual({ vatCents: 210, exVatCents: 1_000 });
  });
});

describe("isValidAmount / parseEuros / centsToDecimal", () => {
  it("accepts whole positive cents up to € 100 000", () => {
    expect(isValidAmount(1)).toBe(true);
    expect(isValidAmount(10_000_000)).toBe(true);
    for (const bad of [0, -1, 1.5, 10_000_001, Number.NaN]) expect(isValidAmount(bad)).toBe(false);
  });

  it("parses what staff type", () => {
    expect(parseEuros("12")).toBe(1200);
    expect(parseEuros("12.5")).toBe(1250);
    expect(parseEuros("12,50")).toBe(1250);
    expect(parseEuros(" € 0,01 ")).toBe(1);
    expect(parseEuros("100000")).toBe(10_000_000);
    for (const bad of ["", "0", "0,00", "-1", "1.234", "12.345", "abc", "100000.01"]) {
      expect(parseEuros(bad), bad).toBeNull();
    }
  });

  it("formats cents", () => {
    expect(centsToDecimal(1)).toBe("0.01");
    expect(centsToDecimal(599)).toBe("5.99");
    expect(centsToDecimal(120_000)).toBe("1200.00");
  });
});

describe("priceAt", () => {
  it("is the latest row that has started; a later row with the same start wins", () => {
    const old = point(500, daysAgo(10));
    const now = point(450, daysAgo(1));
    const fixed = point(460, daysAgo(1));
    const scheduled = point(400, new Date(at.getTime() + DAY));
    const points = [scheduled, fixed, old, now];
    expect(priceAt(points, at)).toBe(fixed);
    expect(priceAt(points, daysAgo(5))).toBe(old);
    expect(priceAt(points, daysAgo(11))).toBeNull();
    expect(priceAt(points, new Date(at.getTime() + DAY))).toBe(scheduled);
  });
});

describe("lowestPriceInWindow (30 days)", () => {
  it("counts the price that was in force when the window opened", () => {
    expect(lowestPriceInWindow([point(500, daysAgo(60))], at)).toBe(500);
  });

  it("keeps a drop inside the window after a later rise", () => {
    const points = [point(1000, daysAgo(45)), point(800, daysAgo(20)), point(1200, daysAgo(5))];
    expect(lowestPriceInWindow(points, at)).toBe(800);
    // 16 days later the drop (in force until 5 days ago) is still in the window
    expect(lowestPriceInWindow(points, new Date(at.getTime() + 16 * DAY))).toBe(800);
    // 26 days later the window opens after the rise: the drop has left it
    expect(lowestPriceInWindow(points, new Date(at.getTime() + 26 * DAY))).toBe(1200);
  });

  it("ignores a price that ended before the window and a scheduled one", () => {
    const points = [
      point(300, daysAgo(50)),
      point(900, daysAgo(30)), // takes over exactly when the window opens
      point(100, new Date(at.getTime() + DAY)),
    ];
    expect(lowestPriceInWindow(points, at)).toBe(900);
  });

  it("ignores a row overtaken at the same moment (never in force)", () => {
    const start = daysAgo(3);
    expect(lowestPriceInWindow([point(100, start), point(700, start)], at)).toBe(700);
  });

  it("is null without any price yet", () => {
    expect(lowestPriceInWindow([], at)).toBeNull();
    expect(lowestPriceInWindow([point(100, new Date(at.getTime() + 1))], at)).toBeNull();
  });
});
