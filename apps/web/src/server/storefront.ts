import { routing } from "@igs/i18n/routing";
import type { Actor } from "@igs/kernel";
import type { ContentLocale } from "@igs/module-catalog";
import { listStorefrontCategories } from "@igs/module-storefront";

import { cache } from "react";

import { ensureKernelConfigured } from "./kernel";

/**
 * The storefront reads (igs-pharma#62, #103) through `@igs/module-storefront`, which composes
 * catalogue, pricing and availability into what a shopper may see. The actor is READ-ONLY and
 * system-level (`system_storefront`), so a bug here cannot show a draft, a stock count or change
 * anything.
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

/** The BCP 47 tag `Intl` formats prices with, so "€ 12,50" or "12,50 €" follows the shopper. */
export const INTL_LOCALE: Record<ContentLocale, string> = {
  nl: "nl-BE",
  fr: "fr-BE",
  de: "de-BE",
  en: "en-BE",
};

/**
 * The category tree in `locale`, read once per request (the frame and the page both ask for it).
 * Throws when the database cannot be read: callers decide what to show.
 */
export const categoryTree = cache(async (locale: ContentLocale) => {
  await ensureKernelConfigured();
  return listStorefrontCategories({ locale }, STOREFRONT_ACTOR);
});
