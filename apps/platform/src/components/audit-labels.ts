/**
 * The audit trail page (igs-pharma#220), kept free of React and Next so it is unit-tested: the URL's
 * filters, Brussels days to instants, and how an actor reads.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const offsetFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Brussels",
  timeZoneName: "longOffset",
});

/** Brussels' offset from UTC at `instant`, in ms ("GMT+02:00" → 7 200 000). */
function brusselsOffsetMs(instant: number): number {
  const name = offsetFormat.formatToParts(instant).find((p) => p.type === "timeZoneName")?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? "");
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

/**
 * The instant Brussels' day `YYYY-MM-DD` starts, or `null` for anything that is not a real day.
 * Daylight saving changes at 02:00 or 03:00, so midnight always exists exactly once.
 */
export function brusselsDayStart(day: string): Date | null {
  const match = DAY.exec(day);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = Date.UTC(y, m - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return new Date(utc - brusselsOffsetMs(utc - brusselsOffsetMs(utc)));
}

/** `YYYY-MM-DD` of `instant` in Brussels. */
export function brusselsDay(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(instant);
}

/** The day `days` after `day` (`YYYY-MM-DD`, calendar arithmetic). */
export function addDays(day: string, days: number): string {
  const start = Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
  );
  return new Date(start + days * 86_400_000).toISOString().slice(0, 10);
}

/** How many days the page shows when no dates are given. */
export const DEFAULT_WINDOW_DAYS = 30;

export interface AuditFilters {
  readonly fromDay: string;
  /** Inclusive: the page searches up to the END of this day. */
  readonly toDay: string;
  readonly action?: string;
  readonly actorId?: string;
  readonly entityId?: string;
  readonly refused: boolean;
  readonly page: number;
}

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

/** The filters in the URL; bad or missing dates fall back to the last 30 days ending today. */
export function filtersOf(
  params: Readonly<Record<string, string | string[] | undefined>>,
  now: Date,
): AuditFilters {
  const today = brusselsDay(now);
  const toDay = first(params["to"]);
  const fromDay = first(params["from"]);
  const to = toDay && brusselsDayStart(toDay) ? toDay : today;
  const from =
    fromDay && brusselsDayStart(fromDay) && fromDay <= to
      ? fromDay
      : addDays(to, -(DEFAULT_WINDOW_DAYS - 1));
  const page = Number.parseInt(first(params["page"]) ?? "1", 10);
  const action = first(params["action"]);
  const actorId = first(params["actor"]);
  const entityId = first(params["entity"]);
  return {
    fromDay: from,
    toDay: to,
    ...(action ? { action } : {}),
    ...(actorId ? { actorId } : {}),
    ...(entityId ? { entityId } : {}),
    refused: first(params["refused"]) === "1",
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** The URL of these filters on another page. */
export function auditHref(filters: AuditFilters, page: number): string {
  const params = new URLSearchParams({ from: filters.fromDay, to: filters.toDay });
  if (filters.refused) params.set("refused", "1");
  else if (filters.action) params.set("action", filters.action);
  if (filters.actorId) params.set("actor", filters.actorId);
  if (filters.entityId) params.set("entity", filters.entityId);
  if (page > 1) params.set("page", String(page));
  return `/audit?${params}`;
}

/** Who did it, as the table shows them: a staff member's name, else the kind and the id. */
export function actorLabel(
  actorType: string,
  actorId: string,
  staffNames: ReadonlyMap<string, string>,
): string {
  const name = staffNames.get(actorId);
  if (name) return name;
  switch (actorType) {
    case "user":
      // a customer, or a staff account that has since been deleted
      return `Account ${actorId.slice(0, 8)}…`;
    case "anonymous":
      return "Anonymous visitor";
    case "system":
      return `System (${actorId})`;
    case "webhook":
      return `Webhook (${actorId})`;
    default:
      return `${actorType} ${actorId}`;
  }
}

/** A data value as text (ids, codes, numbers, flags). */
export const dataValue = (value: string | number | boolean | null): string =>
  value === null ? "none" : String(value);
