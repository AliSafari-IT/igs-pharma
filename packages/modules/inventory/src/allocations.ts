import { newId } from "@igs/db/ids";
import { type Ctx, type Tx, conflict, notFound } from "@igs/kernel";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { INVENTORY_AUDIT } from "./audit";
import { type AllocationCause, DEFAULT_LOCATION_ID, type LotTracking } from "./domain";
import { brusselsToday, expiryBufferDays, sellableLotSql } from "./ledger";
import { lotLevels, lots, reservationAllocations, reservations } from "./schema";

/**
 * Lot allocation of order reservations (igs-pharma#165, ADR 0011 §4). A checkout hold stays per
 * product; when it becomes an ORDER, its quantity is allocated to lots: sellable lots only, earliest
 * expiry first, lots without an expiry date after, the `no_lot` lot last, the lot id breaking ties.
 * Pickup consumes exactly the allocated lots.
 *
 * `reconcileAllocations` is the single place that writes allocations. It keeps every allocation that
 * still holds (its lot is sellable and holds what the earlier orders and this one were given) and
 * allocates again, from what is left, each order whose allocation no longer holds or falls short:
 * older orders first. An order that cannot be allocated in full keeps what it got and is SHORT:
 * staff are flagged, it cannot be packed (`checkAllocation`) and pickup refuses it. Running it again
 * with nothing changed writes nothing, so every stock command and the hourly job can call it.
 *
 * Locking: the products' stock-level rows first (sorted), then the reservation and allocation rows,
 * the order every stock writer shares (see reservations.ts).
 */

/** A lot as the allocation sees it. */
interface LotRow {
  readonly lotId: string;
  readonly tracking: LotTracking;
  readonly expiryDate: string | null;
  readonly onHand: number;
  readonly sellable: boolean;
}

/** FEFO: earliest expiry first, then lots without one, the `no_lot` lot last, then by lot id. */
export function fefoCompare(
  a: Pick<LotRow, "lotId" | "tracking" | "expiryDate">,
  b: Pick<LotRow, "lotId" | "tracking" | "expiryDate">,
): number {
  if (a.expiryDate !== b.expiryDate) {
    if (a.expiryDate === null) return 1;
    if (b.expiryDate === null) return -1;
    return a.expiryDate < b.expiryDate ? -1 : 1;
  }
  const aNoLot = a.tracking === "no_lot" ? 1 : 0;
  const bNoLot = b.tracking === "no_lot" ? 1 : 0;
  if (aNoLot !== bNoLot) return aNoLot - bNoLot;
  return a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0;
}

/** One lot's share of a planned or standing allocation. */
export interface LotShare {
  readonly lotId: string;
  readonly quantity: number;
}

/**
 * The FEFO plan for `quantity` from `lots` (any order), given what is already `used` of each lot.
 * Takes from sellable lots only; the plan may hold less than `quantity`.
 */
export function planFefo(
  lots: readonly Pick<LotRow, "lotId" | "tracking" | "expiryDate" | "onHand" | "sellable">[],
  used: ReadonlyMap<string, number>,
  quantity: number,
): readonly LotShare[] {
  const plan: LotShare[] = [];
  let left = quantity;
  for (const lot of [...lots].sort(fefoCompare)) {
    if (left === 0) break;
    if (!lot.sellable) continue;
    const free = lot.onHand - (used.get(lot.lotId) ?? 0);
    if (free <= 0) continue;
    const take = Math.min(free, left);
    plan.push({ lotId: lot.lotId, quantity: take });
    left -= take;
  }
  return plan;
}

const total = (shares: readonly LotShare[]): number =>
  shares.reduce((sum, share) => sum + share.quantity, 0);

const sameShares = (a: readonly LotShare[], b: readonly LotShare[]): boolean => {
  if (a.length !== b.length) return false;
  const byLot = new Map(a.map((share) => [share.lotId, share.quantity]));
  return b.every((share) => byLot.get(share.lotId) === share.quantity);
};

