import type { Tx } from "@igs/kernel";
import { productRefsByCnk } from "@igs/module-catalog";
import { and, eq, inArray, max, sql } from "drizzle-orm";

import { DEFAULT_LOCATION_ID, type StockCsvError, parseStockCsv } from "./domain";
import { stockMovements } from "./schema";

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
