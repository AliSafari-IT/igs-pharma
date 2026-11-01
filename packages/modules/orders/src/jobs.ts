import {
  type KernelRuntime,
  type OutboxEnvelope,
  type QueueAdmin,
  assertQueuesExist,
  getKernelRuntime,
  isDomainError,
} from "@igs/kernel";
import { sql } from "drizzle-orm";

import {
  PAYMENTS_ACTOR,
  type PaymentProvider,
  expireUnpaidOrders,
  listUnsettledPayments,
  syncPayment,
} from "./payments";
import {
  type RefundProvider,
  RefundRequested,
  executeRefund,
  listUnsettledRefunds,
} from "./refunds";
import {
  SHIPPING_ACTOR,
  ShipmentRequested,
  type ShippingProvider,
  type ShippingSettings,
  listShipmentsToSync,
  syncShipment,
} from "./shipments";
import { type StockShortWaiting, stockShortWaiting } from "./staff";

/**
 * Background job of the orders module (igs-pharma#116): the daily purge of expired carts and of
 * checkouts started more than 30 days ago (gdpr-and-privacy.md: cart and abandoned checkout, 30
 * days). It runs `orders.purge_expired_carts()`, a zero-argument SECURITY DEFINER function (the
 * worker role has no DELETE on those tables) and logs the count only.
 *
 * The schedule avoids 02:00–02:59 Europe/Brussels (the hour that does not exist in March and happens
 * twice in October).
 */
export const ORDERS_JOBS = {
  purgeCarts: {
    queue: "orders.carts.purge",
    deadLetterQueue: "orders.carts.purge.failed",
    cron: "27 4 * * *",
  },
  /**
   * igs-pharma#116: every five minutes, re-read the provider payments still in progress after ten
   * quiet minutes (a lost webhook) and expire the orders unpaid for 24 hours. A payment is started by
   * the shopper's "Pay now", so a `created` payment is a normal resting state, not a crash to repair.
   */
  reconcilePayments: {
    queue: "orders.payments.reconcile",
    deadLetterQueue: "orders.payments.reconcile.failed",
    cron: "*/5 * * * *",
  },
  /**
   * igs-pharma#158 follow-up: hourly, an alarm while a paid order has been short of stock for longer
   * than `STOCK_SHORT_DEADLINE_HOURS` (staff must hold it again or cancel and refund it).
   */
  stockShortAlert: {
    queue: "orders.stock_short.alert",
    deadLetterQueue: "orders.stock_short.alert.failed",
    cron: "41 0-1,3-23 * * *",
  },
  /**
   * igs-pharma#202: every fifteen minutes, labels and cancellations still waiting after ten quiet
   * minutes (a lost job, Sendcloud still announcing) are retried, and the parcels of shipped orders
   * are read for their delivery.
   */
  reconcileShipments: {
    queue: "orders.shipments.reconcile",
    deadLetterQueue: "orders.shipments.reconcile.failed",
    cron: "7,22,37,52 * * * *",
  },
  timezone: "Europe/Brussels",
  /** Only thrown errors are retried (connection, lock timeout). */
  retryLimit: 2,
  retryDelaySeconds: 60,
} as const;

/** Deletes the expired carts and old checkouts and returns how many were deleted. */
export async function runCartPurge(runtime: KernelRuntime = getKernelRuntime()): Promise<number> {
  const rows = await runtime.db.transaction(async (tx) =>
    Array.from(await tx.execute<{ n: number }>(sql`SELECT orders.purge_expired_carts() AS n`)),
  );
  const purged = Number(rows[0]?.n ?? 0);
  runtime.logger.info?.({ purged }, "orders.carts.purged");
  return purged;
}

/** A job that failed all its retries: expired carts stay (treated as absent, but kept too long). */
export function reportCartPurgeFailed(runtime: KernelRuntime = getKernelRuntime()): void {
  runtime.logger.warn?.(
    { alarm: "orders.carts.purge_failed" },
    "orders.carts.purge_failed: the cart purge failed after all retries",
  );
}

/** One pg-boss job of the refund topic: the outbox envelope the relay delivers. */
export interface RefundJob {
  readonly data: unknown;
}

/** The slice of pg-boss that `registerOrdersJobs` uses (structural: the module need not import pg-boss). */
export interface OrdersJobScheduler {
  getQueue(name: string): Promise<unknown>;
  schedule(name: string, cron: string, data?: object, options?: { tz?: string }): Promise<void>;
  /** pg-boss hands a handler the batch of jobs; the scheduled handlers ignore it. */
  work(name: string, handler: (jobs: RefundJob[]) => Promise<void>): Promise<unknown>;
}

