import { describe, expect, it } from "vitest";
import { expandUpcE, hasGs1CheckDigit, readScannedCode } from "../src/scan/code";

describe("readScannedCode", () => {
  it("reads EAN-13, EAN-8, UPC-A and GTIN-14 barcodes as a GTIN", () => {
    for (const gtin of ["5410013111009", "96385074", "036000291452", "05410013111009"]) {
      expect(readScannedCode(gtin)).toEqual({ kind: "gtin", gtin });
    }
  });

  it("takes the GTIN out of a GS1 DataMatrix and ignores serial, expiry and batch", () => {
    const gs = "\u001d";
    expect(readScannedCode(`0105410013111009211234567890${gs}17271231${gs}10AB12`)).toEqual({
      kind: "gtin",
      gtin: "05410013111009",
    });
    expect(readScannedCode(`]d2${gs}010541001311100917271231`)).toEqual({
      kind: "gtin",
      gtin: "05410013111009",
    });
    expect(readScannedCode("(01)05410013111009(17)271231")).toEqual({
      kind: "gtin",
      gtin: "05410013111009",
    });
  });

  it("reads 7 digits as a CNK", () => {
    expect(readScannedCode(" 1234567 ")).toEqual({ kind: "cnk", cnk: "1234567" });
  });

  it("refuses what is no product code: a wrong check digit, a web address, text", () => {
    for (const data of ["5410013111006", "https://igs-pharma.be", "hello", "", "123456"]) {
      expect(readScannedCode(data), data).toBeNull();
    }
  });
});

describe("hasGs1CheckDigit", () => {
  it("checks the GS1 mod-10 digit", () => {
    expect(hasGs1CheckDigit("5412345000013")).toBe(true);
    expect(hasGs1CheckDigit("5412345000014")).toBe(false);
  });
});

describe("UPC-E", () => {
  it("expands each zero-suppression form to its GTIN-12 before the lookup", () => {
    expect(readScannedCode("01234558", "upc_e")).toEqual({ kind: "gtin", gtin: "012345000058" });
    expect(expandUpcE("04252614")).toBe("042100005264"); // last digit 2: x1 x2 x6 0000 x3 x4 x5
    expect(expandUpcE("01234531")).toBe("012300000451"); // last digit 3
    expect(expandUpcE("01234543")).toBe("012340000053"); // last digit 4
  });

  it("refuses a UPC-E with a wrong check digit or number system", () => {
    expect(readScannedCode("01234559", "upc_e")).toBeNull();
    expect(expandUpcE("21234558")).toBeNull();
  });
});
