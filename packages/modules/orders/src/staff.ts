import { type Tx, notFound, query } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { DeliveryMethod } from "./delivery-domain";
import {
  END_STATUSES,
  ORDER_STATUSES,
  type OrderStatus,
  type PaymentStatus,
  REFUNDABLE_ORDER_STATUSES,
  type ReviewDecision,
  STOCK_SHORT_DEADLINE_HOURS,
  holderOf,
} from "./domain";
import { notSellableLinesOf } from "./eligibility";
import { type RefundView, refundsOf } from "./refunds";
import {
  orderAddresses,
  orderContacts,
  orderEvents,
  orderLines,
  orderReviews,
  ordersTable,
  payments,
  refunds,
} from "./schema";
import { type ShipmentView, shipmentOf } from "./shipments";
import type { BasketLineView, DeliveryAddressView } from "./views";

/** Back-office order reads (`orders.read`). */

/** Status of the order's latest payment. The outer column is spelled out: drizzle leaves it
 * unqualified in a single-table select, where it would bind to `p.id`. */
const latestPaymentStatus = sql<string | null>`(
  SELECT p.status FROM ${payments} p
  WHERE p.order_id = ${sql.raw('"orders"."orders"."id"')}
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
)`;

/** When the order last became stock-short (its status history). */
const stockShortSince = sql<Date | null>`(
  SELECT max(e.at) FROM ${orderEvents} e
  WHERE e.order_id = ${sql.raw('"orders"."orders"."id"')} AND e.to_status = 'paid_stock_short'
)`;

const HOUR_MS = 3_600_000;

/** The moment before which a stock-short order is past its deadline. */
export const stockShortDeadline = (now: Date): Date =>
  new Date(now.getTime() - STOCK_SHORT_DEADLINE_HOURS * HOUR_MS);

export interface StockShortWaiting {
  /** Paid orders waiting because their stock was not held. */
  readonly waiting: number;
  /** Of those, the ones past `STOCK_SHORT_DEADLINE_HOURS`, oldest first (at most 50). */
  readonly overdue: readonly { readonly orderId: string; readonly since: Date }[];
  readonly overdueTotal: number;
}

/**
 * The stock-short orders and the ones past their deadline. Shared by the staff query and the
 * worker's alert, which reads with the runtime's own transaction (ids only).
 */
export async function stockShortWaiting(tx: Tx, now: Date): Promise<StockShortWaiting> {
  const [totals] = await tx
    .select({ waiting: count() })
    .from(ordersTable)
    .where(eq(ordersTable.status, "paid_stock_short"));
  const before = stockShortDeadline(now);
  const late = await tx
    .select({ orderId: ordersTable.id, since: stockShortSince })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.status, "paid_stock_short"),
        // a bare subquery has no column type to map a Date: pass the moment as text
        sql`${stockShortSince} <= ${before.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(stockShortSince), asc(ordersTable.id));
  const overdue = late.flatMap((row) =>
    row.since ? [{ orderId: row.orderId, since: new Date(row.since) }] : [],
  );
  return {
    waiting: totals?.waiting ?? 0,
    overdue: overdue.slice(0, 50),
    overdueTotal: overdue.length,
  };
}

/** The dashboard's count of stock-short orders, and how many are past the deadline. */
export const getStockShortSummary = query({
  name: "orders.order.stock_short_summary",
  input: z.object({}),
  permission: PERMISSIONS.orders.read,
  async handler({ ctx }): Promise<{ readonly waiting: number; readonly overdue: number }> {
    const { waiting, overdueTotal } = await stockShortWaiting(ctx.tx, ctx.now);
    return { waiting, overdue: overdueTotal };
  },
});

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
  /** The inventory holder of its stock (the checkout's): what staff look up when it is short. */
  readonly holderRef: string;
  /** While stock-short: since when, and whether past `STOCK_SHORT_DEADLINE_HOURS`. */
  readonly stockShort: { readonly since: Date; readonly overdue: boolean } | null;
  readonly locale: string;
  /** What the customer paid, the delivery fee included. */
  readonly totalCents: number;
  readonly vatCents: number;
  /** Collected at the pharmacy, or sent to `deliveryAddress` (igs-pharma#202). */
  readonly deliveryMethod: DeliveryMethod;
  /** Part of `totalCents`; 0 for a pickup order. */
  readonly deliveryFeeCents: number;
  readonly deliveryAddress: DeliveryAddressView | null;
  /** The parcel of a packed delivery order: its label, tracking, or why it failed (igs-pharma#202). */
  readonly shipment: ShipmentView | null;
  readonly createdAt: Date;
  readonly contact: {
    readonly name: string;
    readonly email: string;
    readonly phone: string;
  } | null;
  readonly lines: readonly BasketLineView[];
  /**
   * The products of an open order that are not sellable now (the eligibility recheck): the order can't
   * be approved, prepared or handed over, only cancelled and refunded. Empty for a closed order.
   */
  readonly notSellable: readonly string[];
  readonly paymentStatus: PaymentStatus | null;
  readonly refundDue: boolean;
  /**
   * Staff may refund it now: paid, closed or its parcel returned (`REFUNDABLE_ORDER_STATUSES`), and no
   * refund under way or done. Wider than `refundDue`, which flags only the ones that MUST be refunded.
   */
  readonly refundable: boolean;
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

/** Nothing more can be stopped: closed, or the goods left (collected, or handed to the carrier). */
const CLOSED_STATUSES: readonly OrderStatus[] = [...END_STATUSES, "shipped"];

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
        checkoutId: ordersTable.checkoutId,
        locale: ordersTable.locale,
        totalCents: ordersTable.totalCents,
        vatCents: ordersTable.vatCents,
        deliveryMethod: ordersTable.deliveryMethod,
        deliveryFeeCents: ordersTable.deliveryFeeCents,
        createdAt: ordersTable.createdAt,
        paymentStatus: latestPaymentStatus,
        refunding: activeRefund,
        stockShortSince,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, input.orderId));
    if (!order) throw notFound("orders.order_not_found");
    const [address] = await ctx.tx
      .select({
        street: orderAddresses.street,
        postalCode: orderAddresses.postalCode,
        city: orderAddresses.city,
        country: orderAddresses.country,
      })
      .from(orderAddresses)
      .where(eq(orderAddresses.orderId, order.id));
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
      holderRef: holderOf(order.checkoutId),
      stockShort:
        order.status === "paid_stock_short" && order.stockShortSince
          ? {
              since: new Date(order.stockShortSince),
              overdue: new Date(order.stockShortSince) <= stockShortDeadline(ctx.now),
            }
          : null,
      locale: order.locale,
      totalCents: order.totalCents,
      vatCents: order.vatCents,
      deliveryMethod: order.deliveryMethod === "delivery" ? "delivery" : "pickup",
      deliveryFeeCents: order.deliveryFeeCents,
      deliveryAddress: address ?? null,
      shipment: await shipmentOf(ctx, order.id),
      createdAt: order.createdAt,
      contact: contact ?? null,
      lines,
      notSellable: CLOSED_STATUSES.includes(order.status as OrderStatus)
        ? []
        : await notSellableLinesOf(ctx.tx, order.id),
      paymentStatus: order.paymentStatus as PaymentStatus | null,
      refundDue: isRefundDue(order.status, order.paymentStatus, order.refunding),
      refundable:
        (REFUNDABLE_ORDER_STATUSES as readonly string[]).includes(order.status) &&
        order.paymentStatus === "paid" &&
        !order.refunding,
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
