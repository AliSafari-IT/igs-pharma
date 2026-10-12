import { describe, expect, it } from "vitest";

import { depthOf, isValidCnk, missingForActivation, subtreeHeight, wouldCycle } from "./domain";

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

describe("category tree rules", () => {
  // a ─ b ─ c   and   d
  const links = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "d", parentId: null },
  ];

  it("finds a cycle: under itself or under a descendant", () => {
    expect(wouldCycle(links, "a", "a")).toBe(true);
    expect(wouldCycle(links, "a", "c")).toBe(true);
    expect(wouldCycle(links, "b", "c")).toBe(true);
  });

  it("allows a move to the root, to a sibling branch or up the tree", () => {
    expect(wouldCycle(links, "b", null)).toBe(false);
    expect(wouldCycle(links, "b", "d")).toBe(false);
    expect(wouldCycle(links, "c", "a")).toBe(false);
  });

  it("never loops on a tree that is already broken", () => {
    const broken = [
      { id: "x", parentId: "y" },
      { id: "y", parentId: "x" },
    ];
    expect(wouldCycle(broken, "z", "x")).toBe(true);
    expect(depthOf(broken, "x")).toBe(2);
  });

  it("measures depth and subtree height", () => {
    expect(depthOf(links, null)).toBe(0);
    expect(depthOf(links, "a")).toBe(1);
    expect(depthOf(links, "c")).toBe(3);
    expect(subtreeHeight(links, "a")).toBe(3);
    expect(subtreeHeight(links, "c")).toBe(1);
    expect(subtreeHeight(links, "d")).toBe(1);
  });
});
