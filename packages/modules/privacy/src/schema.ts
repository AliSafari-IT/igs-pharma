import { newId } from "@igs/db/ids";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  CONSENT_PURPOSES,
  CONSENT_SOURCES,
  DSR_CHANNELS,
  DSR_STATUSES,
  DSR_TYPES,
  RETENTION_KEYS,
} from "./domain";

/**
 * Privacy module tables (igs-pharma#58, domain-model §10). Owned by this module (D-001), Postgres
 * schema `privacy`; UUIDv7 ids generated app-side (D-003); timestamptz everywhere.
 *
 * `consent_events` and `dsr_events` are append-only ledgers (a trigger in migration
 * `privacy_append_only` refuses UPDATE, DELETE and TRUNCATE): the current consent for a subject and
 * purpose is its latest event, never a stored flag, and a request's timeline is never rewritten.
 * `subject_ref` is personal data (an e-mail address): it never goes into the audit trail or logs.
 */
export const privacy = pgSchema("privacy");

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => newId());

export const consentEvents = privacy.table(
  "consent_events",
  {
    id: id(),
    subjectRef: text("subject_ref").notNull(),
    purpose: text("purpose").notNull(),
    granted: boolean("granted").notNull(),
    /** The privacy policy version the person saw when giving or withdrawing consent. */
    policyVersion: text("policy_version").notNull(),
    source: text("source").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("consent_events_purpose_check", oneOf("purpose", CONSENT_PURPOSES)),
    check("consent_events_source_check", oneOf("source", CONSENT_SOURCES)),
    index("consent_events_subject_purpose_at_idx").on(t.subjectRef, t.purpose, t.at),
  ],
);

export const dsrRequests = privacy.table(
  "dsr_requests",
  {
    id: id(),
    subjectRef: text("subject_ref").notNull(),
    type: text("type").notNull(),
    channel: text("channel").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    /** `received_at` + one calendar month (Brussels), computed in the domain (`dsrDueAt`). */
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    /** Free text written by staff; never copied into the audit trail. */
    note: text("note"),
    createdBy: text("created_by").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedReason: text("closed_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("dsr_requests_type_check", oneOf("type", DSR_TYPES)),
    check("dsr_requests_channel_check", oneOf("channel", DSR_CHANNELS)),
    check("dsr_requests_status_check", oneOf("status", DSR_STATUSES)),
    check("dsr_requests_due_check", sql`${t.dueAt} > ${t.receivedAt}`),
    index("dsr_requests_status_due_idx").on(t.status, t.dueAt),
    index("dsr_requests_subject_ref_idx").on(t.subjectRef),
  ],
);

export const dsrEvents = privacy.table(
  "dsr_events",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => dsrRequests.id, { onDelete: "restrict" }),
    /** `null` for the event that logged the request. */
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    note: text("note"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("dsr_events_to_status_check", oneOf("to_status", DSR_STATUSES)),
    index("dsr_events_request_at_idx").on(t.requestId, t.at),
  ],
);

/**
 * How long personal data is kept (igs-pharma#88). Written by migrations only: the runtime roles can
 * read it and nothing else, so the worker that purges cannot shorten retention. `months` is `NULL`
 * for "keep": the purge function skips that scope. Every row awaits the privacy adviser's decision
 * (`awaits_adviser`). The purge itself is `privacy.purge_expired_data()` (a definer function).
 */
export const retentionPolicy = privacy.table(
  "retention_policy",
  {
    key: text("key").primaryKey(),
    months: integer("months"),
    awaitsAdviser: boolean("awaits_adviser").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("retention_policy_key_check", oneOf("key", RETENTION_KEYS)),
    check("retention_policy_months_check", sql`${t.months} IS NULL OR ${t.months} >= 0`),
  ],
);
