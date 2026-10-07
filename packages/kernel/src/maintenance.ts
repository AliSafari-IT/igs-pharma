import { getDb } from "@igs/db/client";
import { and, isNotNull, lt } from "drizzle-orm";

import { peekKernelConfig } from "./config";
import { idempotencyKeys, outbox } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PurgeOptions {
  readonly db?: { delete: ReturnType<typeof getDb>["delete"] };
  readonly now?: Date;
  /** Published outbox rows older than this are deleted (default 7 days). */
  readonly publishedRetentionMs?: number;
}

export interface PurgeResult {
  readonly outbox: number;
  readonly idempotencyKeys: number;
}

/**
 * Housekeeping the worker schedules daily via pg-boss (K5): removes published outbox rows older
 * than the retention window and expired idempotency keys (command responses and `handleOnce`
 * claims). Dead-lettered outbox rows are **kept** for inspection; unpublished rows are never touched.
 */
export async function purgeExpired(options: PurgeOptions = {}): Promise<PurgeResult> {
  const config = peekKernelConfig();
  const db = options.db ?? config?.db() ?? getDb();
  const now = options.now ?? config?.clock() ?? new Date();
  const cutoff = new Date(now.getTime() - (options.publishedRetentionMs ?? 7 * DAY_MS));

  const outboxRows = await (db as ReturnType<typeof getDb>)
    .delete(outbox)
    .where(and(isNotNull(outbox.publishedAt), lt(outbox.publishedAt, cutoff)))
    .returning({ id: outbox.id });
  const keyRows = await (db as ReturnType<typeof getDb>)
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, now))
    .returning({ key: idempotencyKeys.key });

  config?.metrics.increment("kernel.purge.outbox", {}, outboxRows.length);
  config?.metrics.increment("kernel.purge.idempotency_keys", {}, keyRows.length);
  return { outbox: outboxRows.length, idempotencyKeys: keyRows.length };
}
