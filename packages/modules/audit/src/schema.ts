import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Audit module tables (T-006, REQ-SEC-03, REQ-PHC-05). Postgres schema `audit`, owned by the
 * migrator role; the runtime app role gets INSERT/SELECT only (D-027).
 *
 * `events` is **partitioned monthly by `at`** (D-029) and append-only. Drizzle cannot express
 * partitioning, so migration `0005_*` replaces the generated `CREATE TABLE` with the partitioned
 * form (see docs/06-engineering/migrations.md); this definition is the typed view of it.
 *
 * Never import this file from app code — drizzle-kit aggregates it by path glob.
 */
export const audit = pgSchema("audit");

export const events = audit.table(
  "events",
  {
    id: uuid("id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    /** Position in the single hash chain (gap-free, D-026). */
    seq: bigint("seq", { mode: "number" }).notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    /** `<domain>.<noun>.<verb>` */
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    locationId: uuid("location_id"),
    /** `v<key version>:<hex>` keyed hash; never the raw value. */
    ipHash: text("ip_hash"),
    uaHash: text("ua_hash"),
    /** Allow-listed shape per action; never PII, health data or secrets. */
    data: jsonb("data").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.at] }),
    index("events_seq_idx").on(t.seq),
    index("events_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** The chain head: one row, locked `FOR UPDATE` by every `record` (serialises appends). */
export const chainHead = audit.table(
  "chain_head",
  {
    id: integer("id").primaryKey(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [check("chain_head_singleton", sql`${t.id} = 1`)],
);
