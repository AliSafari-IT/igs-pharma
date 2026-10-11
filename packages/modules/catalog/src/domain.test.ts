import { describe, expect, it } from "vitest";

import { isValidCnk, missingForActivation } from "./domain";

describe("isValidCnk", () => {
  it.each(["0000000", "1234567", "9900001"])("accepts %s", (cnk) => {
    expect(isValidCnk(cnk)).toBe(true);
  });

  it.each(["", "123456", "12345678", "123 456", "12345a7", " 1234567", "1234567\n", "١٢٣٤٥٦٧"])(
    "rejects %j",
    (cnk) => {
      expect(isValidCnk(cnk)).toBe(false);
    },
  );
});

describe("missingForActivation", () => {
  it("needs Dutch and French", () => {
    expect(missingForActivation([])).toEqual(["nl", "fr"]);
    expect(missingForActivation(["nl"])).toEqual(["fr"]);
    expect(missingForActivation(["fr", "de", "en"])).toEqual(["nl"]);
  });

  it("is complete with both, whatever else is there", () => {
    expect(missingForActivation(["fr", "nl"])).toEqual([]);
    expect(missingForActivation(new Set(["nl", "fr", "de", "en"]))).toEqual([]);
  });
});