/** The slice of pg-boss that `ensureOrdersQueues` uses. */
export interface OrdersQueueAdmin extends QueueAdmin {
  createQueue(
    name: string,
    options?: { retryLimit?: number; retryDelay?: number; deadLetter?: string },
  ): Promise<void>;
}

/** Every queue of the orders jobs, dead-letter queue first (a queue's `deadLetter` must exist). */
export const ORDERS_QUEUES: readonly string[] = [
  ORDERS_JOBS.purgeCarts.deadLetterQueue,
  ORDERS_JOBS.purgeCarts.queue,
  ORDERS_JOBS.reconcilePayments.deadLetterQueue,
  ORDERS_JOBS.reconcilePayments.queue,
  ORDERS_JOBS.stockShortAlert.deadLetterQueue,
  ORDERS_JOBS.stockShortAlert.queue,
  ORDERS_JOBS.reconcileShipments.deadLetterQueue,
  ORDERS_JOBS.reconcileShipments.queue,
];

/** Creates the queues. DDL on pg-boss's schema: runs in the migrate entry, never in the worker. Idempotent. */
export async function ensureOrdersQueues(boss: OrdersQueueAdmin): Promise<void> {
  const {
    purgeCarts,
    reconcilePayments,
    stockShortAlert,
    reconcileShipments,
    retryLimit,
    retryDelaySeconds,
  } = ORDERS_JOBS;
  for (const job of [purgeCarts, reconcilePayments, stockShortAlert, reconcileShipments]) {
    await boss.createQueue(job.deadLetterQueue);
    await boss.createQueue(job.queue, {
      retryLimit,
      retryDelay: retryDelaySeconds,
      deadLetter: job.deadLetterQueue,
    });
  }
}

/** Quiet minutes before an in-progress provider payment is re-read; at most this many per run. */
const UNSETTLED_QUIET_MINUTES = 10;
const UNSETTLED_BATCH = 50;

/** Logs a failure by code only: one payment or refund must not stop the others. */
function warnFailed(runtime: KernelRuntime, event: string, error: unknown): void {
  runtime.logger.warn?.({ event, code: isDomainError(error) ? error.code : "error" }, event);
}

/**
 * Executes the refunds of a batch of `orders.refund.requested` jobs (igs-pharma#156). A payload that
 * does not parse can never succeed, so it is logged (ids only) and dropped; any other failure is
 * thrown for a retry (the reconciliation also picks the refund up again).
 */
