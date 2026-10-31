import type { StorefrontCategoryNode } from "@igs/module-storefront";
import { describe, expect, it } from "vitest";

import { categoryBar, categoryPath, topLevel } from "../src/lib/category-path";

const cat = (id: string, parentId: string | null, depth: number): StorefrontCategoryNode => ({
  id,
  parentId,
  slug: id,
  name: id.toUpperCase(),
  depth,
  productCount: 1,
});

const tree = [cat("a", null, 1), cat("b", "a", 2), cat("c", "b", 3), cat("d", null, 1)];

describe("categoryPath", () => {
  it("lists the ancestors from the top down to the category itself", () => {
    expect(categoryPath(tree, "c").map((c) => c.slug)).toEqual(["a", "b", "c"]);
    expect(categoryPath(tree, "d").map((c) => c.slug)).toEqual(["d"]);
  });

  it("is empty for a slug that is not in the tree", () => {
    expect(categoryPath(tree, "nope")).toEqual([]);
  });

  it("stops on a cycle instead of looping", () => {
    const broken = [cat("x", "y", 1), cat("y", "x", 1)];
    expect(categoryPath(broken, "x").map((c) => c.slug)).toEqual(["y", "x"]);
  });
});

describe("topLevel", () => {
  it("keeps only the categories without a parent, in order", () => {
    expect(topLevel(tree).map((c) => c.slug)).toEqual(["a", "d"]);
  });
});

describe("categoryBar (igs-pharma#193)", () => {
  it("shows the top level; inside a branch, every level under its top", () => {
    expect(categoryBar(tree, undefined)).toEqual({
      top: [tree[0], tree[3]],
      activeTopId: null,
      branch: [],
    });
    for (const slug of ["a", "b", "c"]) {
      const bar = categoryBar(tree, slug);
      expect(bar.activeTopId, slug).toBe("a");
      expect(
        bar.branch.map((c) => c.slug),
        slug,
      ).toEqual(["b", "c"]);
    }
    expect(categoryBar(tree, "d")).toMatchObject({ activeTopId: "d", branch: [] });
    expect(categoryBar(tree, "nope").activeTopId).toBeNull();
  });
});
