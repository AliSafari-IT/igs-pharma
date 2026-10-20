import {
  type Actor,
  type Ctx,
  command,
  conflict,
  isDomainError,
  notFound,
  query,
} from "@igs/kernel";
import { confirmReservation, releaseReservation } from "@igs/module-inventory";
import { PERMISSIONS } from "@igs/rbac";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import { ORDERS_AUDIT } from "./audit";
import {
  DAY_MS,
  MINUTE_MS,
  ORDER_CURRENCY,
  type OrderLocale,
  type OrderStatus,
  PAYMENT_STATUSES,
  type PaymentStatus,
} from "./domain";
import { carts, checkouts, orderLines, ordersTable, payments } from "./schema";

/**
 * Paying for an order (igs-pharma#116, D-045 steps 4–5). Mollie is reached only OUTSIDE the commands
 * (D-019): the orchestration functions below call the provider and then a command, so a crash in
 * between leaves a state the next call (or the reconciliation job) picks up again.
 *
 * - `startPayment`: the shopper's "Pay now". Creates the provider payment for the order's `created`
 *   payment (our payment id is the idempotency key, so a retry never makes a second one) and returns
 *   where to pay; an open payment returns its existing link.
 * - `syncPayment`: the webhook and the return from the payment page. Fetches the provider's payment
 *   (the only thing trusted) and records its status.
 * - `recordPaymentStatus` (command): forward-only. `paid` confirms the checkout's stock holds and
 *   moves the order to `in_review` (a medicine) or `ready_to_prepare`, or to `paid_stock_short`
 *   when the holds lapsed; `failed` / `canceled` / `expired` cancel the order and give the stock back.
 *
 * The provider is a PORT (`PaymentProvider`): the module never imports the Mollie client, the apps
 * pass it in. Every call runs as `system_payments` (`orders.payment.manage`, system-only); the route
 * checks first that the shopper owns the order.
 */

/** What the module needs from a payment provider (Mollie's client in `@igs/payments` fits it). */
export interface ProviderPaymentView {
  readonly id: string;
  readonly status: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly checkoutUrl: string | null;
}

export interface PaymentProvider {
  createPayment(input: {
    readonly amountCents: number;
    readonly description: string;
    readonly redirectUrl: string;
    readonly webhookUrl?: string | undefined;
    readonly locale: OrderLocale;
    readonly metadata: Readonly<Record<string, string>>;
    readonly idempotencyKey: string;
  }): Promise<ProviderPaymentView>;
  getPayment(id: string): Promise<ProviderPaymentView>;
}

/** Where the shopper comes back to, and where the provider calls. */
export interface PaymentUrls {
  /** The storefront's public origin, e.g. `https://igs-pharma.be`. */
  readonly storefrontUrl: string;
  /** The public https origin of the webhook; unset: no webhook (reconciliation reads the status). */
  readonly webhookBaseUrl?: string | undefined;
}

export const WEBHOOK_PATH = "/api/webhooks/mollie";

/** The actor of every payment step: a system role no person can hold. */
export const PAYMENTS_ACTOR: Actor = { type: "system", id: "payments", roles: ["system_payments"] };
/** The same rights, recorded as the provider's webhook. */
export const PAYMENT_WEBHOOK_ACTOR: Actor = {
  type: "webhook",
  id: "mollie",
  roles: ["system_payments"],
};

/** How far along a payment is; a status only ever moves to a higher rank, and an end state stays. */
const RANK: Record<PaymentStatus, number> = {
  created: 0,
  open: 1,
  pending: 2,
  authorized: 3,
  paid: 4,
  failed: 4,
  canceled: 4,
  expired: 4,
};
const isEnd = (status: PaymentStatus) => RANK[status] === 4;
const isForward = (from: PaymentStatus, to: PaymentStatus) => !isEnd(from) && RANK[to] > RANK[from];

const providerStatus = z.enum(
  PAYMENT_STATUSES.filter((s) => s !== "created") as [string, ...string[]],
);
const providerPaymentId = z.string().regex(/^tr_[A-Za-z0-9]{4,64}$/);

const holderOf = (checkoutId: string) => `checkout:${checkoutId}`;

// ── read ─────────────────────────────────────────────────────────────────────────────────────────

