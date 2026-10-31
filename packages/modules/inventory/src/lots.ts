import {
  type Ctx,
  type Tx,
  command,
  conflict,
  notFound,
  query,
  validationFailed,
} from "@igs/kernel";
import { productRefsById } from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { productsWithOrders, reconcileAllocations } from "./allocations";
import { INVENTORY_AUDIT } from "./audit";
import {
  DEFAULT_LOCATION_ID,
  EXPIRY_BUFFER_MAX_DAYS,
  type ExpiryState,
  LOT_NUMBER_PATTERN,
  type LotTracking,
  MAX_QUANTITY,
  QUARANTINE_REASONS,
  type QuarantineReason,
  expiryStateOf,
} from "./domain";
import { brusselsToday, expiryBufferDays, lockStock, recordMovements } from "./ledger";
import { lotLevels, lots, recallLots, recalls, settings } from "./schema";

/**
 * Lots of the web pool (igs-pharma#164, ADR 0011). Every unit of stock is in a lot. A medicine's
 * stock is always in a real lot with an expiry date; a non-medicine's may be in its `no_lot` lot;
 * stock from before lots is in an `unknown` lot until staff record its lot. A lot is SELLABLE when
 * it is not quarantined, not `unknown`, and its expiry date (when it has one) is more than the
 * expiry buffer away, counted in Europe/Brussels calendar days. Only sellable stock counts towards
 * what the shop may reserve and sell.
 */

export interface LotView {
  readonly lotId: string;
  readonly productId: string;
  readonly tracking: LotTracking;
  readonly lotNumber: string | null;
  /** `YYYY-MM-DD`, `null` without one. */
  readonly expiryDate: string | null;
  readonly onHand: number;
  readonly expiryState: ExpiryState;
  readonly quarantine: {
    readonly reason: QuarantineReason;
    readonly at: Date;
  } | null;
  readonly sellable: boolean;
  readonly createdAt: Date;
}

/**
 * The lots of these products at the default location with their on-hand and state, in FEFO order:
 * earliest expiry first, lots without an expiry date after, then by creation.
 */
export async function lotsOf(
  tx: Tx,
  productIds: readonly string[],
  now: Date,
): Promise<readonly LotView[]> {
  if (productIds.length === 0) return [];
  const [buffer, rows] = await Promise.all([
    expiryBufferDays(tx),
    tx
      .select({
        lotId: lots.id,
        productId: lots.productId,
        tracking: lots.tracking,
        lotNumber: lots.lotNumber,
        expiryDate: lots.expiryDate,
        onHand: sql<number>`coalesce(${lotLevels.onHand}, 0)::int`,
        quarantinedAt: lots.quarantinedAt,
        quarantineReason: lots.quarantineReason,
        createdAt: lots.createdAt,
      })
      .from(lots)
      .leftJoin(lotLevels, eq(lotLevels.lotId, lots.id))
      .where(
        and(eq(lots.locationId, DEFAULT_LOCATION_ID), inArray(lots.productId, [...productIds])),
      )
      .orderBy(sql`${lots.expiryDate} ASC NULLS LAST`, asc(lots.createdAt), asc(lots.id)),
  ]);
  const today = brusselsToday(now);
  return rows.map((row) => {
    const expiryState = expiryStateOf(row.expiryDate, today, buffer);
    const tracking = row.tracking as LotTracking;
    return {
      lotId: row.lotId,
      productId: row.productId,
      tracking,
      lotNumber: row.lotNumber,
      expiryDate: row.expiryDate,
      onHand: row.onHand,
      expiryState,
      quarantine:
        row.quarantinedAt && row.quarantineReason
          ? { reason: row.quarantineReason as QuarantineReason, at: row.quarantinedAt }
          : null,
      sellable: row.quarantinedAt === null && tracking !== "unknown" && expiryState === "sellable",
      createdAt: row.createdAt,
    };
  });
}

/** A lot that needs staff: stock in it that may not be sold (quarantined, `unknown`, near or past expiry). */
export const isFlagged = (lot: Pick<LotView, "onHand" | "sellable">): boolean =>
  lot.onHand > 0 && !lot.sellable;

/** The product's untracked lot of `tracking` (`no_lot` or `unknown`), created when asked and missing. */
async function untrackedLot(
  ctx: Ctx,
  productId: string,
  tracking: "no_lot" | "unknown",
  create: boolean,
): Promise<string | null> {
  const where = and(
    eq(lots.productId, productId),
    eq(lots.locationId, DEFAULT_LOCATION_ID),
    eq(lots.tracking, tracking),
  );
  const [found] = await ctx.tx.select({ id: lots.id }).from(lots).where(where);
  if (found || !create) return found?.id ?? null;
  const [made] = await ctx.tx
    .insert(lots)
    .values({
      productId,
      locationId: DEFAULT_LOCATION_ID,
      tracking,
      createdByType: ctx.actor.type,
      createdById: ctx.actor.id,
      createdAt: ctx.now,
    })
    .onConflictDoNothing()
    .returning({ id: lots.id });
  if (made) return made.id;
  const [raced] = await ctx.tx.select({ id: lots.id }).from(lots).where(where);
  return raced?.id ?? null;
}

