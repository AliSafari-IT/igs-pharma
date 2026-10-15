import { listStorefrontProducts } from "@igs/module-storefront";
import type { StorefrontListing } from "@igs/module-storefront";
import { logger } from "@igs/observability/logger";
import { Alert, EmptyState } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { CategoryGrid } from "../../components/category-grid";
import { PharmacyPanel } from "../../components/pharmacy-panel";
import { ProductGrid } from "../../components/product-grid";
import { StorefrontFrame } from "../../components/storefront-frame";
import { topLevel } from "../../lib/category-path";
import { ensureKernelConfigured } from "../../server/kernel";
import { STOREFRONT_ACTOR, categoryTree, localeOf } from "../../server/storefront";

/** How many products the home page shows. */
const FEATURED = 6;

/**
 * The storefront home (igs-pharma#62, #104, #112): what the shop is (a calm hero band), where the
 * pharmacy is, the categories as a grid and the latest products. The copy is factual: no claims
 * about quality or health (medicine advertising rules).
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeOf((await params).locale);
  if (!locale) notFound();
  const t = await getTranslations({ locale, namespace: "storefront" });

  let listing: StorefrontListing | null = null;
  let categories: ReturnType<typeof topLevel> = [];
  try {
    await ensureKernelConfigured();
    categories = topLevel(await categoryTree(locale));
    listing = await listStorefrontProducts(
      { locale, sort: "latest", pageSize: FEATURED },
      STOREFRONT_ACTOR,
    );
  } catch (error) {
    logger.error({ event: "storefront.home_failed", err: error }, "storefront.home_failed");
  }

  return (
    <StorefrontFrame locale={locale} path="">
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] lg:gap-6">
        <div
          data-testid="home-hero"
          className="flex flex-col justify-center rounded-[var(--radius-lg)] bg-[var(--color-primary-subtle)] p-6 sm:p-8"
        >
          <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">
            IGS-Pharma
          </h1>
          <p className="mt-2 max-w-prose text-lg text-[var(--color-text-subtle)]">{t("tagline")}</p>
        </div>
        <PharmacyPanel locale={locale} />
      </div>
      {!listing ? (
        <div className="mt-6">
          <Alert variant="error" title={t("unavailable")} />
        </div>
      ) : (
        <>
          {categories.length > 0 ? (
            <section aria-labelledby="home-categories" className="mt-8">
              <h2 id="home-categories" className="mb-3 font-display text-2xl font-semibold">
                {t("categoriesHeading")}
              </h2>
              <CategoryGrid locale={locale} categories={categories} />
            </section>
          ) : null}
          <section aria-labelledby="home-products" className="mt-10">
            <h2 id="home-products" className="mb-3 font-display text-2xl font-semibold">
              {t("latestHeading")}
            </h2>
            {listing.items.length === 0 ? (
              <EmptyState title={t("noProducts")} />
            ) : (
              <ProductGrid locale={locale} items={listing.items} />
            )}
          </section>
        </>
      )}
    </StorefrontFrame>
  );
}
