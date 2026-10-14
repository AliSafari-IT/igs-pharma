import { describe, expect, it } from "vitest";

import {
  type PricePoint,
  centsToDecimal,
  comparePoints,
  isValidAmount,
  lowestPriceBefore,
  parseEuros,
  previousAmounts,
  priceAt,
  priceReductionAt,
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

describe("lowestPriceBefore: the reference price of a reduction (Omnibus)", () => {
  // January: no clock change in the window, so 30 calendar days = 30 × 24 h here
  const applied = new Date("2026-01-20T12:00:00Z");
  const daysBefore = (n: number) => new Date(applied.getTime() - n * DAY);
  const windowOpens = daysBefore(30);

  it("never counts the reduction itself, only what came before it", () => {
    // 1000 for 40 days, then 700: the old maths answered 700 at the start of the reduction
    const points = [point(1000, daysBefore(40)), point(700, applied)];
    expect(lowestPriceBefore(points, applied)).toEqual({ cents: 1000, fullWindow: true });
  });

  it.each([
    ["a price that ended exactly when the window opens does not count", 0, 800],
    ["a price that ended 1 ms after the window opened does", 1, 300],
  ])("%s", (_name, overlapMs, expected) => {
    const points = [
      point(300, daysBefore(50)),
      point(900, new Date(windowOpens.getTime() + overlapMs)),
      point(800, daysBefore(10)),
    ];
    expect(lowestPriceBefore(points, applied)?.cents).toBe(expected);
  });

  it("keeps a drop inside the window after a later rise", () => {
    const points = [
      point(1000, daysBefore(40)),
      point(800, daysBefore(20)),
      point(1200, daysBefore(5)),
    ];
    expect(lowestPriceBefore(points, applied)?.cents).toBe(800);
  });

  it("ignores a scheduled price and a price that starts exactly at the reduction", () => {
    const points = [
      point(1000, daysBefore(40)),
      point(100, applied),
      point(50, new Date(applied.getTime() + DAY)),
    ];
    expect(lowestPriceBefore(points, applied)?.cents).toBe(1000);
  });

  it("ignores a row overtaken at the same moment (never in force)", () => {
    const start = daysBefore(3);
    expect(
      lowestPriceBefore([point(100, start), point(700, start), point(600, applied)], applied)
        ?.cents,
    ).toBe(700);
  });

  it("says when the history is shorter than the window, using what exists", () => {
    const points = [point(1000, daysBefore(10)), point(700, applied)];
    expect(lowestPriceBefore(points, applied)).toEqual({ cents: 1000, fullWindow: false });
  });

  it("is full when a price was already in force as the window opened", () => {
    expect(lowestPriceBefore([point(500, daysBefore(60))], applied)).toEqual({
      cents: 500,
      fullWindow: true,
    });
    // priced exactly when the window opens: still the whole window
    expect(lowestPriceBefore([point(500, windowOpens)], applied)?.fullWindow).toBe(true);
    expect(
      lowestPriceBefore([point(500, new Date(windowOpens.getTime() + 1))], applied)?.fullWindow,
    ).toBe(false);
  });

  it("is null without any price before the reduction", () => {
    expect(lowestPriceBefore([], applied)).toBeNull();
    expect(lowestPriceBefore([point(100, applied)], applied)).toBeNull();
  });

  describe("30 calendar days in Europe/Brussels, not 30 × 24 h", () => {
    it("autumn: the clocks went back on 25 Oct, so the window opens an hour 'earlier' in UTC", () => {
      // reduction on 2 Nov 2026 12:00 CET (11:00Z); 3 Oct 12:00 CEST is 10:00Z. 30 × 24 h would
      // open the window at 11:00Z
      const reduction = new Date("2026-11-02T11:00:00Z");
      const endedAt = (iso: string) => [
        point(400, new Date("2026-09-01T00:00:00Z")),
        point(900, new Date(iso)),
        point(800, new Date("2026-10-20T00:00:00Z")),
      ];
      // the 400 ends 30 minutes after the (calendar) window opened: it counts
      expect(lowestPriceBefore(endedAt("2026-10-03T10:30:00Z"), reduction)?.cents).toBe(400);
      // the 400 ends exactly when it opens: it does not
      expect(lowestPriceBefore(endedAt("2026-10-03T10:00:00Z"), reduction)?.cents).toBe(800);
    });

    it("spring: the clocks went forward on 29 Mar, so the window opens an hour 'later' in UTC", () => {
      // reduction on 5 Apr 2026 12:00 CEST (10:00Z); 6 Mar 12:00 CET is 11:00Z. 30 × 24 h would
      // open the window at 10:00Z and count the 400 that ended at 10:30Z
      const reduction = new Date("2026-04-05T10:00:00Z");
      const points = [
        point(400, new Date("2026-02-01T00:00:00Z")),
        point(900, new Date("2026-03-06T10:30:00Z")),
        point(950, new Date("2026-03-20T00:00:00Z")),
      ];
      expect(lowestPriceBefore(points, reduction)?.cents).toBe(900);
    });
  });
});

describe("priceReductionAt", () => {
  const applied = new Date("2026-01-20T12:00:00Z");
  const daysBefore = (n: number) => new Date(applied.getTime() - n * DAY);

  it("starts exactly at the moment the reduction applies: 1 ms before it there is none", () => {
    const points = [point(1000, daysBefore(40)), point(700, applied)];
    expect(priceReductionAt(points, new Date(applied.getTime() - 1))).toBeNull();
    const expected = {
      currentCents: 700,
      appliedAt: applied,
      referenceCents: 1000,
      fullWindow: true,
    };
    expect(priceReductionAt(points, applied)).toEqual(expected);
    // and it stays 1000 for as long as the reduction lasts, not 700
    expect(priceReductionAt(points, new Date(applied.getTime() + 20 * DAY))).toEqual(expected);
  });

  it("measures a reduction after a reduction against the window before the LATEST one", () => {
    const points = [point(1000, daysBefore(60)), point(800, daysBefore(20)), point(600, applied)];
    expect(priceReductionAt(points, applied)).toMatchObject({
      currentCents: 600,
      referenceCents: 800,
    });
    // just before it, the earlier reduction is the one in force
    expect(priceReductionAt(points, new Date(applied.getTime() - 1))).toMatchObject({
      currentCents: 800,
      referenceCents: 1000,
      appliedAt: daysBefore(20),
    });
  });

  it.each([
    ["a rise", [point(700, daysBefore(40)), point(1000, applied)]],
    ["the same price again", [point(700, daysBefore(40)), point(700, applied)]],
    ["a first price", [point(700, applied)]],
    ["no price yet", [point(700, new Date(applied.getTime() + 1))]],
  ])("is none for %s", (_name, points) => {
    expect(priceReductionAt(points, applied)).toBeNull();
  });

  it("carries the short-history flag of the reference", () => {
    const points = [point(1000, daysBefore(10)), point(700, applied)];
    expect(priceReductionAt(points, applied)).toMatchObject({
      referenceCents: 1000,
      fullWindow: false,
    });
  });
});

describe("previousAmounts (igs-pharma#96)", () => {
  type Row = { id: string; validFrom: Date; amountCents: number };
  const t = (ms: number) => new Date(1_700_000_000_000 + ms);

  /** The algorithm it replaced, kept here as the reference: rescan every earlier row for each row. */
  const legacy = (rows: readonly Row[]) =>
    rows.map((row, index) => {
      const before = rows
        .slice(0, index)
        .filter((r) => r.validFrom.getTime() < row.validFrom.getTime());
      return before.at(-1)?.amountCents ?? null;
    });

  const sorted = (rows: Row[]) => [...rows].sort(comparePoints);

  it("empty, one entry, a repeated amount and plain changes", () => {
    expect(previousAmounts([])).toEqual([]);
    expect(previousAmounts([{ validFrom: t(0), amountCents: 100 }])).toEqual([null]);
    expect(
      previousAmounts([
        { validFrom: t(0), amountCents: 700 },
        { validFrom: t(1), amountCents: 700 },
      ]),
    ).toEqual([null, 700]);
    expect(
      previousAmounts([
        { validFrom: t(0), amountCents: 1000 },
        { validFrom: t(1), amountCents: 900 },
        { validFrom: t(2), amountCents: 1100 },
      ]),
    ).toEqual([null, 1000, 900]);
  });

  it("rows that start at the same instant all replaced what was in force before it", () => {
    const rows = sorted([
      { id: "a", validFrom: t(0), amountCents: 1000 },
      { id: "b", validFrom: t(5), amountCents: 900 },
      { id: "c", validFrom: t(5), amountCents: 800 },
      { id: "d", validFrom: t(9), amountCents: 700 },
    ]);
    expect(previousAmounts(rows)).toEqual([null, 1000, 1000, 800]);
  });

  it("gives the same values as the algorithm it replaced, on 500 random histories", () => {
    let seed = 20_261_014;
    const next = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    for (let round = 0; round < 500; round += 1) {
      const rows = sorted(
        Array.from({ length: next(12) }, (_, i) => ({
          id: String(i).padStart(3, "0"),
          // few distinct instants, so equal validFrom groups are common
          validFrom: t(next(5) * 1000),
          amountCents: 100 + next(5) * 50,
        })),
      );
      expect(previousAmounts(rows), JSON.stringify(rows)).toEqual(legacy(rows));
    }
  });
});
