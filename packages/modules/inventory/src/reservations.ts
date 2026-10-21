import { newId } from "@igs/db/ids";
import { type Ctx, command, conflict, notFound } from "@igs/kernel";
import { productRefsById } from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";

import {
  activeShares,
  endAllocations,
  productsWithOrders,
  reconcileAllocations,
  requireAllocated,
} from "./allocations";
import { INVENTORY_AUDIT } from "./audit";
import {
  DEFAULT_LOCATION_ID,
  EXPIRY_BATCH,
  HOLDER_REF_PATTERN,
  HOLD_DEFAULT_MINUTES,
  HOLD_MAX_MINUTES,
  MAX_QUANTITY,
  MINUTE_MS,
  RELEASE_REASONS,
  type ReleaseReason,
  type ReservationKind,
} from "./domain";
import {
  levelOf,
  lockStock,
  recordMovements,
  reservedQuantities,
  sellableOnHand,
  stockLevels,
} from "./ledger";
import { reservations } from "./schema";

/**
 * Stock reservations (igs-pharma#99). A reservation sets stock aside without moving the ledger:
 * what a customer may still buy is on-hand minus the reservations that are live. Two kinds:
 * a `hold` for a checkout in progress (15 minutes by default, at most 30, then it expires) and an
 * `order` that never expires on its own, only a release or a consume ends it. The lifecycle is
 * enforced by the database as well (migration 0038).
 *
 * The commands are SYSTEM-ONLY (`inventory.reservation.manage`). Reserve, confirm, release and
 * consume are also `internal` (igs-pharma#116 S1): the orders module runs them through `ctx.run`
 * inside its own, already authorized, checkout commands, so the customer needs no reservation
 * permission; called directly, only a system actor holding the permission may run them.
 * Staff end a reservation with `releaseReservationByStaff` (`inventory.stock.manage`). A holder is
 * an OPAQUE reference (a checkout or order id), never customer data.
 *
 * Locking: `reserveStock` takes the product's stock-level row lock BEFORE it reads what is
 * available, so two buyers of the last box cannot both see it free, and it waits for any stock
 * movement in flight. `consumeReservation` takes the global stock lock first (like every stock
 * writer), then the rows, so no two paths wait on each other in a circle.
 */

const holderRef = z.string().regex(HOLDER_REF_PATTERN);
const quantity = z.number().int().min(1).max(MAX_QUANTITY);
const releaseReason = z.enum(RELEASE_REASONS);

type Row = typeof reservations.$inferSelect;

const idempotencyOutput = z.object({
  reservationId: z.uuid(),
  productId: z.uuid(),
  quantity: z.number().int(),
});

/** Locks `productId`'s stock-level row (waits for movements in flight) and returns what is on hand. */
async function lockLevel(ctx: Ctx, productId: string): Promise<number> {
  const rows = Array.from(
    await ctx.tx.execute<{ on_hand: number }>(
      sql`SELECT inventory.lock_stock_level(${productId}::uuid, ${DEFAULT_LOCATION_ID}::uuid) AS on_hand`,
    ),
  );
  return Number(rows[0]?.on_hand ?? 0);
}

const isLapsed = (row: Pick<Row, "kind" | "expiresAt">, now: Date): boolean =>
  row.kind === "hold" && row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime();

/** Who changed the row, for the update columns. */
const by = (ctx: Ctx) => ({
  updatedByType: ctx.actor.type,
  updatedById: ctx.actor.id,
  updatedAt: ctx.now,
});

async function audit(
  ctx: Ctx,
  action: string,
  row: Pick<Row, "id" | "productId" | "quantity">,
  extra: Record<string, string> = {},
): Promise<void> {
  await ctx.audit.record({
    action,
    entityType: "product",
    entityId: row.productId,
    data: { reservationId: row.id, productId: row.productId, quantity: row.quantity, ...extra },
  });
}