export interface OrderPayment {
  readonly paymentId: string;
  readonly orderId: string;
  readonly reference: string;
  readonly locale: OrderLocale;
  readonly orderStatus: OrderStatus;
  readonly amountCents: number;
  readonly status: PaymentStatus;
  readonly providerPaymentId: string | null;
  readonly checkoutUrl: string | null;
}

/** The order's latest payment (system only: the route checks the shopper's ownership first). */
export const getOrderPayment = query({
  name: "orders.payment.for_order",
  input: z.object({ orderId: z.uuid() }),
  permission: PERMISSIONS.orders.paymentManage,
  async handler({ input, ctx }): Promise<OrderPayment> {
    const [row] = await ctx.tx
      .select({
        paymentId: payments.id,
        orderId: ordersTable.id,
        reference: ordersTable.reference,
        locale: ordersTable.locale,
        orderStatus: ordersTable.status,
        amountCents: payments.amountCents,
        status: payments.status,
        providerPaymentId: payments.providerPaymentId,
        checkoutUrl: payments.checkoutUrl,
      })
      .from(payments)
      .innerJoin(ordersTable, eq(ordersTable.id, payments.orderId))
      .where(eq(payments.orderId, input.orderId))
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(1);
    if (!row) throw notFound("orders.payment_not_found");
    return {
      ...row,
      locale: row.locale as OrderLocale,
      orderStatus: row.orderStatus as OrderStatus,
      status: row.status as PaymentStatus,
    };
  },
});

/** Provider payments still in progress and quiet for `quietMinutes`: the reconciliation re-reads them. */
export const listUnsettledPayments = query({
  name: "orders.payment.list_unsettled",
  input: z.object({
    quietMinutes: z.number().int().min(1).max(1440),
    limit: z.number().int().min(1).max(200),
  }),
  permission: PERMISSIONS.orders.paymentManage,
  async handler({ input, ctx }): Promise<readonly string[]> {
    const before = new Date(ctx.now.getTime() - input.quietMinutes * MINUTE_MS);
    const rows = await ctx.tx
      .select({ id: payments.providerPaymentId })
      .from(payments)
      .where(
        and(
          inArray(payments.status, ["open", "pending", "authorized"]),
          lte(payments.updatedAt, before),
        ),
      )
      .orderBy(asc(payments.updatedAt))
      .limit(input.limit);
    return rows.flatMap((row) => (row.id ? [row.id] : []));
  },
});

// ── attach ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Links the provider's payment to ours: its id, where the shopper pays, and its first status. Our
 * payment id was the idempotency key, so attaching the same provider payment again changes nothing;
 * a different one is refused (`orders.payment_provider_mismatch`).
 */
export const attachProviderPayment = command({
  name: "orders.payment.attach_provider",
  input: z.object({
    paymentId: z.uuid(),
    providerPaymentId,
    checkoutUrl: z.string().url().startsWith("https://").nullable(),
    status: providerStatus,
  }),
  output: z.object({ paymentId: z.uuid(), status: z.string() }),
  permission: PERMISSIONS.orders.paymentManage,
  audit: "none",
  async handler({ input, ctx }) {
    const [payment] = await ctx.tx
      .select()
      .from(payments)
      .where(eq(payments.id, input.paymentId))
      .for("update");
    if (!payment) throw notFound("orders.payment_not_found");
    if (payment.providerPaymentId !== null) {
      if (payment.providerPaymentId !== input.providerPaymentId) {
        throw conflict("orders.payment_provider_mismatch");
      }
      return { paymentId: payment.id, status: payment.status };
    }
    const from = payment.status as PaymentStatus;
    const to = input.status as PaymentStatus;
    const status = isForward(from, to) ? to : from;
    await ctx.tx
      .update(payments)
      .set({
        providerPaymentId: input.providerPaymentId,
        checkoutUrl: input.checkoutUrl,
        status,
        updatedAt: ctx.now,
      })
      .where(eq(payments.id, payment.id));
    await ctx.audit.record({
      action: ORDERS_AUDIT.paymentAttached,
      entityType: "order",
      entityId: payment.orderId,
      data: { paymentId: payment.id, orderId: payment.orderId, status },
    });
    return { paymentId: payment.id, status };
  },
});

// ── record ───────────────────────────────────────────────────────────────────────────────────────

