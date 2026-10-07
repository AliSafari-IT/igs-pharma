import { describe, expect, it } from "vitest";

import { canonicalJson, requestHash } from "../src";

describe("canonicalJson / requestHash (K4)", () => {
  it("sorts keys, drops undefined, keeps null, no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, undefined, "x"], c: null }, z: undefined })).toBe(
      '{"a":{"c":null,"d":[3,null,"x"]},"b":1}',
    );
  });

  it("formats dates as UTC ISO with ms, tags bigint, rejects non-finite numbers", () => {
    expect(canonicalJson(new Date("2026-01-02T03:04:05.678Z"))).toBe('"2026-01-02T03:04:05.678Z"');
    expect(canonicalJson(1n)).toBe('"1n"');
    expect(canonicalJson(1)).not.toBe(canonicalJson(1n));
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/unsupported/);
  });

  it("hash is independent of key order and differs for different input", () => {
    expect(requestHash({ a: 1, b: 2 })).toBe(requestHash({ b: 2, a: 1 }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
    expect(requestHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
