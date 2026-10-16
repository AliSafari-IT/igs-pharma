import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ListingSkeleton } from "../src/components/listing-skeleton";

const html = (cards?: number) =>
  renderToStaticMarkup(
    cards === undefined ? (
      <ListingSkeleton label="Laden..." />
    ) : (
      <ListingSkeleton label="Laden..." cards={cards} />
    ),
  );

describe("ListingSkeleton (#104, design-system §10.8)", () => {
  it('says "loading" once, in words, in an <output>', () => {
    const out = html();
    expect(out.match(/<output\b/g)).toHaveLength(1);
    expect(out).toContain('<output class="sr-only">Laden...</output>');
  });

  it("hides every placeholder from screen readers", () => {
    const out = html();
    expect(out).toContain('<ul aria-hidden="true"');
    // each Skeleton block outside the list is aria-hidden itself
    const outside = out.slice(0, out.indexOf("<ul"));
    const blocks = outside.match(/<div aria-hidden="true"/g) ?? [];
    expect(blocks).toHaveLength(5);
  });

  it("mirrors ProductGrid: the same columns and 4:3 image boxes, one card per placeholder", () => {
    const out = html(4);
    expect(out).toContain("grid gap-4 sm:grid-cols-2 lg:grid-cols-3");
    expect(out.match(/<li>/g)).toHaveLength(4);
    expect(out.match(/aspect-\[4\/3\]/g)).toHaveLength(4);
    expect(html().match(/<li>/g)).toHaveLength(6);
  });

  it("uses no inline style and no script (the CSP stays as it is)", () => {
    const out = html();
    expect(out).not.toContain("style=");
    expect(out).not.toContain("<script");
  });
});
