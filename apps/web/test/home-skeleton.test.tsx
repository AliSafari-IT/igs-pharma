import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HomeSkeleton } from "../src/components/home-skeleton";
import { ProductCardsSkeleton } from "../src/components/listing-skeleton";

const html = () => renderToStaticMarkup(<HomeSkeleton label="Laden..." />);

describe("HomeSkeleton (#104, design-system §10.8)", () => {
  it('says "loading" once, in words, in an <output>', () => {
    const out = html();
    expect(out.match(/<output\b/g)).toHaveLength(1);
    expect(out).toContain('<output class="sr-only">Laden...</output>');
  });

  it("hides every placeholder from screen readers", () => {
    const out = html();
    // the two lists are hidden as a whole; the two heading bars outside them are hidden themselves
    expect(out.match(/<ul aria-hidden="true"/g)).toHaveLength(2);
    const outsideLists = out.replace(/<ul\b[\s\S]*?<\/ul>/g, "");
    const blocks = outsideLists.match(/<div aria-hidden="true"/g) ?? [];
    expect(blocks).toHaveLength(2);
  });

  it("mirrors CategoryGrid: 2/4 columns, tiles at least 88px high", () => {
    const out = html();
    expect(out).toContain("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4");
    expect(out.match(/min-h-\[88px\]/g)).toHaveLength(4);
  });

  it("mirrors ProductGrid for the latest products: six 4:3 cards, no extra top margin", () => {
    const out = html();
    expect(out).toContain(
      '<ul aria-hidden="true" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"',
    );
    expect(out.match(/aspect-\[4\/3\]/g)).toHaveLength(6);
  });

  it("uses no inline style and no script (the CSP stays as it is)", () => {
    const out = html();
    expect(out).not.toContain("style=");
    expect(out).not.toContain("<script");
  });
});

describe("ProductCardsSkeleton", () => {
  it("puts the caller's spacing before the grid classes", () => {
    const out = renderToStaticMarkup(<ProductCardsSkeleton cards={2} className="mt-4" />);
    expect(out).toContain('class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"');
    expect(out.match(/<li>/g)).toHaveLength(2);
  });
});
