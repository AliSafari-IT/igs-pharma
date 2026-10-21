import { type Ctx, command, conflict, forbidden, isDomainError, notFound } from "@igs/kernel";
import {
  checkAllocation,
  confirmReservation,
  consumeReservation,
  releaseReservation,
  reserveStock,
} from "@igs/module-inventory";
import { PERMISSIONS } from "@igs/rbac";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { ORDERS_AUDIT } from "./audit";
import {
  type OrderStatus,
  REFUND_NOTE_MAX,
  REVIEW_DECISIONS,
  REVIEW_NOTE_MAX,
  canTransition,
  holderOf,
} from "./domain";
import { requestOrderMail } from "./mails";
import { recordRefund } from "./refunds";
import { orderLines, orderReviews, ordersTable } from "./schema";

/** Pharmacist review and fulfilment of paid orders (asafarim-docs:ventures/igs-pharma, D-045). */

const expectedVersion = z.number().int().min(1);

type Order = typeof ordersTable.$inferSelect;

async function lockOrder(ctx: Ctx, orderId: string, version: number): Promise<Order> {
  const [order] = await ctx.tx
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .for("update");
  if (!order) throw notFound("orders.order_not_found");
  if (order.version !== version) {
    throw conflict("orders.stale_version", { expected: version, current: order.version });
  }
  return order;
}

async function moveOrder(ctx: Ctx, order: Order, to: OrderStatus): Promise<number> {
  const version = order.version + 1;
  await ctx.tx
    .update(ordersTable)
    .set({
      status: to,
      version,
      updatedByType: ctx.actor.type,
      updatedById: ctx.actor.id,
      updatedAt: ctx.now,
    })
    .where(eq(ordersTable.id, order.id));
  return version;
}

const result = z.object({ orderId: z.uuid(), status: z.string(), version: z.number().int() });

export const decideReview = command({
  name: "orders.review.decide",
  input: z.object({
    orderId: z.uuid(),
    decision: z.enum(REVIEW_DECISIONS),
    /** Staff-only: not shown to the customer, not audited. */
    note: z.string().trim().min(1).max(REVIEW_NOTE_MAX).optional(),
    expectedVersion,
  }),
  output: result,
  permission: PERMISSIONS.orders.reviewDecide,
  audit: "none",
  async handler({ input, ctx }) {
    const order = await lockOrder(ctx, input.orderId, input.expectedVersion);
    if (order.status !== "in_review") {
      throw conflict("orders.order_not_in_review", { status: order.status });
    }
    await ctx.tx.insert(orderReviews).values({
      orderId: order.id,
      decision: input.decision,
      note: input.note ?? null,
      reviewerId: ctx.actor.id,
      decidedAt: ctx.now,
    });
    let to: OrderStatus = "ready_to_prepare";
    if (input.decision === "rejected") {
      await ctx.run(releaseReservation, {
        holderRef: holderOf(order.checkoutId),
        reason: "order_cancelled",
      });
      to = "cancelled";
    }
    const version = await moveOrder(ctx, order, to);
    if (to === "cancelled") {
      // the pharmacist's refusal is also the authorisation to give the money back
      await recordRefund(
        ctx,
        { ...order, status: to },
        { reason: "pharmacist_rejected", approvedById: ctx.actor.id },
      );
    }
    await ctx.audit.record({
      action: ORDERS_AUDIT.orderReviewed,
      entityType: "order",
      entityId: order.id,
      data: { orderId: order.id, decision: input.decision, status: to },
    });
    return { orderId: order.id, status: to, version };
  },
});

/** Fulfilment steps, in lifecycle order. */
export const FULFILMENT_STEPS = ["preparing", "ready_for_pickup", "collected"] as const;
export type FulfilmentStep = (typeof FULFILMENT_STEPS)[number];

export const advanceOrder = command({
  name: "orders.order.advance",
  input: z.object({ orderId: z.uuid(), to: z.enum(FULFILMENT_STEPS), expectedVersion }),
  output: result,
  permission: PERMISSIONS.orders.manage,
  audit: "none",
  async handler({ input, ctx }) {
    const order = await lockOrder(ctx, input.orderId, input.expectedVersion);
    const from = order.status as OrderStatus;
    if (!canTransition(from, input.to, { needsReview: order.needsReview })) {
      throw conflict("orders.invalid_transition", { from, to: input.to });
    }
    if (input.to === "ready_for_pickup") {
      // packed only from sellable lots allocated in full (igs-pharma#165): else
      // `inventory.allocation_short`, and the order stays in preparation
      await ctx.run(checkAllocation, { holderRef: holderOf(order.checkoutId) });
    }
    if (input.to === "collected") {
      await ctx.run(consumeReservation, { holderRef: holderOf(order.checkoutId) });
    }
    const version = await moveOrder(ctx, order, input.to);
    if (input.to === "ready_for_pickup") {
      await requestOrderMail(ctx, { orderId: order.id, kind: "ready_for_pickup" });
    }
    await ctx.audit.record({
      action: ORDERS_AUDIT.orderAdvanced,
      entityType: "order",
      entityId: order.id,
      data: { orderId: order.id, from, to: input.to },
    });
    return { orderId: order.id, status: input.to, version };
  },
});

