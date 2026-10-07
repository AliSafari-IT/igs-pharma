import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Tables owned by the kernel (D-017): Postgres schema `system` (domain-model §10).
 * `packages/db` owns no tables.
 *
 * Never import this file from app or module code — it exists so drizzle-kit can aggregate it.
 */
export const system = pgSchema("system");

/**
 * Idempotency keys for commands and event subscribers.
 *
 * `response` is stored in plaintext until `expires_at` (24 h by default), so an idempotent
 * command's `output` schema must carry identifiers and status only — never PII or health data (D-020).
 */
export const idempotencyKeys = system.table(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    response: text("response"),
    /** sha256 of the canonical parsed input: replaying a key with different input is a conflict (K4). */
    requestHash: text("request_hash"),
  },
  (t) => [index("idempotency_keys_expires_at_idx").on(t.expiresAt)],
);

/**
 * Transactional outbox: rows are inserted in the command's transaction (`ctx.outbox.publish`) and
 * relayed to pg-boss by `startOutboxRelay`. Delivery is at-least-once; subscribers use `handleOnce`.
 *
 * `payload` carries identifiers and status only — never PII or health data (D-020).
 * `schema_version` lets consumers evolve with the event (A5).
 */
export const outbox = system.table(
  "outbox",
  {
    id: uuid("id").primaryKey(),
    topic: text("topic").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    deadAt: timestamp("dead_at", { withTimezone: true }),
  },
  (t) => [
    // the relay's work queue: only rows still to be delivered
    index("outbox_pending_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.publishedAt} IS NULL AND ${t.deadAt} IS NULL`),
  ],
);
