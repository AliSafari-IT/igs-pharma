import { describe, expect, it } from "vitest";

import { MAX_IMPORT_ROWS, parseStockCsv } from "./domain";

describe("parseStockCsv", () => {
  it("reads cnk;quantity lines, skipping a BOM, a header, blank lines and comments", () => {
    const csv = "﻿cnk;quantity\r\n0000001;12\n\n# counted on Monday\n0000002 ; 0\n";
    expect(parseStockCsv(csv)).toEqual({
      rows: [
        { line: 2, cnk: "0000001", quantity: 12 },
        { line: 5, cnk: "0000002", quantity: 0 },
      ],
      errors: [],
    });
  });

  it("reads a spreadsheet export: quoted fields and header, Windows and old Mac line endings (#91)", () => {
    const csv = '"cnk";"quantity"\r\n"0000001";"12"\r"0000002" ; " 4 "\r\n0000003;"0"';
    expect(parseStockCsv(csv)).toEqual({
      rows: [
        { line: 2, cnk: "0000001", quantity: 12 },
        { line: 3, cnk: "0000002", quantity: 4 },
        { line: 4, cnk: "0000003", quantity: 0 },
      ],
      errors: [],
    });
    expect(parseStockCsv('"0000001","3"').rows).toEqual([{ line: 1, cnk: "0000001", quantity: 3 }]);
    // a quote is not part of the value: an unbalanced one still makes the line invalid
    expect(parseStockCsv('"0000001;3').errors).toEqual([
      { line: 1, code: "inventory.cnk_invalid" },
    ]);
  });

  it("accepts a comma when a line has no semicolon", () => {
    expect(parseStockCsv("0000001,3").rows).toEqual([{ line: 1, cnk: "0000001", quantity: 3 }]);
  });

  it("reports every bad line at once", () => {
    const csv = [
      "0000001;1",
      "123;4",
      "0000002;-1",
      "0000003;1.5",
      "0000001;2",
      "0000004",
      "a;b;c",
    ];
    expect(parseStockCsv(csv.join("\n")).errors).toEqual([
      { line: 2, code: "inventory.cnk_invalid" },
      { line: 3, code: "inventory.quantity_invalid" },
      { line: 4, code: "inventory.quantity_invalid" },
      { line: 5, code: "inventory.duplicate_cnk" },
      { line: 6, code: "inventory.row_malformed" },
      { line: 7, code: "inventory.row_malformed" },
    ]);
  });

  it("refuses a quantity above the limit", () => {
    expect(parseStockCsv("0000001;1000001").errors).toEqual([
      { line: 1, code: "inventory.quantity_invalid" },
    ]);
  });

  it("refuses an empty file and one with too many rows", () => {
    expect(parseStockCsv("cnk;quantity\n\n").errors).toEqual([
      { line: 0, code: "inventory.import_empty" },
    ]);
    const many = Array.from(
      { length: MAX_IMPORT_ROWS + 1 },
      (_, i) => `${String(i).padStart(7, "0")};1`,
    ).join("\n");
    expect(parseStockCsv(many).errors[0]).toEqual({ line: 0, code: "inventory.too_many_rows" });
  });
});
