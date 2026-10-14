import { newId } from "@igs/db/ids";
import { type Actor, type Tx, conflict } from "@igs/kernel";
import { productRefsByCnk } from "@igs/module-catalog";
import { and, eq, inArray, max, sql } from "drizzle-orm";

import {
  type Availability,
  DEFAULT_LOCATION_ID,
  type MovementReason,
  type StockCsvError,
  availabilityOf,
  parseStockCsv,
} from "./domain";
import { reservations, stockMovements } from "./schema";

/** Reading the ledger: on-hand is always the sum of the movements, never a stored number. */

export interface StockLevel {
  readonly onHand: number;
  /** When stock last moved, `null` for a product that never had a movement. */
  readonly lastMovementAt: Date | null;
}

/** On-hand and last movement per product at the default location (absent products have none). */
export async function stockLevels(
  tx: Tx,
  productIds: readonly string[],
): Promise<ReadonlyMap<string, StockLevel>> {
  if (productIds.length === 0) return new Map();
  const rows = await tx
    .select({
      productId: stockMovements.productId,
      onHand: sql<number>`coalesce(sum(${stockMovements.delta}), 0)::int`,
      lastMovementAt: max(stockMovements.at),
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.locationId, DEFAULT_LOCATION_ID),
        inArray(stockMovements.productId, [...productIds]),
      ),
    )
    .groupBy(stockMovements.productId);
  return new Map(
    rows.map((r) => [r.productId, { onHand: r.onHand, lastMovementAt: r.lastMovementAt }]),
  );
}

/**
 * What is set aside per product at the default location, at `now` (igs-pharma#99). A hold counts
 * only while `now < expires_at`: at `expires_at` exactly it is over, whether or not the expiry job
 * has marked it yet. An order counts until it is released or consumed, however old it is.
 */
export async function reservedQuantities(
  tx: Tx,
  productIds: readonly string[],
  now: Date,
): Promise<ReadonlyMap<string, { readonly held: number; readonly ordered: number }>> {
  if (productIds.length === 0) return new Map();
  const rows = await tx
    .select({
      productId: reservations.productId,
      held: sql<number>`coalesce(sum(${reservations.quantity}) FILTER (WHERE ${reservations.kind} = 'hold' AND ${reservations.expiresAt} > ${now.toISOString()}::timestamptz), 0)::int`,
      ordered: sql<number>`coalesce(sum(${reservations.quantity}) FILTER (WHERE ${reservations.kind} = 'order'), 0)::int`,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.status, "active"),
        eq(reservations.locationId, DEFAULT_LOCATION_ID),
        inArray(reservations.productId, [...productIds]),
      ),
    )
    .groupBy(reservations.productId);
  return new Map(rows.map((r) => [r.productId, { held: r.held, ordered: r.ordered }]));
}

/** On hand, reserved, available and short per product (absent products have none of it), at `now`. */
export async function availabilityFor(
  tx: Tx,
  productIds: readonly string[],
  now: Date,
): Promise<ReadonlyMap<string, Availability>> {
  const [levels, reserved] = await Promise.all([
    stockLevels(tx, productIds),
    reservedQuantities(tx, productIds, now),
  ]);
  return new Map(
    productIds.map((id) => {
      const r = reserved.get(id);
      return [id, availabilityOf(levelOf(levels, id).onHand, r?.held ?? 0, r?.ordered ?? 0)];
    }),
  );
}

export const levelOf = (levels: ReadonlyMap<string, StockLevel>, productId: string): StockLevel =>
  levels.get(productId) ?? { onHand: 0, lastMovementAt: null };

/**
 * Serialises every stock write (import and adjust) for the rest of the transaction, so the on-hand
 * a write computed from cannot change before it commits. v1 has one location and low write volume;
 * a per-product lock can replace it when that changes.
 */
