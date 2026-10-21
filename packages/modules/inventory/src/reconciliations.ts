import { newId } from "@igs/db/ids";
import {
  type Ctx,
  type Tx,
  command,
  conflict,
  notFound,
  query,
  validationFailed,
} from "@igs/kernel";
import { productRefsByCnk, productRefsById } from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { reconcileAllocations } from "./allocations";
import { INVENTORY_AUDIT } from "./audit";
import {
  type CountCsvRow,
  DEFAULT_LOCATION_ID,
  type LotTracking,
  MAX_IMPORT_CHARS,
  MAX_IMPORT_ROWS,
  MAX_QUANTITY,
  type ReconciliationSource,
  type ReconciliationStatus,
  type StockCsvError,
  parseCountCsv,
} from "./domain";
import { lockStock, recordMovements } from "./ledger";
import { lotLevels, lots, reconciliationLines, reconciliations } from "./schema";

/**
 * Reconciliation of the web pool, lot by lot (igs-pharma#166, ADR 0011 §1). It replaces the
 * absolute CSV import: a count never overwrites stock silently.
 *
 * 1. **Start:** staff count lots, in a count file (`cnk;lot;expiry;counted`) or typed in on a
 *    product's stock page. The reconciliation stores, per lot, what the ledger held at that moment
 *    (`booked`) and the count: the preview. Nothing moves.
 * 2. **Apply:** one `reconciliation` movement per lot whose count differs, under the
 *    reconciliation's id, all or nothing, and only while every lot still holds what the preview
 *    showed (`inventory.reconciliation_stale` otherwise: start a new one). Applying again changes
 *    nothing and answers the same.
 * 3. **Discard:** it ends without moving anything.
 *
 * Start, apply and discard are audited with ids and counts only.
 */

/** A resolved count: the lot and the quantity counted. */
interface CountedLot {
  readonly line: number;
  readonly productId: string;
  readonly lotId: string;
  readonly counted: number;
}

interface LotCandidate {
  readonly lotId: string;
  readonly productId: string;
  readonly tracking: LotTracking;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
}

/**
 * Finds the lot of each line of a count file: by CNK and lot number, and by expiry date when the
 * file gives one; an empty lot is the product's `no_lot` lot (never a medicine's). A lot not in the
 * web pool (`inventory.lot_unknown`: receive it first), a number that matches lots with different
 * expiry dates and no date to tell them apart (`inventory.lot_ambiguous`), and a lot counted twice
 * (`inventory.duplicate_lot`) are refused, line by line.
 */
async function resolveCountFile(
  tx: Tx,
  rows: readonly CountCsvRow[],
): Promise<{ readonly lines: readonly CountedLot[]; readonly errors: readonly StockCsvError[] }> {
  const refs = await productRefsByCnk(
    tx,
    rows.map((row) => row.cnk),
  );
  const byCnk = new Map(refs.map((ref) => [ref.cnk, ref]));
  const candidates: readonly LotCandidate[] = refs.length
    ? await tx
        .select({
          lotId: lots.id,
          productId: lots.productId,
          tracking: sql<LotTracking>`${lots.tracking}`,
          lotNumber: lots.lotNumber,
          expiryDate: lots.expiryDate,
        })
        .from(lots)
        .where(
          and(
            eq(lots.locationId, DEFAULT_LOCATION_ID),
            inArray(
              lots.productId,
              refs.map((ref) => ref.id),
            ),
          ),
        )
    : [];
  const errors: StockCsvError[] = [];
  const lines: CountedLot[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const ref = byCnk.get(row.cnk);
    if (!ref) {
      errors.push({ line: row.line, code: "inventory.unknown_cnk" });
      continue;
    }
    const mine = candidates.filter((lot) => lot.productId === ref.id);
    let found: readonly LotCandidate[];
    if (row.lotNumber === null) {
      if (ref.isMedicine) {
        errors.push({ line: row.line, code: "inventory.lot_required" });
        continue;
      }
      found = mine.filter((lot) => lot.tracking === "no_lot");
    } else {
      found = mine.filter(
        (lot) =>
          lot.tracking === "lot" &&
          lot.lotNumber === row.lotNumber &&
          (row.expiryDate === null || lot.expiryDate === row.expiryDate),
      );
    }
    if (found.length === 0) {
      errors.push({ line: row.line, code: "inventory.lot_unknown" });
      continue;
    }
    if (found.length > 1) {
      errors.push({ line: row.line, code: "inventory.lot_ambiguous" });
      continue;
    }
    const lot = found[0] as LotCandidate;
    if (seen.has(lot.lotId)) {
      errors.push({ line: row.line, code: "inventory.duplicate_lot" });
      continue;
    }
    seen.add(lot.lotId);
    lines.push({ line: row.line, productId: ref.id, lotId: lot.lotId, counted: row.counted });
  }
  return { lines, errors };
}

