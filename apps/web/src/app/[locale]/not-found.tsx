import { EmptyState, Link } from "@igs/ui";
import { getLocale, getTranslations } from "next-intl/server";

import { StorefrontFrame } from "../../components/storefront-frame";
import { localeOf } from "../../server/storefront";

/**
 * Unknown paths, and products or categories the storefront does not show (a draft, an archived or
 * a prescription product look the same as a missing one, D-034): a localized page inside the
 * normal shell, so the shopper can go on from here.
 */
export default async function NotFoundPage() {
  const locale = localeOf(await getLocale()) ?? "nl";
  const t = await getTranslations({ locale, namespace: "notFound" });
  return (
    <StorefrontFrame locale={locale} path="">
      <h1 className="font-display text-3xl font-medium text-[var(--color-primary)]">
        {t("title")}
      </h1>
      <div className="mt-4">
        <EmptyState title={t("body")}>
          <div className="flex flex-wrap gap-x-6">
            <Link href={`/${locale}`} className="inline-flex min-h-[44px] items-center">
              {t("backHome")}
            </Link>
          </div>
        </EmptyState>
      </div>
    </StorefrontFrame>
  );
}