export async function lockStock(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('inventory.stock'))`);
}

/** One movement to record at the default location. `delta` is never 0. */
export interface MovementEntry {
  readonly productId: string;
  readonly delta: number;
  readonly reason: MovementReason;
  /** Staff free text of an adjustment; never copied into the audit trail. */
  readonly note?: string;
}

/** The constraint on `inventory.stock_levels` that refuses a movement taking a product below zero. */
const NEGATIVE_STOCK_CONSTRAINT = "stock_levels_on_hand_check";

const isNegativeStock = (error: unknown): boolean => {
  const e = error as { code?: string; constraint_name?: string } | null;
  return e?.code === "23514" && e.constraint_name === NEGATIVE_STOCK_CONSTRAINT;
};

/** A movement that was written, with the product it belongs to (paired by id, never by position). */
export interface RecordedMovement {
  readonly productId: string;
  readonly id: string;
}

/**
 * THE ONLY WRITER of `inventory.stock_movements` (igs-pharma#83, D-037; a test fails when any other
 * source file writes the table). It takes the stock lock, inserts the movements in a fixed order
 * (by product, so concurrent multi-row writers take the level rows in the same order) and turns the
 * database guard's refusal into the typed `inventory.negative_stock`.
 *
 * The guard itself is in the database: a trigger on the table keeps `stock_levels` and its
 * `on_hand >= 0` check refuses any movement that would take a product below zero, whoever inserts
 * it and whether or not they went through this function.
 */

export async function recordMovements(
  tx: Tx,
  context: { readonly actor: Actor; readonly now: Date },
  entries: readonly MovementEntry[],
  options: { readonly importId?: string } = {},
): Promise<readonly RecordedMovement[]> {
  if (entries.length === 0) return [];
  await lockStock(tx);
  const ordered = [...entries].sort((a, b) =>
    a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
  );
  const rows = ordered.map((entry) => ({
    id: newId(),
    productId: entry.productId,
    locationId: DEFAULT_LOCATION_ID,
    delta: entry.delta,
    reason: entry.reason,
    note: entry.note ?? null,
    importId: options.importId ?? null,
    actorType: context.actor.type,
    actorId: context.actor.id,
    at: context.now,
  }));
  try {
    await tx.insert(stockMovements).values(rows);
  } catch (error) {
    if (isNegativeStock(error)) throw conflict("inventory.negative_stock");
    throw error;
  }
  return rows.map((row) => ({ productId: row.productId, id: row.id }));
}

export interface ImportPlanRow {
  readonly line: number;
  readonly cnk: string;
  readonly productId: string;
  readonly nameNl: string | null;
  readonly onHand: number;
  /** The count in the file: the on-hand after the import. */
  readonly target: number;
  /** The movement the import writes (`0`: unchanged, nothing written). */
  readonly delta: number;
}

export interface ImportPlan {
  readonly rows: readonly ImportPlanRow[];
  /** Every problem in the file; when not empty, nothing is applied. */
  readonly errors: readonly StockCsvError[];
}

/** Validates a whole stock file against the catalog and the ledger (no writes). */
export async function planImport(tx: Tx, csv: string): Promise<ImportPlan> {
  const parsed = parseStockCsv(csv);
  const refs = await productRefsByCnk(
    tx,
    parsed.rows.map((r) => r.cnk),
  );
  const byCnk = new Map(refs.map((ref) => [ref.cnk, ref]));
  const levels = await stockLevels(
    tx,
    refs.map((ref) => ref.id),
  );
  const errors: StockCsvError[] = [...parsed.errors];
  const rows: ImportPlanRow[] = [];
  for (const row of parsed.rows) {
    const ref = byCnk.get(row.cnk);
    if (!ref) {
      errors.push({ line: row.line, code: "inventory.unknown_cnk" });
      continue;
    }
    const { onHand } = levelOf(levels, ref.id);
    rows.push({
      line: row.line,
      cnk: row.cnk,
      productId: ref.id,
      nameNl: ref.nameNl,
      onHand,
      target: row.quantity,
      delta: row.quantity - onHand,
    });
  }
  errors.sort((a, b) => a.line - b.line);
  return { rows, errors };
}