export async function handleRefundJobs(
  jobs: readonly RefundJob[],
  provider: RefundProvider,
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<void> {
  for (const job of jobs) {
    const envelope = job.data as Partial<OutboxEnvelope> | null;
    const payload = RefundRequested.schema.safeParse(envelope?.payload);
    if (!payload.success) {
      runtime.logger.warn?.(
        { eventId: envelope?.eventId, alarm: "orders.refunds.payload_invalid" },
        "orders.refunds.payload_invalid: a refund request could not be read and was dropped",
      );
      continue;
    }
    const { status } = await executeRefund(payload.data.refundId, provider);
    runtime.logger.info?.(
      { eventId: envelope?.eventId, refundId: payload.data.refundId, status },
      "orders.refunds.executed",
    );
  }
}

/**
 * One reconciliation run: re-reads the unsettled provider payments (when a provider is configured)
 * and expires the unpaid orders; with a refund provider, re-runs the refunds still requested or
 * pending (a lost job, a refund the provider is still processing). A payment or refund the provider
 * refuses is logged and skipped; the counts go to the log.
 */
export async function runPaymentReconciliation(
  provider: PaymentProvider | null,
  runtime: KernelRuntime = getKernelRuntime(),
  refundProvider: RefundProvider | null = null,
): Promise<{ synced: number; failed: number; expired: number; refunds: number }> {
  let synced = 0;
  let failed = 0;
  let refundsChanged = 0;
  if (provider) {
    const ids = await listUnsettledPayments(
      { quietMinutes: UNSETTLED_QUIET_MINUTES, limit: UNSETTLED_BATCH },
      PAYMENTS_ACTOR,
    );
    for (const id of ids) {
      try {
        const { changed } = await syncPayment(id, provider);
        if (changed) synced++;
      } catch (error) {
        failed++;
        warnFailed(runtime, "orders.payments.sync_failed", error);
      }
    }
  }
  if (refundProvider) {
    const ids = await listUnsettledRefunds(
      { quietMinutes: UNSETTLED_QUIET_MINUTES, limit: UNSETTLED_BATCH },
      PAYMENTS_ACTOR,
    );
    for (const id of ids) {
      try {
        const { changed } = await executeRefund(id, refundProvider);
        if (changed) refundsChanged++;
      } catch (error) {
        failed++;
        warnFailed(runtime, "orders.refunds.execute_failed", error);
      }
    }
  }
  const { expired } = await expireUnpaidOrders({}, PAYMENTS_ACTOR);
  runtime.logger.info?.(
    { synced, failed, expired, refunds: refundsChanged },
    "orders.payments.reconciled",
  );
  return { synced, failed, expired, refunds: refundsChanged };
}

/** A reconciliation that failed all its retries: payments stay unread until the next run. */
export function reportReconciliationFailed(runtime: KernelRuntime = getKernelRuntime()): void {
  runtime.logger.warn?.(
    { alarm: "orders.payments.reconcile_failed" },
    "orders.payments.reconcile_failed: the payment reconciliation failed after all retries",
  );
}

/**
 * Raises the alarm `orders.stock_short_overdue` (the count and the order ids, nothing else) while a
 * paid order has waited for stock past its deadline; logs the counts either way. Returns the counts.
 */
export async function runStockShortAlert(
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<{ waiting: number; overdue: number }> {
  const { waiting, overdue, overdueTotal }: StockShortWaiting = await runtime.db.transaction(
    async (tx) => stockShortWaiting(tx, runtime.now()),
  );
  if (overdueTotal > 0) {
    runtime.logger.warn?.(
      {
        alarm: "orders.stock_short_overdue",
        overdue: overdueTotal,
        orderIds: overdue.map((item) => item.orderId),
      },
      "orders.stock_short_overdue: paid orders are past their deadline waiting for stock; hold them again or cancel and refund",
    );
  }
  runtime.logger.info?.({ waiting, overdue: overdueTotal }, "orders.stock_short.checked");
  return { waiting, overdue: overdueTotal };
}

/** An alert run that failed all its retries: nobody was told about late stock-short orders. */
export function reportStockShortAlertFailed(runtime: KernelRuntime = getKernelRuntime()): void {
  runtime.logger.warn?.(
    { alarm: "orders.stock_short.alert_failed" },
    "orders.stock_short.alert_failed: the stock-short deadline check failed after all retries",
  );
}

// ── shipments (igs-pharma#202) ──────────────────────────────────────────────────────────────────

/** The carrier platform and how labels are made; `settings` `null` while labels are not set up. */
export interface ShippingSetup {
  readonly provider: ShippingProvider;
  readonly settings: ShippingSettings | null;
}

/** Shipments looked at per reconciliation run (a single pharmacy ships far fewer at once). */
const SHIPMENTS_BATCH = 200;

/**
 * Syncs the shipments of a batch of `orders.shipment.requested` jobs (a label to make or a parcel to
 * cancel). A payload that does not parse can never succeed, so it is logged (ids only) and dropped;
 * any other failure is thrown for a retry (the reconciliation also picks the shipment up again).
 */
export async function handleShipmentJobs(
  jobs: readonly RefundJob[],
  shipping: ShippingSetup,
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<void> {
  for (const job of jobs) {
    const envelope = job.data as Partial<OutboxEnvelope> | null;
    const payload = ShipmentRequested.schema.safeParse(envelope?.payload);
    if (!payload.success) {
      runtime.logger.warn?.(
        { eventId: envelope?.eventId, alarm: "orders.shipments.payload_invalid" },
        "orders.shipments.payload_invalid: a shipment request could not be read and was dropped",
      );
      continue;
    }
    const { status } = await syncShipment(
      payload.data.shipmentId,
      shipping.provider,
      shipping.settings,
    );
    runtime.logger.info?.(
      { eventId: envelope?.eventId, shipmentId: payload.data.shipmentId, status },
      "orders.shipments.synced",
    );
  }
}

/**
 * One shipment reconciliation run: retries the labels and cancellations still waiting and reads the
 * parcels of shipped orders, moving them to `delivered` when the carrier says so. One shipment that
 * fails is logged and skipped. While labels are not set up, a waiting label raises the alarm
 * `orders.shipments.not_configured` (packed orders cannot leave without one).
 */
export async function runShipmentReconciliation(
  shipping: ShippingSetup,
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<{ synced: number; delivered: number; failed: number; waiting: number }> {
  let synced = 0;
  let delivered = 0;
  let failed = 0;
  let waiting = 0;
  const ids = await listShipmentsToSync(
    { quietMinutes: UNSETTLED_QUIET_MINUTES, limit: SHIPMENTS_BATCH },
    SHIPPING_ACTOR,
  );
  for (const id of ids) {
    try {
      const result = await syncShipment(id, shipping.provider, shipping.settings);
      if (result.changed) synced++;
      if (result.delivered) delivered++;
      if (result.status === "requested") waiting++;
    } catch (error) {
      failed++;
      warnFailed(runtime, "orders.shipments.sync_failed", error);
    }
  }
  if (!shipping.settings && waiting > 0) {
    runtime.logger.warn?.(
      { alarm: "orders.shipments.not_configured", waiting },
      "orders.shipments.not_configured: packed delivery orders wait for a label; set SENDCLOUD_SHIPPING_METHOD_ID",
    );
  }
  runtime.logger.info?.({ synced, delivered, failed, waiting }, "orders.shipments.reconciled");
  return { synced, delivered, failed, waiting };
}

/** A shipment reconciliation that failed all its retries: labels and deliveries wait for the next run. */
export function reportShipmentReconciliationFailed(
  runtime: KernelRuntime = getKernelRuntime(),
): void {
  runtime.logger.warn?.(
    { alarm: "orders.shipments.reconcile_failed" },
    "orders.shipments.reconcile_failed: the shipment reconciliation failed after all retries",
  );
}

/**
 * Verifies the queues exist (a readable `kernel.queue_missing` when the migrate entry has not run),
 * schedules the runs and registers the handlers. Safe to call on every boot. `provider`: the payment
 * provider, `null` when none is configured (the reconciliation then only expires unpaid orders, and
 * refund requests wait, `requested`, until a provider is configured). `shipping`: Sendcloud, `null`
 * without its key pair (labels and cancellations then wait, and the reconciliation is not scheduled).
 */
export async function registerOrdersJobs(
  boss: OrdersJobScheduler,
  runtime: KernelRuntime = getKernelRuntime(),
  provider: (PaymentProvider & RefundProvider) | null = null,
  shipping: ShippingSetup | null = null,
): Promise<void> {
  const { purgeCarts, reconcilePayments, stockShortAlert, reconcileShipments, timezone } =
    ORDERS_JOBS;
  await assertQueuesExist(boss, [
    ...ORDERS_QUEUES,
    ...(provider ? [RefundRequested.topic] : []),
    ...(shipping ? [ShipmentRequested.topic] : []),
  ]);
  await boss.schedule(purgeCarts.queue, purgeCarts.cron, undefined, { tz: timezone });
  await boss.schedule(reconcilePayments.queue, reconcilePayments.cron, undefined, { tz: timezone });
  await boss.schedule(stockShortAlert.queue, stockShortAlert.cron, undefined, { tz: timezone });
  await boss.work(purgeCarts.queue, async () => {
    await runCartPurge(runtime);
  });
  await boss.work(purgeCarts.deadLetterQueue, async () => reportCartPurgeFailed(runtime));
  await boss.work(reconcilePayments.queue, async () => {
    await runPaymentReconciliation(provider, runtime, provider);
  });
  await boss.work(stockShortAlert.queue, async () => {
    await runStockShortAlert(runtime);
  });
  await boss.work(stockShortAlert.deadLetterQueue, async () =>
    reportStockShortAlertFailed(runtime),
  );
  if (provider) {
    await boss.work(RefundRequested.topic, (jobs) => handleRefundJobs(jobs, provider, runtime));
  }
  await boss.work(reconcilePayments.deadLetterQueue, async () =>
    reportReconciliationFailed(runtime),
  );
  if (shipping) {
    await boss.schedule(reconcileShipments.queue, reconcileShipments.cron, undefined, {
      tz: timezone,
    });
    await boss.work(reconcileShipments.queue, async () => {
      await runShipmentReconciliation(shipping, runtime);
    });
    await boss.work(reconcileShipments.deadLetterQueue, async () =>
      reportShipmentReconciliationFailed(runtime),
    );
    await boss.work(ShipmentRequested.topic, (jobs) => handleShipmentJobs(jobs, shipping, runtime));
  }
}
