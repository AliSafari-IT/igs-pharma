/**
 * The back-office list pages' query string (igs-pharma#104, #50, #53): a text search `q` and a page
 * number, read the same way on every list and written back into the pager's links.
 */

type Raw = string | string[] | undefined;

const first = (value: Raw) => (Array.isArray(value) ? value[0] : value);

export interface ListQuery {
  /** Trimmed, at most 100 characters; `""` = no search. */
  readonly q: string;
  /** 1 to 10 000; anything else is 1. */
  readonly page: number;
}

export function parseListQuery(params: { q?: Raw; page?: Raw }): ListQuery {
  const q = (first(params.q) ?? "").trim().slice(0, 100);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(first(params.page) ?? "1", 10) || 1));
  return { q, page };
}

/** The list's URL for `page`, keeping the search. */
export const listHref = (path: string, q: string, page: number): string =>
  `${path}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page) })}`;

/** How many pages a list of `total` rows has (at least 1). */
export const pageCount = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(total / pageSize));

/** "Page 2 of 3 · 51 products": the count line under every list. */
export const countLine = (page: number, pages: number, total: number, noun: string): string =>
  `Page ${page} of ${pages} · ${total} ${noun}${total === 1 ? "" : "s"}`;
