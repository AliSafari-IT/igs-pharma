import { describe, expect, it } from "vitest";

import { decryptField, encryptField } from "./envelope";
import { safeEqual, sha256Hex } from "./hash";

describe("sha256Hex", () => {
  it("matches the known digest of 'abc'", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("safeEqual", () => {
  it("is true for equal strings and false otherwise", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secreT")).toBe(false);
    expect(safeEqual("short", "longer-value")).toBe(false);
  });
});

describe("envelope encryption stubs", () => {
  it("refuses to run until KMS is wired", () => {
    expect(() => encryptField("x")).toThrow(/not yet configured/);
    expect(() => decryptField("x")).toThrow(/not yet configured/);
  });
});
