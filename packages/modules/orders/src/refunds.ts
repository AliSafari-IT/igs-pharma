import { type Ctx, command, conflict, defineEvent, forbidden, notFound, query } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import { ORDERS_AUDIT } from "./audit";
import {
  ACTIVE_REFUND_STATUSES,
  MINUTE_MS,
  ORDER_CURRENCY,
  REFUNDABLE_ORDER_STATUSES,
  REFUND_NOTE_MAX,
  REFUND_REASONS,
  type RefundReason,
  type RefundStatus,
} from "./domain";
import { requestOrderMail } from "./mails";
import { PAYMENTS_ACTOR } from "./payments";
import { ordersTable, payments, refunds } from "./schema";

/**
 * Refunds (igs-pharma#156). A refund starts as a record: `requestRefund` (staff) or a pharmacist's
 * rejection of a paid order writes it with its reason and publishes `orders.refund.requested` in the
 * same transaction. The provider is asked only by the worker (`executeRefund`, outside any
 * transaction, D-019): our refund id is the idempotency key, and a refund the provider already made
 * for it (found by its metadata) is taken instead of making a second one. Full refunds only.
 */

/** Ids only (D-020). */
export const RefundRequested = defineEvent(
  "orders.refund.requested",
  1,
  z.object({ refundId: z.uuid(), orderId: z.uuid() }),
);

/** Reasons staff choose; `pharmacist_rejected` comes with the review. */
export const STAFF_REFUND_REASONS = REFUND_REASONS.filter(
  (reason) => reason !== "pharmacist_rejected",
) as Exclude<RefundReason, "pharmacist_rejected">[];

type Order = typeof ordersTable.$inferSelect;

/** The order's latest payment when it is paid, else `null`. */
async function paidPaymentOf(ctx: Ctx, orderId: string) {
  const [payment] = await ctx.tx
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(1);
  return payment?.status === "paid" ? payment : null;
}

/**
 * Records a refund of the order's paid payment and asks the worker to execute it. The caller has
 * locked the order and moved it to a closed status. `null` when there is nothing to refund (no
 * paid payment, or a refund that is not failed already exists).
 */
export async function recordRefund(
  ctx: Ctx,
  order: Order,
  input: {
    readonly reason: RefundReason;
    readonly note?: string | undefined;
    readonly approvedById: string | null;
  },
): Promise<string | null> {
  const payment = await paidPaymentOf(ctx, order.id);
  if (!payment) return null;
  const [active] = await ctx.tx
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(eq(refunds.paymentId, payment.id), inArray(refunds.status, [...ACTIVE_REFUND_STATUSES])),
    );
  if (active) return null;
  const [row] = await ctx.tx
    .insert(refunds)
    .values({
      orderId: order.id,
      paymentId: payment.id,
      amountCents: payment.amountCents,
      currency: payment.currency,
      reason: input.reason,
      note: input.note ?? null,
      requestedByType: ctx.actor.type,
      requestedById: ctx.actor.id,
      approvedById: input.approvedById,
      requestedAt: ctx.now,
      updatedAt: ctx.now,
    })
    .returning({ id: refunds.id });
  if (!row) throw new Error("orders.refund_not_stored");
  await ctx.audit.record({
    action: ORDERS_AUDIT.refundRequested,
    entityType: "order",
    entityId: order.id,
    data: {
      orderId: order.id,
      refundId: row.id,
      paymentId: payment.id,
      reason: input.reason,
      amountCents: payment.amountCents,
      currency: payment.currency,
      approvedById: input.approvedById,
    },
  });
  await ctx.outbox.publish(RefundRequested, { refundId: row.id, orderId: order.id });
  await requestOrderMail(ctx, { orderId: order.id, kind: "refund_initiated", refundId: row.id });
  return row.id;
}

/**
 * Staff ask for the refund of a closed (cancelled or expired), paid order. An order that holds a
 * medicine needs a pharmacist (`orders.review.decide`), who is recorded as approving it.
 */
