import { type Ctx, type Tx, command, conflict, notFound, query } from "@igs/kernel";
import { endStopSale, productRefsById, startStopSale } from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { reconcileAllocations } from "./allocations";
import { INVENTORY_AUDIT } from "./audit";
import {
  DEFAULT_LOCATION_ID,
  DISPOSAL_METHODS,
  type DisposalMethod,
  MAX_QUANTITY,
  RECALL_LOTS_MAX,
  RECALL_NOTE_MAX,
  RECALL_SOURCES,
  type RecallScope,
  type RecallSource,
} from "./domain";
import { lockStock, recordMovements } from "./ledger";
import { type LotView, lockLot, lotOnHand, lotsOf } from "./lots";
import {
  lots,
  recallDisposals,
  recallLots,
  recalls,
  reservationAllocations,
  reservations,
} from "./schema";

/**
 * Recalls, part 1 (igs-pharma#187, REQ-SAF-01, milestone 5.1). A pharmacist starts a recall on a
 * product, for every lot or the lots named. In ONE transaction:
 * - the lots are quarantined with reason `recall` (a lot already quarantined keeps its reason);
 * - the catalogue stops the product selling (`startStopSale`): it leaves the storefront, and
 *   checkout and every fulfilment step refuse it through the eligibility recheck (#182);
 * - the orders allocated to those lots are allocated again from sellable stock.
 * Only a pharmacist ends it, which lifts the stop-sale. The lots stay quarantined: their disposal is
 * part 2, and none of them can be released while its recall is active (`releaseLot`).
 */

export interface RecallListItem {
  readonly recallId: string;
  readonly productId: string;
  readonly cnk: string;
  readonly nameNl: string | null;
  readonly scope: RecallScope;
  readonly source: RecallSource;
  readonly lotCount: number;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export interface RecallDisposalView {
  readonly disposalId: string;
  readonly lotId: string;
  readonly quantity: number;
  readonly method: DisposalMethod;
  readonly note: string | null;
  readonly recordedById: string;
  readonly recordedAt: Date;
}

export interface RecallView extends RecallListItem {
  readonly note: string;
  readonly startedById: string;
  readonly endedById: string | null;
  /** The lots it covers, as they stand now. */
  readonly lots: readonly LotView[];
  /** What was destroyed or returned, oldest first (igs-pharma#189). */
  readonly disposals: readonly RecallDisposalView[];
}

/**
 * What a recall covers, for the modules that act on it (the orders module lists the affected orders,
 * igs-pharma#189). `lotIds` are the lots recorded when it started; `null` when it is unknown.
 */
export interface RecallCoverage {
  readonly recallId: string;
  readonly productId: string;
  readonly scope: RecallScope;
  readonly lotIds: readonly string[];
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

/** The recall's coverage, `null` for an unknown recall. No permission: callers check their own. */
export async function recallCoverage(tx: Tx, recallId: string): Promise<RecallCoverage | null> {
  const [row] = await tx
    .select({
      recallId: recalls.id,
      productId: recalls.productId,
      scope: recalls.scope,
      startedAt: recalls.startedAt,
      endedAt: recalls.endedAt,
    })
    .from(recalls)
    .where(eq(recalls.id, recallId));
  if (!row) return null;
  const covered = await tx
    .select({ lotId: recallLots.lotId })
    .from(recallLots)
    .where(eq(recallLots.recallId, recallId));
  return {
    ...row,
    scope: row.scope as RecallScope,
    lotIds: covered.map((lot) => lot.lotId).sort(),
  };
}

/**
 * The holder references of the ORDER reservations picked, or to be picked, from these lots: an
 * allocation that stands (`active`) or was picked (`consumed`), and one moved off the lots since
 * `since` (`superseded`): starting a recall quarantines its lots and allocates their orders again, so
 * the orders that held them at that moment still count. Released shares never left the shelf.
 */
export async function orderHoldersOfLots(
  tx: Tx,
  lotIds: readonly string[],
  since: Date,
): Promise<readonly string[]> {
  if (lotIds.length === 0) return [];
  const rows = await tx
    .selectDistinct({ holderRef: reservations.holderRef })
    .from(reservationAllocations)
    .innerJoin(reservations, eq(reservations.id, reservationAllocations.reservationId))
    .where(
      and(
        inArray(reservationAllocations.lotId, [...lotIds]),
        or(
          inArray(reservationAllocations.status, ["active", "consumed"]),
          and(
            eq(reservationAllocations.status, "superseded"),
            gte(reservationAllocations.updatedAt, since),
          ),
        ),
        eq(reservations.kind, "order"),
      ),
    );
  return rows.map((row) => row.holderRef).sort();
}

/**
 * What must hold before a recall ends, decided outside inventory (igs-pharma#189): the orders module
 * refuses while an affected order is open or a collected one was never told. Each composition root
 * that runs `endRecall` installs it once with `configureRecallEndGuard`. Without one, ending is refused
 * (`inventory.recall_end_guard_missing`): a recall never ends unchecked.
 */
export type RecallEndGuard = (ctx: Ctx, recall: RecallCoverage) => Promise<void>;

let endGuard: RecallEndGuard | null = null;

export function configureRecallEndGuard(guard: RecallEndGuard | null): void {
  endGuard = guard;
}

/** The most recalls the list shows (active ones first, then the latest ended). */
export const RECALL_LIST_LIMIT = 200;

/** The id of the product's active recall, `null` when it has none. */
export async function activeRecallOf(tx: Tx, productId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: recalls.id })
    .from(recalls)
    .where(and(eq(recalls.productId, productId), isNull(recalls.endedAt)));
  return row?.id ?? null;
}