/** The product's `no_lot` lot (created when missing): where a non-medicine's untracked stock is. */
export const noLotOf = async (ctx: Ctx, productId: string): Promise<string> =>
  (await untrackedLot(ctx, productId, "no_lot", true)) as string;

/** The lot with this number and expiry date (created when missing). */
async function trackedLot(
  ctx: Ctx,
  productId: string,
  lotNumber: string,
  expiryDate: string | null,
): Promise<string> {
  const where = and(
    eq(lots.productId, productId),
    eq(lots.locationId, DEFAULT_LOCATION_ID),
    eq(lots.tracking, "lot"),
    eq(lots.lotNumber, lotNumber),
    expiryDate === null ? sql`${lots.expiryDate} IS NULL` : eq(lots.expiryDate, expiryDate),
  );
  const [found] = await ctx.tx.select({ id: lots.id }).from(lots).where(where);
  if (found) return found.id;
  const [made] = await ctx.tx
    .insert(lots)
    .values({
      productId,
      locationId: DEFAULT_LOCATION_ID,
      tracking: "lot",
      lotNumber,
      expiryDate,
      createdByType: ctx.actor.type,
      createdById: ctx.actor.id,
      createdAt: ctx.now,
    })
    .onConflictDoNothing()
    .returning({ id: lots.id });
  if (made) return made.id;
  const [raced] = await ctx.tx.select({ id: lots.id }).from(lots).where(where);
  if (!raced) throw new Error("inventory.lot_not_stored");
  return raced.id;
}

/**
 * A lot of the default location, locked for the rest of the transaction (`inventory.lot_not_found`),
 * after its product's stock-level row: a reservation takes that row before it reads what is
 * sellable, so a quarantine and a reservation never interleave.
 */
export async function lockLot(ctx: Ctx, lotId: string) {
  const [peek] = await ctx.tx
    .select({ productId: lots.productId })
    .from(lots)
    .where(and(eq(lots.id, lotId), eq(lots.locationId, DEFAULT_LOCATION_ID)));
  if (!peek) throw notFound("inventory.lot_not_found");
  await ctx.tx.execute(
    sql`SELECT inventory.lock_stock_level(${peek.productId}::uuid, ${DEFAULT_LOCATION_ID}::uuid)`,
  );
  const [lot] = await ctx.tx.select().from(lots).where(eq(lots.id, lotId)).for("update");
  if (!lot) throw notFound("inventory.lot_not_found");
  return lot;
}

/** Whether the lot is covered by an active recall (igs-pharma#187): it then may not be released. */
async function lotUnderActiveRecall(tx: Tx, lotId: string): Promise<boolean> {
  const [row] = await tx
    .select({ recallId: recallLots.recallId })
    .from(recallLots)
    .innerJoin(recalls, eq(recalls.id, recallLots.recallId))
    .where(and(eq(recallLots.lotId, lotId), isNull(recalls.endedAt)));
  return row !== undefined;
}

export const lotOnHand = async (tx: Tx, lotId: string): Promise<number> => {
  const [row] = await tx
    .select({ onHand: lotLevels.onHand })
    .from(lotLevels)
    .where(eq(lotLevels.lotId, lotId));
  return row?.onHand ?? 0;
};

const isoDate = z.iso.date();
const lotNumber = z.string().trim().regex(LOT_NUMBER_PATTERN);
const note = z.string().trim().min(1).max(200);
const quantity = z.number().int().min(1).max(MAX_QUANTITY);

/**
 * The lot a receipt goes into: a medicine needs a lot number AND an expiry date
 * (`inventory.lot_required`); another product may have neither (its `no_lot` lot), a lot number
 * alone, or both, but never an expiry date without a lot number. An expiry date that is not after
 * today is refused (`inventory.expiry_in_past`): expired stock never enters the web pool.
 */
