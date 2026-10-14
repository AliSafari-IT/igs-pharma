import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  defaultSort,
  getInputSchema,
  listInputSchema,
  listOutputSchema,
  productSchema,
  visibilityOutputSchema,
} from "./contract";
import { FIXTURE_PRODUCTS, fixtureGetProduct, fixtureListProducts } from "./fixtures";

describe("storefront.products.list input", () => {
  it("fills the defaults: first page of 24, nothing filtered", () => {
    expect(listInputSchema.parse({ locale: "nl" })).toEqual({
      locale: "nl",
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it("trims q; empty or blank means no text filter; one character is refused", () => {
    expect(listInputSchema.parse({ locale: "fr", q: "  zink  " }).q).toBe("zink");
    expect(listInputSchema.parse({ locale: "fr", q: "   " }).q).toBeUndefined();
    expect(listInputSchema.parse({ locale: "fr", q: "" }).q).toBeUndefined();
    expect(listInputSchema.safeParse({ locale: "fr", q: "z" }).success).toBe(false);
    expect(listInputSchema.safeParse({ locale: "fr", q: "x".repeat(101) }).success).toBe(false);
    // counted in characters, not UTF-16 units
    expect(listInputSchema.safeParse({ locale: "fr", q: "é" }).success).toBe(false);
    expect(listInputSchema.safeParse({ locale: "fr", q: "éé" }).success).toBe(true);
  });

  it.each([
    [{ page: 0 }],
    [{ page: 10_001 }],
    [{ page: 1.5 }],
    [{ pageSize: 0 }],
    [{ pageSize: MAX_PAGE_SIZE + 1 }],
    [{ sort: "popular" }],
    [{ availability: "low" }],
    [{ locale: "it" }],
    [{ categorySlug: "" }],
  ])("refuses %j", (bad) => {
    expect(listInputSchema.safeParse({ locale: "nl", ...bad }).success).toBe(false);
  });

  it("takes page and pageSize from a URL query string (strings)", () => {
    const parsed = listInputSchema.parse({ locale: "en", page: "3", pageSize: "48" });
    expect([parsed.page, parsed.pageSize]).toEqual([3, 48]);
  });

  it("sorts by relevance when there is a query, by name otherwise", () => {
    expect(defaultSort("zink")).toBe("relevance");
    expect(defaultSort(undefined)).toBe("name");
  });
});

describe("storefront.product.get input", () => {
  it("wants a 7-digit CNK", () => {
    expect(getInputSchema.safeParse({ cnk: "9900001", locale: "nl" }).success).toBe(true);
    expect(getInputSchema.safeParse({ cnk: "99000", locale: "nl" }).success).toBe(false);
    expect(getInputSchema.safeParse({ cnk: "99000011", locale: "nl" }).success).toBe(false);
  });
});

describe("the fixtures follow the contract", () => {
  it("every listing the fixtures produce satisfies the output schema", async () => {
    for (const input of [
      { locale: "nl" as const },
      { locale: "fr" as const, q: "creme", sort: "price_desc" as const },
      { locale: "en" as const, categorySlug: "gezondheid", availability: "in_stock" as const },
      { locale: "de" as const, page: 99 },
    ]) {
      const listing = await fixtureListProducts(input);
      expect(() => listOutputSchema.parse(listing)).not.toThrow();
    }
  });

  it("every fixture product page satisfies the product schema", () => {
    for (const p of FIXTURE_PRODUCTS) {
      const page = fixtureGetProduct(p.cnk);
      expect(page).toBeDefined();
      expect(() => productSchema.parse(page)).not.toThrow();
    }
    expect(fixtureGetProduct("1234567")).toBeUndefined();
  });

  it("never carries a stock count: availability is a word", async () => {
    const listing = await fixtureListProducts({ locale: "nl", pageSize: 48 });
    for (const item of listing.items) {
      expect(["available", "low", "out"]).toContain(item.status);
      expect(Object.keys(item).sort()).toEqual(
        [
          "brandName",
          "cnk",
          "contentLocale",
          "id",
          "isMedicine",
          "name",
          "price",
          "shortDescription",
          "status",
        ].sort(),
      );
    }
  });

  it("the visibility answer has a closed set of reasons", () => {
    expect(
      visibilityOutputSchema.safeParse({
        visible: false,
        reasons: [{ code: "no_price" }, { code: "text_not_approved", locales: ["nl", "fr"] }],
      }).success,
    ).toBe(true);
    expect(
      visibilityOutputSchema.safeParse({ visible: false, reasons: [{ code: "x" }] }).success,
    ).toBe(false);
    expect(
      visibilityOutputSchema.safeParse({
        visible: false,
        reasons: [{ code: "text_not_approved", locales: [] }],
      }).success,
    ).toBe(false);
  });
});
