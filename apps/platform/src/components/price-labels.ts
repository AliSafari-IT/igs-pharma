/**
 * The English text staff see for prices and pricing error codes (D-006: the kernel carries no
 * text). No domain-module import (server code), so client components can use them too.
 */
import { formatPrice } from "@igs/ui";

/** The back-office is English-only (asafarim-docs:ventures/igs-pharma/04-product/pharmacy-platform-backoffice.md). */
export const BACK_OFFICE_LOCALE = "en-GB";

/** Whole cents as euros for the English back-office: `599` → `"€5.99"` (Intl, via `@igs/ui`). */
export const formatEuros = (cents: number): string => formatPrice(cents, BACK_OFFICE_LOCALE);

/** `600` → `"6 %"`, `550` → `"5.5 %"`. */
export const formatRate = (rateBp: number): string =>
  `${rateBp % 100 === 0 ? rateBp / 100 : (rateBp / 100).toFixed(rateBp % 10 === 0 ? 1 : 2)} %`;

/** "incl. 6 % VAT, €0.34" */
export const vatLine = (rateBp: number, vatCents: number): string =>
  `incl. ${formatRate(rateBp)} VAT, ${formatEuros(vatCents)}`;

const ERRORS: Record<string, string> = {
  "pricing.amount_invalid": "Enter a price from €0.01 to €100,000.00, with at most two decimals.",
  "pricing.valid_from_in_past":
    "The start can't be in the past. Choose “From now” or a later time.",
  "pricing.valid_from_invalid": "Choose a date and a time for the new price.",
  "pricing.unknown_product": "This product no longer exists.",
  "kernel.forbidden": "You don't have permission to change prices.",
  "kernel.mfa_required": "Confirm your 2-step login first.",
  "kernel.validation_failed": "Some fields are not filled in correctly.",
};

export const priceErrorMessage = (code: string | undefined): string =>
  (code && Object.hasOwn(ERRORS, code) && ERRORS[code]) || "That didn't work. Try again.";

const BRUSSELS = "Europe/Brussels";

const wallClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: BRUSSELS,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** How far Brussels' wall clock is ahead of UTC at `ms` (1 or 2 hours). */
function brusselsOffsetMs(ms: number): number {
  const parts = Object.fromEntries(
    wallClock.formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(
    parts["year"] ?? 0,
    (parts["month"] ?? 1) - 1,
    parts["day"] ?? 1,
    parts["hour"] ?? 0,
    parts["minute"] ?? 0,
    parts["second"] ?? 0,
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * A `datetime-local` value (`YYYY-MM-DDTHH:mm`, Brussels time) as a moment, or `null` when it is not
 * one. A time skipped when the clocks go forward lands an hour later, as on a wall clock.
 */
export function brusselsLocalToDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(guess).getUTCDate() !== d) return null; // 31 February and the like
  const first = guess - brusselsOffsetMs(guess);
  return new Date(guess - brusselsOffsetMs(first));
}

/** A moment as a `datetime-local` value in Brussels time (for the dialog's `min`). */
export function toBrusselsLocal(value: Date): string {
  const shifted = new Date(value.getTime() + brusselsOffsetMs(value.getTime()));
  return shifted.toISOString().slice(0, 16);
}
