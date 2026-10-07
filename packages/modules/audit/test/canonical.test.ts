import { describe, expect, it } from "vitest";

import { canonicalJson } from "../src/canonical";
import { type EventCore, GENESIS_HASH, canonicalEvent, computeHash } from "../src/chain";

/**
 * GOLDEN VECTORS — produced independently (Python reference implementation of the spec in
 * docs/03-architecture/audit-log.md), not by this code. Any reimplementation of the chain must
 * reproduce them exactly.
 */
describe("canonicalJson golden vectors", () => {
  it("sorts keys, keeps null, drops nothing but undefined, escapes like JSON.stringify", () => {
    expect(canonicalJson({ é: 1, b: 'xé\n"', a: [1, null, true, { y: 2, x: -3 }] })).toBe(
      '{"a":[1,null,true,{"x":-3,"y":2}],"b":"xé\\n\\"","é":1}',
    );
  });

  it("orders keys by UTF-16 code unit (astral characters sort before U+FFFF)", () => {
    expect(canonicalJson({ "\u{1F600}": 1, "￿": 2, a: 3 })).toBe('{"a":3,"\u{1F600}":1,"￿":2}');
  });
});

describe("canonicalJson rules", () => {
  it("drops undefined object keys but rejects undefined array items", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(() => canonicalJson([1, undefined])).toThrow(/unsupported/);
  });

  it("accepts safe integers only", () => {
    expect(canonicalJson(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
    expect(() => canonicalJson(1.5)).toThrow(/safe integers/);
    expect(() => canonicalJson(Number.NaN)).toThrow(/safe integers/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/safe integers/);
    expect(() => canonicalJson(2 ** 53)).toThrow(/safe integers/);
  });
});

const vectorCore: EventCore = {
  id: "018f0000-0000-7000-8000-000000000001",
  at: new Date("2026-01-02T03:04:05.678Z"),
  seq: 1,
  actorType: "user",
  actorId: "user-1",
  action: "pharmacy.review.decided",
  entityType: "order",
  entityId: "o-1",
  locationId: null,
  ipHash: "v1:abc",
  uaHash: null,
  data: { decision: "approved", orderId: "o-1", z: 1, a: true, n: null },
  prevHash: GENESIS_HASH,
};

describe("event hash golden vector", () => {
  it("canonical form of the hashed content (every column except hash)", () => {
    expect(canonicalJson(canonicalEvent(vectorCore))).toBe(
      '{"action":"pharmacy.review.decided","actor_id":"user-1","actor_type":"user","at":"2026-01-02T03:04:05.678Z","data":{"a":true,"decision":"approved","n":null,"orderId":"o-1","z":1},"entity_id":"o-1","entity_type":"order","id":"018f0000-0000-7000-8000-000000000001","ip_hash":"v1:abc","location_id":null,"prev_hash":"0000000000000000000000000000000000000000000000000000000000000000","seq":1,"ua_hash":null}',
    );
  });

  it("hash = sha256(canonical || prev_hash)", () => {
    expect(computeHash(vectorCore)).toBe(
      "fd446d39cbf681c3cc4245d177eb05b80f65a7cc8450d0dfccc6ddcf3e646e98",
    );
  });

  it("timestamps are truncated to milliseconds before hashing", () => {
    expect(computeHash({ ...vectorCore, at: new Date(vectorCore.at.getTime() + 0.9) })).toBe(
      computeHash(vectorCore),
    );
  });

  it("changing any hashed column changes the hash", () => {
    const base = computeHash(vectorCore);
    const variants: Partial<EventCore>[] = [
      { seq: 2 },
      { actorId: "user-2" },
      { entityId: "o-2" },
      { locationId: "018f0000-0000-7000-8000-0000000000aa" },
      { ipHash: "v1:abd" },
      { data: { ...vectorCore.data, z: 2 } },
      { prevHash: "1".repeat(64) },
      { at: new Date(vectorCore.at.getTime() + 1) },
    ];
    for (const change of variants) {
      expect(computeHash({ ...vectorCore, ...change })).not.toBe(base);
    }
  });
});
