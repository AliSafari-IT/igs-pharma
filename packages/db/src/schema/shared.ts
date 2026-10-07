import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Cross-module idempotency table.
 * Commands and webhook handlers insert here before executing;
 * duplicate keys are ignored (ON CONFLICT DO NOTHING).
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    response: text("response"),
  },
  (t) => [index("idempotency_keys_expires_at_idx").on(t.expiresAt)],
);
