import { type Ctx, command, conflict, notFound } from "@igs/kernel";
import { consumeReservation, releaseReservation } from "@igs/module-inventory";
import { PERMISSIONS } from "@igs/rbac";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { ORDERS_AUDIT } from "./audit";
import {
  type OrderStatus,
  REVIEW_DECISIONS,
  REVIEW_NOTE_MAX,
  canTransition,
  holderOf,
} from "./domain";
import { orderReviews, ordersTable } from "./schema";

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
    if (input.to === "collected") {
      await ctx.run(consumeReservation, { holderRef: holderOf(order.checkoutId) });
    }
    const version = await moveOrder(ctx, order, input.to);
    await ctx.audit.record({
      action: ORDERS_AUDIT.orderAdvanced,
      entityType: "order",
      entityId: order.id,
      data: { orderId: order.id, from, to: input.to },
    });
    return { orderId: order.id, status: input.to, version };
  },
});