/**
 * Starts a recall (pharmacist). Refused for an unknown product (`inventory.product_not_found`), a
 * product with an active recall (`inventory.recall_active`), or a named lot that is not one of the
 * product's (`inventory.lot_not_found`). Without `lotIds` it covers every lot the product has now;
 * the stop-sale covers stock that arrives later.
 */
export const startRecall = command({
  name: "inventory.recall.start",
  input: z.object({
    productId: z.uuid(),
    lotIds: z.array(z.uuid()).min(1).max(RECALL_LOTS_MAX).optional(),
    source: z.enum(RECALL_SOURCES),
    note: z.string().trim().min(1).max(RECALL_NOTE_MAX),
  }),
  output: z.object({
    recallId: z.uuid(),
    lots: z.number().int().min(0),
    quarantined: z.number().int().min(0),
  }),
  permission: PERMISSIONS.inventory.recallsManage,
  async handler({ input, ctx }) {
    const [product] = await productRefsById(ctx.tx, [input.productId]);
    if (!product) throw notFound("inventory.product_not_found");
    // the same lock order as a quarantine: stock, the product's level row, then its lots
    await lockStock(ctx.tx);
    await ctx.tx.execute(
      sql`SELECT inventory.lock_stock_level(${product.id}::uuid, ${DEFAULT_LOCATION_ID}::uuid)`,
    );
    if (await activeRecallOf(ctx.tx, product.id)) throw conflict("inventory.recall_active");

    const named = input.lotIds ? [...new Set(input.lotIds)] : null;
    const covered = await ctx.tx
      .select({ id: lots.id, quarantinedAt: lots.quarantinedAt })
      .from(lots)
      .where(
        and(
          eq(lots.productId, product.id),
          eq(lots.locationId, DEFAULT_LOCATION_ID),
          ...(named ? [inArray(lots.id, named)] : []),
        ),
      )
      .orderBy(lots.id)
      .for("update");
    if (named && covered.length !== named.length) throw notFound("inventory.lot_not_found");

    const scope: RecallScope = named ? "lots" : "all_lots";
    const [recall] = await ctx.tx
      .insert(recalls)
      .values({
        productId: product.id,
        scope,
        source: input.source,
        note: input.note,
        startedByType: ctx.actor.type,
        startedById: ctx.actor.id,
        startedAt: ctx.now,
      })
      .returning({ id: recalls.id });
    if (!recall) throw new Error("inventory.recall_not_stored");
    if (covered.length > 0) {
      await ctx.tx
        .insert(recallLots)
        .values(covered.map((lot) => ({ recallId: recall.id, lotId: lot.id })));
    }

    const toQuarantine = covered.filter((lot) => lot.quarantinedAt === null);
    if (toQuarantine.length > 0) {
      await ctx.tx
        .update(lots)
        .set({
          quarantinedAt: ctx.now,
          quarantineReason: "recall",
          quarantinedByType: ctx.actor.type,
          quarantinedById: ctx.actor.id,
        })
        .where(
          inArray(
            lots.id,
            toQuarantine.map((lot) => lot.id),
          ),
        );
      for (const lot of toQuarantine) {
        await ctx.audit.record({
          action: INVENTORY_AUDIT.lotQuarantined,
          entityType: "product",
          entityId: product.id,
          data: { productId: product.id, lotId: lot.id, reason: "recall" },
        });
      }
    }

    await ctx.run(startStopSale, {
      productId: product.id,
      reason: "recall",
      referenceId: recall.id,
    });
    await ctx.audit.record({
      action: INVENTORY_AUDIT.recallStarted,
      entityType: "product",
      entityId: product.id,
      data: {
        recallId: recall.id,
        productId: product.id,
        scope,
        source: input.source,
        lots: covered.length,
        quarantined: toQuarantine.length,
      },
    });
    // the orders allocated to these lots are allocated again from sellable lots (igs-pharma#165)
    await reconcileAllocations(ctx, [product.id]);
    return { recallId: recall.id, lots: covered.length, quarantined: toQuarantine.length };
  },
});