const view = (row: Pick<Row, "id" | "productId" | "quantity">) => ({
  reservationId: row.id,
  productId: row.productId,
  quantity: row.quantity,
});

/** The holder's ACTIVE reservations, locked, ordered by product. */
function activeOf(ctx: Ctx, holder: string) {
  return ctx.tx
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.holderRef, holder),
        eq(reservations.locationId, DEFAULT_LOCATION_ID),
        eq(reservations.status, "active"),
      ),
    )
    .orderBy(asc(reservations.productId))
    .for("update");
}

/**
 * The holder's active reservations, locked in the order every stock writer shares: look first, take
 * the products' stock-level rows (sorted), then lock and read the rows. A line that appeared between
 * the look and the lock is reported, never consumed or confirmed unlocked.
 */
async function lockHolder(ctx: Ctx, holder: string) {
  const lookedAt = await ctx.tx
    .select({ productId: reservations.productId })
    .from(reservations)
    .where(
      and(
        eq(reservations.holderRef, holder),
        eq(reservations.locationId, DEFAULT_LOCATION_ID),
        eq(reservations.status, "active"),
      ),
    );
  const locked = new Set<string>();
  for (const productId of [...new Set(lookedAt.map((row) => row.productId))].sort()) {
    await lockLevel(ctx, productId);
    locked.add(productId);
  }
  const active = await activeOf(ctx, holder);
  return { active, unlocked: active.some((row) => !locked.has(row.productId)) };
}

// ── reserve ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Sets `quantity` of a product aside as a HOLD for `holderRef`, for `holdMinutes` (15 by default,
 * 30 at most). Refused with `inventory.insufficient_stock` (and the number available) when less is
 * available. Asking again for the same holder and product with the SAME quantity returns the hold it
 * already has (no double reservation); with a different quantity it is refused with
 * `inventory.reservation_quantity_mismatch` (and the quantity held), because a retry never changes
 * a hold: release it and reserve again. A lapsed hold is replaced.
 */
export const reserveStock = command({
  name: "inventory.reservation.reserve",
  input: z.object({
    productId: z.uuid(),
    quantity,
    holderRef,
    holdMinutes: z.number().int().min(1).max(HOLD_MAX_MINUTES).default(HOLD_DEFAULT_MINUTES),
  }),
  output: idempotencyOutput.extend({
    kind: z.enum(["hold", "order"]),
    expiresAt: z.coerce.date().nullable(),
    created: z.boolean(),
  }),
  permission: PERMISSIONS.inventory.reservationManage,
  // the checkout runs it through ctx.run for the customer (S1); directly, system actors only
  internal: true,
  // changes (and audits) something only when there is something to change; a retry changes nothing
  audit: "none",
  async handler({ input, ctx }) {
    const [product] = await productRefsById(ctx.tx, [input.productId]);
    if (!product) throw notFound("inventory.product_not_found");
    // the lock FIRST, then what is available
    await lockLevel(ctx, product.id);

    const [existing] = await ctx.tx
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.productId, product.id),
          eq(reservations.locationId, DEFAULT_LOCATION_ID),
          eq(reservations.holderRef, input.holderRef),
          eq(reservations.status, "active"),
        ),
      )
      .for("update");
    if (existing) {
      if (!isLapsed(existing, ctx.now)) {
        // asking again is a retry, not a change: a different quantity is a different request
        if (existing.quantity !== input.quantity) {
          throw conflict("inventory.reservation_quantity_mismatch", { held: existing.quantity });
        }
        return {
          ...view(existing),
          kind: existing.kind as ReservationKind,
          expiresAt: existing.expiresAt,
          created: false,
        };
      }
      // a lapsed hold the expiry job has not marked yet: it is over, and makes room for a new one
      await ctx.tx
        .update(reservations)
        .set({ status: "expired", ...by(ctx) })
        .where(eq(reservations.id, existing.id));
      await audit(ctx, INVENTORY_AUDIT.reservationExpired, existing);
    }

    const reserved = (await reservedQuantities(ctx.tx, [product.id], ctx.now)).get(product.id);
    // only sellable lots count (igs-pharma#164): not quarantined, not unknown, not near expiry
    const sellable = (await sellableOnHand(ctx.tx, [product.id], ctx.now)).get(product.id) ?? 0;
    const available = sellable - (reserved?.held ?? 0) - (reserved?.ordered ?? 0);
    if (available < input.quantity) {
      throw conflict("inventory.insufficient_stock", { available: Math.max(0, available) });
    }

    const row = {
      id: newId(),
      productId: product.id,
      locationId: DEFAULT_LOCATION_ID,
      quantity: input.quantity,
      kind: "hold" as const,
      holderRef: input.holderRef,
      status: "active" as const,
      expiresAt: new Date(ctx.now.getTime() + input.holdMinutes * MINUTE_MS),
      createdByType: ctx.actor.type,
      createdById: ctx.actor.id,
      createdAt: ctx.now,
      updatedByType: ctx.actor.type,
      updatedById: ctx.actor.id,
      updatedAt: ctx.now,
    };
    await ctx.tx.insert(reservations).values(row);
    await audit(ctx, INVENTORY_AUDIT.reservationReserved, row);
    return { ...view(row), kind: "hold" as const, expiresAt: row.expiresAt, created: true };
  },
});

