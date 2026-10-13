import {
  type Actor,
  type KernelRuntime,
  type QueueAdmin,
  assertQueuesExist,
  getKernelRuntime,
} from "@igs/kernel";

import { purgeExpiredPrivacyData } from "./commands";

/**
 * Background job of the privacy module (igs-pharma#88): the daily retention purge. The handler lives
 * here; the worker only registers it (`registerPrivacyJobs`). Personal data never reaches a log: the
 * result is three counts.
 *
 * The schedule avoids 02:00–02:59 Europe/Brussels (the hour that does not exist in March and happens
 * twice in October).
 */
export const PRIVACY_JOBS = {
  purge: {
    queue: "privacy.retention.purge",
    deadLetterQueue: "privacy.retention.purge.failed",
    cron: "52 3 * * *",
  },
  timezone: "Europe/Brussels",
  /** Only thrown errors are retried (connection, lock timeout). */
  retryLimit: 2,
  retryDelaySeconds: 60,
} as const;

/** The worker's maintenance actor: `system_maintenance` is a system role no user can hold. */
export const MAINTENANCE_ACTOR: Actor = {
  type: "system",
  id: "retention-purge",
  roles: ["system_maintenance"],
};

export interface RetentionPurgeResult {
  readonly consentEvents: number;
  readonly dsrRequests: number;
  readonly dsrEvents: number;
}

/** Runs the purge command as the maintenance actor and logs the counts (nothing else). */
export async function runRetentionPurge(
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<RetentionPurgeResult> {
  const result = await purgeExpiredPrivacyData({}, MAINTENANCE_ACTOR);
  runtime.logger.info?.({ ...result }, "privacy.retention.purged");
  return result;
}

/** A job that failed all its retries: the personal data past its retention period is still there. */
export function reportRetentionPurgeFailed(runtime: KernelRuntime = getKernelRuntime()): void {
  runtime.logger.warn?.(
    { alarm: "privacy.retention.purge_failed" },
    "privacy.retention.purge_failed: the retention purge failed after all retries",
  );
}

/** The slice of pg-boss that `registerPrivacyJobs` uses (structural: the module need not import pg-boss). */
export interface PrivacyJobScheduler {
  getQueue(name: string): Promise<unknown>;
  schedule(name: string, cron: string, data?: object, options?: { tz?: string }): Promise<void>;
  work(name: string, handler: () => Promise<void>): Promise<unknown>;
}

/** The slice of pg-boss that `ensurePrivacyQueues` uses. */
export interface PrivacyQueueAdmin extends QueueAdmin {
  createQueue(
    name: string,
    options?: { retryLimit?: number; retryDelay?: number; deadLetter?: string },
  ): Promise<void>;
}

/** Every queue of the privacy jobs, dead-letter queue first (a queue's `deadLetter` must exist). */
export const PRIVACY_QUEUES: readonly string[] = [
  PRIVACY_JOBS.purge.deadLetterQueue,
  PRIVACY_JOBS.purge.queue,
];

/** Creates the queues. DDL on pg-boss's schema: runs in the migrate entry, never in the worker. Idempotent. */
export async function ensurePrivacyQueues(boss: PrivacyQueueAdmin): Promise<void> {
  const { purge, retryLimit, retryDelaySeconds } = PRIVACY_JOBS;
  await boss.createQueue(purge.deadLetterQueue);
  await boss.createQueue(purge.queue, {
    retryLimit,
    retryDelay: retryDelaySeconds,
    deadLetter: purge.deadLetterQueue,
  });
}

/**
 * Verifies the queue exists (a readable `kernel.queue_missing` when the migrate entry has not run),
 * schedules the daily run and registers the handlers. Safe to call on every boot.
 */
export async function registerPrivacyJobs(
  boss: PrivacyJobScheduler,
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<void> {
  const { purge, timezone } = PRIVACY_JOBS;
  await assertQueuesExist(boss, PRIVACY_QUEUES);
  await boss.schedule(purge.queue, purge.cron, undefined, { tz: timezone });
  await boss.work(purge.queue, async () => {
    await runRetentionPurge(runtime);
  });
  await boss.work(purge.deadLetterQueue, async () => reportRetentionPurgeFailed(runtime));
}
