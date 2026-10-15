/**
 * Pure parts of the dashboard (igs-pharma#115): how a tile's state is derived, and how the stock
 * alerts are counted from the pages of the inventory's own list. No I/O here, so it is unit-tested
 * without a database.
 */

/** One tile: its data, or that its source failed. A failing source never breaks the page. */
export type TileResult<T> =
  | { readonly state: "ok"; readonly data: T }
  | { readonly state: "error" };

/** Runs one tile's loader; any failure becomes the tile's error state (the caller logs it). */
export async function settle<T>(
  load: () => Promise<T>,
  onError: (error: unknown) => void,
): Promise<TileResult<T>> {
  try {
    return { state: "ok", data: await load() };
  } catch (error) {
    onError(error);
    return { state: "error" };
  }
}

/** What a product on the stock list tells the alert counts. */
export interface StockLevel {
  /** What a new hold may take: on hand minus what is reserved, never below 0. */
  readonly available: number;
}

export interface StockPageLike {
  readonly items: readonly StockLevel[];
  readonly total: number;
}

export interface StockAlerts {
  /** Products with 1 up to the threshold available. */
  readonly low: number;
  /** Products with none available. */
  readonly out: number;
  /** How many products were looked at. */
  readonly scanned: number;
  /** How many products there are. */
  readonly total: number;
  /** Whether the scan stopped at its ceiling before the last product. */
  readonly capped: boolean;
}

/** "Low" on the dashboard: the same default as the storefront's `low` badge (1 to 3 available). */
export const LOW_STOCK_THRESHOLD = 3;
export const STOCK_PAGE_SIZE = 100;
/** The scan's ceiling: 20 pages of 100. Past it the tile says so instead of guessing. */
export const STOCK_MAX_PAGES = 20;

/**
 * Counts low and out products by paging through the inventory's list (`fetchPage(page)`), the only
 * stock read the inventory module exports for staff. Stops at `maxPages`; `capped` then says the
 * counts cover only the products scanned.
 */
export async function scanStockAlerts(
  fetchPage: (page: number) => Promise<StockPageLike>,
  options: {
    readonly lowThreshold?: number;
    readonly maxPages?: number;
    readonly pageSize?: number;
  } = {},
): Promise<StockAlerts> {
  const lowThreshold = options.lowThreshold ?? LOW_STOCK_THRESHOLD;
  const maxPages = options.maxPages ?? STOCK_MAX_PAGES;
  const pageSize = options.pageSize ?? STOCK_PAGE_SIZE;
  let low = 0;
  let out = 0;
  let scanned = 0;
  let total = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page);
    total = result.total;
    for (const item of result.items) {
      scanned += 1;
      if (item.available <= 0) out += 1;
      else if (item.available <= lowThreshold) low += 1;
    }
    if (result.items.length < pageSize || scanned >= total) break;
  }
  return { low, out, scanned, total, capped: scanned < total };
}
