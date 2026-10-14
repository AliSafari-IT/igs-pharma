import { describe, expect, it } from "vitest";

import { type Candidate, composeListing, statusOf } from "./compose";
import { type AvailabilityStatus, type StorefrontPriceView, listInputSchema } from "./contract";
import { fixtureListProducts } from "./fixtures";

const id = (n: number) => `0192f000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const price = (amountCents: number): StorefrontPriceView => ({
  amountCents,
  vatClass: "BE_6",
  vatRateBp: 600,
});
const candidate = (n: number, name: string, extra: Partial<Candidate> = {}): Candidate => ({
  id: id(n),
  cnk: String(9_000_000 + n),
  name,
  brandName: null,
  shortDescription: null,
  contentLocale: "nl",
  isMedicine: false,
  createdAt: new Date(Date.UTC(2026, 0, n)),
  rank: 0,
  ...extra,
});

const parts = (
  candidates: Candidate[],
  prices: Record<number, number>,
  statuses: Record<number, AvailabilityStatus> = {},
) => ({
  candidates,
  prices: new Map(Object.entries(prices).map(([n, cents]) => [id(Number(n)), price(cents)])),
  loadStatuses: async (ids: readonly string[]) =>
    new Map(
      ids.flatMap((i) =>
        statuses[Number.parseInt(i.slice(-12), 10)]
          ? [[i, statuses[Number.parseInt(i.slice(-12), 10)] as AvailabilityStatus] as const]
          : [],
      ),
    ),
  category: null,
});
const parse = (input: object) => listInputSchema.parse({ locale: "nl", ...input });
const names = (page: { items: { name: string }[] }) => page.items.map((i) => i.name);

describe("statusOf", () => {
  it.each([
    [-2, 3, "out"],
    [0, 3, "out"],
    [1, 3, "low"],
    [3, 3, "low"],
    [4, 3, "available"],
    [1, 0, "available"],
    [0, 0, "out"],
  ] as const)("%i on hand with a threshold of %i is %s", (onHand, threshold, expected) => {
    expect(statusOf(onHand, threshold)).toBe(expected);
  });
});

describe("composeListing", () => {
  const items = [
    candidate(1, "Banaan"),
    candidate(2, "appel"),
    candidate(3, "Cactus"),
    candidate(4, "appel"), // the same name as 2: the id breaks the tie
  ];
  const prices = { 1: 500, 2: 300, 3: 500, 4: 300 };

  it("sorts by name ignoring case, ties by id", async () => {
    const page = await composeListing(parse({}), parts(items, prices));
    expect(page.items.map((i) => i.id)).toEqual([id(2), id(4), id(1), id(3)]);
  });

  it("sorts by price both ways, ties by name then id", async () => {
    const asc = await composeListing(parse({ sort: "price_asc" }), parts(items, prices));
    expect(asc.items.map((i) => i.id)).toEqual([id(2), id(4), id(1), id(3)]);
    const desc = await composeListing(parse({ sort: "price_desc" }), parts(items, prices));
    expect(desc.items.map((i) => i.id)).toEqual([id(1), id(3), id(2), id(4)]);
  });

  it("sorts latest first, ties by id", async () => {
    const same = new Date(Date.UTC(2026, 5, 1));
    const page = await composeListing(
      parse({ sort: "latest" }),
      parts(
        [
          candidate(1, "a", { createdAt: same }),
          candidate(2, "b", { createdAt: same }),
          candidate(3, "c"),
        ],
        { 1: 1, 2: 1, 3: 1 },
      ),
    );
    expect(page.items.map((i) => i.id)).toEqual([id(2), id(1), id(3)]);
  });

  it("puts the better match first when there is a query", async () => {
    const page = await composeListing(
      parse({ q: "zink" }),
      parts(
        [
          candidate(1, "Alfa zink", { rank: 2 }),
          candidate(2, "Zinkzalf", { rank: 1 }),
          candidate(3, "Crème", { rank: 3 }),
          candidate(4, "Zink", { rank: 0 }),
        ],
        { 1: 1, 2: 1, 3: 1, 4: 1 },
      ),
    );
    expect(names(page)).toEqual(["Zink", "Zinkzalf", "Alfa zink", "Crème"]);
    expect(page.q).toBe("zink");
  });

  it("does not list a product without a price", async () => {
    const page = await composeListing(parse({}), parts(items, { 1: 500, 3: 500 }));
    expect(page.total).toBe(2);
    expect(names(page)).toEqual(["Banaan", "Cactus"]);
  });

  it("filters to products in stock and counts only those", async () => {
    const page = await composeListing(
      parse({ availability: "in_stock" }),
      parts(items, prices, { 1: "available", 2: "low", 3: "out" }),
    );
    expect(page.items.map((i) => i.id)).toEqual([id(2), id(1)]);
    expect(page.total).toBe(2);
  });

  it("a product with no availability row is out", async () => {
    const page = await composeListing(parse({}), parts([candidate(1, "x")], { 1: 1 }));
    expect(page.items[0]?.status).toBe("out");
  });

  it("pages are stable and complete for every sort: no product repeats or is skipped", async () => {
    const many = Array.from({ length: 23 }, (_, i) =>
      candidate(i + 1, i % 3 === 0 ? "Zelfde" : `Naam ${i % 5}`),
    );
    const manyPrices = Object.fromEntries(many.map((_, i) => [i + 1, 100 + (i % 4) * 50]));
    for (const sort of ["relevance", "latest", "name", "price_asc", "price_desc"] as const) {
      const seen: string[] = [];
      for (let page = 1; page <= 5; page++) {
        const result = await composeListing(
          parse({ sort, page, pageSize: 5 }),
          parts(many, manyPrices),
        );
        expect(result.pageCount).toBe(5);
        expect(result.total).toBe(23);
        seen.push(...result.items.map((i) => i.id));
      }
      expect(new Set(seen).size, sort).toBe(23);
      expect(seen).toHaveLength(23);
    }
  });

  it("a page past the end is empty, with the real total", async () => {
    const page = await composeListing(parse({ page: 9, pageSize: 2 }), parts(items, prices));
    expect(page.items).toEqual([]);
    expect([page.total, page.page, page.pageCount]).toEqual([4, 9, 2]);
  });

  it("an empty set has no pages", async () => {
    const page = await composeListing(parse({}), parts([], {}));
    expect([page.total, page.pageCount, page.items]).toEqual([0, 0, []]);
  });

  it("loads availability for the page only when it does not filter on it", async () => {
    const asked: string[][] = [];
    const base = parts(items, prices);
    await composeListing(parse({ pageSize: 2 }), {
      ...base,
      loadStatuses: async (ids) => {
        asked.push([...ids]);
        return new Map();
      },
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toHaveLength(2);
  });
});

describe("the fixtures go through the same composition", () => {
  it("search, category subtree and price sort work end to end", async () => {
    const cream = await fixtureListProducts({ locale: "nl", q: "handcrème" });
    expect(cream.items.map((i) => i.cnk)).toEqual(["9900004"]);
    const health = await fixtureListProducts({
      locale: "nl",
      categorySlug: "gezondheid",
      sort: "price_asc",
    });
    expect(health.category).toEqual({ slug: "gezondheid", name: "Gezondheid" });
    const amounts = health.items.map((i) => i.price.amountCents);
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
    expect(
      health.items.every((i) =>
        ["9900001", "9900002", "9900005", "9900006", "9900008"].includes(i.cnk),
      ),
    ).toBe(true);
  });
});