/** Stores the reconciliation and its lines with what each lot holds now; audited. */
async function store(
  ctx: Ctx,
  source: ReconciliationSource,
  counted: readonly CountedLot[],
): Promise<{
  readonly reconciliationId: string;
  readonly lines: number;
  readonly differing: number;
}> {
  const booked = await lotOnHands(
    ctx.tx,
    counted.map((line) => line.lotId),
  );
  const id = newId();
  await ctx.tx.insert(reconciliations).values({
    id,
    status: "open",
    source,
    startedByType: ctx.actor.type,
    startedById: ctx.actor.id,
    startedAt: ctx.now,
  });
  const rows = counted.map((line) => ({
    reconciliationId: id,
    line: line.line,
    productId: line.productId,
    lotId: line.lotId,
    booked: booked.get(line.lotId) ?? 0,
    counted: line.counted,
  }));
  await ctx.tx.insert(reconciliationLines).values(rows);
  const differing = rows.filter((row) => row.booked !== row.counted).length;
  await ctx.audit.record({
    action: INVENTORY_AUDIT.reconciliationStarted,
    entityType: "stock_reconciliation",
    entityId: id,
    data: { reconciliationId: id, source, lines: rows.length, differing },
  });
  return { reconciliationId: id, lines: rows.length, differing };
}

/** What each lot holds now (absent lots hold nothing). */
async function lotOnHands(tx: Tx, lotIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
  if (lotIds.length === 0) return new Map();
  const rows = await tx
    .select({ lotId: lotLevels.lotId, onHand: lotLevels.onHand })
    .from(lotLevels)
    .where(inArray(lotLevels.lotId, [...lotIds]));
  return new Map(rows.map((row) => [row.lotId, row.onHand]));
}

const started = z.object({
  reconciliationId: z.uuid(),
  lines: z.number().int(),
  differing: z.number().int(),
});

/**
 * Starts a reconciliation from a count file (see `parseCountCsv`). A file with any problem fails
 * with `inventory.reconciliation_invalid` (every bad line as `line.<n>`, `file` for the file as a
 * whole) and stores nothing. Moves no stock.
 */
export const startReconciliationFromFile = command({
  name: "inventory.reconciliation.start_file",
  input: z.object({ csv: z.string().max(MAX_IMPORT_CHARS) }),
  output: started,
  permission: PERMISSIONS.inventory.stockManage,
  async handler({ input, ctx }) {
    const parsed = parseCountCsv(input.csv);
    const resolved = await resolveCountFile(ctx.tx, parsed.rows);
    const errors = [...parsed.errors, ...resolved.errors].sort((a, b) => a.line - b.line);
    if (errors.length > 0) {
      throw validationFailed(
        "inventory.reconciliation_invalid",
        errors.map((e) => ({ path: e.line === 0 ? "file" : `line.${e.line}`, code: e.code })),
      );
    }
    return store(ctx, "csv", resolved.lines);
  },
});

/**
 * Starts a reconciliation of one product's lots, counted on its stock page: each lot once, with
 * its count (`inventory.lot_not_found` for a lot of another product). Moves no stock.
 */
export const startReconciliation = command({
  name: "inventory.reconciliation.start",
  input: z.object({
    productId: z.uuid(),
    lines: z
      .array(z.object({ lotId: z.uuid(), counted: z.number().int().min(0).max(MAX_QUANTITY) }))
      .min(1)
      .max(MAX_IMPORT_ROWS)
      .refine((lines) => new Set(lines.map((line) => line.lotId)).size === lines.length, {
        message: "one line per lot",
      }),
  }),
  output: started,
  permission: PERMISSIONS.inventory.stockManage,
  async handler({ input, ctx }) {
    const [product] = await productRefsById(ctx.tx, [input.productId]);
    if (!product) throw notFound("inventory.product_not_found");
    const owned = await ctx.tx
      .select({ id: lots.id })
      .from(lots)
      .where(
        and(
          eq(lots.productId, product.id),
          eq(lots.locationId, DEFAULT_LOCATION_ID),
          inArray(
            lots.id,
            input.lines.map((line) => line.lotId),
          ),
        ),
      );
    if (owned.length !== input.lines.length) throw notFound("inventory.lot_not_found");
    return store(
      ctx,
      "typed",
      input.lines.map((line, index) => ({
        line: index + 1,
        productId: product.id,
        lotId: line.lotId,
        counted: line.counted,
      })),
    );
  },
});

