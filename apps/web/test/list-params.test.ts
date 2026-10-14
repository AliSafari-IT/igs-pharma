import { describe, expect, it } from "vitest";

import { isCnk, listQuery, parseListParams } from "../src/lib/list-params";

describe("parseListParams", () => {
  it("defaults", () => {
    expect(parseListParams({})).toEqual({
      q: undefined,
      qTooShort: false,
      sort: undefined,
      inStock: false,
      page: 1,
    });
  });
  it("trims and caps the query, and flags one character", () => {
    expect(parseListParams({ q: "  zalf " }).q).toBe("zalf");
    expect(parseListParams({ q: "x".repeat(300) }).q).toHaveLength(100);
    expect(parseListParams({ q: "a" })).toMatchObject({ q: undefined, qTooShort: true });
    expect(parseListParams({ q: "   " })).toMatchObject({ q: undefined, qTooShort: false });
  });
  it("drops unknown sorts and sorts a page does not offer", () => {
    expect(parseListParams({ sort: "price_asc" }).sort).toBe("price_asc");
    expect(parseListParams({ sort: "evil" }).sort).toBeUndefined();
    expect(parseListParams({ sort: "relevance" }, ["name", "latest"]).sort).toBeUndefined();
  });
  it("clamps the page and takes the first of repeated values", () => {
    expect(parseListParams({ page: "0" }).page).toBe(1);
    expect(parseListParams({ page: "-4" }).page).toBe(1);
    expect(parseListParams({ page: "x" }).page).toBe(1);
    expect(parseListParams({ page: "99999999" }).page).toBe(10_000);
    expect(parseListParams({ page: ["3", "4"] }).page).toBe(3);
  });
  it("reads the stock filter", () => {
    expect(parseListParams({ availability: "in_stock" }).inStock).toBe(true);
    expect(parseListParams({ availability: "all" }).inStock).toBe(false);
  });
});

describe("listQuery", () => {
  it("is empty without filters and keeps them, encoded, otherwise", () => {
    expect(listQuery({ q: undefined, sort: undefined, inStock: false })).toBe("");
    expect(listQuery({ q: "vitamine c", sort: "name", inStock: true }, 2)).toBe(
      "?q=vitamine+c&sort=name&availability=in_stock&page=2",
    );
  });
});

describe("isCnk", () => {
  it("accepts exactly seven digits", () => {
    expect(isCnk("1234567")).toBe(true);
    expect(isCnk("123456")).toBe(false);
    expect(isCnk("12345678")).toBe(false);
    expect(isCnk("12345a7")).toBe(false);
    expect(isCnk(undefined)).toBe(false);
  });
});
