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
  DSR_EVENT_KINDS,
  DSR_EXTENSION_REASONS,
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
    /**
     * The CURRENT deadline: `received_at` + one calendar month (Brussels, `dsrDueAt`), or the
     * extended one once extended (`dsrExtendedDueAt`, igs-pharma#88 C9).
     */
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    /** Free text written by staff; never copied into the audit trail. */
    note: text("note"),
    createdBy: text("created_by").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedReason: text("closed_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // art. 12(3) extension (igs-pharma#88 C9): all four set, or none
    /** The one-month deadline the extension replaced. */
    originalDueAt: timestamp("original_due_at", { withTimezone: true }),
    extendedAt: timestamp("extended_at", { withTimezone: true }),
    extensionMonths: integer("extension_months"),
    /** A reason code (`DSR_EXTENSION_REASONS`), never free text. */
    extensionReason: text("extension_reason"),
    /** When staff told the person about the extension (the system sends nothing, D-019). */
    extensionNoticeAt: timestamp("extension_notice_at", { withTimezone: true }),
  },
  (t) => [
    check("dsr_requests_type_check", oneOf("type", DSR_TYPES)),
    check("dsr_requests_channel_check", oneOf("channel", DSR_CHANNELS)),
    check("dsr_requests_status_check", oneOf("status", DSR_STATUSES)),
    check("dsr_requests_due_check", sql`${t.dueAt} > ${t.receivedAt}`),
    check(
      "dsr_requests_extension_check",
      sql`(${t.originalDueAt} IS NULL AND ${t.extendedAt} IS NULL AND ${t.extensionMonths} IS NULL AND ${t.extensionReason} IS NULL AND ${t.extensionNoticeAt} IS NULL) OR (${t.originalDueAt} IS NOT NULL AND ${t.extendedAt} IS NOT NULL AND ${t.extensionMonths} IN (1, 2) AND ${t.extensionReason} IS NOT NULL AND ${t.dueAt} > ${t.originalDueAt})`,
    ),
    check(
      "dsr_requests_extension_reason_check",
      sql`${t.extensionReason} IS NULL OR ${oneOf("extension_reason", DSR_EXTENSION_REASONS)}`,
    ),
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
    /**
     * `status` (a status change), `extended` (the deadline was extended) or `notice_sent` (staff told
     * the person). For the last two the status stays: `from_status` = `to_status` (igs-pharma#88 C9).
     */
    kind: text("kind").notNull().default("status"),
  },
  (t) => [
    check("dsr_events_to_status_check", oneOf("to_status", DSR_STATUSES)),
    check("dsr_events_kind_check", oneOf("kind", DSR_EVENT_KINDS)),
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
