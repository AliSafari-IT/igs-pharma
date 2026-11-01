import { sha256Hex } from "@igs/crypto";
import { notFound, query } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { cartToken, ownerOf } from "./cart";
import type { DeliveryMethod } from "./delivery-domain";
import type { CheckoutStatus, OrderStatus, PaymentStatus } from "./domain";
import {
  checkoutLines,
  checkouts,
  orderAddresses,
  orderLines,
  ordersTable,
  payments,
} from "./schema";

/**
 * What the storefront shows of a checkout and of an order (igs-pharma#116, Sprint 3 E2), to their
 * owner only. A checkout or order of someone else, or one that does not exist, is the same
 * `not_found`. Whose it is follows the cart (`ownerOf`): a signed-in customer's by user id, a
 * guest's by the hash of the cart cookie it was started with. No contact data is returned.
 */

export interface BasketLineView {
  readonly productId: string;
  readonly cnk: string;
  readonly name: string;
  readonly isMedicine: boolean;
  readonly quantity: number;
  /** VAT included. */
  readonly unitPriceCents: number;
  readonly lineTotalCents: number;
}

export interface CheckoutView {
  readonly checkoutId: string;
  readonly status: CheckoutStatus;
  readonly locale: string;
  /** When the stock holds lapse; `expired` says whether that moment has passed. */
  readonly expiresAt: Date;
  readonly expired: boolean;
  readonly needsReview: boolean;
  readonly totalCents: number;
  readonly vatCents: number;
  readonly lines: readonly BasketLineView[];
  /** The order placed from it, once `placed`. */
  readonly orderId: string | null;
}

const lineColumns = {
  productId: checkoutLines.productId,
  cnk: checkoutLines.cnk,
  name: checkoutLines.name,
  isMedicine: checkoutLines.isMedicine,
  quantity: checkoutLines.quantity,
  unitPriceCents: checkoutLines.unitPriceCents,
  lineTotalCents: checkoutLines.lineTotalCents,
};

export const getCheckout = query({
  name: "orders.checkout.get",
  input: z.object({ cartToken: cartToken.optional(), checkoutId: z.uuid() }),
  permission: "public",
  async handler({ input, ctx }): Promise<CheckoutView> {
    const owner = ownerOf(ctx, input.cartToken);
    if (!owner) throw notFound("orders.checkout_not_found");
    const [checkout] = await ctx.tx
      .select()
      .from(checkouts)
      .where(
        and(
          eq(checkouts.id, input.checkoutId),
          "customerId" in owner
            ? eq(checkouts.customerId, owner.customerId)
            : eq(checkouts.tokenHash, owner.tokenHash),
        ),
      );
    if (!checkout) throw notFound("orders.checkout_not_found");
    const lines = await ctx.tx
      .select(lineColumns)
      .from(checkoutLines)
      .where(eq(checkoutLines.checkoutId, checkout.id))
      .orderBy(asc(checkoutLines.position));
    const [order] =
      checkout.status === "placed"
        ? await ctx.tx
            .select({ id: ordersTable.id })
            .from(ordersTable)
            .where(eq(ordersTable.checkoutId, checkout.id))
        : [];
    return {
      checkoutId: checkout.id,
      status: checkout.status as CheckoutStatus,
      locale: checkout.locale,
      expiresAt: checkout.expiresAt,
      expired: checkout.expiresAt.getTime() <= ctx.now.getTime(),
      needsReview: checkout.needsReview,
      totalCents: checkout.totalCents,
      vatCents: checkout.vatCents,
      lines,
      orderId: order?.id ?? null,
    };
  },
});

/** Where a home-delivery order goes (igs-pharma#202). */
export interface DeliveryAddressView {
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  readonly country: string;
}

export interface OrderView {
  readonly orderId: string;
  readonly reference: string;
  readonly status: OrderStatus;
  readonly needsReview: boolean;
  /** What the customer paid, the delivery fee included. */
  readonly totalCents: number;
  readonly vatCents: number;
  /** Collected at the pharmacy, or sent to `deliveryAddress`. */
  readonly deliveryMethod: DeliveryMethod;
  /** What delivery cost, VAT included, and part of `totalCents`; 0 for a pickup order. */
  readonly deliveryFeeCents: number;
  readonly deliveryAddress: DeliveryAddressView | null;
  readonly createdAt: Date;
  readonly lines: readonly BasketLineView[];
  /** The latest payment's status, `null` when there is none. */
  readonly paymentStatus: PaymentStatus | null;
}

