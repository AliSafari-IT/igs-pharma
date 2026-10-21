import { notFound, query } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  ORDER_STATUSES,
  type OrderStatus,
  type PaymentStatus,
  type ReviewDecision,
} from "./domain";
import { type RefundView, refundsOf } from "./refunds";
import {
  orderContacts,
  orderEvents,
  orderLines,
  orderReviews,
  ordersTable,
  payments,
  refunds,
} from "./schema";
import type { BasketLineView } from "./views";

/** Back-office order reads (`orders.read`). */

/** Status of the order's latest payment. The outer column is spelled out: drizzle leaves it
 * unqualified in a single-table select, where it would bind to `p.id`. */
const latestPaymentStatus = sql<string | null>`(
  SELECT p.status FROM ${payments} p
  WHERE p.order_id = ${sql.raw('"orders"."orders"."id"')}
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
)`;

/** Whether the order has a refund that is not failed or canceled (full refunds only). */
const activeRefund = sql<boolean>`EXISTS (
  SELECT 1 FROM ${refunds} r
  WHERE r.order_id = ${sql.raw('"orders"."orders"."id"')}
    AND r.status IN ('requested', 'pending', 'refunded')
)`;

/** Paid, closed, and no refund under way or made. */
const isRefundDue = (status: string, paymentStatus: string | null, refunding: boolean) =>
  (status === "cancelled" || status === "expired") && paymentStatus === "paid" && !refunding;

export interface StaffOrderListItem {
  readonly orderId: string;
  readonly reference: string;
  readonly status: OrderStatus;
  readonly needsReview: boolean;
  readonly totalCents: number;
  readonly createdAt: Date;
  readonly contactName: string | null;
  readonly paymentStatus: PaymentStatus | null;
  readonly refundDue: boolean;
}

export interface StaffOrderPage {
  readonly items: readonly StaffOrderListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  /** Orders per status. */
  readonly counts: Readonly<Partial<Record<OrderStatus, number>>>;
}

