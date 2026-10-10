import type React from "react";

import type { ContrastPair } from "../contrast";
import { onSurfaces } from "../contrast";
import { cn } from "../utils";

/**
 * Formats integer cents for a locale. The symbol position comes from Intl (nl-BE: "€ 12,50",
 * fr-BE: "12,50 €"), never from this code.
 */
export function formatPrice(cents: number, locale: string, currency = "EUR"): string {
  if (!Number.isInteger(cents))
    throw new RangeError(`Price: cents must be an integer, got ${cents}`);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export const priceContrast: Record<"amount" | "vat", ContrastPair[]> = {
  amount: onSurfaces("text", "text"),
  vat: onSurfaces("text-muted", "text"),
};

export interface PriceProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Integer cents, VAT included. */
  cents: number;
  /** From next-intl (`useLocale()`), e.g. "nl-BE"; @igs/ui stays i18n-free. */
  locale: string;
  currency?: string;
  /** Translated label such as "incl. btw" / "TVA comprise". */
  vatLabel?: string;
}

export function Price({
  cents,
  locale,
  currency = "EUR",
  vatLabel,
  className,
  ...props
}: PriceProps) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 font-sans", className)} {...props}>
      <data
        value={(cents / 100).toFixed(2)}
        className="font-semibold tabular-nums text-[var(--color-text)]"
      >
        {formatPrice(cents, locale, currency)}
      </data>
      {vatLabel ? <span className="text-xs text-[var(--color-text-muted)]">{vatLabel}</span> : null}
    </span>
  );
}
