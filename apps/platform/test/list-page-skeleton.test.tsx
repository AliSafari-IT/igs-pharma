import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ListPageSkeleton } from "../src/components/list-page-skeleton";

describe("ListPageSkeleton", () => {
  it("shows the page's real heading and says what is loading, once", () => {
    const out = renderToStaticMarkup(<ListPageSkeleton title="Data requests" />);
    expect(out).toContain(">Data requests</h1>");
    expect(out).toContain('<div role="status" class="sr-only">Loading data requests…</div>');
    expect(out.match(/role="status"/g)).toHaveLength(1);
  });

  it("hides every grey block from screen readers and never nests a div in the description", () => {
    const out = renderToStaticMarkup(<ListPageSkeleton title="Stock" search />);
    const blocks = out.match(/<(div|span)[^>]*motion-safe:animate-pulse[^>]*>/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(block).toContain('aria-hidden="true"');
    expect(out).not.toMatch(/<p[^>]*><div/);
  });

  it("draws the search row only for pages that have one, and uses no inline style", () => {
    const withSearch = renderToStaticMarkup(<ListPageSkeleton title="Stock" search />);
    const without = renderToStaticMarkup(<ListPageSkeleton title="Staff" />);
    expect(withSearch).toContain("min-w-64");
    expect(without).not.toContain("min-w-64");
    expect(withSearch).not.toContain("style=");
    expect(without).not.toContain("style=");
  });
});
