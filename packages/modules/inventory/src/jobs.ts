import {
  type Actor,
  type KernelRuntime,
  type QueueAdmin,
  assertQueuesExist,
  getKernelRuntime,
} from "@igs/kernel";
import { sql } from "drizzle-orm";

import { EXPIRY_BATCH } from "./domain";
import { expireReservations } from "./reservations";

/**
 * Background job of the inventory module (igs-pharma#88): the daily purge of expired import plans
 * (#84). A plan is a stored stock-file preview; it expires one hour after it was prepared and is
 * deleted `IMPORT_PLAN_GRACE_HOURS` later by `inventory.purge_expired_import_plans()`, a zero-argument
 * SECURITY DEFINER function (the runtime roles have no DELETE on the table). The grace is a constant
 * of that function, an operational value: a plan holds product ids and counts, no personal data. The
 * result is logged as a count only.
 *
 * The schedule avoids 02:00–02:59 Europe/Brussels (the hour that does not exist in March and happens
 * twice in October).
 */
export const INVENTORY_JOBS = {
  purgePlans: {
    queue: "inventory.plans.purge",
    deadLetterQueue: "inventory.plans.purge.failed",
    cron: "12 4 * * *",
  },
  /**
   * igs-pharma#99: marks holds past their `expires_at` as expired, every minute. The money-relevant
   * truth does not wait for it (availability ignores a lapsed hold at once); the job keeps the
   * table and the audit trail honest. It never touches an order.
   */
  expireReservations: {
    queue: "inventory.reservations.expire",
    deadLetterQueue: "inventory.reservations.expire.failed",
    cron: "* * * * *",
  },
  timezone: "Europe/Brussels",
  /** Only thrown errors are retried (connection, lock timeout). */
  retryLimit: 2,
  retryDelaySeconds: 60,
} as const;

/** The expiry job's actor: `system_reservations` is a system role no user can hold. */
export const RESERVATION_EXPIRY_ACTOR: Actor = {
  type: "system",
  id: "reservation-expiry",
  roles: ["system_reservations"],
};

/** The most batches one run handles (a safety stop; the next minute continues). */
const MAX_EXPIRY_BATCHES = 50;

/** Expires the lapsed holds, batch by batch, and returns how many it marked. Safe to run twice. */
export async function runReservationExpiry(
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAX_EXPIRY_BATCHES; batch += 1) {
    const { expired } = await expireReservations({}, RESERVATION_EXPIRY_ACTOR);
    total += expired;
    if (expired < EXPIRY_BATCH) break;
  }
  if (total > 0) runtime.logger.info?.({ expired: total }, "inventory.reservations.expired");
  return total;
}

/** A job that failed all its retries: lapsed holds stay marked active (availability still ignores them). */
export function reportReservationExpiryFailed(runtime: KernelRuntime = getKernelRuntime()): void {
  runtime.logger.warn?.(
    { alarm: "inventory.reservations.expire_failed" },
    "inventory.reservations.expire_failed: the reservation expiry failed after all retries",
  );
}

/** How long after `expires_at` a plan is kept (mirrors the constant in the SQL function). */
export const IMPORT_PLAN_GRACE_HOURS = 24;

/** Deletes the expired plans and returns how many were deleted. */
export async function runImportPlanPurge(
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<number> {
  const rows = await runtime.db.transaction(async (tx) =>
    Array.from(
      await tx.execute<{ n: number }>(sql`SELECT inventory.purge_expired_import_plans() AS n`),
    ),
  );
  const purged = Number(rows[0]?.n ?? 0);
  runtime.logger.info?.({ purged }, "inventory.plans.purged");
  return purged;
}

/** A job that failed all its retries: expired plans pile up (harmless, but worth knowing). */
export function reportImportPlanPurgeFailed(runtime: KernelRuntime = getKernelRuntime()): void {
  runtime.logger.warn?.(
    { alarm: "inventory.plans.purge_failed" },
    "inventory.plans.purge_failed: the import plan purge failed after all retries",
  );
}

/** The slice of pg-boss that `registerInventoryJobs` uses (structural: the module need not import pg-boss). */
export interface InventoryJobScheduler {
  getQueue(name: string): Promise<unknown>;
  schedule(name: string, cron: string, data?: object, options?: { tz?: string }): Promise<void>;
  work(name: string, handler: () => Promise<void>): Promise<unknown>;
}

/** The slice of pg-boss that `ensureInventoryQueues` uses. */
export interface InventoryQueueAdmin extends QueueAdmin {
  createQueue(
    name: string,
    options?: { retryLimit?: number; retryDelay?: number; deadLetter?: string },
  ): Promise<void>;
}

/** Every queue of the inventory jobs, dead-letter queue first (a queue's `deadLetter` must exist). */
export const INVENTORY_QUEUES: readonly string[] = [
  INVENTORY_JOBS.purgePlans.deadLetterQueue,
  INVENTORY_JOBS.purgePlans.queue,
  INVENTORY_JOBS.expireReservations.deadLetterQueue,
  INVENTORY_JOBS.expireReservations.queue,
];

/** Creates the queues. DDL on pg-boss's schema: runs in the migrate entry, never in the worker. Idempotent. */
export async function ensureInventoryQueues(boss: InventoryQueueAdmin): Promise<void> {
  const { purgePlans, expireReservations: expiry, retryLimit, retryDelaySeconds } = INVENTORY_JOBS;
  await boss.createQueue(purgePlans.deadLetterQueue);
  await boss.createQueue(purgePlans.queue, {
    retryLimit,
    retryDelay: retryDelaySeconds,
    deadLetter: purgePlans.deadLetterQueue,
  });
  await boss.createQueue(expiry.deadLetterQueue);
  await boss.createQueue(expiry.queue, {
    retryLimit,
    retryDelay: retryDelaySeconds,
    deadLetter: expiry.deadLetterQueue,
  });
}

/**
 * Verifies the queue exists (a readable `kernel.queue_missing` when the migrate entry has not run),
 * schedules the daily run and registers the handlers. Safe to call on every boot.
 */
export async function registerInventoryJobs(
  boss: InventoryJobScheduler,
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<void> {
  const { purgePlans, expireReservations: expiry, timezone } = INVENTORY_JOBS;
  await assertQueuesExist(boss, INVENTORY_QUEUES);
  await boss.schedule(purgePlans.queue, purgePlans.cron, undefined, { tz: timezone });
  await boss.schedule(expiry.queue, expiry.cron, undefined, { tz: timezone });
  await boss.work(purgePlans.queue, async () => {
    await runImportPlanPurge(runtime);
  });
  await boss.work(purgePlans.deadLetterQueue, async () => reportImportPlanPurgeFailed(runtime));
  await boss.work(expiry.queue, async () => {
    await runReservationExpiry(runtime);
  });
  await boss.work(expiry.deadLetterQueue, async () => reportReservationExpiryFailed(runtime));
}
