import { describe, expect, it } from "vitest";

import { CATEGORY_ICONS, categoryIconFor } from "../src/lib/category-icon";

const DEMO_TOP_LEVEL = [
  "pain-fever",
  "cold-flu",
  "allergy",
  "vitamins",
  "skin-care",
  "first-aid",
  "hygiene",
  "baby",
] as const;

describe("categoryIconFor", () => {
  it("gives each top-level demo category its own icon", () => {
    for (const slug of DEMO_TOP_LEVEL) expect(categoryIconFor(slug)).toBe(slug);
    expect(new Set(DEMO_TOP_LEVEL.map(categoryIconFor)).size).toBe(DEMO_TOP_LEVEL.length);
  });

  it("falls back to the generic icon for any other slug", () => {
    for (const slug of ["sun-care", "e2e-browse-1234", "", "constructor", "__proto__"]) {
      expect(categoryIconFor(slug)).toBe("generic");
    }
  });

  it("only ever names an icon that exists", () => {
    for (const slug of [...DEMO_TOP_LEVEL, "anything"]) {
      expect(CATEGORY_ICONS).toContain(categoryIconFor(slug));
    }
  });
});
