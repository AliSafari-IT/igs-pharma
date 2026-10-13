/**
 * Calendar arithmetic on the Europe/Brussels wall clock (D-003, D-038): pure, no I/O, no
 * dependencies. Moved out of the privacy module (igs-pharma#83) so that every module counts
 * calendar days and months the same way.
 *
 * A calendar day is not 24 hours: across a daylight-saving change it is 23 or 25. So the unit of
 * these functions is the calendar date, with the wall-clock time of day kept. Two edge cases of the
 * target wall time are fixed: one that does not exist (the hour skipped in March) moves forward by
 * that hour; one that happens twice (October) takes the earlier instant, the safe side for a
 * deadline and for the start of a look-back window.
 */

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

export interface LocalTime {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** The wall clock in Europe/Brussels at `instant` (a time in ms since the epoch). */
export function brusselsLocal(instant: number): LocalTime {
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
 * The instant (ms since the epoch) at which Brussels' wall clock reads `local`. A wall time that does
 * not exist (the hour skipped in March) moves forward by that hour; one that happens twice (October)
 * takes the earlier instant.
 */
export function brusselsInstant(local: LocalTime): number {
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
 * `months` calendar months after `instant` (negative: before) on the Europe/Brussels calendar, at
 * the same wall-clock time (milliseconds kept). The day of the month is clamped to the last day of
 * the target month (31 January + 1 month = 28 February, or 29 in a leap year).
 */
export function addBrusselsMonths(instant: Date, months: number): Date {
  const local = brusselsLocal(instant.getTime());
  const index = local.year * 12 + (local.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  const day = Math.min(local.day, daysInMonth(year, month));
  const result = brusselsInstant({ ...local, year, month, day });
  return new Date(result + instant.getUTCMilliseconds());
}

/**
 * `days` calendar days after `instant` (negative: before) on the Europe/Brussels calendar, at the
 * same wall-clock time (milliseconds kept). A 23- or 25-hour day counts as one day.
 */
export function addBrusselsDays(instant: Date, days: number): Date {
  const local = brusselsLocal(instant.getTime());
  // day arithmetic on the calendar date alone
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  const result = brusselsInstant({
    ...local,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
  return new Date(result + instant.getUTCMilliseconds());
}
