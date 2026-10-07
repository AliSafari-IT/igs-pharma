import type { Db } from "@igs/db";
import { getDb } from "@igs/db/client";
import { logger as defaultLogger } from "@igs/observability/logger";
import { type Span, startSpan } from "@igs/observability/otel";

import type { Actor } from "./actor";

/** The Drizzle transaction handed to handlers (one per execution). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Non-PII values only (identifiers, counters, flags) — audit `data` must never carry PII or health data. */
export type AuditData = Readonly<Record<string, string | number | boolean | null>>;

export interface AuditEntry {
  /** `<module>.<entity>.<verb>` e.g. `pharmacy.review.decided` */
  readonly action: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly data?: AuditData;
}

/**
 * Implemented by `module-audit` (T-006) and wired by each app's composition root. The entry is
 * written **inside the command's transaction** (`tx`), so it commits or rolls back with the handler.
 * `actor.type` is stored as `actor_type` (incl. `anonymous`, A1).
 */
export interface AuditPort {
  record(entry: AuditEntry, context: { actor: Actor; tx: Tx; at: Date }): Promise<void>;
}

export interface Metrics {
  /** Adds `value` (default 1) to a counter. Labels must be low-cardinality: never put counts or ids in them. */
  increment(name: string, attributes?: Readonly<Record<string, string>>, value?: number): void;
  /** Point-in-time value (e.g. outbox lag in seconds). */
  gauge?(name: string, value: number, attributes?: Readonly<Record<string, string>>): void;
}

export interface Tracer {
  startSpan(name: string): Span;
}

export interface KernelLogger {
  error(obj: Record<string, unknown>, msg?: string): void;
  info?(obj: Record<string, unknown>, msg?: string): void;
}

export interface KernelConfig {
  readonly audit: AuditPort;
  readonly clock: () => Date;
  readonly tracer: Tracer;
  readonly metrics: Metrics;
  readonly logger: KernelLogger;
  readonly db: () => Pick<Db, "transaction">;
  /** Whole-execution retries on serialization failure / deadlock (A3). */
  readonly maxRetries: number;
  /** How long a stored idempotent response is replayed. */
  readonly idempotencyTtlMs: number;
}

export type KernelOptions = { readonly audit: AuditPort } & Partial<Omit<KernelConfig, "audit">>;

let current: KernelConfig | undefined;

/**
 * Call **once** in each app's composition root (web, platform, worker). Running a command or query
 * before this throws. The kernel never imports a module: modules implement ports (e.g. `AuditPort`)
 * and apps wire them in.
 */
export function configureKernel(options: KernelOptions): void {
  current = {
    clock: () => new Date(),
    tracer: { startSpan },
    metrics: { increment: () => {} },
    logger: defaultLogger,
    db: () => getDb(),
    maxRetries: 3,
    idempotencyTtlMs: 24 * 60 * 60 * 1000,
    ...options,
  };
}

export function getKernelConfig(): KernelConfig {
  if (!current) {
    throw new Error(
      "kernel.not_configured: call configureKernel({ audit }) once in the app's composition root",
    );
  }
  return current;
}

/** The configuration if `configureKernel` has run, else `undefined` (never throws). */
export function peekKernelConfig(): KernelConfig | undefined {
  return current;
}

/** Test seam — re-exported by `@igs/kernel/testing`; do not call from production code. */
export function resetKernelConfig(): void {
  current = undefined;
}
