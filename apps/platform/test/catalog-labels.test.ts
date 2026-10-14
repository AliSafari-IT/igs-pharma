import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { catalogErrorMessage, statusLabelFor } from "../src/components/catalog-labels";

// The product page reads `?status=` and `?error=` straight from the URL (igs-pharma#51 review).
const PROTOTYPE_KEYS = ["toString", "constructor", "hasOwnProperty", "__proto__", "valueOf"];

describe("statusLabelFor", () => {
  it("labels the three statuses", () => {
    expect(statusLabelFor("draft")).toBe("Draft");
    expect(statusLabelFor("active")).toBe("Active");
    expect(statusLabelFor("archived")).toBe("Archived");
  });

  it("ignores anything else, Object.prototype names included", () => {
    expect(statusLabelFor(undefined)).toBeUndefined();
    expect(statusLabelFor("")).toBeUndefined();
    expect(statusLabelFor("deleted")).toBeUndefined();
    for (const key of PROTOTYPE_KEYS) expect(statusLabelFor(key)).toBeUndefined();
  });
});

describe("catalogErrorMessage", () => {
  const fallback = "That didn't work. Try again.";

  it("explains a known code", () => {
    expect(catalogErrorMessage("catalog.cnk_taken")).toBe("Another product already has this CNK.");
  });

  it("tells a stale form to reload, and explains why a live product's CNK is locked (igs-pharma#80)", () => {
    expect(catalogErrorMessage("catalog.stale_version")).toMatch(/changed by someone else.*Reload/);
    expect(catalogErrorMessage("catalog.cnk_locked")).toMatch(/Archive the product/);
    expect(catalogErrorMessage("catalog.stale_version")).not.toBe(fallback);
  });

  it("falls back to a generic text, never to an Object.prototype member", () => {
    expect(catalogErrorMessage(undefined)).toBe(fallback);
    expect(catalogErrorMessage("catalog.unknown")).toBe(fallback);
    for (const key of PROTOTYPE_KEYS) expect(catalogErrorMessage(key)).toBe(fallback);
  });
});

describe("every catalog error code has a message (igs-pharma#96)", () => {
  // the codes the catalog module can raise: `catalog.<snake_case>` (audit actions and permissions
  // have a second dot, so they do not match)
  const sourceDir = fileURLToPath(
    new URL("../../../packages/modules/catalog/src/", import.meta.url),
  );
  const codes = [
    ...new Set(
      readdirSync(sourceDir)
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
        .flatMap((file) =>
          [...readFileSync(`${sourceDir}${file}`, "utf8").matchAll(/"(catalog\.[a-z_]+)"/g)].map(
            (match) => match[1] as string,
          ),
        ),
    ),
  ].sort();

  it("finds the codes of the catalog module", () => {
    expect(codes).toContain("catalog.cnk_taken");
    expect(codes).toContain("catalog.brand_slug_taken");
    expect(codes.length).toBeGreaterThan(15);
  });

  it("explains each of them, never with the generic fallback", () => {
    const fallback = catalogErrorMessage("catalog.unknown");
    expect(codes.filter((code) => catalogErrorMessage(code) === fallback)).toEqual([]);
  });

  it("explains a brand that already exists", () => {
    expect(catalogErrorMessage("catalog.brand_slug_taken")).toBe(
      "A brand with that name already exists.",
    );
  });
});
