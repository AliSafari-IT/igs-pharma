import { routing } from "@igs/i18n/routing";
import type { Actor } from "@igs/kernel";
import type { ContentLocale } from "@igs/module-catalog";
import { getAvailability } from "@igs/module-inventory";
import { type CurrentPrice, currentPrices } from "@igs/module-pricing";

import { ensureKernelConfigured } from "./kernel";

/**
 * The storefront reads (igs-pharma#62) through the modules' public queries, as `apps/platform` does,
 * but as a READ-ONLY system actor: `system_storefront` holds `catalog.storefront.read` (active
 * products only), `inventory.availability.read` (in or out, never counts) and `pricing.price.read`.
 * It holds no write permission and no staff read permission, so a bug here cannot show a draft, a
 * stock level or change anything.
 */
export const STOREFRONT_ACTOR: Actor = {
  type: "system",
  id: "storefront",
  roles: ["system_storefront"],
};

/** The shopper's language from the URL, or `null` for anything this storefront does not have. */
export function localeOf(value: string): ContentLocale | null {
  return (routing.locales as readonly string[]).includes(value) ? (value as ContentLocale) : null;
}

/** Prices (VAT included) and availability of these products, by product id. */
export interface PriceAndStock {
  readonly prices: ReadonlyMap<string, CurrentPrice>;
  readonly inStock: ReadonlyMap<string, boolean>;
}

/** Configures the kernel and looks up the current price and availability of `productIds`. */
export async function priceAndStock(productIds: readonly string[]): Promise<PriceAndStock> {
  await ensureKernelConfigured();
  if (productIds.length === 0) return { prices: new Map(), inStock: new Map() };
  const ids = [...productIds];
  const [prices, availability] = await Promise.all([
    currentPrices({ productIds: ids }, STOREFRONT_ACTOR),
    getAvailability({ productIds: ids }, STOREFRONT_ACTOR),
  ]);
  return {
    prices: new Map(prices.map((p) => [p.productId, p])),
    inStock: new Map(availability.map((a) => [a.productId, a.inStock])),
  };
}

/** The BCP 47 tag `Intl` formats prices with, so "€ 12,50" or "12,50 €" follows the shopper. */
export const INTL_LOCALE: Record<ContentLocale, string> = {
  nl: "nl-BE",
  fr: "fr-BE",
  de: "de-BE",
  en: "en-BE",
};