// ── confirm ──────────────────────────────────────────────────────────────────────────────────────

const holderOutput = z.object({
  holderRef: z.string(),
  reservations: z.array(idempotencyOutput),
});

/** The basket the checkout expects to confirm: one line per product. */
const expectedItems = z
  .array(z.object({ productId: z.uuid(), quantity }))
  .min(1)
  .max(100)
  .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, {
    message: "one line per product",
  });

/**
 * An order now exists for `holderRef`: every active HOLD of the holder becomes an ORDER and its
 * `expires_at` is cleared, so from now on it never expires on its own. The caller passes the basket
 * it expects (`items`, one line per product), and the confirmation goes through only when the
 * holder's ACTIVE reservations are EXACTLY that set, with those quantities, none of them lapsed:
 * otherwise nothing changes and it is refused. `inventory.reservation_expired` when a line of the
 * basket lapsed or was given back (also when the expiry job already marked it), and
 * `inventory.reservation_mismatch` when the holder has other lines or other quantities. So the
 * answer never depends on whether the expiry job has run. Confirming again with the same basket
 * changes nothing (an order stays an order).
 */
export const confirmReservation = command({
  name: "inventory.reservation.confirm",
  input: z.object({ holderRef, items: expectedItems }),
  output: holderOutput,
  permission: PERMISSIONS.inventory.reservationManage,
  // the checkout runs it through ctx.run for the customer (S1); directly, system actors only
  internal: true,
  // changes (and audits) something only when there is something to change; a retry changes nothing
  audit: "none",
  async handler({ input, ctx }) {
    const { active, unlocked } = await lockHolder(ctx, input.holderRef);
    // a line that appeared meanwhile is not the basket the caller expects
    if (unlocked) throw conflict("inventory.reservation_mismatch");
    if (active.length === 0) {
      const [ended] = await ctx.tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.holderRef, input.holderRef), eq(reservations.status, "expired")))
        .limit(1);
      if (ended) throw conflict("inventory.reservation_expired");
      throw notFound("inventory.reservation_not_found");
    }
    if (active.some((row) => isLapsed(row, ctx.now)))
      throw conflict("inventory.reservation_expired");

    const activeByProduct = new Map(active.map((row) => [row.productId, row]));
    for (const item of input.items) {
      const row = activeByProduct.get(item.productId);
      if (!row) {
        // a line of the basket is not active: the job (or a lapse) gave it back, or it never existed
        const [ended] = await ctx.tx
          .select({ id: reservations.id })
          .from(reservations)
          .where(
            and(
              eq(reservations.holderRef, input.holderRef),
              eq(reservations.productId, item.productId),
              eq(reservations.status, "expired"),
            ),
          )
          .limit(1);
        throw conflict(ended ? "inventory.reservation_expired" : "inventory.reservation_mismatch");
      }
      if (row.quantity !== item.quantity) throw conflict("inventory.reservation_mismatch");
    }
    if (active.length !== input.items.length) throw conflict("inventory.reservation_mismatch");

    const holds = active.filter((row) => row.kind === "hold");
    if (holds.length > 0) {
      await ctx.tx
        .update(reservations)
        .set({ kind: "order", expiresAt: null, ...by(ctx) })
        .where(
          inArray(
            reservations.id,
            holds.map((row) => row.id),
          ),
        );
      for (const row of holds) await audit(ctx, INVENTORY_AUDIT.reservationConfirmed, row);
    }
    // igs-pharma#165: the order is allocated to lots now (a retry finds it allocated: no change)
    await reconcileAllocations(
      ctx,
      active.map((row) => row.productId),
      { confirmed: new Set(holds.map((row) => row.id)) },
    );
    return { holderRef: input.holderRef, reservations: active.map(view) };
  },
});