/**
 * Ends an active recall (pharmacist) and lifts its stop-sale. Its lots stay quarantined. Refused for
 * an unknown recall (`inventory.recall_not_found`), one already ended (`inventory.recall_ended`), and
 * whatever the installed end guard refuses (igs-pharma#189).
 */
export const endRecall = command({
  name: "inventory.recall.end",
  input: z.object({ recallId: z.uuid() }),
  output: z.object({ recallId: z.uuid() }),
  permission: PERMISSIONS.inventory.recallsManage,
  async handler({ input, ctx }) {
    const [recall] = await ctx.tx
      .select({ id: recalls.id, productId: recalls.productId, endedAt: recalls.endedAt })
      .from(recalls)
      .where(eq(recalls.id, input.recallId))
      .for("update");
    if (!recall) throw notFound("inventory.recall_not_found");
    if (recall.endedAt) throw conflict("inventory.recall_ended");
    if (!endGuard) throw conflict("inventory.recall_end_guard_missing");
    const coverage = await recallCoverage(ctx.tx, recall.id);
    if (coverage) await endGuard(ctx, coverage);
    await ctx.tx
      .update(recalls)
      .set({ endedAt: ctx.now, endedByType: ctx.actor.type, endedById: ctx.actor.id })
      .where(eq(recalls.id, recall.id));
    await ctx.run(endStopSale, { reason: "recall", referenceId: recall.id });
    await ctx.audit.record({
      action: INVENTORY_AUDIT.recallEnded,
      entityType: "product",
      entityId: recall.productId,
      data: { recallId: recall.id, productId: recall.productId },
    });
    return { recallId: recall.id };
  },
});

/**
 * Records that `quantity` units of one of the recall's lots were destroyed or returned to the supplier
 * (pharmacist, igs-pharma#189): a `disposal` movement takes them out of the lot, and the record keeps
 * the method. Refused for an unknown recall (`inventory.recall_not_found`), a lot the recall does not
 * cover (`inventory.lot_not_in_recall`), or more than the lot holds (`inventory.negative_stock`). It
 * may be recorded while the recall is active or after it ended.
 */
export const recordRecallDisposal = command({
  name: "inventory.recall.dispose",
  input: z.object({
    recallId: z.uuid(),
    lotId: z.uuid(),
    quantity: z.number().int().min(1).max(MAX_QUANTITY),
    method: z.enum(DISPOSAL_METHODS),
    note: z.string().trim().min(1).max(200).optional(),
  }),
  output: z.object({
    disposalId: z.uuid(),
    movementId: z.uuid(),
    lotOnHand: z.number().int(),
  }),
  permission: PERMISSIONS.inventory.recallsManage,
  async handler({ input, ctx }) {
    const [recall] = await ctx.tx
      .select({ id: recalls.id, productId: recalls.productId })
      .from(recalls)
      .where(eq(recalls.id, input.recallId));
    if (!recall) throw notFound("inventory.recall_not_found");
    const [covered] = await ctx.tx
      .select({ lotId: recallLots.lotId })
      .from(recallLots)
      .where(and(eq(recallLots.recallId, recall.id), eq(recallLots.lotId, input.lotId)));
    if (!covered) throw notFound("inventory.lot_not_in_recall");
    await lockStock(ctx.tx);
    const lot = await lockLot(ctx, input.lotId);
    const [movement] = await recordMovements(ctx.tx, ctx, [
      {
        productId: lot.productId,
        lotId: lot.id,
        delta: -input.quantity,
        reason: "disposal",
        ...(input.note ? { note: input.note } : {}),
      },
    ]);
    if (!movement) throw new Error("inventory.disposal_not_stored");
    const [disposal] = await ctx.tx
      .insert(recallDisposals)
      .values({
        recallId: recall.id,
        lotId: lot.id,
        movementId: movement.id,
        quantity: input.quantity,
        method: input.method,
        note: input.note ?? null,
        recordedByType: ctx.actor.type,
        recordedById: ctx.actor.id,
        recordedAt: ctx.now,
      })
      .returning({ id: recallDisposals.id });
    if (!disposal) throw new Error("inventory.disposal_not_stored");
    await ctx.audit.record({
      action: INVENTORY_AUDIT.recallDisposed,
      entityType: "product",
      entityId: recall.productId,
      data: {
        recallId: recall.id,
        disposalId: disposal.id,
        movementId: movement.id,
        productId: recall.productId,
        lotId: lot.id,
        quantity: input.quantity,
        method: input.method,
      },
    });
    // what left the lot no longer counts anywhere (the lot was quarantined: nothing was allocated from it)
    await reconcileAllocations(ctx, [recall.productId]);
    return {
      disposalId: disposal.id,
      movementId: movement.id,
      lotOnHand: await lotOnHand(ctx.tx, lot.id),
    };
  },
});