async function receiptLot(
  ctx: Ctx,
  product: { readonly id: string; readonly isMedicine: boolean },
  input: { readonly lotNumber?: string | undefined; readonly expiryDate?: string | undefined },
): Promise<string> {
  const missing = [
    ...(input.lotNumber ? [] : [{ path: "lotNumber", code: "required" }]),
    ...(input.expiryDate ? [] : [{ path: "expiryDate", code: "required" }]),
  ];
  if (product.isMedicine && missing.length > 0) {
    throw validationFailed("inventory.lot_required", missing);
  }
  if (input.expiryDate && !input.lotNumber) {
    throw validationFailed("inventory.lot_required", [{ path: "lotNumber", code: "required" }]);
  }
  if (input.expiryDate && input.expiryDate <= brusselsToday(ctx.now)) {
    throw validationFailed("inventory.expiry_in_past", [{ path: "expiryDate", code: "past" }]);
  }
  return input.lotNumber
    ? trackedLot(ctx, product.id, input.lotNumber, input.expiryDate ?? null)
    : noLotOf(ctx, product.id);
}

/** Stock taken from the pharmacy into the web pool, into its lot (see `receiptLot`). */
export const receiveStock = command({
  name: "inventory.stock.receive",
  input: z.object({
    productId: z.uuid(),
    quantity,
    lotNumber: lotNumber.optional(),
    expiryDate: isoDate.optional(),
    /** Staff-only; never audited. */
    note: note.optional(),
  }),
  output: z.object({ movementId: z.uuid(), lotId: z.uuid(), lotOnHand: z.number().int() }),
  permission: PERMISSIONS.inventory.stockManage,
  async handler({ input, ctx }) {
    const [product] = await productRefsById(ctx.tx, [input.productId]);
    if (!product) throw notFound("inventory.product_not_found");
    await lockStock(ctx.tx);
    const lotId = await receiptLot(ctx, product, input);
    const [movement] = await recordMovements(ctx.tx, ctx, [
      {
        productId: product.id,
        lotId,
        delta: input.quantity,
        reason: "receipt",
        ...(input.note ? { note: input.note } : {}),
      },
    ]);
    const movementId = movement?.id ?? "";
    await ctx.audit.record({
      action: INVENTORY_AUDIT.stockReceived,
      entityType: "product",
      entityId: product.id,
      data: { movementId, productId: product.id, lotId, quantity: input.quantity },
    });
    // an order short of sellable stock may be filled now (igs-pharma#165)
    await reconcileAllocations(ctx, [product.id]);
    return { movementId, lotId, lotOnHand: await lotOnHand(ctx.tx, lotId) };
  },
});

/** Stock given back from the web pool to the pharmacy, out of one lot. */
export const returnStock = command({
  name: "inventory.stock.return",
  input: z.object({ lotId: z.uuid(), quantity, note: note.optional() }),
  output: z.object({ movementId: z.uuid(), lotOnHand: z.number().int() }),
  permission: PERMISSIONS.inventory.stockManage,
  async handler({ input, ctx }) {
    await lockStock(ctx.tx);
    const lot = await lockLot(ctx, input.lotId);
    const [movement] = await recordMovements(ctx.tx, ctx, [
      {
        productId: lot.productId,
        lotId: lot.id,
        delta: -input.quantity,
        reason: "return",
        ...(input.note ? { note: input.note } : {}),
      },
    ]);
    const movementId = movement?.id ?? "";
    await ctx.audit.record({
      action: INVENTORY_AUDIT.stockReturned,
      entityType: "product",
      entityId: lot.productId,
      data: { movementId, productId: lot.productId, lotId: lot.id, quantity: input.quantity },
    });
    // orders allocated to what left the lot are allocated again (igs-pharma#165)
    await reconcileAllocations(ctx, [lot.productId]);
    return { movementId, lotOnHand: await lotOnHand(ctx.tx, lot.id) };
  },
});

/**
 * Records the lot of stock that sat in a product's `unknown` lot (from before lots): moves
 * `quantity` out of it into the lot with this number and expiry date, as two `correction`
 * movements. The same lot rules as a receipt apply.
 */
export const assignUnknownLot = command({
  name: "inventory.lot.assign",
  input: z.object({
    productId: z.uuid(),
    quantity,
    lotNumber,
    expiryDate: isoDate.optional(),
  }),
  output: z.object({ lotId: z.uuid(), unknownOnHand: z.number().int() }),
  permission: PERMISSIONS.inventory.stockManage,
  async handler({ input, ctx }) {
    const [product] = await productRefsById(ctx.tx, [input.productId]);
    if (!product) throw notFound("inventory.product_not_found");
    await lockStock(ctx.tx);
    const unknownId = await untrackedLot(ctx, product.id, "unknown", false);
    if (!unknownId) throw notFound("inventory.lot_not_found");
    const lotId = await receiptLot(ctx, product, input);
    await recordMovements(ctx.tx, ctx, [
      { productId: product.id, lotId: unknownId, delta: -input.quantity, reason: "correction" },
      { productId: product.id, lotId, delta: input.quantity, reason: "correction" },
    ]);
    await ctx.audit.record({
      action: INVENTORY_AUDIT.lotAssigned,
      entityType: "product",
      entityId: product.id,
      data: { productId: product.id, fromLotId: unknownId, lotId, quantity: input.quantity },
    });
    await reconcileAllocations(ctx, [product.id]);
    return { lotId, unknownOnHand: await lotOnHand(ctx.tx, unknownId) };
  },
});

