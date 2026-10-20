import {
  type KernelRuntime,
  type QueueAdmin,
  assertQueuesExist,
  getKernelRuntime,
} from "@igs/kernel";
import { sql } from "drizzle-orm";

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

/** The slice of pg-boss that `registerOrdersJobs` uses (structural: the module need not import pg-boss). */
export interface OrdersJobScheduler {
  getQueue(name: string): Promise<unknown>;
  schedule(name: string, cron: string, data?: object, options?: { tz?: string }): Promise<void>;
  work(name: string, handler: () => Promise<void>): Promise<unknown>;
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
];

/** Creates the queues. DDL on pg-boss's schema: runs in the migrate entry, never in the worker. Idempotent. */
export async function ensureOrdersQueues(boss: OrdersQueueAdmin): Promise<void> {
  const { purgeCarts, retryLimit, retryDelaySeconds } = ORDERS_JOBS;
  await boss.createQueue(purgeCarts.deadLetterQueue);
  await boss.createQueue(purgeCarts.queue, {
    retryLimit,
    retryDelay: retryDelaySeconds,
    deadLetter: purgeCarts.deadLetterQueue,
  });
}

/**
 * Verifies the queues exist (a readable `kernel.queue_missing` when the migrate entry has not run),
 * schedules the daily run and registers the handlers. Safe to call on every boot.
 */
export async function registerOrdersJobs(
  boss: OrdersJobScheduler,
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<void> {
  const { purgeCarts, timezone } = ORDERS_JOBS;
  await assertQueuesExist(boss, ORDERS_QUEUES);
  await boss.schedule(purgeCarts.queue, purgeCarts.cron, undefined, { tz: timezone });
  await boss.work(purgeCarts.queue, async () => {
    await runCartPurge(runtime);
  });
  await boss.work(purgeCarts.deadLetterQueue, async () => reportCartPurgeFailed(runtime));
}