/** The order's next status once its payment settled, and whether the stock holds are still ours. */
async function settleOrder(
  ctx: Ctx,
  order: typeof ordersTable.$inferSelect,
  status: PaymentStatus,
): Promise<OrderStatus> {
  const holderRef = holderOf(order.checkoutId);
  if (status === "paid") {
    const items = await ctx.tx
      .select({ productId: orderLines.productId, quantity: orderLines.quantity })
      .from(orderLines)
      .where(eq(orderLines.orderId, order.id))
      .orderBy(asc(orderLines.productId));
    try {
      await ctx.run(confirmReservation, { holderRef, items });
    } catch (error) {
      // refused before it wrote anything: the holds lapsed (or were given back) while the shopper paid.
      // Never charge silently for stock we may not have: staff re-reserve or refund (#116).
      const lapsed = [
        "inventory.reservation_expired",
        "inventory.reservation_mismatch",
        "inventory.reservation_not_found",
      ];
      if (!isDomainError(error) || !lapsed.includes(error.code)) throw error;
      return "paid_stock_short";
    }
    await clearCartOf(ctx, order.checkoutId);
    return order.needsReview ? "in_review" : "ready_to_prepare";
  }
  // failed, canceled, expired: the stock goes back; the cart stays for another try
  await ctx.run(releaseReservation, { holderRef, reason: "checkout_cancelled" });
  return "cancelled";
}

/** A paid order empties the cart it came from (a guest's by its cookie hash, a customer's by id). */
async function clearCartOf(ctx: Ctx, checkoutId: string): Promise<void> {
  const [checkout] = await ctx.tx
    .select({ customerId: checkouts.customerId, tokenHash: checkouts.tokenHash })
    .from(checkouts)
    .where(eq(checkouts.id, checkoutId));
  if (!checkout) return;
  if (checkout.customerId) {
    await ctx.tx.delete(carts).where(eq(carts.customerId, checkout.customerId));
  } else if (checkout.tokenHash) {
    await ctx.tx.delete(carts).where(eq(carts.tokenHash, checkout.tokenHash));
  }
}

/**
 * Records what the provider says about a payment (fetched by us, never taken from a caller). Only
 * forward: an older or equal status changes nothing (webhooks arrive late, twice, or out of order).
 * A `paid` amount that is not the order's is refused (`orders.payment_amount_mismatch`) and nothing
 * moves. The order moves only while it waits for payment (`pending_payment`).
 */
export const recordPaymentStatus = command({
  name: "orders.payment.record_status",
  input: z.object({
    providerPaymentId,
    status: providerStatus,
    amountCents: z.number().int().min(1),
    currency: z.string().length(3),
  }),
  output: z.object({
    paymentId: z.uuid(),
    orderId: z.uuid(),
    paymentStatus: z.string(),
    orderStatus: z.string(),
    changed: z.boolean(),
  }),
  permission: PERMISSIONS.orders.paymentManage,
  // audits only when something changed: a repeated webhook is not a change
  audit: "none",
  async handler({ input, ctx }) {
    const [payment] = await ctx.tx
      .select()
      .from(payments)
      .where(eq(payments.providerPaymentId, input.providerPaymentId))
      .for("update");
    if (!payment) throw notFound("orders.payment_not_found");
    const [order] = await ctx.tx
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, payment.orderId))
      .for("update");
    if (!order) throw notFound("orders.order_not_found");

    const from = payment.status as PaymentStatus;
    const to = input.status as PaymentStatus;
    const unchanged = {
      paymentId: payment.id,
      orderId: order.id,
      paymentStatus: from,
      orderStatus: order.status,
      changed: false,
    };
    if (!isForward(from, to)) return unchanged;
    if (
      to === "paid" &&
      (input.amountCents !== payment.amountCents || input.currency !== ORDER_CURRENCY)
    ) {
      throw conflict("orders.payment_amount_mismatch");
    }

    await ctx.tx
      .update(payments)
      .set({ status: to, updatedAt: ctx.now })
      .where(eq(payments.id, payment.id));

    let orderStatus = order.status as OrderStatus;
    if (order.status === "pending_payment" && isEnd(to)) {
      orderStatus = await settleOrder(ctx, order, to);
      await ctx.tx
        .update(ordersTable)
        .set({
          status: orderStatus,
          version: order.version + 1,
          updatedByType: ctx.actor.type,
          updatedById: ctx.actor.id,
          updatedAt: ctx.now,
        })
        .where(eq(ordersTable.id, order.id));
    }
    await ctx.audit.record({
      action: ORDERS_AUDIT.paymentStatusRecorded,
      entityType: "order",
      entityId: order.id,
      data: { paymentId: payment.id, orderId: order.id, status: to, orderStatus },
    });
    return { ...unchanged, paymentStatus: to, orderStatus, changed: true };
  },
});

