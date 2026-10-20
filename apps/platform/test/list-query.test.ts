// The back-office list query string (igs-pharma#104): one reading of `q` and `page` for every list,
// and the pager's links keep the search.
import { describe, expect, it } from "vitest";

import { countLine, listHref, pageCount, parseListQuery } from "../src/lib/list-query";

describe("parseListQuery", () => {
  it("trims and caps the search, and keeps the page between 1 and 10 000", () => {
    expect(parseListQuery({})).toEqual({ q: "", page: 1 });
    expect(parseListQuery({ q: "  dafalgan ", page: "3" })).toEqual({ q: "dafalgan", page: 3 });
    expect(parseListQuery({ q: "x".repeat(150) }).q).toHaveLength(100);
    expect(parseListQuery({ q: ["a", "b"], page: ["2", "9"] })).toEqual({ q: "a", page: 2 });
    for (const bad of ["0", "-4", "abc", ""])
      expect(parseListQuery({ page: bad }).page, bad).toBe(1);
    expect(parseListQuery({ page: "999999" }).page).toBe(10_000);
  });
});

describe("the pager", () => {
  it("links keep the search; the count line says page, pages and total", () => {
    expect(listHref("/stock", "", 2)).toBe("/stock?page=2");
    expect(listHref("/products", "pijn & koorts", 1)).toBe("/products?q=pijn+%26+koorts&page=1");
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(51, 25)).toBe(3);
    expect(countLine(2, 3, 51, "product")).toBe("Page 2 of 3 · 51 products");
    expect(countLine(1, 1, 1, "product")).toBe("Page 1 of 1 · 1 product");
  });
});
