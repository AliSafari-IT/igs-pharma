/**
 * Privacy domain rules (igs-pharma#58, domain-model §10, gdpr-and-privacy §5–6), free of I/O:
 * drizzle-kit loads this file through `schema.ts`, so it imports only pure leaf packages (`@igs/time`).
 */
import { addBrusselsMonths } from "@igs/time";

/** What a consent is for. The storefront banner (Phase 1b) records the same purposes. */
export const CONSENT_PURPOSES = ["marketing_email", "analytics_cookies"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Where a consent was given or withdrawn. */
export const CONSENT_SOURCES = [
  "storefront",
  "in_store",
  "phone",
  "back_office",
  "import",
] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** The sources staff pick in the back-office form (`storefront` and `import` come from systems). */
export const STAFF_CONSENT_SOURCES = ["in_store", "phone", "back_office"] as const;
export type StaffConsentSource = (typeof STAFF_CONSENT_SOURCES)[number];

/** GDPR art. 15–21. `access` also covers a request for the data in a portable file (art. 20). */
export const DSR_TYPES = [
  "access",
  "erasure",
  "rectification",
  "restriction",
  "objection",
] as const;
export type DsrType = (typeof DSR_TYPES)[number];

/** How the request reached us. */
export const DSR_CHANNELS = ["email", "in_store", "post", "other"] as const;
export type DsrChannel = (typeof DSR_CHANNELS)[number];

export const DSR_STATUSES = ["received", "in_progress", "completed", "rejected"] as const;
export type DsrStatus = (typeof DSR_STATUSES)[number];

/** Statuses a request can no longer leave. */
export const FINAL_DSR_STATUSES: readonly DsrStatus[] = ["completed", "rejected"];

/** The allowed moves: `received → in_progress → completed`, and `received | in_progress → rejected`. */
const NEXT_STATUSES: Readonly<Record<DsrStatus, readonly DsrStatus[]>> = {
  received: ["in_progress", "rejected"],
  in_progress: ["completed", "rejected"],
  completed: [],
  rejected: [],
};

export const nextDsrStatuses = (from: DsrStatus): readonly DsrStatus[] => NEXT_STATUSES[from];

export const canMoveDsr = (from: DsrStatus, to: DsrStatus): boolean =>
  NEXT_STATUSES[from].includes(to);

export const isFinalDsrStatus = (status: DsrStatus): boolean => FINAL_DSR_STATUSES.includes(status);

const DAY_MS = 86_400_000;

/**
 * When the answer to a request received at `receivedAt` is due: GDPR art. 12(3) gives one month,
 * counted per Reg. (EEC, Euratom) 1182/71, i.e. the same date in the next month, or the last day of
 * that month when it has no such date. We add one calendar month on the Europe/Brussels calendar
 * (D-003), keep the local time of day and clamp to the month's last day. We do NOT extend a
 * deadline that falls on a weekend or holiday: an earlier internal deadline is safe, and
 * `isDsrOverdue` flagging a day early is acceptable. (Art. 12(3)'s extension is not modelled.)
 */
export function dsrDueAt(receivedAt: Date): Date {
  return addBrusselsMonths(receivedAt, 1);
}

/** An open request whose deadline has passed. */
export const isDsrOverdue = (status: DsrStatus, dueAt: Date, now: Date): boolean =>
  !isFinalDsrStatus(status) && dueAt.getTime() < now.getTime();

/** Whole days until `dueAt`, rounded up (0 on the day it falls due, negative once overdue). */
export const daysUntil = (dueAt: Date, now: Date): number =>
  Math.ceil((dueAt.getTime() - now.getTime()) / DAY_MS);

export const MAX_SUBJECT_REF_LENGTH = 254;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The subject reference of v1: the person's e-mail address, trimmed and lower-cased so the same
 * person always gets the same reference. `null` when it is not a plausible e-mail address. Once
 * customer accounts exist, requests and consents also get the customer id.
 */
export function normalizeSubjectRef(value: string): string | null {
  const ref = value.trim().toLowerCase();
  if (ref.length === 0 || ref.length > MAX_SUBJECT_REF_LENGTH || !EMAIL.test(ref)) return null;
  return ref;
}

/**
 * Retention of personal data in the privacy ledgers (igs-pharma#88, REQ-PRV-04). The periods are legal
 * decisions: this is the documented default per key, seeded into `privacy.retention_policy` by a
 * migration (a test keeps the two equal); the purge function reads the TABLE, so a value changes by a
 * reviewed migration, never by the worker. `months: null` means keep: never purge that scope.
 *
 * **Every value here awaits the privacy adviser (and the owner) to confirm.**
 */
export const RETENTION_KEYS = ["consent_after_withdrawal", "dsr_after_close"] as const;
export type RetentionKey = (typeof RETENTION_KEYS)[number];

export interface RetentionDefault {
  /** Calendar months (Europe/Brussels) after the clock starts; `null`: keep, never purge. */
  readonly months: number | null;
  /** Always `true` until the adviser has decided; flipped by the migration that sets the real value. */
  readonly awaitsPrivacyAdviser: boolean;
  readonly description: string;
}

export const RETENTION_DEFAULTS: Readonly<Record<RetentionKey, RetentionDefault>> = {
  consent_after_withdrawal: {
    months: 60,
    awaitsPrivacyAdviser: true,
    description:
      "A consent chain whose latest event is a withdrawal is deleted this many months after it (consent period + 5 years, REQ-PRV-04). A chain whose latest event is a grant is never purged.",
  },
  dsr_after_close: {
    months: null,
    awaitsPrivacyAdviser: true,
    description:
      "A closed data-subject request is deleted with its events this many months after it closed. Switched OFF (keep): the requests are also the evidence that deadlines were met.",
  },
};
