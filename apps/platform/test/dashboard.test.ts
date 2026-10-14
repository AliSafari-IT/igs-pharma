import { describe, expect, it } from "vitest";

import { type StockLevel, scanStockAlerts, settle } from "../src/lib/dashboard";

const level = (available: number): StockLevel => ({ available });

/** A fake inventory list over `levels`, `pageSize` per page. */
const listOf = (levels: StockLevel[], pageSize: number) => async (page: number) => ({
  items: levels.slice((page - 1) * pageSize, page * pageSize),
  total: levels.length,
});

describe("scanStockAlerts", () => {
  it("counts out (none available) and low (1 up to the threshold), and ignores the rest", async () => {
    const levels = [0, 0, 1, 2, 3, 4, 50].map(level);
    expect(await scanStockAlerts(listOf(levels, 100))).toEqual({
      low: 3,
      out: 2,
      scanned: 7,
      total: 7,
      capped: false,
    });
  });

  it("follows the pages until the last product", async () => {
    const levels = Array.from({ length: 250 }, (_, i) => level(i % 5)); // 0..4 repeating
    const result = await scanStockAlerts(listOf(levels, 100));
    expect(result).toMatchObject({ scanned: 250, total: 250, capped: false });
    expect(result.out).toBe(50);
    expect(result.low).toBe(150); // 1, 2 and 3 of every 5
  });

  it("stops at its ceiling and says the counts are partial", async () => {
    const levels = Array.from({ length: 500 }, () => level(0));
    const result = await scanStockAlerts(listOf(levels, 100), { maxPages: 2 });
    expect(result).toEqual({ low: 0, out: 200, scanned: 200, total: 500, capped: true });
  });

  it("is empty for an empty catalogue, and honours another threshold", async () => {
    expect(await scanStockAlerts(listOf([], 100))).toEqual({
      low: 0,
      out: 0,
      scanned: 0,
      total: 0,
      capped: false,
    });
    const result = await scanStockAlerts(listOf([5, 6, 7].map(level), 100), { lowThreshold: 6 });
    expect(result.low).toBe(2);
  });
});

describe("settle", () => {
  it("returns the data of a loader that works", async () => {
    expect(
      await settle(
        async () => 42,
        () => undefined,
      ),
    ).toEqual({ state: "ok", data: 42 });
  });

  it("turns any failure into the error state, reports it, and does not throw", async () => {
    const seen: unknown[] = [];
    const result = await settle(
      async () => {
        throw new Error("database is down");
      },
      (error) => seen.push(error),
    );
    expect(result).toEqual({ state: "error" });
    expect(seen).toHaveLength(1);
  });
});
