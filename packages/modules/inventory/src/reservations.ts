import { newId } from "@igs/db/ids";
import { type Ctx, command, conflict, notFound } from "@igs/kernel";
import { productRefsById } from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";

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
import { lockStock, recordMovements, reservedQuantities } from "./ledger";
import { reservations } from "./schema";

/**
 * Stock reservations (igs-pharma#99). A reservation sets stock aside without moving the ledger:
 * what a customer may still buy is on-hand minus the reservations that are live. Two kinds:
 * a `hold` for a checkout in progress (15 minutes by default, at most 30, then it expires) and an
 * `order` that never expires on its own, only a release or a consume ends it. The lifecycle is
 * enforced by the database as well (migration 0037).
 *
 * The commands are SYSTEM-ONLY (`inventory.reservation.manage`): the future checkout calls them.
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
  // changes (and audits) something only when there is something to change; a retry changes nothing
  audit: "none",
  async handler({ input, ctx }) {
    const [product] = await productRefsById(ctx.tx, [input.productId]);
    if (!product) throw notFound("inventory.product_not_found");
    // the lock FIRST, then what is available
    const onHand = await lockLevel(ctx, product.id);

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
    const available = onHand - (reserved?.held ?? 0) - (reserved?.ordered ?? 0);
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
  // changes (and audits) something only when there is something to change; a retry changes nothing
  audit: "none",
  async handler({ input, ctx }) {
    const active = await activeOf(ctx, input.holderRef);
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
    return { holderRef: input.holderRef, reservations: active.map(view) };
  },
});

// ── release ──────────────────────────────────────────────────────────────────────────────────────

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
  // changes (and audits) something only when there is something to change; a retry changes nothing
  audit: "none",
  async handler({ input, ctx }) {
    const active = await activeOf(ctx, input.holderRef);
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
 * leaves the shelf as a `sale` movement in the ledger (the ledger stays the truth). A holder with
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
  async handler({ input, ctx }) {
    await lockStock(ctx.tx);
    // the lock order everyone shares (advisory → stock-level rows by product → reservation rows):
    // a retried reserve takes the level row first, so consume must not hold a reservation row
    // while it waits for one (40P01). Look first, lock the levels, then lock and read the rows.
    const lookedAt = await ctx.tx
      .select({ productId: reservations.productId })
      .from(reservations)
      .where(
        and(
          eq(reservations.holderRef, input.holderRef),
          eq(reservations.locationId, DEFAULT_LOCATION_ID),
          eq(reservations.status, "active"),
        ),
      );
    const locked = new Set<string>();
    for (const productId of [...new Set(lookedAt.map((row) => row.productId))].sort()) {
      await lockLevel(ctx, productId);
      locked.add(productId);
    }
    const active = await activeOf(ctx, input.holderRef);
    if (active.some((row) => !locked.has(row.productId))) {
      // a line appeared between the look and the lock: not a state to consume from
      throw conflict("inventory.reservation_not_confirmed");
    }
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
    const movements = await recordMovements(
      ctx.tx,
      ctx,
      active.map((row) => ({
        productId: row.productId,
        delta: -row.quantity,
        reason: "sale" as const,
      })),
    );
    // paired by product (one active reservation per product and holder), never by position
    const byProduct = new Map(movements.map((movement) => [movement.productId, movement.id]));
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
