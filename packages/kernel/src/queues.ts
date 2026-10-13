import { renderPgbossGrantsSql } from "@igs/db/grants";

import { registeredTopics } from "./events";

/**
 * Queue creation is DDL on pg-boss's schema (`createQueue` creates the queue's table), which the
 * runtime roles do not have (igs-pharma#66). So queues are created ONCE, by the migrate entry under
 * the administrative role (`ensure…Queues`), and the worker/relay only check that they exist
 * (`assertQueuesExist`), failing fast with a readable message when the migrate entry has not run.
 */

/** The daily housekeeping job (K5): `purgeExpired`. */
export const PURGE_QUEUE = "kernel.maintenance.purge";

export interface QueueAdmin {
  createQueue(name: string): Promise<void>;
}

export interface QueueReader {
  getQueue(name: string): Promise<unknown>;
}

/** Creates the kernel's own queues and one per registered event topic (outbox relay targets). */
export async function ensureKernelQueues(boss: QueueAdmin): Promise<void> {
  await boss.createQueue(PURGE_QUEUE);
  for (const topic of registeredTopics()) await boss.createQueue(topic);
}

/** Resolves when every queue exists; otherwise throws `kernel.queue_missing` naming them. */
export async function assertQueuesExist(
  boss: QueueReader,
  names: readonly string[],
): Promise<void> {
  const missing: string[] = [];
  for (const name of names) {
    if (!(await boss.getQueue(name))) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `kernel.queue_missing: pg-boss queue(s) ${missing.join(", ")} do not exist. Queues are created by the migrate entry under the administrative database role (node dist/migrate.js, with DATABASE_MIGRATE_URL); run it before starting the worker.`,
    );
  }
}

/** The statement executor of a started pg-boss (`boss.getDb()`). */
export interface SqlExecutor {
  executeSql(text: string, values?: unknown[]): Promise<unknown>;
}

/**
 * Gives the worker role its runtime rights on the `pgboss` schema (DML, no DDL; `igs_app` gets
 * nothing). Run by the migrate entry as the administrative role AFTER the queues exist, so the
 * grants cover the queue tables. Idempotent.
 */
export async function grantPgBossRuntime(db: SqlExecutor): Promise<void> {
  for (const statement of renderPgbossGrantsSql()) await db.executeSql(statement);
}