export const requestRefund = command({
  name: "orders.refund.request",
  input: z.object({
    orderId: z.uuid(),
    reason: z.enum(STAFF_REFUND_REASONS),
    /** Staff-only: not sent to the provider, not audited. */
    note: z.string().trim().min(1).max(REFUND_NOTE_MAX).optional(),
  }),
  output: z.object({ refundId: z.uuid(), orderId: z.uuid() }),
  permission: PERMISSIONS.orders.refundRequest,
  audit: "none",
  async handler({ input, ctx }) {
    const [order] = await ctx.tx
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, input.orderId))
      .for("update");
    if (!order) throw notFound("orders.order_not_found");
    const pharmacist = ctx.can(PERMISSIONS.orders.reviewDecide);
    if (order.needsReview && !pharmacist) throw forbidden("orders.refund_needs_pharmacist");
    if (!(REFUNDABLE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
      throw conflict("orders.order_not_refundable", { status: order.status });
    }
    if (!(await paidPaymentOf(ctx, order.id))) throw conflict("orders.order_not_refundable");
    const refundId = await recordRefund(ctx, order, {
      reason: input.reason,
      note: input.note,
      approvedById: order.needsReview ? ctx.actor.id : null,
    });
    if (!refundId) throw conflict("orders.refund_exists");
    return { refundId, orderId: order.id };
  },
});

// ── worker side ──────────────────────────────────────────────────────────────────────────────────