// ── release ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Ends `rows` (locked by the caller after their stock-level rows) and their lot allocation; the lots
 * they had are then offered to the orders of the same products that are short.
 */
async function release(ctx: Ctx, rows: readonly Row[], reason: ReleaseReason): Promise<void> {
  if (rows.length === 0) return;
  await ctx.tx
    .update(reservations)
    .set({ status: "released", releaseReason: reason, ...by(ctx) })
    .where(
      inArray(
        reservations.id,
        rows.map((row) => row.id),
      ),
    );
  for (const row of rows) await audit(ctx, INVENTORY_AUDIT.reservationReleased, row, { reason });
  const orders = rows.filter((row) => row.kind === "order");
  if (orders.length > 0) {
    await endAllocations(
      ctx,
      orders.map((row) => row.id),
      "released",
    );
    await reconcileAllocations(
      ctx,
      orders.map((row) => row.productId),
    );
  }
}

/**
 * A cancelled checkout or order, or a refund before picking: ends every ACTIVE reservation of
 * `holderRef` and puts the stock back. Nothing active is not an error (`released: 0`), so a retry
 * is harmless.
 */
export const releaseReservation = command({
  name: "inventory.reservation.release",
  input: z.object({ holderRef, reason: releaseReason }),
  output: z.object({ holderRef: z.string(), released: z.number().int() }),
  permission: PERMISSIONS.inventory.reservationManage,
  // the checkout runs it through ctx.run for the customer (S1); directly, system actors only
  internal: true,
  // changes (and audits) something only when there is something to change; a retry changes nothing
  audit: "none",
  async handler({ input, ctx }) {
    // a line that appeared between the look and the lock stays: a retry releases it
    const { active } = await lockHolder(ctx, input.holderRef);
    await release(ctx, active, input.reason);
    return { holderRef: input.holderRef, released: active.length };
  },
});

/**
 * Staff ends ONE reservation from the Stock page, with a reason code (`inventory.stock.manage`).
 * An unknown id is `inventory.reservation_not_found`; one that already ended is
 * `inventory.reservation_not_active`.
 */
export const releaseReservationByStaff = command({
  name: "inventory.reservation.release_by_staff",
  input: z.object({ reservationId: z.uuid(), reason: releaseReason }),
  output: idempotencyOutput,
  permission: PERMISSIONS.inventory.stockManage,
  async handler({ input, ctx }) {
    const [peek] = await ctx.tx
      .select({ productId: reservations.productId })
      .from(reservations)
      .where(eq(reservations.id, input.reservationId));
    if (!peek) throw notFound("inventory.reservation_not_found");
    // the stock-level row first, like every stock writer
    await lockLevel(ctx, peek.productId);
    const [row] = await ctx.tx
      .select()
      .from(reservations)
      .where(eq(reservations.id, input.reservationId))
      .for("update");
    if (!row) throw notFound("inventory.reservation_not_found");
    if (row.status !== "active") throw conflict("inventory.reservation_not_active");
    await release(ctx, [row], input.reason);
    return view(row);
  },
});

