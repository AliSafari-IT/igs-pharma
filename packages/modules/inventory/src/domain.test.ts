import { describe, expect, it } from "vitest";

import { MAX_IMPORT_ROWS, parseCountCsv } from "./domain";

describe("parseCountCsv", () => {
  it("reads cnk;lot;expiry;counted lines, skipping a BOM, a header, blank lines and comments", () => {
    const csv =
      "\uFEFFcnk;lot;expiry;counted\r\n0000001;A12;2027-03-31;12\n\n# counted on Monday\n0000002 ; ; ; 0\n";
    expect(parseCountCsv(csv)).toEqual({
      rows: [
        { line: 2, cnk: "0000001", lotNumber: "A12", expiryDate: "2027-03-31", counted: 12 },
        { line: 5, cnk: "0000002", lotNumber: null, expiryDate: null, counted: 0 },
      ],
      errors: [],
    });
  });

  it("reads a spreadsheet export: quoted fields, Belgian dates, any line ending", () => {
    const csv =
      '"cnk";"lot";"expiry";"counted"\r\n"0000001";"B 7";"31/03/2027";"3"\r0000002;C9;;"4"';
    expect(parseCountCsv(csv).rows).toEqual([
      { line: 2, cnk: "0000001", lotNumber: "B 7", expiryDate: "2027-03-31", counted: 3 },
      { line: 3, cnk: "0000002", lotNumber: "C9", expiryDate: null, counted: 4 },
    ]);
  });

  it("reports every bad line at once", () => {
    const csv = [
      "0000001;A;;1",
      "123;A;;4",
      "0000002;A;;-1",
      "0000003;A;31/02/2027;1",
      "0000004;;2027-01-01;1",
      "0000005;?bad;;1",
      "0000006;A;1",
    ];
    expect(parseCountCsv(csv.join("\n")).errors).toEqual([
      { line: 2, code: "inventory.cnk_invalid" },
      { line: 3, code: "inventory.quantity_invalid" },
      { line: 4, code: "inventory.expiry_invalid" },
      { line: 5, code: "inventory.expiry_invalid" },
      { line: 6, code: "inventory.lot_number_invalid" },
      { line: 7, code: "inventory.row_malformed" },
    ]);
  });

  it("refuses a count above the limit, an empty file and one with too many rows", () => {
    expect(parseCountCsv("0000001;A;;1000001").errors).toEqual([
      { line: 1, code: "inventory.quantity_invalid" },
    ]);
    expect(parseCountCsv("cnk;lot;expiry;counted\n\n").errors).toEqual([
      { line: 0, code: "inventory.import_empty" },
    ]);
    const many = Array.from(
      { length: MAX_IMPORT_ROWS + 1 },
      (_, i) => `${String(i).padStart(7, "0")};A;;1`,
    ).join("\n");
    expect(parseCountCsv(many).errors[0]).toEqual({ line: 0, code: "inventory.too_many_rows" });
  });
});
