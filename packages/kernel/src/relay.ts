import { getDb } from "@igs/db/client";
import { logger as defaultLogger } from "@igs/observability/logger";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";

import { type KernelLogger, type Metrics, type Tx, peekKernelConfig } from "./config";
import { type JobExecutor, pgBossExecutor } from "./pgboss";
import { outbox } from "./schema";

/** The slice of pg-boss that the relay needs (structural, so the kernel need not import pg-boss). */
export interface JobQueue {
  createQueue(name: string): Promise<void>;
  send(
    name: string,
    data: object,
    options: { singletonKey: string; db: JobExecutor },
  ): Promise<string | null>;
}

/** What subscribers receive as the pg-boss job `data`. */
export interface OutboxEnvelope {
  readonly eventId: string;
  readonly topic: string;
  readonly schemaVersion: number;
  readonly payload: unknown;
}

export interface OutboxRelayOptions {
  readonly queue: JobQueue;
  readonly db?: { transaction: ReturnType<typeof getDb>["transaction"] };
  readonly intervalMs?: number;
  readonly batchSize?: number;
  /** After this many failed deliveries a row is dead-lettered (`dead_at`). */
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly clock?: () => Date;
  readonly random?: () => number;
  readonly metrics?: Metrics;
  readonly logger?: KernelLogger;
}

export interface RelayRunStats {
  readonly published: number;
  readonly failed: number;
  readonly dead: number;
}

export interface OutboxProcessor {
  /** Processes one batch now (also what the timer calls). */
  runOnce(): Promise<RelayRunStats>;
}

export interface OutboxRelay extends OutboxProcessor {
  /** Stops the timer and waits for the batch in flight. */
  stop(): Promise<void>;
}

const MAX_ERROR_LENGTH = 500;

/** Exponential backoff with jitter: `base·2^(attempts-1)` capped at `max`, plus up to 20 %. */
export function backoffMs(
  attempts: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
  return Math.round(exp + exp * 0.2 * random());
}

/** Never store the raw error message (may echo data): class name and, for SQL errors, the code. */
function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  const code = (error as { code?: unknown } | null)?.code;
  return `${name}${typeof code === "string" ? `:${code}` : ""}`.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Moves committed outbox rows into pg-boss. `createOutboxRelay` only builds the processor (no
 * timer; for tests and one-shot runs); `startOutboxRelay` also polls every `intervalMs`.
 * Several relays can run concurrently
 * (`FOR UPDATE SKIP LOCKED`). Enqueue and `published_at` happen in ONE transaction through the
 * pg-boss `db` executor, with `singletonKey = outbox.id` as defence in depth: delivery to pg-boss
 * is effectively once, delivery to subscribers is at-least-once (use `handleOnce`).
 */
export function createOutboxRelay(options: OutboxRelayOptions): OutboxProcessor {
  const batchSize = options.batchSize ?? 50;
  const maxAttempts = options.maxAttempts ?? 10;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 5 * 60 * 1000;
  const clock = options.clock ?? (() => new Date());
  const random = options.random ?? Math.random;
  const metrics = options.metrics ?? peekKernelConfig()?.metrics ?? { increment: () => {} };
  const logger = options.logger ?? peekKernelConfig()?.logger ?? defaultLogger;
  const database = () => options.db ?? peekKernelConfig()?.db() ?? getDb();
  const queues = new Set<string>();

  async function ensureQueue(topic: string) {
    if (queues.has(topic)) return;
    await options.queue.createQueue(topic);
    queues.add(topic);
  }

  async function runOnce(): Promise<RelayRunStats> {
    const now = clock();
    let published = 0;
    let failed = 0;
    let dead = 0;

    await database().transaction(async (tx: Tx) => {
      const rows = await tx
        .select()
        .from(outbox)
        .where(
          and(isNull(outbox.publishedAt), isNull(outbox.deadAt), lte(outbox.nextAttemptAt, now)),
        )
        .orderBy(asc(outbox.createdAt))
        .limit(batchSize)
        .for("update", { skipLocked: true });

      for (const row of rows) {
        try {
          await ensureQueue(row.topic);
          // savepoint: a failing statement must not poison the whole batch transaction
          await tx.transaction(async (sp) => {
            const envelope: OutboxEnvelope = {
              eventId: row.id,
              topic: row.topic,
              schemaVersion: row.schemaVersion,
              payload: row.payload,
            };
            await options.queue.send(row.topic, envelope, {
              singletonKey: row.id,
              db: pgBossExecutor(sp),
            });
            await sp.update(outbox).set({ publishedAt: now }).where(eq(outbox.id, row.id));
          });
          published++;
        } catch (error) {
          const attempts = row.attempts + 1;
          const isDead = attempts >= maxAttempts;
          await tx
            .update(outbox)
            .set({
              attempts,
              lastError: describeError(error),
              nextAttemptAt: new Date(
                now.getTime() + backoffMs(attempts, baseDelayMs, maxDelayMs, random),
              ),
              deadAt: isDead ? now : null,
            })
            .where(eq(outbox.id, row.id));
          failed++;
          if (isDead) {
            dead++;
            logger.error({ eventId: row.id, topic: row.topic, attempts }, "kernel.outbox.dead");
          }
        }
      }
    });

    if (published) metrics.increment("kernel.outbox.published", {}, published);
    if (failed) metrics.increment("kernel.outbox.failed", {}, failed);
    if (dead) metrics.increment("kernel.outbox.dead", {}, dead);
    await reportLag(now);
    return { published, failed, dead };
  }

  /** Oldest pending event age — the ops doc alerts when this exceeds 5 minutes. */
  async function reportLag(now: Date) {
    if (!metrics.gauge) return;
    const [row] = await database()
      .transaction((tx) =>
        tx
          .select({ oldest: sql<Date | null>`min(${outbox.createdAt})` })
          .from(outbox)
          .where(and(isNull(outbox.publishedAt), isNull(outbox.deadAt))),
      )
      .catch(() => [undefined]);
    const oldest = row?.oldest ? new Date(row.oldest).getTime() : undefined;
    metrics.gauge(
      "kernel.outbox.lag_seconds",
      oldest ? Math.max(0, (now.getTime() - oldest) / 1000) : 0,
    );
  }

  return { runOnce };
}

/** `createOutboxRelay` plus a polling timer (the worker's relay). */
export function startOutboxRelay(options: OutboxRelayOptions): OutboxRelay {
  const intervalMs = options.intervalMs ?? 1000;
  const logger = options.logger ?? peekKernelConfig()?.logger ?? defaultLogger;
  const { runOnce } = createOutboxRelay(options);
  let stopped = false;
  let inFlight: Promise<unknown> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;

  const tick = () => {
    if (stopped) return;
    inFlight = runOnce()
      .catch((error: unknown) => {
        logger.error({ err: describeError(error) }, "kernel.outbox.relay_error");
      })
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, intervalMs);
      });
  };
  timer = setTimeout(tick, 0);

  return {
    runOnce,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
}
