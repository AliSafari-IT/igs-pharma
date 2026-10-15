import { isDomainError } from "@igs/kernel";
import { type StorefrontListing, listStorefrontProducts } from "@igs/module-storefront";
import type { ListSort } from "@igs/module-storefront";
import { logger } from "@igs/observability/logger";
import { Alert, Breadcrumbs, EmptyState, Pagination } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ListControls } from "../../../../components/list-controls";
import { ProductGrid } from "../../../../components/product-grid";
import { StorefrontFrame } from "../../../../components/storefront-frame";
import { categoryPath } from "../../../../lib/category-path";
import { type RawParams, listQuery, parseListParams } from "../../../../lib/list-params";
import { ensureKernelConfigured } from "../../../../server/kernel";
import { STOREFRONT_ACTOR, categoryTree, localeOf } from "../../../../server/storefront";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** A category list has no text query, so no "relevance". */
const SORTS: readonly ListSort[] = ["latest", "name", "price_asc", "price_desc"];

interface Props {
  readonly params: Promise<{ locale: string; slug: string }>;
  readonly searchParams: Promise<RawParams>;
}

/** The products of one category and everything below it (igs-pharma#62, #104). */
export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale: rawLocale, slug } = await params;
  const locale = localeOf(rawLocale);
  if (!locale || !SLUG.test(slug)) notFound();
  const t = await getTranslations({ locale, namespace: "storefront" });
  const { sort, inStock, page } = parseListParams(await searchParams, SORTS);

  let result: StorefrontListing | null = null;
  let trail: ReturnType<typeof categoryPath> = [];
  try {
    await ensureKernelConfigured();
    result = await listStorefrontProducts(
      {
        locale,
        categorySlug: slug,
        page,
        ...(sort ? { sort } : {}),
        ...(inStock ? { availability: "in_stock" as const } : {}),
      },
      STOREFRONT_ACTOR,
    );
    trail = categoryPath(await categoryTree(locale), slug);
  } catch (error) {
    if (isDomainError(error) && error.code === "catalog.category_not_found") notFound();
    logger.error({ event: "storefront.category_failed", err: error }, "storefront.category_failed");
  }
  const filters = { q: undefined, sort, inStock };
  const href = (n: number) => `/${locale}/c/${slug}${listQuery(filters, n)}`;
  const name = result?.category?.name ?? t("title");

  return (
    <StorefrontFrame
      locale={locale}
      path={`/c/${slug}${listQuery(filters, page)}`}
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
      {!result ? (
        <div className="mt-4">
          <Alert variant="error" title={t("unavailable")} />
        </div>
      ) : (
        <>
          <p className="mt-1 text-[var(--color-text-subtle)]">
            {t("productCount", { count: result.total })}
          </p>
          <div className="mt-4">
            <ListControls
              locale={locale}
              action={`/${locale}/c/${slug}`}
              sorts={SORTS}
              sort={sort}
              inStock={inStock}
            />
          </div>
          {result.items.length === 0 ? (
            <div className="mt-4">
              <EmptyState title={inStock ? t("noProductsInStock") : t("noProducts")} />
            </div>
          ) : (
            <>
              <div className="mt-4">
                <ProductGrid locale={locale} items={result.items} />
              </div>
              <Pagination
                page={result.page}
                pages={Math.max(1, result.pageCount)}
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
        </>
      )}
    </StorefrontFrame>
  );
}