/** The reconciliation, locked for the rest of the transaction (`inventory.reconciliation_not_found`). */
async function lockReconciliation(ctx: Ctx, reconciliationId: string) {
  const [row] = await ctx.tx
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.id, reconciliationId))
    .for("update");
  if (!row) throw notFound("inventory.reconciliation_not_found");
  return row;
}

const linesOf = (tx: Tx, reconciliationId: string) =>
  tx
    .select()
    .from(reconciliationLines)
    .where(eq(reconciliationLines.reconciliationId, reconciliationId))
    .orderBy(asc(reconciliationLines.line));

/**
 * Books the counts: one `reconciliation` movement per lot whose count differs from what the
 * preview showed it held, under the reconciliation's id, all or nothing. Refused with
 * `inventory.reconciliation_stale` (and how many lots moved) when any lot holds something else
 * now, and `inventory.reconciliation_discarded` for a discarded one. Applying an applied one changes
 * nothing and answers the same. Orders on the counted products are allocated again where their lots
 * no longer cover them (igs-pharma#165).
 */
export const applyReconciliation = command({
  name: "inventory.reconciliation.apply",
  input: z.object({ reconciliationId: z.uuid() }),
  output: z.object({ reconciliationId: z.uuid(), changed: z.number().int() }),
  permission: PERMISSIONS.inventory.stockManage,
  // audits only the apply itself: applying again records nothing
  audit: "none",
  async handler({ input, ctx }) {
    await lockStock(ctx.tx);
    const reconciliation = await lockReconciliation(ctx, input.reconciliationId);
    const lines = await linesOf(ctx.tx, reconciliation.id);
    const differing = lines.filter((line) => line.counted !== line.booked);
    if (reconciliation.status === "applied") {
      return { reconciliationId: reconciliation.id, changed: differing.length };
    }
    if (reconciliation.status === "discarded") throw conflict("inventory.reconciliation_discarded");

    const now = await lotOnHands(
      ctx.tx,
      lines.map((line) => line.lotId),
    );
    const moved = lines.filter((line) => (now.get(line.lotId) ?? 0) !== line.booked).length;
    if (moved > 0) throw conflict("inventory.reconciliation_stale", { movedLots: moved });

    await recordMovements(
      ctx.tx,
      ctx,
      differing.map((line) => ({
        productId: line.productId,
        lotId: line.lotId,
        delta: line.counted - line.booked,
        reason: "reconciliation" as const,
      })),
      { importId: reconciliation.id },
    );
    await ctx.tx
      .update(reconciliations)
      .set({
        status: "applied",
        endedByType: ctx.actor.type,
        endedById: ctx.actor.id,
        endedAt: ctx.now,
      })
      .where(eq(reconciliations.id, reconciliation.id));
    await ctx.audit.record({
      action: INVENTORY_AUDIT.reconciliationApplied,
      entityType: "stock_reconciliation",
      entityId: reconciliation.id,
      data: { reconciliationId: reconciliation.id, changed: differing.length },
    });
    await reconcileAllocations(
      ctx,
      differing.map((line) => line.productId),
    );
    return { reconciliationId: reconciliation.id, changed: differing.length };
  },
});

/** Ends an open reconciliation without moving stock (`inventory.reconciliation_not_open` otherwise). */
export const discardReconciliation = command({
  name: "inventory.reconciliation.discard",
  input: z.object({ reconciliationId: z.uuid() }),
  output: z.object({ reconciliationId: z.uuid() }),
  permission: PERMISSIONS.inventory.stockManage,
  async handler({ input, ctx }) {
    const reconciliation = await lockReconciliation(ctx, input.reconciliationId);
    if (reconciliation.status !== "open") throw conflict("inventory.reconciliation_not_open");
    await ctx.tx
      .update(reconciliations)
      .set({
        status: "discarded",
        endedByType: ctx.actor.type,
        endedById: ctx.actor.id,
        endedAt: ctx.now,
      })
      .where(eq(reconciliations.id, reconciliation.id));
    await ctx.audit.record({
      action: INVENTORY_AUDIT.reconciliationDiscarded,
      entityType: "stock_reconciliation",
      entityId: reconciliation.id,
      data: { reconciliationId: reconciliation.id },
    });
    return { reconciliationId: reconciliation.id };
  },
});

