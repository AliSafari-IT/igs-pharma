import type React from "react";

import { cn } from "../utils";
import { Link } from "./link";

export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  /** The current page, from 1. */
  readonly page: number;
  readonly pages: number;
  readonly hrefFor: (page: number) => string;
  /** Visible and spoken text, in the page's language. */
  readonly labels: {
    readonly nav: string;
    readonly previous: string;
    readonly next: string;
    /** "Page 3", for the number links. */
    readonly page: (page: number) => string;
  };
}

/** One entry of the pager: a page number, or the gap between two runs of them. */
export interface PageItem {
  /** Stable across renders: `p3`, or `gap-after-3`. */
  readonly key: string;
  /** The page number; `null` for a gap. */
  readonly page: number | null;
}

/** The entries to show: the first, the last, and the current page with its neighbours. */
export function pageItems(page: number, pages: number): PageItem[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1]);
  const numbers = [...wanted].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: PageItem[] = [];
  let before = 0;
  for (const n of numbers) {
    if (before > 0 && n - before > 1) out.push({ key: `gap-after-${before}`, page: null });
    out.push({ key: `p${n}`, page: n });
    before = n;
  }
  return out;
}

/** The page numbers to show, with `"gap"` between two runs (see `pageItems`). */
export const pageWindow = (page: number, pages: number): (number | "gap")[] =>
  pageItems(page, pages).map((entry) => entry.page ?? "gap");

const item =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-md)] px-3";

/** Numbered pages with previous and next; plain links, so it works without JavaScript. */
export function Pagination({ page, pages, hrefFor, labels, className, ...props }: PaginationProps) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={labels.nav} className={cn("text-base", className)} {...props}>
      <ul className="flex flex-wrap items-center gap-1">
        {page > 1 ? (
          <li>
            <Link href={hrefFor(page - 1)} rel="prev" className={item}>
              {labels.previous}
            </Link>
          </li>
        ) : null}
        {pageItems(page, pages).map(({ key, page: entry }) =>
          entry === null ? (
            <li
              key={key}
              aria-hidden="true"
              className={cn(item, "text-[var(--color-text-subtle)]")}
            >
              …
            </li>
          ) : (
            <li key={key}>
              {entry === page ? (
                <span
                  aria-current="page"
                  aria-label={labels.page(entry)}
                  className={cn(
                    item,
                    "bg-[var(--color-primary)] font-semibold text-[var(--color-on-primary)]",
                  )}
                >
                  {entry}
                </span>
              ) : (
                <Link href={hrefFor(entry)} aria-label={labels.page(entry)} className={item}>
                  {entry}
                </Link>
              )}
            </li>
          ),
        )}
        {page < pages ? (
          <li>
            <Link href={hrefFor(page + 1)} rel="next" className={item}>
              {labels.next}
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
