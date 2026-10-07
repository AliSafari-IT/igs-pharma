import type { KernelRuntime } from "@igs/kernel";
import { sql } from "drizzle-orm";

import { verifyChainSnapshot } from "./verify";

/**
 * Background jobs of the audit module (T-006b). Handlers live here; the worker only registers them
 * (`registerAuditJobs`). Every alarm is ALSO an `error` log, because metrics are not wired to a
 * backend yet; gauges stay metric-only.
 *
 * Schedules avoid 02:00–02:59 Europe/Brussels: that hour does not exist on the last Sunday of March
 * and happens twice on the last Sunday of October, so cron libraries skip or double-fire it.
 */
export const AUDIT_JOBS = {
  partitions: {
    queue: "audit.partitions.ensure",
    deadLetterQueue: "audit.partitions.ensure.failed",
    cron: "47 4 * * *",
  },
  verify: {
    queue: "audit.chain.verify",
    deadLetterQueue: "audit.chain.verify.failed",
    cron: "37 3 * * *",
  },
  timezone: "Europe/Brussels",
  /** Only thrown errors are retried (connection, lock timeout): a mismatch is deterministic. */
  retryLimit: 2,
  retryDelaySeconds: 60,
} as const;

/** Months of partitions kept ahead; an alarm fires when fewer than `MIN_FUTURE_PARTITIONS` exist. */
export const PARTITION_MONTHS_AHEAD = 3;
export const MIN_FUTURE_PARTITIONS = 2;
export const VERIFY_WINDOW_HOURS = 48;

export interface PartitionMaintenanceResult {
  readonly created: number;
  readonly future: number;
}

/**
 * Daily: `audit.ensure_partitions(3)` (a narrow SECURITY DEFINER function, executable by the worker
 * role only: no DDL credential in the worker), then checks the horizon. Fewer than 2 future months
 * → error log + counter `audit.partitions.low`.
 */
export async function runPartitionMaintenance(
  runtime: KernelRuntime,
): Promise<PartitionMaintenanceResult> {
  const { created, future } = await runtime.db.transaction(async (tx) => {
    const ensured = Array.from(
      await tx.execute<{ n: number }>(
        sql`SELECT audit.ensure_partitions(${PARTITION_MONTHS_AHEAD}::integer) AS n`,
      ),
    );
    const horizon = Array.from(
      await tx.execute<{ n: number }>(sql`SELECT audit.future_partitions() AS n`),
    );
    return { created: Number(ensured[0]?.n ?? 0), future: Number(horizon[0]?.n ?? 0) };
  });
  runtime.metrics.gauge?.("audit.partitions.future", future);
  if (future < MIN_FUTURE_PARTITIONS) {
    runtime.metrics.increment("audit.partitions.low");
    runtime.logger.error({ alarm: "audit.partitions.low", future }, "audit.partitions.low");
  }
  return { created, future };
}

export interface ChainVerificationResult {
  readonly ok: boolean;
  readonly checked: number;
}

/**
 * Daily: verifies the last 48 hours in one REPEATABLE READ snapshot with the app role. A mismatch
 * is deterministic (the chain stays broken), so it **alarms immediately**: error log with the
 * position and reason only (never event data) + counter `audit.chain.mismatch`. Thrown errors
 * propagate so pg-boss retries them (`AUDIT_JOBS.retryLimit`).
 */
export async function runChainVerification(
  runtime: KernelRuntime,
): Promise<ChainVerificationResult> {
  const sinceAt = new Date(runtime.now().getTime() - VERIFY_WINDOW_HOURS * 60 * 60 * 1000);
  const result = await verifyChainSnapshot(runtime.db, { sinceAt });
  runtime.metrics.gauge?.("audit.chain.checked", result.checked);
  if (!result.ok) {
    runtime.metrics.increment("audit.chain.mismatch", { reason: result.reason });
    runtime.logger.error(
      { alarm: "audit.chain.mismatch", seq: result.firstBadSeq, reason: result.reason },
      "audit.chain.mismatch",
    );
  }
  return { ok: result.ok, checked: result.checked };
}

/** Dead-letter handlers: a job that failed all its retries. A verifier / partition job that never runs is an integrity gap. */
export function reportVerifyFailed(runtime: KernelRuntime): void {
  runtime.metrics.increment("audit.chain.verify_failed");
  runtime.logger.error(
    { alarm: "audit.chain.verify_failed" },
    "audit.chain.verify_failed: the chain verification job failed after all retries",
  );
}

export function reportPartitionsFailed(runtime: KernelRuntime): void {
  runtime.metrics.increment("audit.partitions.ensure_failed");
  runtime.logger.error(
    { alarm: "audit.partitions.ensure_failed" },
    "audit.partitions.ensure_failed: partition maintenance failed after all retries; the horizon will run out",
  );
}

/** The slice of pg-boss that `registerAuditJobs` uses (structural: the module need not import pg-boss). */
export interface JobScheduler {
  createQueue(
    name: string,
    options?: { retryLimit?: number; retryDelay?: number; deadLetter?: string },
  ): Promise<void>;
  schedule(name: string, cron: string, data?: object, options?: { tz?: string }): Promise<void>;
  work(name: string, handler: () => Promise<void>): Promise<unknown>;
}

/**
 * Creates the queues (with retries and dead-letter queues), schedules the daily runs and registers
 * the handlers. Called by the worker's composition root after `configureKernel`.
 */
export async function registerAuditJobs(boss: JobScheduler, runtime: KernelRuntime): Promise<void> {
  const { partitions, verify, timezone, retryLimit, retryDelaySeconds } = AUDIT_JOBS;
  const retry = { retryLimit, retryDelay: retryDelaySeconds };

  // dead-letter queues first: a queue's deadLetter must exist
  await boss.createQueue(partitions.deadLetterQueue);
  await boss.createQueue(verify.deadLetterQueue);
  await boss.createQueue(partitions.queue, { ...retry, deadLetter: partitions.deadLetterQueue });
  await boss.createQueue(verify.queue, { ...retry, deadLetter: verify.deadLetterQueue });

  await boss.schedule(partitions.queue, partitions.cron, undefined, { tz: timezone });
  await boss.schedule(verify.queue, verify.cron, undefined, { tz: timezone });

  await boss.work(partitions.queue, async () => {
    await runPartitionMaintenance(runtime);
  });
  await boss.work(verify.queue, async () => {
    await runChainVerification(runtime);
  });
  await boss.work(partitions.deadLetterQueue, async () => reportPartitionsFailed(runtime));
  await boss.work(verify.deadLetterQueue, async () => reportVerifyFailed(runtime));
}
