import {
  type KernelRuntime,
  type QueueAdmin,
  assertQueuesExist,
  getKernelRuntime,
} from "@igs/kernel";

import { type SamImportOptions, type SamImportReport, runSamImport } from "./import";

/**
 * The weekly SAM import job (igs-pharma#237). The handler lives here; the worker registers it and
 * passes `openExport`, the one function that does I/O (download, temp file, unzip; D-019). The
 * schedule avoids 02:00–02:59 Europe/Brussels (the DST hour) and the 03:xx–04:xx housekeeping jobs.
 */
export const SAM_IMPORT_JOBS = {
  run: {
    queue: "catalog.sam_import.run",
    deadLetterQueue: "catalog.sam_import.run.failed",
    /** Mondays 05:41 Europe/Brussels. */
    cron: "41 5 * * 1",
  },
  timezone: "Europe/Brussels",
  /** One retry, half an hour later (a SAM server hiccup); then the dead-letter alarm. */
  retryLimit: 1,
  retryDelaySeconds: 1_800,
} as const;

/** An opened export: the AMP XML as a stream, and a cleanup that removes any temp file. */
export interface SamExportStream {
  readonly chunks: AsyncIterable<string | Uint8Array>;
  close(): Promise<void>;
}

/** Runs one import over an opened export and always closes it. */
export async function runSamImportFrom(
  openExport: () => Promise<SamExportStream>,
  options: SamImportOptions,
): Promise<SamImportReport> {
  const source = await openExport();
  try {
    return await runSamImport(source.chunks, options);
  } finally {
    await source.close();
  }
}

/** A job that failed all its retries: the catalogue misses this week's SAM changes. */
export function reportSamImportFailed(runtime: KernelRuntime = getKernelRuntime()): void {
  runtime.logger.warn?.(
    { alarm: "catalog.sam_import.failed" },
    "catalog.sam_import.failed: the SAM import failed after all retries",
  );
}

/** The slice of pg-boss that `registerSamImportJob` uses (structural: no pg-boss import). */
export interface SamImportJobScheduler {
  getQueue(name: string): Promise<unknown>;
  schedule(name: string, cron: string, data?: object, options?: { tz?: string }): Promise<void>;
  unschedule(name: string): Promise<void>;
  work(name: string, handler: () => Promise<void>): Promise<unknown>;
}

/** The slice of pg-boss that `ensureSamImportQueues` uses. */
export interface SamImportQueueAdmin extends QueueAdmin {
  createQueue(
    name: string,
    options?: { retryLimit?: number; retryDelay?: number; deadLetter?: string },
  ): Promise<void>;
}

/** Every queue of the job, dead-letter queue first (a queue's `deadLetter` must exist). */
export const SAM_IMPORT_QUEUES: readonly string[] = [
  SAM_IMPORT_JOBS.run.deadLetterQueue,
  SAM_IMPORT_JOBS.run.queue,
];

/** Creates the queues. DDL on pg-boss's schema: the migrate entry only, never the worker. Idempotent. */
export async function ensureSamImportQueues(boss: SamImportQueueAdmin): Promise<void> {
  const { run, retryLimit, retryDelaySeconds } = SAM_IMPORT_JOBS;
  await boss.createQueue(run.deadLetterQueue);
  await boss.createQueue(run.queue, {
    retryLimit,
    retryDelay: retryDelaySeconds,
    deadLetter: run.deadLetterQueue,
  });
}

/**
 * Checks the queues exist, schedules the weekly run and registers the handlers. Without
 * `openExport` (no `SAM_EXPORT_URL` configured) nothing is scheduled; the dead-letter handler is
 * still registered so an old failed job is reported. Safe to call on every boot.
 */
export async function registerSamImportJob(
  boss: SamImportJobScheduler,
  setup: {
    readonly openExport: (() => Promise<SamExportStream>) | null;
    readonly otcDeliveryModusCodes: readonly string[];
  },
  runtime: KernelRuntime = getKernelRuntime(),
): Promise<void> {
  const { run, timezone } = SAM_IMPORT_JOBS;
  await assertQueuesExist(boss, SAM_IMPORT_QUEUES);
  await boss.work(run.deadLetterQueue, async () => reportSamImportFailed(runtime));
  const { openExport } = setup;
  if (openExport === null) {
    await boss.unschedule(run.queue); // a schedule left from an earlier configuration stops too
    runtime.logger.warn?.(
      { job: run.queue },
      "catalog.sam_import.not_configured: SAM_EXPORT_URL is not set; the weekly import is off",
    );
    return;
  }
  await boss.schedule(run.queue, run.cron, undefined, { tz: timezone });
  await boss.work(run.queue, async () => {
    await runSamImportFrom(openExport, {
      otcDeliveryModusCodes: setup.otcDeliveryModusCodes,
      runtime,
    });
  });
}
