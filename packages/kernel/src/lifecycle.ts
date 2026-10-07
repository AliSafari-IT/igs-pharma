import type { Db } from "@igs/db";
import { closeDb, getDb } from "@igs/db/client";
import { sql } from "drizzle-orm";

import { type KernelLogger, type Metrics, getKernelConfig } from "./config";

/** Fails if the database is unreachable (worker start-up check). */
export async function checkDatabase(): Promise<void> {
  await getDb().execute(sql`SELECT 1`);
}

/** Closes the connection pool on graceful shutdown. */
export async function closeDatabase(): Promise<void> {
  await closeDb();
}

/**
 * What a background job handler needs, taken from the configured kernel: the database, the metrics
 * sink, the logger and the clock. Module job handlers (e.g. `@igs/module-audit`) receive this from
 * the app's composition root, so apps never import `@igs/db` (D-015). It is **not** for request
 * handling, which always goes through `command()` / `query()`.
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