export const getOrder = query({
  name: "orders.order.get",
  input: z.object({
    cartToken: cartToken.optional(),
    /** The order's status link token (`?t=`): opens it without the cart cookie. */
    statusToken: cartToken.optional(),
    orderId: z.uuid(),
  }),
  permission: "public",
  async handler({ input, ctx }): Promise<OrderView> {
    const owner = ownerOf(ctx, input.cartToken);
    if (!owner && !input.statusToken) throw notFound("orders.order_not_found");
    const [order] = await ctx.tx
      .select({
        id: ordersTable.id,
        reference: ordersTable.reference,
        status: ordersTable.status,
        needsReview: ordersTable.needsReview,
        totalCents: ordersTable.totalCents,
        vatCents: ordersTable.vatCents,
        deliveryMethod: ordersTable.deliveryMethod,
        deliveryFeeCents: ordersTable.deliveryFeeCents,
        createdAt: ordersTable.createdAt,
        customerId: ordersTable.customerId,
        statusTokenHash: ordersTable.statusTokenHash,
        tokenHash: checkouts.tokenHash,
      })
      .from(ordersTable)
      // a guest order is theirs through the checkout it was placed from (same cart cookie)
      .leftJoin(checkouts, eq(checkouts.id, ordersTable.checkoutId))
      .where(eq(ordersTable.id, input.orderId));
    const byLink =
      input.statusToken !== undefined &&
      order?.statusTokenHash != null &&
      order.statusTokenHash === sha256Hex(input.statusToken);
    const owns =
      order !== undefined &&
      (byLink ||
        (owner !== undefined &&
          ("customerId" in owner
            ? order.customerId === owner.customerId
            : order.customerId === null && order.tokenHash === owner.tokenHash)));
    if (!order || !owns) throw notFound("orders.order_not_found");

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
    const [payment] = await ctx.tx
      .select({ status: payments.status })
      .from(payments)
      .where(eq(payments.orderId, order.id))
      // the latest attempt decides (retries add rows); the id (UUIDv7) breaks a same-instant tie
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(1);
    const [address] = await ctx.tx
      .select({
        street: orderAddresses.street,
        postalCode: orderAddresses.postalCode,
        city: orderAddresses.city,
        country: orderAddresses.country,
      })
      .from(orderAddresses)
      .where(eq(orderAddresses.orderId, order.id));
    return {
      orderId: order.id,
      reference: order.reference,
      status: order.status as OrderStatus,
      needsReview: order.needsReview,
      totalCents: order.totalCents,
      vatCents: order.vatCents,
      deliveryMethod: order.deliveryMethod === "delivery" ? "delivery" : "pickup",
      deliveryFeeCents: order.deliveryFeeCents,
      deliveryAddress: address ?? null,
      createdAt: order.createdAt,
      lines,
      paymentStatus: (payment?.status as PaymentStatus | undefined) ?? null,
    };
  },
});

export interface OwnOrderListItem {
  readonly orderId: string;
  readonly reference: string;
  readonly status: OrderStatus;
  readonly totalCents: number;
  readonly createdAt: Date;
  readonly paymentStatus: PaymentStatus | null;
}

export interface OwnOrderPage {
  readonly items: readonly OwnOrderListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** A signed-in customer's own orders, newest first. Guests have no list (their link opens one order). */
export const listOwnOrders = query({
  name: "orders.order.list_own",
  input: z.object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  }),
  permission: PERMISSIONS.orders.readOwn,
  async handler({ input, ctx }): Promise<OwnOrderPage> {
    const owner = ownerOf(ctx, undefined);
    if (!owner || !("customerId" in owner)) throw notFound("orders.order_not_found");
    const mine = eq(ordersTable.customerId, owner.customerId);
    const rows = await ctx.tx
      .select({
        orderId: ordersTable.id,
        reference: ordersTable.reference,
        status: ordersTable.status,
        totalCents: ordersTable.totalCents,
        createdAt: ordersTable.createdAt,
        paymentStatus: sql<string | null>`(
          SELECT p.status FROM ${payments} p
          WHERE p.order_id = ${sql.raw('"orders"."orders"."id"')}
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT 1
        )`,
      })
      .from(ordersTable)
      .where(mine)
      .orderBy(desc(ordersTable.createdAt), desc(ordersTable.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    const [counted] = await ctx.tx.select({ n: count() }).from(ordersTable).where(mine);
    return {
      items: rows.map((row) => ({
        ...row,
        status: row.status as OrderStatus,
        paymentStatus: row.paymentStatus as PaymentStatus | null,
      })),
      total: counted?.n ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    };
  },
});