// ── expire ───────────────────────────────────────────────────────────────────────────────────────

/** Orders never paid stay `pending_payment` this long, then expire (#116: 24 h). */
export const UNPAID_ORDER_HOURS = 24;
const EXPIRY_BATCH = 50;

/**
 * Expires the orders still waiting for payment `UNPAID_ORDER_HOURS` after they were placed, a batch at
 * a time, and gives their stock back (their holds have long lapsed; releasing is then a no-op).
 */
export const expireUnpaidOrders = command({
  name: "orders.order.expire_unpaid",
  input: z.object({}),
  output: z.object({ expired: z.number().int() }),
  permission: PERMISSIONS.orders.paymentManage,
  audit: "none",
  async handler({ ctx }) {
    const before = new Date(ctx.now.getTime() - (UNPAID_ORDER_HOURS * DAY_MS) / 24);
    const due = await ctx.tx
      .select()
      .from(ordersTable)
      .where(and(eq(ordersTable.status, "pending_payment"), lte(ordersTable.createdAt, before)))
      .orderBy(asc(ordersTable.createdAt))
      .limit(EXPIRY_BATCH)
      .for("update", { skipLocked: true });
    for (const order of due) {
      await ctx.run(releaseReservation, {
        holderRef: holderOf(order.checkoutId),
        reason: "checkout_cancelled",
      });
      await ctx.tx
        .update(ordersTable)
        .set({
          status: "expired",
          version: order.version + 1,
          updatedByType: ctx.actor.type,
          updatedById: ctx.actor.id,
          updatedAt: ctx.now,
        })
        .where(eq(ordersTable.id, order.id));
      await ctx.audit.record({
        action: ORDERS_AUDIT.orderExpired,
        entityType: "order",
        entityId: order.id,
        data: { orderId: order.id },
      });
    }
    return { expired: due.length };
  },
});

// ── orchestration (outside any transaction, D-019) ───────────────────────────────────────────────

/** "Pay now": where to send the shopper, or `null` when the order no longer waits for payment. */
export async function startPayment(
  orderId: string,
  provider: PaymentProvider,
  urls: PaymentUrls,
): Promise<string | null> {
  const payment = await getOrderPayment({ orderId }, PAYMENTS_ACTOR);
  if (payment.orderStatus !== "pending_payment") return null;
  if (payment.providerPaymentId) {
    return payment.status === "open" && payment.checkoutUrl ? payment.checkoutUrl : null;
  }
  const created = await provider.createPayment({
    amountCents: payment.amountCents,
    // what the shopper sees on the payment page and their bank statement: the reference only
    description: `IGS-Pharma ${payment.reference}`,
    redirectUrl: `${urls.storefrontUrl}/${payment.locale}/orders/${orderId}`,
    webhookUrl: urls.webhookBaseUrl ? `${urls.webhookBaseUrl}${WEBHOOK_PATH}` : undefined,
    locale: payment.locale,
    metadata: { orderId, paymentId: payment.paymentId },
    idempotencyKey: payment.paymentId,
  });
  await attachProviderPayment(
    {
      paymentId: payment.paymentId,
      providerPaymentId: created.id,
      checkoutUrl: created.checkoutUrl,
      status: created.status,
    },
    PAYMENTS_ACTOR,
  );
  return created.status === "open" ? created.checkoutUrl : null;
}

/** Re-reads a provider payment and records its status (the webhook, the return page, reconciliation). */
export async function syncPayment(
  providerPaymentIdValue: string,
  provider: PaymentProvider,
  actor: Actor = PAYMENTS_ACTOR,
) {
  const fetched = await provider.getPayment(providerPaymentIdValue);
  return recordPaymentStatus(
    {
      providerPaymentId: fetched.id,
      status: fetched.status,
      amountCents: fetched.amountCents,
      currency: fetched.currency,
    },
    actor,
  );
}
