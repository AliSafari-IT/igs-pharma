import type { Locale } from "./api/types";

const INTL: Record<Locale, string> = { nl: "nl-BE", fr: "fr-BE", de: "de-BE", en: "en-BE" };

export const intlLocale = (locale: Locale) => INTL[locale];

/** "€ 12,50" / "12,50 €" from euro cents, as the storefront shows it for that language. */
export function formatPrice(amountCents: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL[locale], { style: "currency", currency: "EUR" }).format(
    amountCents / 100,
  );
}

/** "6 %" from basis points (600). */
export function formatVatRate(vatRateBp: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL[locale], { style: "percent", maximumFractionDigits: 1 }).format(
    vatRateBp / 10_000,
  );
}

/** Whether a value from the pharmacy identity is still a stand-in such as "[city]". */
export const isStandIn = (value: string) => /^\[.*\]$/.test(value.trim());

/** Digits and a leading + only, for a tel: link. */
export const telUrl = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
