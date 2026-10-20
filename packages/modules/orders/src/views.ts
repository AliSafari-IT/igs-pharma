import { notFound, query } from "@igs/kernel";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { cartToken, ownerOf } from "./cart";
import type { CheckoutStatus, OrderStatus, PaymentStatus } from "./domain";
import { checkoutLines, checkouts, orderLines, ordersTable, payments } from "./schema";

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

export interface OrderView {
  readonly orderId: string;
  readonly reference: string;
  readonly status: OrderStatus;
  readonly needsReview: boolean;
  readonly totalCents: number;
  readonly vatCents: number;
  readonly createdAt: Date;
  readonly lines: readonly BasketLineView[];
  /** The latest payment's status, `null` when there is none. */
  readonly paymentStatus: PaymentStatus | null;
}

export const getOrder = query({
  name: "orders.order.get",
  input: z.object({ cartToken: cartToken.optional(), orderId: z.uuid() }),
  permission: "public",
  async handler({ input, ctx }): Promise<OrderView> {
    const owner = ownerOf(ctx, input.cartToken);
    if (!owner) throw notFound("orders.order_not_found");
    const [order] = await ctx.tx
      .select({
        id: ordersTable.id,
        reference: ordersTable.reference,
        status: ordersTable.status,
        needsReview: ordersTable.needsReview,
        totalCents: ordersTable.totalCents,
        vatCents: ordersTable.vatCents,
        createdAt: ordersTable.createdAt,
        customerId: ordersTable.customerId,
        tokenHash: checkouts.tokenHash,
      })
      .from(ordersTable)
      // a guest order is theirs through the checkout it was placed from (same cart cookie)
      .leftJoin(checkouts, eq(checkouts.id, ordersTable.checkoutId))
      .where(eq(ordersTable.id, input.orderId));
    const owns =
      order !== undefined &&
      ("customerId" in owner
        ? order.customerId === owner.customerId
        : order.customerId === null && order.tokenHash === owner.tokenHash);
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
    return {
      orderId: order.id,
      reference: order.reference,
      status: order.status as OrderStatus,
      needsReview: order.needsReview,
      totalCents: order.totalCents,
      vatCents: order.vatCents,
      createdAt: order.createdAt,
      lines,
      paymentStatus: (payment?.status as PaymentStatus | undefined) ?? null,
    };
  },
});
