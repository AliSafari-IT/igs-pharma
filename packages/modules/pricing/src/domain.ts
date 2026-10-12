/**
 * Pricing rules (igs-pharma#59, domain-model §3). Money is whole euro cents in an integer, never a
 * float, and a VAT rate is in basis points (600 = 6 %). Pure functions, tested on their own.
 */

/** Sales channels a price can belong to; v1 only writes `web`. */
export const PRICE_CHANNELS = ["web", "store", "b2b"] as const;
export type PriceChannel = (typeof PRICE_CHANNELS)[number];

/** The only currency v1 stores. */
export const CURRENCY = "EUR";

/** The highest price accepted (€ 100 000.00): keeps every product of the VAT maths a safe integer. */
export const MAX_AMOUNT_CENTS = 10_000_000;

/** The window of `lowestPriceInWindow` for a price reduction (Belgian rule: the previous 30 days). */
export const LOWEST_PRICE_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

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

/** The price in force at `at`: the last row (in `comparePoints` order) with `validFrom <= at`. */
export function priceAt<P extends PricePoint>(points: readonly P[], at: Date): P | null {
  let current: P | null = null;
  for (const point of points) {
    if (point.validFrom.getTime() > at.getTime()) continue;
    if (current === null || comparePoints(point, current) > 0) current = point;
  }
  return current;
}

/**
 * The lowest price that was in force at any moment of `[at − days, at]`, or `null` when the product
 * had no price in that window. A row overtaken by another with the same `validFrom` was never in
 * force, so it does not count.
 */
export function lowestPriceInWindow(
  points: readonly PricePoint[],
  at: Date,
  days: number = LOWEST_PRICE_WINDOW_DAYS,
): number | null {
  const from = at.getTime() - days * DAY_MS;
  const sorted = [...points].filter((p) => p.validFrom.getTime() <= at.getTime());
  sorted.sort(comparePoints);
  let lowest: number | null = null;
  sorted.forEach((point, index) => {
    const next = sorted[index + 1];
    // in force from its validFrom until the next row takes over (or until `at`)
    if (next && next.validFrom.getTime() === point.validFrom.getTime()) return;
    if (next && next.validFrom.getTime() <= from) return;
    if (lowest === null || point.amountCents < lowest) lowest = point.amountCents;
  });
  return lowest;
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