// ── consume ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Picking: in ONE transaction every active ORDER of `holderRef` is marked `consumed` and its stock
 * leaves the shelf as one `sale` movement per allocated lot (igs-pharma#165; the ledger stays the
 * truth). A holder with
 * nothing active is `inventory.reservation_not_active` (consuming twice is refused); a hold that was
 * never confirmed cannot be consumed (`inventory.reservation_not_confirmed`). When the shelf holds
 * less than the order (it is short) the movement is refused: `inventory.negative_stock`.
 */
export const consumeReservation = command({
  name: "inventory.reservation.consume",
  input: z.object({ holderRef }),
  output: z.object({
    holderRef: z.string(),
    reservations: z.array(idempotencyOutput.extend({ movementId: z.uuid() })),
  }),
  permission: PERMISSIONS.inventory.reservationManage,
  // the checkout runs it through ctx.run for the customer (S1); directly, system actors only
  internal: true,
  async handler({ input, ctx }) {
    await lockStock(ctx.tx);
    // the lock order everyone shares (advisory → stock-level rows by product → reservation rows):
    // a retried reserve takes the level row first, so consume must not hold a reservation row
    // while it waits for one (40P01)
    const { active, unlocked } = await lockHolder(ctx, input.holderRef);
    // a line appeared between the look and the lock: not a state to consume from
    if (unlocked) throw conflict("inventory.reservation_not_confirmed");
    if (active.length === 0) {
      const [any] = await ctx.tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(eq(reservations.holderRef, input.holderRef))
        .limit(1);
      throw any
        ? conflict("inventory.reservation_not_active")
        : notFound("inventory.reservation_not_found");
    }
    if (active.some((row) => row.kind !== "order")) {
      throw conflict("inventory.reservation_not_confirmed");
    }
    // igs-pharma#165: each line leaves the shelf from exactly its allocated lots, checked (and
    // allocated again where needed) now; a line not allocated in full is refused, so nothing is
    // ever picked from a quarantined, unknown or near-expiry lot: `inventory.negative_stock` when
    // the shelf itself holds less, `inventory.stock_not_sellable` when the rest is not sellable,
    // `inventory.allocation_short` when the sellable stock is allocated to older orders
    await reconcileAllocations(
      ctx,
      active.map((row) => row.productId),
    );
    const shares = await activeShares(
      ctx.tx,
      active.map((row) => row.id),
    );
    const entries = [];
    for (const row of active) {
      const mine = shares.get(row.id) ?? [];
      if (mine.reduce((sum, share) => sum + share.quantity, 0) < row.quantity) {
        const { onHand } = levelOf(await stockLevels(ctx.tx, [row.productId]), row.productId);
        const sellable = (await sellableOnHand(ctx.tx, [row.productId], ctx.now)).get(
          row.productId,
        );
        throw conflict(
          onHand < row.quantity
            ? "inventory.negative_stock"
            : (sellable ?? 0) < row.quantity
              ? "inventory.stock_not_sellable"
              : "inventory.allocation_short",
        );
      }
      for (const share of mine) {
        entries.push({
          productId: row.productId,
          lotId: share.lotId,
          delta: -share.quantity,
          reason: "sale" as const,
        });
      }
    }
    const movements = await recordMovements(ctx.tx, ctx, entries);
    await endAllocations(
      ctx,
      active.map((row) => row.id),
      "consumed",
    );
    // the first movement of each product (one active reservation per product and holder)
    const byProduct = new Map<string, string>();
    for (const movement of movements) {
      if (!byProduct.has(movement.productId)) byProduct.set(movement.productId, movement.id);
    }
    await ctx.tx
      .update(reservations)
      .set({ status: "consumed", ...by(ctx) })
      .where(
        inArray(
          reservations.id,
          active.map((row) => row.id),
        ),
      );
    for (const row of active) {
      await audit(ctx, INVENTORY_AUDIT.reservationConsumed, row, {
        movementId: byProduct.get(row.productId) ?? "",
      });
    }
    return {
      holderRef: input.holderRef,
      reservations: active.map((row) => ({
        ...view(row),
        movementId: byProduct.get(row.productId) ?? "",
      })),
    };
  },
});

