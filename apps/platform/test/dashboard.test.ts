import { describe, expect, it } from "vitest";

import { type TileResult, mapTile, needsAttention, settle } from "../src/lib/dashboard";

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

describe("needsAttention", () => {
  const ok = <T>(data: T): TileResult<T> => ({ state: "ok", data });
  const failed = { state: "error" } as const;

  it("lists the non-zero counts, most pressing first, each linked to its page", () => {
    const { items, incomplete } = needsAttention({
      products: ok({ awaitingApproval: 2 }),
      stock: ok({ out: 3, short: 4 }),
      requests: ok({ overdue: 5 }),
    });
    expect(items).toEqual([
      { id: "short", text: "4 products are short for orders", href: "/stock" },
      { id: "overdue", text: "5 data requests are overdue", href: "/privacy/requests" },
      { id: "out", text: "3 products are out of stock", href: "/stock" },
      {
        id: "awaiting",
        text: "2 medicines are awaiting a pharmacist's approval",
        href: "/products",
      },
    ]);
    expect(incomplete).toBe(false);
  });

  it("puts paid orders waiting for stock first (#158)", () => {
    expect(
      needsAttention({
        orders: ok({ stockShort: 2, overdue: 0 }),
        stock: ok({ out: 1, short: 0 }),
      }).items,
    ).toEqual([
      {
        id: "stock_short_orders",
        text: "2 paid orders are waiting for stock",
        href: "/orders?status=paid_stock_short",
      },
      { id: "out", text: "1 product is out of stock", href: "/stock" },
    ]);
    expect(needsAttention({ orders: ok({ stockShort: 1, overdue: 0 }) }).items[0]?.text).toBe(
      "1 paid order is waiting for stock",
    );
    expect(needsAttention({ orders: ok({ stockShort: 3, overdue: 2 }) }).items[0]?.text).toBe(
      "3 paid orders are waiting for stock (2 past the deadline)",
    );
    expect(needsAttention({ orders: ok({ stockShort: 0, overdue: 0 }) }).items).toEqual([]);
    expect(needsAttention({ orders: failed }).incomplete).toBe(true);
  });

  it("says one in the singular", () => {
    const { items } = needsAttention({
      products: ok({ awaitingApproval: 1 }),
      stock: ok({ out: 1, short: 1 }),
      requests: ok({ overdue: 1 }),
    });
    expect(items.map((item) => item.text)).toEqual([
      "1 product is short for orders",
      "1 data request is overdue",
      "1 product is out of stock",
      "1 medicine is awaiting a pharmacist's approval",
    ]);
  });

  it("leaves out zero counts, and is empty when nothing is due", () => {
    expect(
      needsAttention({ stock: ok({ out: 2, short: 0 }), requests: ok({ overdue: 0 }) }).items.map(
        (item) => item.id,
      ),
    ).toEqual(["out"]);
    expect(
      needsAttention({
        products: ok({ awaitingApproval: 0 }),
        stock: ok({ out: 0, short: 0 }),
        requests: ok({ overdue: 0 }),
      }),
    ).toEqual({ items: [], incomplete: false });
  });

  it("reads only the tiles the member may see", () => {
    // a content editor: the products tile only
    expect(needsAttention({ products: ok({ awaitingApproval: 3 }) }).items).toEqual([
      {
        id: "awaiting",
        text: "3 medicines are awaiting a pharmacist's approval",
        href: "/products",
      },
    ]);
    expect(needsAttention({})).toEqual({ items: [], incomplete: false });
  });

  it("a tile in its error state adds nothing and marks the list incomplete", () => {
    expect(
      needsAttention({ stock: failed, requests: ok({ overdue: 2 }), products: undefined }),
    ).toEqual({
      items: [{ id: "overdue", text: "2 data requests are overdue", href: "/privacy/requests" }],
      incomplete: true,
    });
    expect(needsAttention({ requests: failed })).toEqual({ items: [], incomplete: true });
  });
});
