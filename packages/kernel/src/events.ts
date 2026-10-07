import type { z } from "zod";

import { invariant } from "./errors";

/** `<module>.<entity>.<past_tense>` e.g. `orders.review.approved` (architect, T-005 design). */
const TOPIC_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export interface EventDef<T = unknown> {
  readonly topic: string;
  /** Bumped when the payload shape changes incompatibly; stored as `outbox.schema_version`. */
  readonly version: number;
  /** Payload schema: identifiers and status only — never PII or health data (D-020). */
  readonly schema: z.ZodType<T, unknown>;
}

/**
 * Declares an event. The owning module exports its defs and registers them at startup
 * (`registerEvents`); the kernel only holds the registry mechanism.
 */
export function defineEvent<T>(
  topic: string,
  version: number,
  schema: z.ZodType<T, unknown>,
): EventDef<T> {
  if (!TOPIC_PATTERN.test(topic)) {
    throw new Error(`kernel.invalid_topic: "${topic}" must match <module>.<entity>.<past_tense>`);
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`kernel.invalid_event_version: "${topic}" version must be an integer ≥ 1`);
  }
  return { topic, version, schema };
}

const registry = new Map<string, EventDef>();

/** Idempotent for the same def; registering a different def for a topic is a programming error. */
export function registerEvents(...defs: EventDef[]): void {
  for (const def of defs) {
    const existing = registry.get(def.topic);
    if (existing && existing !== def) {
      throw new Error(`kernel.event_already_registered: topic "${def.topic}"`);
    }
    registry.set(def.topic, def);
  }
}

/** Test seam — re-exported by `@igs/kernel/testing`. */
export function resetEventRegistry(): void {
  registry.clear();
}

export function requireRegistered(def: EventDef): void {
  if (registry.get(def.topic) !== def) {
    throw invariant("kernel.event_not_registered", { topic: def.topic });
  }
}
