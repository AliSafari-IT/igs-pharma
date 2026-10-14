import type { Db } from "@igs/db";
import { MIGRATE_LOCK_KEY, closeDb, getDb, withAdvisoryLock } from "@igs/db/client";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { type KernelLogger, type Metrics, getKernelConfig } from "./config";

/** Fails if the database is unreachable (worker start-up check). */
export async function checkDatabase(): Promise<void> {
  await getDb().execute(sql`SELECT 1`);
}

/**
 * Applies every committed migration in `migrationsFolder` (`packages/db/drizzle`, copied into the
 * worker image) to `DATABASE_URL`, in order, each once (igs-pharma#46). The same chain and journal as
 * `drizzle-kit migrate` (asafarim-docs:ventures/igs-pharma/06-engineering/migrations.md), so the two tools can take turns on one database. Run by the
 * worker image's one-shot `migrate` entry with a DDL-capable role, before the apps start.
 */
export async function migrateDatabase(migrationsFolder: string): Promise<void> {
  await migrate(getDb(), { migrationsFolder });
}

/**
 * Runs the whole migrate entry (Drizzle migrations, pg-boss install, queue creation, grants) under a
 * session-level advisory lock, so two concurrent starts serialise (igs-pharma#77).
 */
export function withMigrateLock<T>(
  fn: () => Promise<T>,
  options: { waitSeconds?: number; onWait?: () => void } = {},
): Promise<T> {
  return withAdvisoryLock(MIGRATE_LOCK_KEY, fn, options);
}

/** Closes the connection pool on graceful shutdown. */
export async function closeDatabase(): Promise<void> {
  await closeDb();
}

/**
 * What a background job handler needs, taken from the configured kernel: the database, the metrics
 * sink, the logger and the clock. For **modules** that register background jobs (e.g.
 * `@igs/module-audit`): they call it inside their own `register…Jobs(boss)`, so app code never holds
 * a database handle (D-015). Apps must not call it; it is **not** for request handling, which always
 * goes through `command()` / `query()`.
 */
export interface KernelRuntime {
  readonly db: Pick<Db, "transaction">;
  readonly metrics: Metrics;
  readonly logger: KernelLogger;
  readonly now: () => Date;
}

export function getKernelRuntime(): KernelRuntime {
  const config = getKernelConfig();
  return { db: config.db(), metrics: config.metrics, logger: config.logger, now: config.clock };
}