// ── paid, stock short (igs-pharma#158) ───────────────────────────────────────────────────────────

async function lockStockShort(ctx: Ctx, orderId: string, version: number): Promise<Order> {
  const order = await lockOrder(ctx, orderId, version);
  if (order.status !== "paid_stock_short") {
    throw conflict("orders.order_not_stock_short", { status: order.status });
  }
  return order;
}

/**
 * The stock is there again: holds the ORIGINAL products and quantities once more through the
 * inventory commands (the paid prices on the lines never change) and confirms them, all or nothing.
 * `orders.stock_still_short` (with the product and what is available) when a line still cannot be
 * held. The order then goes where a paid order goes: the pharmacist's review for a medicine, else
 * "to prepare"; the customer gets the "received" mail. Nothing is ever substituted.
 */
export const reReserveOrder = command({
  name: "orders.order.re_reserve",
  input: z.object({ orderId: z.uuid(), expectedVersion }),
  output: result,
  permission: PERMISSIONS.orders.manage,
  audit: "none",
  async handler({ input, ctx }) {
    const order = await lockStockShort(ctx, input.orderId, input.expectedVersion);
    const holderRef = holderOf(order.checkoutId);
    const items = await ctx.tx
      .select({ productId: orderLines.productId, quantity: orderLines.quantity })
      .from(orderLines)
      .where(eq(orderLines.orderId, order.id))
      .orderBy(asc(orderLines.productId));
    for (const item of items) {
      try {
        await ctx.run(reserveStock, { ...item, holderRef });
      } catch (error) {
        if (isDomainError(error) && error.code === "inventory.insufficient_stock") {
          throw conflict("orders.stock_still_short", {
            productId: item.productId,
            available: Number(error.details?.["available"] ?? 0),
          });
        }
        throw error;
      }
    }
    await ctx.run(confirmReservation, { holderRef, items });
    const to: OrderStatus = order.needsReview ? "in_review" : "ready_to_prepare";
    const version = await moveOrder(ctx, order, to);
    await requestOrderMail(ctx, { orderId: order.id, kind: "order_received" });
    await ctx.audit.record({
      action: ORDERS_AUDIT.orderReReserved,
      entityType: "order",
      entityId: order.id,
      data: { orderId: order.id, status: to },
    });
    return { orderId: order.id, status: to, version };
  },
});

/**
 * The stock will not come: gives back whatever is still held, cancels the order and records the
 * full refund (reason `stock_short`), which also tells the customer. The refund rules apply: owner
 * or pharmacist, and a pharmacist for an order that holds a medicine.
 */
export const cancelStockShortOrder = command({
  name: "orders.order.cancel_stock_short",
  input: z.object({
    orderId: z.uuid(),
    expectedVersion,
    /** Staff-only, kept on the refund; not audited. */
    note: z.string().trim().min(1).max(REFUND_NOTE_MAX).optional(),
  }),
  output: result,
  permission: PERMISSIONS.orders.refundRequest,
  audit: "none",
  async handler({ input, ctx }) {
    const order = await lockStockShort(ctx, input.orderId, input.expectedVersion);
    if (order.needsReview && !ctx.can(PERMISSIONS.orders.reviewDecide)) {
      throw forbidden("orders.refund_needs_pharmacist");
    }
    await ctx.run(releaseReservation, {
      holderRef: holderOf(order.checkoutId),
      reason: "order_cancelled",
    });
    const version = await moveOrder(ctx, order, "cancelled");
    const refundId = await recordRefund(
      ctx,
      { ...order, status: "cancelled" },
      {
        reason: "stock_short",
        note: input.note,
        approvedById: order.needsReview ? ctx.actor.id : null,
      },
    );
    await ctx.audit.record({
      action: ORDERS_AUDIT.orderCancelled,
      entityType: "order",
      entityId: order.id,
      data: { orderId: order.id, from: "paid_stock_short", reason: "stock_short", refundId },
    });
    return { orderId: order.id, status: "cancelled", version };
  },
});