/**
 * Takes a lot out of sale (pharmacist): its stock stays on hand but counts as available nowhere.
 * Quarantining a quarantined lot is refused (`inventory.lot_quarantined`).
 */
export const quarantineLot = command({
  name: "inventory.lot.quarantine",
  input: z.object({ lotId: z.uuid(), reason: z.enum(QUARANTINE_REASONS) }),
  output: z.object({ lotId: z.uuid() }),
  permission: PERMISSIONS.inventory.lotsQuarantine,
  async handler({ input, ctx }) {
    await lockStock(ctx.tx);
    const lot = await lockLot(ctx, input.lotId);
    if (lot.quarantinedAt) throw conflict("inventory.lot_quarantined");
    await ctx.tx
      .update(lots)
      .set({
        quarantinedAt: ctx.now,
        quarantineReason: input.reason,
        quarantinedByType: ctx.actor.type,
        quarantinedById: ctx.actor.id,
      })
      .where(eq(lots.id, lot.id));
    await ctx.audit.record({
      action: INVENTORY_AUDIT.lotQuarantined,
      entityType: "product",
      entityId: lot.productId,
      data: { productId: lot.productId, lotId: lot.id, reason: input.reason },
    });
    // the orders allocated to it are allocated again from sellable lots (igs-pharma#165)
    await reconcileAllocations(ctx, [lot.productId]);
    return { lotId: lot.id };
  },
});

/**
 * Puts a quarantined lot back on sale (pharmacist). Its expiry still applies. A lot of an active
 * recall is refused (`inventory.lot_under_recall`).
 */
export const releaseLot = command({
  name: "inventory.lot.release",
  input: z.object({ lotId: z.uuid() }),
  output: z.object({ lotId: z.uuid() }),
  permission: PERMISSIONS.inventory.lotsQuarantine,
  async handler({ input, ctx }) {
    await lockStock(ctx.tx);
    const lot = await lockLot(ctx, input.lotId);
    if (!lot.quarantinedAt) throw conflict("inventory.lot_not_quarantined");
    // a recalled lot stays out of sale until its recall ends (igs-pharma#187)
    if (await lotUnderActiveRecall(ctx.tx, lot.id)) throw conflict("inventory.lot_under_recall");
    await ctx.tx
      .update(lots)
      .set({
        quarantinedAt: null,
        quarantineReason: null,
        quarantinedByType: null,
        quarantinedById: null,
      })
      .where(eq(lots.id, lot.id));
    await ctx.audit.record({
      action: INVENTORY_AUDIT.lotReleased,
      entityType: "product",
      entityId: lot.productId,
      data: {
        productId: lot.productId,
        lotId: lot.id,
        reason: lot.quarantineReason ?? "other",
      },
    });
    await reconcileAllocations(ctx, [lot.productId]);
    return { lotId: lot.id };
  },
});

/** The shop-wide expiry buffer (titular only): how many days before its expiry a lot stops selling. */
export const setExpiryBuffer = command({
  name: "inventory.settings.expiry_buffer",
  input: z.object({ days: z.number().int().min(0).max(EXPIRY_BUFFER_MAX_DAYS) }),
  output: z.object({ days: z.number().int() }),
  permission: PERMISSIONS.inventory.settingsManage,
  // audits only a change: setting the same value again is not one
  audit: "none",
  async handler({ input, ctx }) {
    await lockStock(ctx.tx);
    const from = await expiryBufferDays(ctx.tx);
    if (from === input.days) return { days: from };
    await ctx.tx
      .update(settings)
      .set({
        expiryBufferDays: input.days,
        updatedAt: ctx.now,
        updatedByType: ctx.actor.type,
        updatedById: ctx.actor.id,
      })
      .where(eq(settings.id, 1));
    await ctx.audit.record({
      action: INVENTORY_AUDIT.expiryBufferSet,
      entityType: "inventory_settings",
      entityId: "1",
      data: { from, to: input.days },
    });
    // a longer buffer may take allocated lots out of sale (igs-pharma#165)
    await reconcileAllocations(ctx, await productsWithOrders(ctx.tx));
    return { days: input.days };
  },
});

/** The inventory settings as staff see them. */
export const getInventorySettings = query({
  name: "inventory.settings.get",
  input: z.object({}),
  permission: PERMISSIONS.inventory.stockRead,
  async handler({ ctx }): Promise<{ readonly expiryBufferDays: number }> {
    return { expiryBufferDays: await expiryBufferDays(ctx.tx) };
  },
});