/** What the module needs from a payment provider to refund (Mollie's client fits it). */
export interface ProviderRefundView {
  readonly id: string;
  readonly status: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface RefundProvider {
  createRefund(
    paymentId: string,
    input: {
      readonly amountCents: number;
      readonly description: string;
      readonly metadata: Readonly<Record<string, string>>;
      readonly idempotencyKey: string;
    },
  ): Promise<ProviderRefundView>;
  getRefund(paymentId: string, refundId: string): Promise<ProviderRefundView>;
  listRefunds(paymentId: string): Promise<readonly ProviderRefundView[]>;
}

/** The provider's refund statuses, as ours. */
const FROM_PROVIDER: Readonly<Record<string, RefundStatus>> = {
  queued: "pending",
  pending: "pending",
  processing: "pending",
  refunded: "refunded",
  failed: "failed",
  canceled: "canceled",
};

const RANK: Record<RefundStatus, number> = {
  requested: 0,
  pending: 1,
  refunded: 2,
  failed: 2,
  canceled: 2,
};

const providerRefundId = z.string().regex(/^re_[A-Za-z0-9]{4,64}$/);

export interface RefundForExecution {
  readonly refundId: string;
  readonly orderId: string;
  readonly reference: string;
  readonly status: RefundStatus;
  readonly amountCents: number;
  readonly currency: string;
  readonly providerPaymentId: string | null;
  readonly providerRefundId: string | null;
}

export const getRefundForExecution = query({
  name: "orders.refund.for_execution",
  input: z.object({ refundId: z.uuid() }),
  permission: PERMISSIONS.orders.paymentManage,
  async handler({ input, ctx }): Promise<RefundForExecution> {
    const [row] = await ctx.tx
      .select({
        refundId: refunds.id,
        orderId: refunds.orderId,
        reference: ordersTable.reference,
        status: refunds.status,
        amountCents: refunds.amountCents,
        currency: refunds.currency,
        providerPaymentId: payments.providerPaymentId,
        providerRefundId: refunds.providerRefundId,
      })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .innerJoin(ordersTable, eq(ordersTable.id, refunds.orderId))
      .where(eq(refunds.id, input.refundId));
    if (!row) throw notFound("orders.refund_not_found");
    return { ...row, status: row.status as RefundStatus };
  },
});

/** Refunds still `requested` or `pending` and quiet for `quietMinutes`: the reconciliation re-runs them. */
export const listUnsettledRefunds = query({
  name: "orders.refund.list_unsettled",
  input: z.object({
    quietMinutes: z.number().int().min(1).max(1440),
    limit: z.number().int().min(1).max(200),
  }),
  permission: PERMISSIONS.orders.paymentManage,
  async handler({ input, ctx }): Promise<readonly string[]> {
    const before = new Date(ctx.now.getTime() - input.quietMinutes * MINUTE_MS);
    const rows = await ctx.tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(and(inArray(refunds.status, ["requested", "pending"]), lte(refunds.updatedAt, before)))
      .orderBy(asc(refunds.updatedAt))
      .limit(input.limit);
    return rows.map((row) => row.id);
  },
});

/**
 * Records what the provider said about a refund: its refund (id and status), or a refusal (the
 * refund failed and was never made). Forward only; a repeat changes nothing and is not audited.
 */
export const recordRefundStatus = command({
  name: "orders.refund.record_status",
  input: z.object({
    refundId: z.uuid(),
    outcome: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("provider"),
        providerRefundId,
        status: z.enum(Object.keys(FROM_PROVIDER) as [string, ...string[]]),
        amountCents: z.number().int().min(1),
        currency: z.string().length(3),
      }),
      z.object({ kind: z.literal("refused"), code: z.string().regex(/^[a-z0-9_]{1,40}$/) }),
    ]),
  }),
  output: z.object({ refundId: z.uuid(), status: z.string(), changed: z.boolean() }),
  permission: PERMISSIONS.orders.paymentManage,
  audit: "none",
  async handler({ input, ctx }) {
    const [refund] = await ctx.tx
      .select()
      .from(refunds)
      .where(eq(refunds.id, input.refundId))
      .for("update");
    if (!refund) throw notFound("orders.refund_not_found");
    const from = refund.status as RefundStatus;
    const { outcome } = input;
    const unchanged = { refundId: refund.id, status: from, changed: false };
    if (RANK[from] === 2) return unchanged;
    // the first answer of the provider: its refund id, and when it accepted it
    const firstAnswer = outcome.kind === "provider" && refund.providerRefundId === null;
    let status: RefundStatus;
    if (outcome.kind === "refused") {
      // a refusal only ends a refund the provider never made
      if (from !== "requested") return unchanged;
      status = "failed";
    } else {
      if (
        refund.providerRefundId !== null &&
        refund.providerRefundId !== outcome.providerRefundId
      ) {
        throw conflict("orders.refund_provider_mismatch");
      }
      if (outcome.amountCents !== refund.amountCents || outcome.currency !== ORDER_CURRENCY) {
        throw conflict("orders.refund_amount_mismatch");
      }
      const to = FROM_PROVIDER[outcome.status] ?? from;
      status = RANK[to] > RANK[from] ? to : from;
      if (status === from && !firstAnswer) return unchanged;
    }
    await ctx.tx
      .update(refunds)
      .set({
        status,
        ...(outcome.kind === "provider"
          ? { providerRefundId: outcome.providerRefundId }
          : { failureCode: outcome.code }),
        ...(firstAnswer ? { submittedAt: ctx.now } : {}),
        ...(RANK[status] === 2 ? { settledAt: ctx.now } : {}),
        updatedAt: ctx.now,
      })
      .where(eq(refunds.id, refund.id));
    await ctx.audit.record({
      action: ORDERS_AUDIT.refundStatusRecorded,
      entityType: "order",
      entityId: refund.orderId,
      data: {
        orderId: refund.orderId,
        refundId: refund.id,
        status,
        amountCents: refund.amountCents,
        currency: refund.currency,
        providerRefundId:
          outcome.kind === "provider" ? outcome.providerRefundId : refund.providerRefundId,
        failureCode: outcome.kind === "refused" ? outcome.code : null,
      },
    });
    if (status === "refunded") {
      await requestOrderMail(ctx, {
        orderId: refund.orderId,
        kind: "refund_completed",
        refundId: refund.id,
      });
    }
    return { refundId: refund.id, status, changed: true };
  },
});

