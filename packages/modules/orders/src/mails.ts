import {
  type Ctx,
  type KernelRuntime,
  type OutboxEnvelope,
  assertQueuesExist,
  defineEvent,
  getKernelRuntime,
} from "@igs/kernel";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { ORDER_MAIL_KINDS, type OrderMailKind } from "./domain";
import { orderContacts, orderMails, ordersTable, refunds, shipments } from "./schema";

/**
 * Customer mails about an order (igs-pharma#157, D-019). The command that moves an order or a refund
 * into a state the customer must hear about records the mail in the same transaction
 * (`requestOrderMail`) and publishes `orders.mail.requested`; the WORKER sends it. The send function
 * is injected, so this module never imports the mail package.
 *
 * Each mail is tied to one state, twice over: a database trigger refuses a mail whose order or
 * refund is not in the state it reports, and the worker checks again before sending (an order that
 * moved on meanwhile gets no stale "ready" mail). One mail per order and kind (per refund for the
 * refund mails): a repeated event finds the row and publishes nothing. Once sent, the row says so and
 * a redelivered job does nothing; a crash between the send and that update sends it again
 * (at-least-once, as for the account mails).
 */

/** Ids and the kind only (D-020): the address is read from the order's contact at send time. */
export const OrderMailRequested = defineEvent(
  "orders.mail.requested",
  1,
  z.object({ mailId: z.uuid(), orderId: z.uuid(), kind: z.enum(ORDER_MAIL_KINDS) }),
);

/** Records a mail about the order (and refund) and asks the worker to send it; once per kind. */
export async function requestOrderMail(
  ctx: Ctx,
  input: { readonly orderId: string; readonly kind: OrderMailKind; readonly refundId?: string },
): Promise<void> {
  const [row] = await ctx.tx
    .insert(orderMails)
    .values({
      orderId: input.orderId,
      kind: input.kind,
      refundId: input.refundId ?? null,
      createdAt: ctx.now,
    })
    .onConflictDoNothing()
    .returning({ id: orderMails.id });
  if (!row) return;
  await ctx.outbox.publish(OrderMailRequested, {
    mailId: row.id,
    orderId: input.orderId,
    kind: input.kind,
  });
}

/** One order mail, as the worker hands it to the sender: everything needed, nothing logged. */
export interface OrderMailToSend {
  readonly to: string;
  readonly name: string;
  readonly locale: string;
  readonly kind: OrderMailKind;
  readonly reference: string;
  /** The refund's amount, for the refund mails. */
  readonly amountCents: number | undefined;
  /** The carrier's tracking link, for the `shipped` mail (igs-pharma#202). */
  readonly trackingUrl: string | undefined;
}

export type OrderMailSender = (mail: OrderMailToSend) => Promise<void>;

export type OrderMailDelivery = "sent" | "skipped";

/** Reserved test domains (RFC 2606/6761): the demo orders use them; nothing is sent there. */
const RESERVED_DOMAIN = /\.(test|example|invalid|localhost)$/i;

/** Whether the order is still where the mail says it is (the trigger checked it when recorded). */
function stillTrue(kind: OrderMailKind, orderStatus: string): boolean {
  switch (kind) {
    case "order_received":
      return orderStatus !== "cancelled" && orderStatus !== "expired";
    case "stock_short":
      return orderStatus === "paid_stock_short";
    case "ready_for_pickup":
      return orderStatus === "ready_for_pickup";
    // a parcel delivered before its mail went out: the mail still tells where it is
    case "shipped":
      return orderStatus === "shipped" || orderStatus === "delivered";
    default:
      return true;
  }
}

/**
 * Sends the mail `mailId` stands for and marks it sent. `skipped` when there is nothing to send: it
 * was sent already, the order moved on, there is no contact, or the address is a reserved test one.
 * Throws when the send fails, so the job is retried; the row stays pending.
 */
export async function deliverOrderMail(
  mailId: string,
  send: OrderMailSender,
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<OrderMailDelivery> {
  const row = await runtime.db.transaction(async (tx) => {
    const [found] = await tx
      .select({
        kind: orderMails.kind,
        status: orderMails.status,
        orderStatus: ordersTable.status,
        reference: ordersTable.reference,
        locale: ordersTable.locale,
        email: orderContacts.email,
        name: orderContacts.name,
        amountCents: refunds.amountCents,
        trackingUrl: shipments.trackingUrl,
      })
      .from(orderMails)
      .innerJoin(ordersTable, eq(ordersTable.id, orderMails.orderId))
      .leftJoin(orderContacts, eq(orderContacts.orderId, orderMails.orderId))
      .leftJoin(refunds, eq(refunds.id, orderMails.refundId))
      .leftJoin(shipments, eq(shipments.orderId, orderMails.orderId))
      .where(eq(orderMails.id, mailId));
    return found;
  });
  if (!row || row.status !== "pending") return "skipped";
  const kind = row.kind as OrderMailKind;
  const mark = async (status: "sent" | "skipped") => {
    await runtime.db.transaction(async (tx) => {
      await tx
        .update(orderMails)
        .set({ status, ...(status === "sent" ? { sentAt: runtime.now() } : {}) })
        .where(and(eq(orderMails.id, mailId), eq(orderMails.status, "pending")));
    });
  };
  if (!row.email || RESERVED_DOMAIN.test(row.email) || !stillTrue(kind, row.orderStatus)) {
    await mark("skipped");
    return "skipped";
  }
  await send({
    to: row.email,
    name: row.name ?? "",
    locale: row.locale,
    kind,
    reference: row.reference,
    amountCents: row.amountCents ?? undefined,
    trackingUrl: kind === "shipped" ? (row.trackingUrl ?? undefined) : undefined,
  });
  await mark("sent");
  return "sent";
}

/** One pg-boss job of the mail topic: the outbox envelope the relay delivers. */
export interface OrderMailJob {
  readonly data: unknown;
}

/**
 * Handles a batch of `orders.mail.requested` jobs. A payload that does not parse can never succeed,
 * so it is logged (ids only) and dropped; every other failure is thrown for a retry.
 */
export async function handleOrderMailJobs(
  jobs: readonly OrderMailJob[],
  send: OrderMailSender,
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<void> {
  for (const job of jobs) {
    const envelope = job.data as Partial<OutboxEnvelope> | null;
    const payload = OrderMailRequested.schema.safeParse(envelope?.payload);
    if (!payload.success) {
      runtime.logger.warn?.(
        { eventId: envelope?.eventId, alarm: "orders.mail.payload_invalid" },
        "orders.mail.payload_invalid: an order mail request could not be read and was dropped",
      );
      continue;
    }
    const outcome = await deliverOrderMail(payload.data.mailId, send, runtime);
    runtime.logger.info?.(
      { eventId: envelope?.eventId, kind: payload.data.kind, outcome },
      "orders.mail.handled",
    );
  }
}

/** The slice of pg-boss that `registerOrderMailJobs` uses. */
export interface OrderMailJobScheduler {
  getQueue(name: string): Promise<unknown>;
  work(name: string, handler: (jobs: OrderMailJob[]) => Promise<void>): Promise<unknown>;
}

/** Verifies the topic's queue exists (the migrate entry creates it) and registers the sender. */
export async function registerOrderMailJobs(
  boss: OrderMailJobScheduler,
  send: OrderMailSender,
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<void> {
  await assertQueuesExist(boss, [OrderMailRequested.topic]);
  await boss.work(OrderMailRequested.topic, (jobs) => handleOrderMailJobs(jobs, send, runtime));
}
