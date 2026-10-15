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
}

/** The active reservations tile, from the same summary. */
export interface ReservationCounts {
  /** Orders, and checkout holds not yet expired, still setting stock aside. */
  readonly active: number;
}