export const listOrdersForStaff = query({
  name: "orders.order.list_staff",
  input: z.object({
    /** Unset: all orders, newest first; a status lists oldest first. */
    status: z.enum(ORDER_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  }),
  permission: PERMISSIONS.orders.read,
  async handler({ input, ctx }): Promise<StaffOrderPage> {
    const where = input.status ? eq(ordersTable.status, input.status) : undefined;
    const rows = await ctx.tx
      .select({
        orderId: ordersTable.id,
        reference: ordersTable.reference,
        status: ordersTable.status,
        needsReview: ordersTable.needsReview,
        totalCents: ordersTable.totalCents,
        createdAt: ordersTable.createdAt,
        contactName: orderContacts.name,
        paymentStatus: latestPaymentStatus,
        refunding: activeRefund,
      })
      .from(ordersTable)
      .leftJoin(orderContacts, eq(orderContacts.orderId, ordersTable.id))
      .where(where)
      .orderBy(
        input.status ? asc(ordersTable.createdAt) : desc(ordersTable.createdAt),
        asc(ordersTable.id),
      )
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    const grouped = await ctx.tx
      .select({ status: ordersTable.status, n: count() })
      .from(ordersTable)
      .groupBy(ordersTable.status);
    const counts: Partial<Record<OrderStatus, number>> = {};
    for (const row of grouped) counts[row.status as OrderStatus] = row.n;
    const total = input.status
      ? (counts[input.status] ?? 0)
      : grouped.reduce((sum, row) => sum + row.n, 0);
    return {
      items: rows.map(({ refunding, ...row }) => ({
        ...row,
        status: row.status as OrderStatus,
        paymentStatus: row.paymentStatus as PaymentStatus | null,
        refundDue: isRefundDue(row.status, row.paymentStatus, refunding),
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
      counts,
    };
  },
});

export interface StaffOrderView {
  readonly orderId: string;
  readonly reference: string;
  readonly status: OrderStatus;
  /** Pass as `expectedVersion`. */
  readonly version: number;
  readonly needsReview: boolean;
  readonly locale: string;
  readonly totalCents: number;
  readonly vatCents: number;
  readonly createdAt: Date;
  readonly contact: {
    readonly name: string;
    readonly email: string;
    readonly phone: string;
  } | null;
  readonly lines: readonly BasketLineView[];
  readonly paymentStatus: PaymentStatus | null;
  readonly refundDue: boolean;
  /** Newest first. */
  readonly refunds: readonly RefundView[];
  readonly review: {
    readonly decision: ReviewDecision;
    readonly note: string | null;
    readonly reviewerId: string;
    readonly decidedAt: Date;
  } | null;
  /** Status history, oldest first. */
  readonly events: readonly {
    readonly fromStatus: OrderStatus | null;
    readonly toStatus: OrderStatus;
    readonly actorType: string;
    readonly actorId: string;
    readonly at: Date;
  }[];
}

export const getOrderForStaff = query({
  name: "orders.order.get_staff",
  input: z.object({ orderId: z.uuid() }),
  permission: PERMISSIONS.orders.read,
  async handler({ input, ctx }): Promise<StaffOrderView> {
    const [order] = await ctx.tx
      .select({
        id: ordersTable.id,
        reference: ordersTable.reference,
        status: ordersTable.status,
        version: ordersTable.version,
        needsReview: ordersTable.needsReview,
        locale: ordersTable.locale,
        totalCents: ordersTable.totalCents,
        vatCents: ordersTable.vatCents,
        createdAt: ordersTable.createdAt,
        paymentStatus: latestPaymentStatus,
        refunding: activeRefund,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, input.orderId));
    if (!order) throw notFound("orders.order_not_found");
    const [contact] = await ctx.tx
      .select({ name: orderContacts.name, email: orderContacts.email, phone: orderContacts.phone })
      .from(orderContacts)
      .where(eq(orderContacts.orderId, order.id));
    const lines = await ctx.tx
      .select({
        productId: orderLines.productId,
        cnk: orderLines.cnk,
        name: orderLines.name,
        isMedicine: orderLines.isMedicine,
        quantity: orderLines.quantity,
        unitPriceCents: orderLines.unitPriceCents,
        lineTotalCents: orderLines.lineTotalCents,
      })
      .from(orderLines)
      .where(eq(orderLines.orderId, order.id))
      .orderBy(asc(orderLines.cnk));
    const [review] = await ctx.tx
      .select({
        decision: orderReviews.decision,
        note: orderReviews.note,
        reviewerId: orderReviews.reviewerId,
        decidedAt: orderReviews.decidedAt,
      })
      .from(orderReviews)
      .where(eq(orderReviews.orderId, order.id));
    const events = await ctx.tx
      .select({
        fromStatus: orderEvents.fromStatus,
        toStatus: orderEvents.toStatus,
        actorType: orderEvents.actorType,
        actorId: orderEvents.actorId,
        at: orderEvents.at,
      })
      .from(orderEvents)
      .where(eq(orderEvents.orderId, order.id))
      .orderBy(asc(orderEvents.at), asc(orderEvents.id));
    return {
      orderId: order.id,
      reference: order.reference,
      status: order.status as OrderStatus,
      version: order.version,
      needsReview: order.needsReview,
      locale: order.locale,
      totalCents: order.totalCents,
      vatCents: order.vatCents,
      createdAt: order.createdAt,
      contact: contact ?? null,
      lines,
      paymentStatus: order.paymentStatus as PaymentStatus | null,
      refundDue: isRefundDue(order.status, order.paymentStatus, order.refunding),
      refunds: await refundsOf(ctx, order.id),
      review: review ? { ...review, decision: review.decision as ReviewDecision } : null,
      events: events.map((event) => ({
        ...event,
        fromStatus: event.fromStatus as OrderStatus | null,
        toStatus: event.toStatus as OrderStatus,
      })),
    };
  },
});