/** Locks the stock-level rows of these products, in id order. */
async function lockLevels(ctx: Ctx, productIds: readonly string[]): Promise<void> {
  for (const productId of [...new Set(productIds)].sort()) {
    await ctx.tx.execute(
      sql`SELECT inventory.lock_stock_level(${productId}::uuid, ${DEFAULT_LOCATION_ID}::uuid)`,
    );
  }
}

/** The lots of these products with their on-hand and whether they are sellable at `now`. */
async function lotRows(
  tx: Tx,
  productIds: readonly string[],
  now: Date,
): Promise<ReadonlyMap<string, readonly LotRow[]>> {
  const buffer = await expiryBufferDays(tx);
  const rows = await tx
    .select({
      lotId: lots.id,
      productId: lots.productId,
      tracking: lots.tracking,
      expiryDate: lots.expiryDate,
      onHand: sql<number>`coalesce(${lotLevels.onHand}, 0)::int`,
      sellable: sql<boolean>`${sellableLotSql(brusselsToday(now), buffer)}`,
    })
    .from(lots)
    .leftJoin(lotLevels, eq(lotLevels.lotId, lots.id))
    .where(and(eq(lots.locationId, DEFAULT_LOCATION_ID), inArray(lots.productId, [...productIds])));
  const byProduct = new Map<string, LotRow[]>();
  for (const row of rows) {
    const list = byProduct.get(row.productId) ?? [];
    list.push({
      lotId: row.lotId,
      tracking: row.tracking as LotTracking,
      expiryDate: row.expiryDate,
      onHand: row.onHand,
      sellable: row.sellable,
    });
    byProduct.set(row.productId, list);
  }
  return byProduct;
}

/** How an order reservation stands after `reconcileAllocations`. */
export interface AllocationResult {
  readonly reservationId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly allocated: number;
}

/**
 * Allocates (again) the active orders of these products where their allocation no longer holds or
 * falls short (see the module note), and returns how each order of them stands. `confirmed` names
 * the reservations that have just become orders: their first allocation is audited as `confirmed`.
 */
