/**
 * Pure parts of the dashboard (igs-pharma#115): how a tile's state is derived, and how one source
 * feeds several tiles. No I/O here, so it is unit-tested without a database.
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

/** One source's result shaped for one tile: the error state stays the error state. */
export function mapTile<T, U>(result: TileResult<T>, pick: (data: T) => U): TileResult<U> {
  return result.state === "ok" ? { state: "ok", data: pick(result.data) } : result;
}

/** The stock alerts tile, from the inventory's stock summary. */
export interface StockAlerts {
  /** Products with 1 up to the low-stock threshold available. */
  readonly low: number;
  /** Products with none available. */
  readonly out: number;
  /** Products whose active orders exceed what is on the shelf (igs-pharma#112). */
  readonly short: number;
  /** Lots with stock that can't be sold: quarantined, near or past expiry, lot not recorded (#164). */
  readonly flaggedLots: number;
  /** Order lines not allocated in full to sellable lots: they can't be packed (#165). */
  readonly unallocatedOrders: number;
}

/** The active reservations tile, from the same summary. */
export interface ReservationCounts {
  /** Orders, and checkout holds not yet expired, still setting stock aside. */
  readonly active: number;
}

/** The tiles the "Needs attention" panel reads; each is absent when the member may not see it. */
export interface AttentionSources {
  /** Paid orders waiting because their stock was not held, and those past the deadline (#158). */
  readonly orders?:
    | TileResult<{ readonly stockShort: number; readonly overdue: number }>
    | undefined;
  readonly products?: TileResult<{ readonly awaitingApproval: number }> | undefined;
  readonly stock?:
    | TileResult<Pick<StockAlerts, "out" | "short" | "flaggedLots" | "unallocatedOrders">>
    | undefined;
  readonly requests?: TileResult<{ readonly overdue: number }> | undefined;
}

/** One line of the panel: a plain sentence that links to the page where it is dealt with. */
export interface AttentionItem {
  readonly id:
    | "stock_short_orders"
    | "unallocated_orders"
    | "short"
    | "flagged_lots"
    | "overdue"
    | "out"
    | "awaiting";
  readonly text: string;
  readonly href: string;
}

export interface Attention {
  /** At most six lines, most pressing first; only non-zero counts. */
  readonly items: readonly AttentionItem[];
  /** A source tile failed to load, so the list may be missing something. */
  readonly incomplete: boolean;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The dashboard's "Needs attention" list (igs-pharma#112 V1 item 1), from the tiles already loaded:
 * no query and no permission of its own. Order: paid orders short of stock (#158), order lines
 * without enough sellable lots (#165), products short for their orders, lots that can't be sold
 * (#164), overdue data
 * requests, products out of stock, medicines awaiting a pharmacist's approval. A tile the member
 * may not see, or one in its error state, adds nothing (an error marks the list incomplete).
 */
export function needsAttention(sources: AttentionSources): Attention {
  const ok = <T>(result: TileResult<T> | undefined): T | undefined =>
    result?.state === "ok" ? result.data : undefined;
  const stock = ok(sources.stock);
  const requests = ok(sources.requests);
  const products = ok(sources.products);
  const orders = ok(sources.orders);
  const items: AttentionItem[] = [];
  if (orders && orders.stockShort > 0) {
    items.push({
      id: "stock_short_orders",
      text: `${count(orders.stockShort, "paid order is", "paid orders are")} waiting for stock${
        orders.overdue > 0 ? ` (${orders.overdue} past the deadline)` : ""
      }`,
      href: "/orders?status=paid_stock_short",
    });
  }
  if (stock && stock.unallocatedOrders > 0) {
    items.push({
      id: "unallocated_orders",
      text: `${count(stock.unallocatedOrders, "order line", "order lines")} can't be packed: not enough sellable lots`,
      href: "/orders",
    });
  }
  if (stock && stock.short > 0) {
    items.push({
      id: "short",
      text: `${count(stock.short, "product is", "products are")} short for orders`,
      href: "/stock",
    });
  }
  if (stock && stock.flaggedLots > 0) {
    items.push({
      id: "flagged_lots",
      text: `${count(stock.flaggedLots, "lot", "lots")} can't be sold (too close to expiry, expired, quarantined or lot not recorded)`,
      href: "/stock",
    });
  }
  if (requests && requests.overdue > 0) {
    items.push({
      id: "overdue",
      text: `${count(requests.overdue, "data request is", "data requests are")} overdue`,
      href: "/privacy/requests",
    });
  }
  if (stock && stock.out > 0) {
    items.push({
      id: "out",
      text: `${count(stock.out, "product is", "products are")} out of stock`,
      href: "/stock",
    });
  }
  if (products && products.awaitingApproval > 0) {
    const medicines = count(products.awaitingApproval, "medicine is", "medicines are");
    items.push({
      id: "awaiting",
      text: `${medicines} awaiting a pharmacist's approval`,
      href: "/products",
    });
  }
  return {
    items,
    incomplete: [sources.orders, sources.stock, sources.requests, sources.products].some(
      (result) => result?.state === "error",
    ),
  };
}
