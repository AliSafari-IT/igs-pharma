import { isDomainError } from "@igs/kernel";
import { type StorefrontProductPage, listStorefrontProducts } from "@igs/module-catalog";
import { logger } from "@igs/observability/logger";
import { Alert, Link } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ProductCard } from "../../../../components/product-card";
import { StorefrontFrame } from "../../../../components/storefront-frame";
import { ensureKernelConfigured } from "../../../../server/kernel";
import { STOREFRONT_ACTOR, localeOf, priceAndStock } from "../../../../server/storefront";

const PAGE_SIZE = 24;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface Props {
  readonly params: Promise<{ locale: string; slug: string }>;
  readonly searchParams: Promise<{ page?: string | string[] }>;
}

/** The active products of one category and everything below it (igs-pharma#62). */
export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale: rawLocale, slug } = await params;
  const locale = localeOf(rawLocale);
  if (!locale || !SLUG.test(slug)) notFound();
  const t = await getTranslations({ locale, namespace: "storefront" });
  const raw = (await searchParams).page;
  const page = Math.max(
    1,
    Math.min(10_000, Number.parseInt((Array.isArray(raw) ? raw[0] : raw) ?? "1", 10) || 1),
  );

  let result: StorefrontProductPage | null = null;
  let stock: Awaited<ReturnType<typeof priceAndStock>> | null = null;
  try {
    await ensureKernelConfigured();
    result = await listStorefrontProducts(
      { locale, categorySlug: slug, page, pageSize: PAGE_SIZE },
      STOREFRONT_ACTOR,
    );
    stock = await priceAndStock(result.items.map((item) => item.id));
  } catch (error) {
    if (isDomainError(error) && error.code === "catalog.category_not_found") notFound();
    logger.error({ event: "storefront.category_failed", err: error }, "storefront.category_failed");
  }
  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const href = (n: number) => `/${locale}/c/${slug}?page=${n}`;

  return (
    <StorefrontFrame locale={locale} path={`/c/${slug}`} activeSlug={slug}>
      <h1 className="font-display text-3xl font-medium text-[var(--color-primary)]">
        {result?.category?.name ?? t("title")}
      </h1>
      {!result || !stock ? (
        <div className="mt-4">
          <Alert variant="error" title={t("unavailable")} />
        </div>
      ) : result.items.length === 0 ? (
        <p className="mt-4 text-[var(--color-text-subtle)]">{t("noProducts")}</p>
      ) : (
        <>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {result.items.map((item) => (
              <ProductCard
                key={item.id}
                locale={locale}
                item={item}
                price={stock.prices.get(item.id)}
                inStock={stock.inStock.get(item.id) ?? false}
              />
            ))}
          </ul>
          {pages > 1 ? (
            <nav aria-label={t("pages")} className="mt-6 flex items-center gap-4">
              {result.page > 1 ? <Link href={href(result.page - 1)}>{t("previous")}</Link> : null}
              <span className="text-sm text-[var(--color-text-subtle)]">
                {t("page", { page: result.page, pages })}
              </span>
              {result.page < pages ? <Link href={href(result.page + 1)}>{t("next")}</Link> : null}
            </nav>
          ) : null}
        </>
      )}
    </StorefrontFrame>
  );
}
