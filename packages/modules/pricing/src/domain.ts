/**
 * Pricing rules (igs-pharma#59, domain-model §3). Money is whole euro cents in an integer, never a
 * float, and a VAT rate is in basis points (600 = 6 %). Pure functions, tested on their own.
 */

import { addBrusselsDays } from "@igs/time";

/** Sales channels a price can belong to; v1 only writes `web`. */
export const PRICE_CHANNELS = ["web", "store", "b2b"] as const;
export type PriceChannel = (typeof PRICE_CHANNELS)[number];

/** The only currency v1 stores. */
export const CURRENCY = "EUR";

/** The highest price accepted (€ 100 000.00): keeps every product of the VAT maths a safe integer. */
export const MAX_AMOUNT_CENTS = 10_000_000;

/** The window of `lowestPriceBefore`: the 30 calendar days before a price reduction (Omnibus, art. 6a). */
export const LOWEST_PRICE_WINDOW_DAYS = 30;

/** A positive whole number of cents, at most `MAX_AMOUNT_CENTS`. */
export const isValidAmount = (cents: number): boolean =>
  Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_AMOUNT_CENTS;

/**
 * The VAT part of a price that includes VAT: `round(amount × rate / (10000 + rate))`, half up, in
 * integer arithmetic only (for 6 % and 21 % an exact half cent never occurs, but the rule is fixed).
 */
export function vatPartCents(amountCents: number, rateBp: number): number {
  const divisor = 10_000 + rateBp;
  return Math.floor((2 * amountCents * rateBp + divisor) / (2 * divisor));
}

/** A price including VAT, split into its VAT part and the price without VAT. */
export function splitVat(
  amountCents: number,
  rateBp: number,
): { vatCents: number; exVatCents: number } {
  const vatCents = vatPartCents(amountCents, rateBp);
  return { vatCents, exVatCents: amountCents - vatCents };
}

/** One row of a price history, as the pure functions need it. */
export interface PricePoint {
  readonly id: string;
  readonly amountCents: number;
  readonly validFrom: Date;
}

/**
 * The order in which prices take over: by `validFrom`, and for the same `validFrom` the row written
 * last wins (UUIDv7 ids sort by creation time).
 */
export const comparePoints = (a: PricePoint, b: PricePoint): number =>
  a.validFrom.getTime() - b.validFrom.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * For each row of a price history sorted by `comparePoints`, the amount it replaced: the amount of
 * the last row with a STRICTLY earlier `validFrom`, or `null` for the first one. Rows that start at
 * the same instant all replaced what was in force before that instant. One pass with a running
 * "previous" value (igs-pharma#96); it used to rescan every earlier row for each row.
 */
export function previousAmounts(
  rows: readonly { readonly validFrom: Date; readonly amountCents: number }[],
): (number | null)[] {
  let previous: number | null = null; // the last row of the group before the current instant
  let groupStart: number | null = null; // the instant of the current group
  let groupLast: number | null = null; // the last amount seen in the current group
  return rows.map((row) => {
    const start = row.validFrom.getTime();
    if (start !== groupStart) {
      previous = groupLast;
      groupStart = start;
    }
    groupLast = row.amountCents;
    return previous;
  });
}

/** The price in force at `at`: the last row (in `comparePoints` order) with `validFrom <= at`. */
export function priceAt<P extends PricePoint>(points: readonly P[], at: Date): P | null {
  let current: P | null = null;
  for (const point of points) {
    if (point.validFrom.getTime() > at.getTime()) continue;
    if (current === null || comparePoints(point, current) > 0) current = point;
  }
  return current;
}

/** What the reference price of a reduction is, and how much history stands behind it. */
export interface ReferencePrice {
  readonly cents: number;
  /**
   * Whether the price history reaches back to the start of the window. `false`: the product was first
   * priced inside the window, so the reference is the lowest price actually applied in the history
   * that exists (no price is invented for the missing days).
   */
  readonly fullWindow: boolean;
}

/**
 * The lowest price in force at any moment of `[appliedAt − days, appliedAt)`, the reference price of
 * a reduction applied at `appliedAt` (Omnibus, art. 6a Directive 98/6/EC as amended): the window is
 * counted in Europe/Brussels calendar days (not 24-hour days) and is open at the end, so the price
 * that starts at `appliedAt`, the reduction itself, or anything later never counts. The price in
 * force when the window opens counts. A row overtaken by another with the same `validFrom` was
 * never in force. `null` when no price was in force in the window.
 */
export function lowestPriceBefore(
  points: readonly PricePoint[],
  appliedAt: Date,
  days: number = LOWEST_PRICE_WINDOW_DAYS,
): ReferencePrice | null {
  const end = appliedAt.getTime();
  const start = addBrusselsDays(appliedAt, -days).getTime();
  const sorted = points.filter((p) => p.validFrom.getTime() < end).sort(comparePoints);
  let lowest: number | null = null;
  let earliest: number | null = null;
  sorted.forEach((point, index) => {
    const next = sorted[index + 1];
    // in force from its validFrom until the next row takes over (or until `appliedAt`)
    if (next && next.validFrom.getTime() === point.validFrom.getTime()) return;
    if (next && next.validFrom.getTime() <= start) return;
    if (lowest === null || point.amountCents < lowest) lowest = point.amountCents;
    if (earliest === null || point.validFrom.getTime() < earliest)
      earliest = point.validFrom.getTime();
  });
  if (lowest === null || earliest === null) return null;
  return { cents: lowest, fullWindow: earliest <= start };
}

/** A price reduction in force at some moment, with its reference price. */
export interface PriceReduction {
  readonly currentCents: number;
  /** When the current price took over: the moment the reduction was applied. */
  readonly appliedAt: Date;
  readonly referenceCents: number;
  readonly fullWindow: boolean;
}

/**
 * The reduction in force at `at`, or `null` when there is none: no price at `at`, no price before
 * it, or a current price that is not lower than the reference. The reference is the lowest price of
 * the 30 days BEFORE the current price took over, so a reduction after a reduction is measured
 * against the lowest of the window before the latest one, and the reduction never defines itself.
 */
export function priceReductionAt(
  points: readonly PricePoint[],
  at: Date,
  days: number = LOWEST_PRICE_WINDOW_DAYS,
): PriceReduction | null {
  const current = priceAt(points, at);
  if (current === null) return null;
  const reference = lowestPriceBefore(points, current.validFrom, days);
  if (reference === null || current.amountCents >= reference.cents) return null;
  return {
    currentCents: current.amountCents,
    appliedAt: current.validFrom,
    referenceCents: reference.cents,
    fullWindow: reference.fullWindow,
  };
}

/** `1234` → `"12.34"` (the UI adds the euro sign and the locale's separators). */
export const centsToDecimal = (cents: number): string =>
  `${Math.trunc(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

/**
 * A euro amount typed by staff (`"12"`, `"12.5"`, `"12,50"`, `"€ 1 234,56"`) in cents, or `null`
 * when it is not a positive amount with at most two decimals.
 */
export function parseEuros(text: string): number | null {
  const cleaned = text.replace(/[€\s]/g, "").replace(",", ".");
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return isValidAmount(cents) ? cents : null;
}
