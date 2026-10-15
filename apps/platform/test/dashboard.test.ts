import { describe, expect, it } from "vitest";

import { type TileResult, mapTile, settle } from "../src/lib/dashboard";

describe("mapTile", () => {
  it("shapes one source's data for a tile", () => {
    const summary: TileResult<{ low: number; out: number; activeReservations: number }> = {
      state: "ok",
      data: { low: 2, out: 5, activeReservations: 7 },
    };
    expect(mapTile(summary, ({ low, out }) => ({ low, out }))).toEqual({
      state: "ok",
      data: { low: 2, out: 5 },
    });
    expect(mapTile(summary, (s) => ({ active: s.activeReservations }))).toEqual({
      state: "ok",
      data: { active: 7 },
    });
  });

  it("keeps the error state, without calling the mapping", () => {
    let called = false;
    const failed: TileResult<number> = { state: "error" };
    expect(
      mapTile(failed, (n: number) => {
        called = true;
        return n + 1;
      }),
    ).toEqual({ state: "error" });
    expect(called).toBe(false);
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