export async function reconcileAllocations(
  ctx: Ctx,
  productIds: readonly string[],
  options: { readonly confirmed?: ReadonlySet<string> } = {},
): Promise<readonly AllocationResult[]> {
  const products = [...new Set(productIds)].sort();
  if (products.length === 0) return [];
  await lockLevels(ctx, products);
  const orders = await ctx.tx
    .select({
      id: reservations.id,
      productId: reservations.productId,
      quantity: reservations.quantity,
    })
    .from(reservations)
    .where(
      and(
        inArray(reservations.productId, products),
        eq(reservations.locationId, DEFAULT_LOCATION_ID),
        eq(reservations.kind, "order"),
        eq(reservations.status, "active"),
      ),
    )
    .orderBy(asc(reservations.productId), asc(reservations.createdAt), asc(reservations.id))
    .for("update");
  if (orders.length === 0) return [];
  const standing = await ctx.tx
    .select()
    .from(reservationAllocations)
    .where(
      and(
        inArray(
          reservationAllocations.reservationId,
          orders.map((order) => order.id),
        ),
        eq(reservationAllocations.status, "active"),
      ),
    )
    .orderBy(asc(reservationAllocations.id))
    .for("update");
  const standingOf = new Map<string, (typeof standing)[number][]>();
  for (const row of standing) {
    const list = standingOf.get(row.reservationId) ?? [];
    list.push(row);
    standingOf.set(row.reservationId, list);
  }
  const lotsOf = await lotRows(ctx.tx, products, ctx.now);

  for (const productId of products) {
    const productLots = lotsOf.get(productId) ?? [];
    const lotById = new Map(productLots.map((lot) => [lot.lotId, lot]));
    const used = new Map<string, number>();
    const use = (shares: readonly LotShare[]) => {
      for (const share of shares)
        used.set(share.lotId, (used.get(share.lotId) ?? 0) + share.quantity);
    };
    const productOrders = orders.filter((order) => order.productId === productId);

    // what still holds is kept, oldest order first; the rest is allocated again afterwards
    const redo: { order: (typeof orders)[number]; cause: AllocationCause }[] = [];
    for (const order of productOrders) {
      const shares = standingOf.get(order.id) ?? [];
      let cause: AllocationCause | null = null;
      if (shares.some((share) => !lotById.get(share.lotId)?.sellable)) {
        cause = "lot_not_sellable";
      } else if (
        shares.some(
          (share) =>
            (used.get(share.lotId) ?? 0) + share.quantity > (lotById.get(share.lotId)?.onHand ?? 0),
        )
      ) {
        cause = "lot_short";
      } else if (total(shares) < order.quantity) {
        cause =
          options.confirmed?.has(order.id) && shares.length === 0 ? "confirmed" : "stock_added";
      }
      if (cause) redo.push({ order, cause });
      else use(shares);
    }

    for (const { order, cause } of redo) {
      const shares = standingOf.get(order.id) ?? [];
      const plan = planFefo(productLots, used, order.quantity);
      use(plan);
      const allocated = total(plan);
      if (!sameShares(shares, plan)) {
        await writeAllocation(ctx, order, shares, plan, cause);
      }
      if (allocated < order.quantity && (cause === "confirmed" || !sameShares(shares, plan))) {
        await ctx.audit.record({
          action: INVENTORY_AUDIT.allocationShort,
          entityType: "product",
          entityId: order.productId,
          data: {
            reservationId: order.id,
            productId: order.productId,
            quantity: order.quantity,
            allocated,
            cause,
          },
        });
      }
    }
  }
  // how each order now stands, the ones just allocated again included
  const current = await activeShares(
    ctx.tx,
    orders.map((order) => order.id),
  );
  return orders.map((order) => ({
    reservationId: order.id,
    productId: order.productId,
    quantity: order.quantity,
    allocated: total(current.get(order.id) ?? []),
  }));
}

/** Supersedes `before` and writes `after` as the order's allocation, audited row by row. */
async function writeAllocation(
  ctx: Ctx,
  order: { readonly id: string; readonly productId: string },
  before: readonly (LotShare & { readonly id: string })[],
  after: readonly LotShare[],
  cause: AllocationCause,
): Promise<void> {
  if (before.length > 0) {
    await ctx.tx
      .update(reservationAllocations)
      .set({ status: "superseded", updatedAt: ctx.now })
      .where(
        inArray(
          reservationAllocations.id,
          before.map((row) => row.id),
        ),
      );
    for (const row of before) {
      await ctx.audit.record({
        action: INVENTORY_AUDIT.allocationSuperseded,
        entityType: "product",
        entityId: order.productId,
        data: {
          allocationId: row.id,
          reservationId: order.id,
          productId: order.productId,
          lotId: row.lotId,
          quantity: row.quantity,
          cause,
        },
      });
    }
  }
  if (after.length === 0) return;
  const rows = after.map((share) => ({
    id: newId(),
    reservationId: order.id,
    productId: order.productId,
    lotId: share.lotId,
    quantity: share.quantity,
    status: "active" as const,
    createdByType: ctx.actor.type,
    createdById: ctx.actor.id,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  }));
  await ctx.tx.insert(reservationAllocations).values(rows);
  for (const row of rows) {
    await ctx.audit.record({
      action: INVENTORY_AUDIT.allocationAllocated,
      entityType: "product",
      entityId: order.productId,
      data: {
        allocationId: row.id,
        reservationId: order.id,
        productId: order.productId,
        lotId: row.lotId,
        quantity: row.quantity,
        cause,
      },
    });
  }
}

