import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StorefrontSkeleton } from "../src/components/storefront-skeleton";

const html = (variant: "listing" | "product") =>
  renderToStaticMarkup(<StorefrontSkeleton label="Chargement..." variant={variant} />);

describe("StorefrontSkeleton", () => {
  it("says it is loading once, in words, in a status region", () => {
    for (const variant of ["listing", "product"] as const) {
      const out = html(variant);
      expect(out).toContain('<div role="status" class="sr-only">Chargement...</div>');
      expect(out.match(/role="status"/g)).toHaveLength(1);
    }
  });

  it("keeps the skip link's target, and hides every grey block from screen readers", () => {
    const out = html("listing");
    expect(out).toContain('<main id="main"');
    const blocks = out.match(/<div[^>]*motion-safe:animate-pulse[^>]*>/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(block).toContain('aria-hidden="true"');
  });

  it("holds the real sizes: the product grid and 4:3 image boxes", () => {
    const listing = html("listing");
    expect(listing).toContain("grid gap-4 sm:grid-cols-2 lg:grid-cols-3");
    expect(listing.match(/aspect-\[4\/3\]/g)).toHaveLength(6);
    const product = html("product");
    expect(product).toContain("md:grid-cols-[minmax(0,16rem)_1fr]");
    expect(product.match(/aspect-\[4\/3\]/g)).toHaveLength(1);
  });

  it("uses no inline style (the CSP refuses them)", () => {
    for (const variant of ["listing", "product"] as const) {
      expect(html(variant)).not.toContain("style=");
    }
  });
});
