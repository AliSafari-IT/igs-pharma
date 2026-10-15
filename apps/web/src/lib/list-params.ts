import type { ListSort } from "@igs/module-storefront";

// The contract's limits (`@igs/module-storefront`: MIN_QUERY_LENGTH, MAX_QUERY_LENGTH, MAX_PAGE,
// LIST_SORTS). Copied, not imported: that package is server-only, and this parser must run in unit
// tests; the types below keep the sort list in step with the contract.
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const MAX_PAGE = 10_000;
export const ALL_SORTS: readonly ListSort[] = [
  "relevance",
  "latest",
  "name",
  "price_asc",
  "price_desc",
];

/** Next's `searchParams` values: absent, one string, or repeated. */
export type RawParams = Readonly<Record<string, string | string[] | undefined>>;

export interface ListParams {
  /** The trimmed text query, `undefined` when absent or empty. */
  readonly q: string | undefined;
  /** `true` when the query is there but shorter than the minimum (the page asks for more letters). */
  readonly qTooShort: boolean;
  readonly sort: ListSort | undefined;
  readonly inStock: boolean;
  readonly page: number;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * The listing's URL parameters, forgiving by design: a wrong sort, page or length is dropped, never
 * an error page (the URL is typed by shoppers and followed from old links). `allowedSorts` is what
 * the page offers (a category has no "relevance").
 */
export function parseListParams(
  raw: RawParams,
  allowedSorts: readonly ListSort[] = ALL_SORTS,
): ListParams {
  // control characters (a NUL byte above all, which Postgres refuses) become spaces
  const text = first(raw["q"])?.replace(CONTROL_CHARACTERS, " ").trim().slice(0, MAX_QUERY_LENGTH);
  const q = text ? text : undefined;
  const qTooShort = q !== undefined && [...q].length < MIN_QUERY_LENGTH;
  const sortValue = first(raw["sort"]);
  const sort = allowedSorts.find((candidate) => candidate === sortValue);
  const pageValue = Number.parseInt(first(raw["page"]) ?? "1", 10);
  const page = Number.isFinite(pageValue) ? Math.max(1, Math.min(MAX_PAGE, pageValue)) : 1;
  return {
    q: qTooShort ? undefined : q,
    qTooShort,
    sort,
    inStock: first(raw["availability"]) === "in_stock",
    page,
  };
}

/** `?q=…&sort=…` for the page's own links; `page` only past the first. Empty when nothing is set. */
export function listQuery(params: Pick<ListParams, "q" | "sort" | "inStock">, page = 1): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.sort) search.set("sort", params.sort);
  if (params.inStock) search.set("availability", "in_stock");
  if (page > 1) search.set("page", String(page));
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** A shopper's input that is exactly a CNK: the product page is the answer. */
export const isCnk = (value: string | undefined): value is string =>
  value !== undefined && /^[0-9]{7}$/.test(value);
