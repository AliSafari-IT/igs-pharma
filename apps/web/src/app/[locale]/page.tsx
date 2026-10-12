import { type StorefrontProductPage, listStorefrontProducts } from "@igs/module-catalog";
import { logger } from "@igs/observability/logger";
import { Alert } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ProductCard } from "../../components/product-card";
import { StorefrontFrame } from "../../components/storefront-frame";
import { ensureKernelConfigured } from "../../server/kernel";
import { STOREFRONT_ACTOR, localeOf, priceAndStock } from "../../server/storefront";

/** How many products the home page shows. */
const FEATURED = 8;

/** The storefront home (igs-pharma#62): the category tree beside a few products. */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeOf((await params).locale);
  if (!locale) notFound();
  const t = await getTranslations({ locale, namespace: "storefront" });

  let page: StorefrontProductPage | null = null;
  let stock: Awaited<ReturnType<typeof priceAndStock>> | null = null;
  try {
    await ensureKernelConfigured();
    page = await listStorefrontProducts({ locale, pageSize: FEATURED }, STOREFRONT_ACTOR);
    stock = await priceAndStock(page.items.map((item) => item.id));
  } catch (error) {
    logger.error({ event: "storefront.home_failed", err: error }, "storefront.home_failed");
  }

  return (
    <StorefrontFrame locale={locale} path="">
      <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">IGS-Pharma</h1>
      <h2 className="mt-6 font-display text-2xl font-semibold">{t("title")}</h2>
      {!page || !stock ? (
        <div className="mt-4">
          <Alert variant="error" title={t("unavailable")} />
        </div>
      ) : page.items.length === 0 ? (
        <p className="mt-4 text-[var(--color-text-subtle)]">{t("noProducts")}</p>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {page.items.map((item) => (
            <ProductCard
              key={item.id}
              locale={locale}
              item={item}
              price={stock.prices.get(item.id)}
              inStock={stock.inStock.get(item.id) ?? false}
            />
          ))}
        </ul>
      )}
    </StorefrontFrame>
  );
}
