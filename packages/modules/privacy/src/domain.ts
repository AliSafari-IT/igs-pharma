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

const DAY_MS = 86_400_000;

const BRUSSELS = "Europe/Brussels";

const brusselsParts = new Intl.DateTimeFormat("en-US", {
  timeZone: BRUSSELS,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

interface LocalTime {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** The wall clock in Europe/Brussels at `instant`. */
function brusselsLocal(instant: number): LocalTime {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(brusselsParts.formatToParts(instant).find((p) => p.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

const localAsUtc = (t: LocalTime): number =>
  Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);

/** Europe/Brussels' offset from UTC at `instant`, in ms (whole seconds). */
const brusselsOffset = (instant: number): number =>
  localAsUtc(brusselsLocal(instant)) - Math.floor(instant / 1000) * 1000;

/**
 * The instant at which Brussels' wall clock reads `local`. A wall time that does not exist (the
 * hour skipped in March) moves forward by that hour; one that happens twice (October) takes the
 * earlier instant, the safe side. A due date can only hit the March gap (28 Feb → 28 Mar), never
 * the October repeat (there is no 31 September), but the helper handles both.
 */
function brusselsInstant(local: LocalTime): number {
  const wall = localAsUtc(local);
  const before = brusselsOffset(wall - DAY_MS);
  const after = brusselsOffset(wall + DAY_MS);
  const candidates = [before, after]
    .map((offset) => wall - offset)
    .filter((instant) => brusselsOffset(instant) === wall - instant);
  // no candidate: the wall time falls in the March gap; the offset from before the gap lands after it
  return candidates.length > 0 ? Math.min(...candidates) : wall - before;
}

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * When the answer to a request received at `receivedAt` is due: GDPR art. 12(3) gives one month,
 * counted per Reg. (EEC, Euratom) 1182/71, i.e. the same date in the next month, or the last day of
 * that month when it has no such date. We add one calendar month on the Europe/Brussels calendar
 * (D-003), keep the local time of day and clamp to the month's last day. We do NOT extend a
 * deadline that falls on a weekend or holiday: an earlier internal deadline is safe, and
 * `isDsrOverdue` flagging a day early is acceptable. (Art. 12(3)'s extension is not modelled.)
 */
export function dsrDueAt(receivedAt: Date): Date {
  const local = brusselsLocal(receivedAt.getTime());
  const year = local.month === 12 ? local.year + 1 : local.year;
  const month = local.month === 12 ? 1 : local.month + 1;
  const day = Math.min(local.day, daysInMonth(year, month));
  const due = brusselsInstant({ ...local, year, month, day });
  return new Date(due + receivedAt.getUTCMilliseconds());
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
