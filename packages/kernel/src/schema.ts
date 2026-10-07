import { index, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Tables owned by the kernel (D-017): Postgres schema `system` (domain-model §10).
 * `system.outbox` arrives with T-005b. `packages/db` owns no tables.
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
  },
  (t) => [index("idempotency_keys_expires_at_idx").on(t.expiresAt)],
);