/**
 * A refusal the provider will repeat (a 4xx other than a timeout or rate limit): the refund failed.
 * Anything else (the network, a 5xx) is thrown again so the job retries.
 */
function refusalCode(error: unknown): string | null {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number" || status < 400 || status >= 500) return null;
  if (status === 408 || status === 429) return null;
  return status === 404 ? "provider_not_found" : "provider_refused";
}

/**
 * Asks the provider for a requested refund, or re-reads a pending one, and records the answer.
 * Idempotent: a refund the provider already made for our id is found (its metadata) and taken; the
 * create call also carries our id as its idempotency key. Safe to run any number of times.
 */
export async function executeRefund(refundId: string, provider: RefundProvider) {
  const refund = await getRefundForExecution({ refundId }, PAYMENTS_ACTOR);
  const providerPaymentId = refund.providerPaymentId;
  if (RANK[refund.status] === 2 || !providerPaymentId) {
    return { refundId, status: refund.status, changed: false };
  }
  let made: ProviderRefundView;
  try {
    if (refund.providerRefundId) {
      made = await provider.getRefund(providerPaymentId, refund.providerRefundId);
    } else {
      const existing = (await provider.listRefunds(providerPaymentId)).find(
        (candidate) => candidate.metadata["refundId"] === refund.refundId,
      );
      made =
        existing ??
        (await provider.createRefund(providerPaymentId, {
          amountCents: refund.amountCents,
          // what the customer sees on their statement: the order reference only
          description: `IGS-Pharma ${refund.reference}`,
          metadata: { refundId: refund.refundId, orderId: refund.orderId },
          idempotencyKey: refund.refundId,
        }));
    }
  } catch (error) {
    const code = refusalCode(error);
    if (!code || refund.providerRefundId) throw error;
    return recordRefundStatus({ refundId, outcome: { kind: "refused", code } }, PAYMENTS_ACTOR);
  }
  return recordRefundStatus(
    {
      refundId,
      outcome: {
        kind: "provider",
        providerRefundId: made.id,
        status: made.status,
        amountCents: made.amountCents,
        currency: made.currency,
      },
    },
    PAYMENTS_ACTOR,
  );
}

// ── staff read ───────────────────────────────────────────────────────────────────────────────────

export interface RefundView {
  readonly refundId: string;
  readonly status: RefundStatus;
  readonly reason: RefundReason;
  readonly note: string | null;
  readonly amountCents: number;
  readonly requestedByType: string;
  readonly requestedById: string;
  readonly approvedById: string | null;
  readonly providerRefundId: string | null;
  readonly failureCode: string | null;
  readonly requestedAt: Date;
  readonly settledAt: Date | null;
}

/** An order's refunds, newest first (for `getOrderForStaff`). */
export async function refundsOf(ctx: { readonly tx: Ctx["tx"] }, orderId: string) {
  const rows = await ctx.tx
    .select({
      refundId: refunds.id,
      status: refunds.status,
      reason: refunds.reason,
      note: refunds.note,
      amountCents: refunds.amountCents,
      requestedByType: refunds.requestedByType,
      requestedById: refunds.requestedById,
      approvedById: refunds.approvedById,
      providerRefundId: refunds.providerRefundId,
      failureCode: refunds.failureCode,
      requestedAt: refunds.requestedAt,
      settledAt: refunds.settledAt,
    })
    .from(refunds)
    .where(eq(refunds.orderId, orderId))
    .orderBy(desc(refunds.requestedAt), desc(refunds.id));
  return rows.map(
    (row): RefundView => ({
      ...row,
      status: row.status as RefundStatus,
      reason: row.reason as RefundReason,
    }),
  );
}
