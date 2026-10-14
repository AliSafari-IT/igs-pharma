import { isDomainError } from "@igs/kernel";
import { type StorefrontProductPage, listStorefrontProducts } from "@igs/module-catalog";
import { logger } from "@igs/observability/logger";
import { Alert, Breadcrumbs, EmptyState, Pagination } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ProductGrid } from "../../../../components/product-grid";
import { StorefrontFrame } from "../../../../components/storefront-frame";
import { categoryPath } from "../../../../lib/category-path";
import { ensureKernelConfigured } from "../../../../server/kernel";
import {
  STOREFRONT_ACTOR,
  categoryTree,
  localeOf,
  priceAndStock,
} from "../../../../server/storefront";

const PAGE_SIZE = 24;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface Props {
  readonly params: Promise<{ locale: string; slug: string }>;
  readonly searchParams: Promise<{ page?: string | string[] }>;
}

/** The active products of one category and everything below it (igs-pharma#62, #104). */
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
  let trail: ReturnType<typeof categoryPath> = [];
  try {
    await ensureKernelConfigured();
    result = await listStorefrontProducts(
      { locale, categorySlug: slug, page, pageSize: PAGE_SIZE },
      STOREFRONT_ACTOR,
    );
    stock = await priceAndStock(result.items.map((item) => item.id));
    trail = categoryPath(await categoryTree(locale), slug);
  } catch (error) {
    if (isDomainError(error) && error.code === "catalog.category_not_found") notFound();
    logger.error({ event: "storefront.category_failed", err: error }, "storefront.category_failed");
  }
  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const href = (n: number) => `/${locale}/c/${slug}${n > 1 ? `?page=${n}` : ""}`;
  const name = result?.category?.name ?? t("title");

  return (
    <StorefrontFrame
      locale={locale}
      path={`/c/${slug}${page > 1 ? `?page=${page}` : ""}`}
      activeSlug={slug}
    >
      <Breadcrumbs
        label={t("breadcrumb")}
        items={[
          { label: t("home"), href: `/${locale}` },
          ...(trail.length > 0
            ? trail.map((category, index) =>
                index === trail.length - 1
                  ? { label: category.name }
                  : { label: category.name, href: `/${locale}/c/${category.slug}` },
              )
            : [{ label: name }]),
        ]}
      />
      <h1 className="mt-3 font-display text-3xl font-medium text-[var(--color-primary)]">{name}</h1>
      {!result || !stock ? (
        <div className="mt-4">
          <Alert variant="error" title={t("unavailable")} />
        </div>
      ) : result.items.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={t("noProducts")} />
        </div>
      ) : (
        <>
          <p className="mt-1 text-[var(--color-text-subtle)]">
            {t("productCount", { count: result.total })}
          </p>
          <div className="mt-4">
            <ProductGrid locale={locale} items={result.items} stock={stock} />
          </div>
          <Pagination
            page={result.page}
            pages={pages}
            hrefFor={href}
            className="mt-8"
            labels={{
              nav: t("pages"),
              previous: t("previous"),
              next: t("next"),
              page: (n) => t("pageNumber", { page: n }),
            }}
          />
        </>
      )}
    </StorefrontFrame>
  );
}