// ── reads ────────────────────────────────────────────────────────────────────────────────────────

/** One counted lot as staff see it in the preview. */
export interface ReconciliationLineView {
  readonly line: number;
  readonly productId: string;
  readonly cnk: string;
  readonly nameNl: string | null;
  readonly lotId: string;
  readonly tracking: LotTracking;
  readonly lotNumber: string | null;
  /** `YYYY-MM-DD`, `null` without one. */
  readonly expiryDate: string | null;
  /** What the ledger held when the count was previewed. */
  readonly booked: number;
  readonly counted: number;
  /** `counted − booked`: the movement applying writes (0: nothing). */
  readonly difference: number;
  /** The lot moved since the preview: applying would be refused. */
  readonly moved: boolean;
}

export interface ReconciliationView {
  readonly reconciliationId: string;
  readonly status: ReconciliationStatus;
  readonly source: ReconciliationSource;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly lines: readonly ReconciliationLineView[];
}

/** A reconciliation with its lines (`inventory.reconciliation_not_found`). */
export const getReconciliation = query({
  name: "inventory.reconciliation.get",
  input: z.object({ reconciliationId: z.uuid() }),
  permission: PERMISSIONS.inventory.stockRead,
  async handler({ input, ctx }): Promise<ReconciliationView> {
    const [row] = await ctx.tx
      .select()
      .from(reconciliations)
      .where(eq(reconciliations.id, input.reconciliationId));
    if (!row) throw notFound("inventory.reconciliation_not_found");
    const lines = await ctx.tx
      .select({
        line: reconciliationLines.line,
        productId: reconciliationLines.productId,
        lotId: reconciliationLines.lotId,
        booked: reconciliationLines.booked,
        counted: reconciliationLines.counted,
        tracking: lots.tracking,
        lotNumber: lots.lotNumber,
        expiryDate: lots.expiryDate,
        onHand: sql<number>`coalesce(${lotLevels.onHand}, 0)::int`,
      })
      .from(reconciliationLines)
      .innerJoin(lots, eq(lots.id, reconciliationLines.lotId))
      .leftJoin(lotLevels, eq(lotLevels.lotId, reconciliationLines.lotId))
      .where(eq(reconciliationLines.reconciliationId, row.id))
      .orderBy(asc(reconciliationLines.line));
    const refs = await productRefsById(ctx.tx, [...new Set(lines.map((line) => line.productId))]);
    const refOf = new Map(refs.map((ref) => [ref.id, ref]));
    return {
      reconciliationId: row.id,
      status: row.status as ReconciliationStatus,
      source: row.source as ReconciliationSource,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      lines: lines.map((line) => ({
        line: line.line,
        productId: line.productId,
        cnk: refOf.get(line.productId)?.cnk ?? "",
        nameNl: refOf.get(line.productId)?.nameNl ?? null,
        lotId: line.lotId,
        tracking: line.tracking as LotTracking,
        lotNumber: line.lotNumber,
        expiryDate: line.expiryDate,
        booked: line.booked,
        counted: line.counted,
        difference: line.counted - line.booked,
        moved: row.status === "open" && line.onHand !== line.booked,
      })),
    };
  },
});

export interface OpenReconciliation {
  readonly reconciliationId: string;
  readonly source: ReconciliationSource;
  readonly startedAt: Date;
  readonly lines: number;
}

/** The reconciliations still open, newest first: previews waiting to be applied or discarded. */
export const listOpenReconciliations = query({
  name: "inventory.reconciliation.list_open",
  input: z.object({}),
  permission: PERMISSIONS.inventory.stockRead,
  async handler({ ctx }): Promise<readonly OpenReconciliation[]> {
    const rows = await ctx.tx
      .select({
        reconciliationId: reconciliations.id,
        source: reconciliations.source,
        startedAt: reconciliations.startedAt,
        // the outer column spelled out: drizzle leaves it unqualified in a single-table select
        lines: sql<number>`(SELECT count(*)::int FROM ${reconciliationLines} l WHERE l.reconciliation_id = ${sql.raw('"inventory"."reconciliations"."id"')})`,
      })
      .from(reconciliations)
      .where(eq(reconciliations.status, "open"))
      .orderBy(desc(reconciliations.startedAt), desc(reconciliations.id))
      .limit(20);
    return rows.map((row) => ({ ...row, source: row.source as ReconciliationSource }));
  },
});