// ── allocation ───────────────────────────────────────────────────────────────────────────────────

const allocationOutput = z.object({
  reservationId: z.uuid(),
  productId: z.uuid(),
  quantity: z.number().int(),
  allocated: z.number().int(),
});

/**
 * Packing (igs-pharma#165): the orders of `holderRef` are allocated to sellable lots in full, checked
 * (and allocated again where needed) now; else `inventory.allocation_short`, and the order is not
 * packed. The orders module runs it through `ctx.run` before an order is ready for pickup.
 */
export const checkAllocation = command({
  name: "inventory.reservation.check_allocation",
  input: z.object({ holderRef }),
  output: z.object({ holderRef: z.string(), reservations: z.array(allocationOutput) }),
  permission: PERMISSIONS.inventory.reservationManage,
  internal: true,
  // audits only what it allocates again
  audit: "none",
  async handler({ input, ctx }) {
    return {
      holderRef: input.holderRef,
      reservations: [...(await requireAllocated(ctx, input.holderRef))],
    };
  },
});

/**
 * The hourly check (igs-pharma#165): allocates again every active order whose lots stopped being
 * sellable (a lot crossed the expiry buffer overnight) or that is short and may now be filled.
 * Writes nothing when nothing changed.
 */
export const reallocateOrders = command({
  name: "inventory.reservation.reallocate",
  input: z.object({}),
  output: z.object({ orders: z.number().int(), short: z.number().int() }),
  permission: PERMISSIONS.inventory.reservationManage,
  // audits only what it allocates again
  audit: "none",
  async handler({ ctx }) {
    await lockStock(ctx.tx);
    const results = await reconcileAllocations(ctx, await productsWithOrders(ctx.tx));
    return {
      orders: results.length,
      short: results.filter((result) => result.allocated < result.quantity).length,
    };
  },
});

// ── expire ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The expiry job's command: marks HOLDS past their `expires_at` as `expired` (at most
 * `EXPIRY_BATCH` per call; the job loops). It never touches an `order`. Safe to run twice and to
 * run at the same time as itself: rows another run has locked are skipped.
 */
export const expireReservations = command({
  name: "inventory.reservation.expire",
  input: z.object({}),
  output: z.object({ expired: z.number().int() }),
  permission: PERMISSIONS.inventory.reservationManage,
  // changes (and audits) something only when there is something to change; a retry changes nothing
  audit: "none",
  async handler({ ctx }) {
    const lapsed = await ctx.tx
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.status, "active"),
          eq(reservations.kind, "hold"),
          lte(reservations.expiresAt, ctx.now),
        ),
      )
      .orderBy(asc(reservations.expiresAt), asc(reservations.id))
      .limit(EXPIRY_BATCH)
      .for("update", { skipLocked: true });
    if (lapsed.length === 0) return { expired: 0 };
    await ctx.tx
      .update(reservations)
      .set({ status: "expired", ...by(ctx) })
      .where(
        inArray(
          reservations.id,
          lapsed.map((row) => row.id),
        ),
      );
    for (const row of lapsed) await audit(ctx, INVENTORY_AUDIT.reservationExpired, row);
    return { expired: lapsed.length };
  },
});