const lotCount = sql<number>`(SELECT count(*)::int FROM ${recallLots} WHERE ${recallLots.recallId} = ${recalls.id})`;

/** Recalls for the back-office: the active ones first, then the latest ended. */
export const listRecalls = query({
  name: "inventory.recall.list",
  input: z.object({}),
  permission: PERMISSIONS.inventory.stockRead,
  async handler({ ctx }): Promise<readonly RecallListItem[]> {
    const rows = await ctx.tx
      .select({
        recallId: recalls.id,
        productId: recalls.productId,
        scope: recalls.scope,
        source: recalls.source,
        lotCount,
        startedAt: recalls.startedAt,
        endedAt: recalls.endedAt,
      })
      .from(recalls)
      .orderBy(sql`${recalls.endedAt} IS NOT NULL`, desc(recalls.startedAt), desc(recalls.id))
      .limit(RECALL_LIST_LIMIT);
    const refs = new Map(
      (await productRefsById(ctx.tx, [...new Set(rows.map((row) => row.productId))])).map((ref) => [
        ref.id,
        ref,
      ]),
    );
    return rows.map((row) => ({
      ...row,
      scope: row.scope as RecallScope,
      source: row.source as RecallSource,
      cnk: refs.get(row.productId)?.cnk ?? "",
      nameNl: refs.get(row.productId)?.nameNl ?? null,
    }));
  },
});

/** One recall with its lots as they stand now (`inventory.recall_not_found`). */
export const getRecall = query({
  name: "inventory.recall.get",
  input: z.object({ recallId: z.uuid() }),
  permission: PERMISSIONS.inventory.stockRead,
  async handler({ input, ctx }): Promise<RecallView> {
    const [row] = await ctx.tx
      .select({
        recallId: recalls.id,
        productId: recalls.productId,
        scope: recalls.scope,
        source: recalls.source,
        note: recalls.note,
        lotCount,
        startedAt: recalls.startedAt,
        startedById: recalls.startedById,
        endedAt: recalls.endedAt,
        endedById: recalls.endedById,
      })
      .from(recalls)
      .where(eq(recalls.id, input.recallId));
    if (!row) throw notFound("inventory.recall_not_found");
    const [ref] = await productRefsById(ctx.tx, [row.productId]);
    const lotIds = new Set(
      (
        await ctx.tx
          .select({ lotId: recallLots.lotId })
          .from(recallLots)
          .where(eq(recallLots.recallId, row.recallId))
      ).map((lot) => lot.lotId),
    );
    const covered = (await lotsOf(ctx.tx, [row.productId], ctx.now)).filter((lot) =>
      lotIds.has(lot.lotId),
    );
    const disposals = await ctx.tx
      .select({
        disposalId: recallDisposals.id,
        lotId: recallDisposals.lotId,
        quantity: recallDisposals.quantity,
        method: recallDisposals.method,
        note: recallDisposals.note,
        recordedById: recallDisposals.recordedById,
        recordedAt: recallDisposals.recordedAt,
      })
      .from(recallDisposals)
      .where(eq(recallDisposals.recallId, row.recallId))
      .orderBy(recallDisposals.recordedAt, recallDisposals.id);
    return {
      ...row,
      scope: row.scope as RecallScope,
      source: row.source as RecallSource,
      cnk: ref?.cnk ?? "",
      nameNl: ref?.nameNl ?? null,
      lots: covered,
      disposals: disposals.map((d) => ({ ...d, method: d.method as DisposalMethod })),
    };
  },
});
