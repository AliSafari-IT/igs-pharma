import { getFeatureFlags } from "@igs/config/feature-flags";
import type { ContentLocale } from "@igs/module-catalog";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { localeOf } from "./storefront";

/**
 * The storefront account pages (igs-pharma#115) exist only while `NEXT_PUBLIC_FEATURE_CUSTOMER_ACCOUNTS`
 * is on (D-044): otherwise every one of them is the plain 404, like the `/api/auth` routes behind
 * them. Returns the shopper's locale, or answers 404 for an unknown locale too.
 */
export function accountLocale(rawLocale: string): ContentLocale {
  const locale = localeOf(rawLocale);
  if (!locale || !getFeatureFlags().customerAccounts) notFound();
  return locale;
}

/** Account pages are utility pages: never indexed, links not followed. */
export const ACCOUNT_ROBOTS = { index: false, follow: false } as const;

/** The page title in the shopper's language (a key of the `account` namespace) and no indexing. */
export async function accountMetadata(rawLocale: string, titleKey: string) {
  const locale = localeOf(rawLocale);
  if (!locale || !getFeatureFlags().customerAccounts) return { robots: ACCOUNT_ROBOTS };
  const t = await getTranslations({ locale, namespace: "account" });
  return { title: `${t(titleKey)} · IGS-Pharma`, robots: ACCOUNT_ROBOTS };
}
