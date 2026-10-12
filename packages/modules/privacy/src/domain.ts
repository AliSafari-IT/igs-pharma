/**
 * Privacy domain rules (igs-pharma#58, domain-model §10, gdpr-and-privacy §5–6), free of I/O and of
 * imports: drizzle-kit loads this file through `schema.ts`.
 */

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

/** GDPR art. 12(3): the answer is due one month after receipt; v1 counts 30 days. */
export const DSR_DEADLINE_DAYS = 30;

const DAY_MS = 86_400_000;

/** When the answer to a request received at `receivedAt` is due. */
export const dsrDueAt = (receivedAt: Date): Date =>
  new Date(receivedAt.getTime() + DSR_DEADLINE_DAYS * DAY_MS);

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
