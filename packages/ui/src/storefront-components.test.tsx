import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Breadcrumbs,
  EmptyState,
  Pagination,
  ProductImagePlaceholder,
  Skeleton,
  pageWindow,
} from "./index";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("pageWindow", () => {
  it("shows every page when there are few", () => {
    expect(pageWindow(2, 3)).toEqual([1, 2, 3]);
  });

  it("keeps the first, the last and the current page with its neighbours, with gaps between", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, "gap", 20]);
    expect(pageWindow(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageWindow(20, 20)).toEqual([1, "gap", 19, 20]);
    expect(pageWindow(3, 20)).toEqual([1, 2, 3, 4, "gap", 20]);
  });
});

describe("Pagination", () => {
  const labels = {
    nav: "Pages",
    previous: "Previous",
    next: "Next",
    page: (n: number) => `Page ${n}`,
  };
  const props = { labels, hrefFor: (n: number) => `/c/x?page=${n}` };

  it("renders nothing for a single page", () => {
    expect(html(<Pagination page={1} pages={1} {...props} />)).toBe("");
  });

  it("marks the current page, links the others and the neighbours, and hides the gaps", () => {
    const out = html(<Pagination page={10} pages={20} {...props} />);
    expect(out).toContain('<nav aria-label="Pages"');
    expect(out).toMatch(/aria-current="page"[^>]*>10<\/span>/);
    expect(out).toContain('href="/c/x?page=9"');
    expect(out).toContain('href="/c/x?page=11"');
    expect(out).toContain('rel="prev"');
    expect(out).toContain('rel="next"');
    expect(out).toContain('aria-label="Page 20"');
    expect(out).toMatch(/aria-hidden="true"[^>]*>…<\/li>/);
  });

  it("has no previous link on the first page and no next link on the last", () => {
    expect(html(<Pagination page={1} pages={3} {...props} />)).not.toContain('rel="prev"');
    expect(html(<Pagination page={3} pages={3} {...props} />)).not.toContain('rel="next"');
  });
});

describe("Breadcrumbs", () => {
  it("links the ancestors and marks the last item as the current page, not a link", () => {
    const out = html(
      <Breadcrumbs
        label="Breadcrumb"
        items={[
          { label: "Home", href: "/nl" },
          { label: "Allergy", href: "/nl/c/a" },
          { label: "Tablets" },
        ]}
      />,
    );
    expect(out).toContain('aria-label="Breadcrumb"');
    expect(out).toContain('href="/nl"');
    expect(out).toContain('href="/nl/c/a"');
    expect(out).toMatch(/<span aria-current="page"[^>]*>Tablets<\/span>/);
    expect(out.match(/<a /g)).toHaveLength(2);
  });
});

describe("Skeleton, EmptyState, ProductImagePlaceholder", () => {
  it("hides the skeleton from assistive technology and respects reduced motion", () => {
    const out = html(<Skeleton className="h-4" />);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("motion-safe:animate-pulse");
  });

  it("shows the empty state's title and help", () => {
    const out = html(<EmptyState title="No results">Try another word.</EmptyState>);
    expect(out).toContain("No results");
    expect(out).toContain("Try another word.");
  });

  it("keeps a fixed aspect ratio and is decorative", () => {
    const out = html(<ProductImagePlaceholder />);
    expect(out).toContain("aspect-[4/3]");
    expect(out).toContain('aria-hidden="true"');
  });
});
