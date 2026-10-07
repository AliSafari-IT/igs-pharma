/**
 * Test helpers for code built on the kernel (`@igs/kernel/testing`).
 *
 * TEST-ONLY (A8): importable only from test code (*.test.ts files, test/ folders and
 * vitest.config.ts) — enforced by the boundaries config, like `@igs/db/testing`.
 */
import type { Db } from "@igs/db";

import type { Actor } from "../actor";
import {
  type AuditEntry,
  type AuditPort,
  type KernelConfig,
  type Origin,
  configureKernel,
  resetKernelConfig,
} from "../config";
import { resetEventRegistry } from "../events";

// ── clock ──────────────────────────────────────────────────────────────────────────────────────

export interface FakeClock {
  now(): Date;
  advance(ms: number): void;
  set(date: Date): void;
}

export function fakeClock(start: Date = new Date("2026-01-01T00:00:00.000Z")): FakeClock {
  let time = start.getTime();
  return {
    now: () => new Date(time),
    advance: (ms) => {
      time += ms;
    },
    set: (date) => {
      time = date.getTime();
    },
  };
}

// ── actors ─────────────────────────────────────────────────────────────────────────────────────

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

/** Actor builders. Roles are given explicitly; `anonymous` never carries any. */
export const actors = {
  user: (options: { id?: string; roles?: readonly string[] } = {}): Actor => ({
    type: "user",
    id: options.id ?? nextId("user"),
    roles: options.roles ?? [],
  }),
  anonymous: (id?: string): Actor => ({
    type: "anonymous",
    id: id ?? nextId("anon"),
    roles: [],
  }),
  system: (options: { id?: string; roles?: readonly string[] } = {}): Actor => ({
    type: "system",
    id: options.id ?? nextId("system"),
    roles: options.roles ?? [],
  }),
  webhook: (options: { id?: string; roles?: readonly string[] } = {}): Actor => ({
    type: "webhook",
    id: options.id ?? nextId("webhook"),
    roles: options.roles ?? [],
  }),
};

// ── audit ──────────────────────────────────────────────────────────────────────────────────────

export interface CapturedAuditEntry extends AuditEntry {
  readonly actor: Actor;
  readonly at: Date;
  readonly origin?: Origin | undefined;
}

/** `AuditPort` that keeps entries in memory (they do NOT roll back with the transaction). */
export class InMemoryAudit implements AuditPort {
  readonly entries: CapturedAuditEntry[] = [];

  async record(
    entry: AuditEntry,
    context: { actor: Actor; at: Date; origin?: Origin },
  ): Promise<void> {
    this.entries.push({ ...entry, actor: context.actor, at: context.at, origin: context.origin });
  }

  clear(): void {
    this.entries.length = 0;
  }
}

// ── configuration ──────────────────────────────────────────────────────────────────────────────

export interface RecordedSpan {
  readonly name: string;
  readonly attributes: Record<string, string | number | boolean>;
  ended: boolean;
}

export interface RecordedMetric {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly value: number;
}

export interface KernelTestHandles {
  readonly audit: AuditPort;
  readonly inMemoryAudit: InMemoryAudit;
  readonly clock: FakeClock;
  readonly spans: RecordedSpan[];
  readonly metrics: RecordedMetric[];
  readonly errors: Record<string, unknown>[];
}

/**
 * Configures the kernel for a test with a fake clock, in-memory audit and captured spans/metrics.
 * Pass `db` (e.g. `createIsolatedDatabase().db` from `@igs/db/testing`) for tests that execute
 * commands; unit tests of authorization/validation need none.
 */
export function configureKernelForTests(
  options: {
    db?: Pick<Db, "transaction">;
    audit?: AuditPort;
    maxRetries?: number;
    idempotencyTtlMs?: number;
  } = {},
): KernelTestHandles {
  const inMemoryAudit = new InMemoryAudit();
  const clock = fakeClock();
  const spans: RecordedSpan[] = [];
  const metrics: RecordedMetric[] = [];
  const errors: Record<string, unknown>[] = [];
  const audit = options.audit ?? inMemoryAudit;

  const overrides: Partial<Omit<KernelConfig, "audit">> = {
    clock: clock.now,
    tracer: {
      startSpan(name) {
        const span: RecordedSpan = { name, attributes: {}, ended: false };
        spans.push(span);
        return {
          setAttribute: (key, value) => {
            span.attributes[key] = value;
          },
          end: () => {
            span.ended = true;
          },
        };
      },
    },
    metrics: {
      increment: (name, attributes = {}, value = 1) =>
        void metrics.push({ name, attributes, value }),
    },
    logger: { error: (obj) => void errors.push(obj) },
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    ...(options.idempotencyTtlMs === undefined
      ? {}
      : { idempotencyTtlMs: options.idempotencyTtlMs }),
    ...(options.db ? { db: () => options.db as Pick<Db, "transaction"> } : {}),
  };
  configureKernel({ audit, ...overrides });
  return { audit, inMemoryAudit, clock, spans, metrics, errors };
}

/** Back to "not configured" (the state before an app's composition root runs). */
export function resetKernelForTests(): void {
  resetKernelConfig();
  resetEventRegistry();
}
