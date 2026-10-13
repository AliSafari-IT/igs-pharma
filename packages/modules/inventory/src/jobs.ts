import {
  type KernelRuntime,
  type QueueAdmin,
  assertQueuesExist,
  getKernelRuntime,
} from "@igs/kernel";
import { sql } from "drizzle-orm";

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
  timezone: "Europe/Brussels",
  /** Only thrown errors are retried (connection, lock timeout). */
  retryLimit: 2,
  retryDelaySeconds: 60,
} as const;

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
];

/** Creates the queues. DDL on pg-boss's schema: runs in the migrate entry, never in the worker. Idempotent. */
export async function ensureInventoryQueues(boss: InventoryQueueAdmin): Promise<void> {
  const { purgePlans, retryLimit, retryDelaySeconds } = INVENTORY_JOBS;
  await boss.createQueue(purgePlans.deadLetterQueue);
  await boss.createQueue(purgePlans.queue, {
    retryLimit,
    retryDelay: retryDelaySeconds,
    deadLetter: purgePlans.deadLetterQueue,
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
  const { purgePlans, timezone } = INVENTORY_JOBS;
  await assertQueuesExist(boss, INVENTORY_QUEUES);
  await boss.schedule(purgePlans.queue, purgePlans.cron, undefined, { tz: timezone });
  await boss.work(purgePlans.queue, async () => {
    await runImportPlanPurge(runtime);
  });
  await boss.work(purgePlans.deadLetterQueue, async () => reportImportPlanPurgeFailed(runtime));
}