/** The active allocation of each of these reservations. */
export async function activeShares(
  tx: Tx,
  reservationIds: readonly string[],
): Promise<ReadonlyMap<string, readonly (LotShare & { readonly id: string })[]>> {
  if (reservationIds.length === 0) return new Map();
  const rows = await tx
    .select({
      id: reservationAllocations.id,
      reservationId: reservationAllocations.reservationId,
      lotId: reservationAllocations.lotId,
      quantity: reservationAllocations.quantity,
    })
    .from(reservationAllocations)
    .where(
      and(
        inArray(reservationAllocations.reservationId, [...reservationIds]),
        eq(reservationAllocations.status, "active"),
      ),
    )
    .orderBy(asc(reservationAllocations.id));
  const byReservation = new Map<string, (LotShare & { id: string })[]>();
  for (const row of rows) {
    const list = byReservation.get(row.reservationId) ?? [];
    list.push({ id: row.id, lotId: row.lotId, quantity: row.quantity });
    byReservation.set(row.reservationId, list);
  }
  return byReservation;
}

/** Ends the active allocation of these reservations with them (`consumed` or `released`). */
export async function endAllocations(
  ctx: Ctx,
  reservationIds: readonly string[],
  status: "consumed" | "released",
): Promise<void> {
  if (reservationIds.length === 0) return;
  await ctx.tx
    .update(reservationAllocations)
    .set({ status, updatedAt: ctx.now })
    .where(
      and(
        inArray(reservationAllocations.reservationId, [...reservationIds]),
        eq(reservationAllocations.status, "active"),
      ),
    );
}

/** The products that have an active order: what a shop-wide change (the expiry buffer) re-checks. */
export async function productsWithOrders(tx: Tx): Promise<readonly string[]> {
  const rows = await tx
    .selectDistinct({ productId: reservations.productId })
    .from(reservations)
    .where(
      and(
        eq(reservations.locationId, DEFAULT_LOCATION_ID),
        eq(reservations.kind, "order"),
        eq(reservations.status, "active"),
      ),
    );
  return rows.map((row) => row.productId).sort();
}

/**
 * The orders of `holderRef` are allocated in full, or it is refused: `inventory.allocation_short`
 * (with the first short product) when sellable stock no longer covers them. A holder with no active
 * order is `inventory.reservation_not_active` (or `_not_found`).
 */
export async function requireAllocated(
  ctx: Ctx,
  holderRef: string,
): Promise<readonly AllocationResult[]> {
  const looked = await ctx.tx
    .select({ productId: reservations.productId, kind: reservations.kind })
    .from(reservations)
    .where(
      and(
        eq(reservations.holderRef, holderRef),
        eq(reservations.locationId, DEFAULT_LOCATION_ID),
        eq(reservations.status, "active"),
      ),
    );
  if (looked.length === 0) {
    const [any] = await ctx.tx
      .select({ id: reservations.id })
      .from(reservations)
      .where(eq(reservations.holderRef, holderRef))
      .limit(1);
    throw any
      ? conflict("inventory.reservation_not_active")
      : notFound("inventory.reservation_not_found");
  }
  if (looked.some((row) => row.kind !== "order")) {
    throw conflict("inventory.reservation_not_confirmed");
  }
  const products = looked.map((row) => row.productId);
  const all = await reconcileAllocations(ctx, products);
  const ids = new Set(
    (
      await ctx.tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.holderRef, holderRef),
            eq(reservations.locationId, DEFAULT_LOCATION_ID),
            eq(reservations.status, "active"),
          ),
        )
    ).map((row) => row.id),
  );
  const mine = all.filter((result) => ids.has(result.reservationId));
  const short = mine.find((result) => result.allocated < result.quantity);
  if (short) {
    throw conflict("inventory.allocation_short", {
      productId: short.productId,
      allocated: short.allocated,
    });
  }
  return mine;
}
