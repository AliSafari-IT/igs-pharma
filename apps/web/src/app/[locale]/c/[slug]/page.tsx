import { isDomainError } from "@igs/kernel";
import type { ContentLocale } from "@igs/module-catalog";
import { type StorefrontListing, listStorefrontProducts } from "@igs/module-storefront";
import type { ListSort, StorefrontCategoryNode } from "@igs/module-storefront";
import { logger } from "@igs/observability/logger";
import { Alert, Breadcrumbs, EmptyState, Pagination } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ListControls } from "../../../../components/list-controls";
import { ListingSkeleton } from "../../../../components/listing-skeleton";
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

/**
 * The products of one category and everything below it (igs-pharma#62, #104).
 *
 * The 404 is decided from the category tree BEFORE anything streams (design-system §10.8): the tree
 * is the navigation, it is read once per request for the frame anyway, and a category is in it only
 * when it has a visible, priced product below it. Only the listing waits behind `<Suspense>`, so the
 * frame, breadcrumbs and heading show at once and the status code is already settled.
 */
export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale: rawLocale, slug } = await params;
  const locale = localeOf(rawLocale);
  if (!locale || !SLUG.test(slug)) notFound();
  const t = await getTranslations({ locale, namespace: "storefront" });
  const common = await getTranslations({ locale, namespace: "common" });
  const { sort, inStock, page } = parseListParams(await searchParams, SORTS);

  const trail = await trailTo(locale, slug);
  if (trail && trail.length === 0) notFound();

  const filters = { q: undefined, sort, inStock };
  const current = trail ? trail[trail.length - 1] : undefined;
  const name = current?.name ?? t("title");

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
          ...(trail
            ? trail.map((category, index) =>
                index === trail.length - 1
                  ? { label: category.name }
                  : { label: category.name, href: `/${locale}/c/${category.slug}` },
              )
            : [{ label: name }]),
        ]}
      />
      <h1 className="mt-3 font-display text-3xl font-medium text-[var(--color-primary)]">{name}</h1>
      {!trail ? (
        <div className="mt-4">
          <Alert variant="error" title={t("unavailable")} />
        </div>
      ) : (
        // a new key per query, so a sort or page change shows the placeholder again
        <Suspense
          key={listQuery(filters, page)}
          fallback={<ListingSkeleton label={common("loading")} />}
        >
          <CategoryListing locale={locale} slug={slug} sort={sort} inStock={inStock} page={page} />
        </Suspense>
      )}
    </StorefrontFrame>
  );
}

/** The categories down to `slug` (empty: not on the storefront), or `null` when the tree can't be read. */
async function trailTo(
  locale: ContentLocale,
  slug: string,
): Promise<StorefrontCategoryNode[] | null> {
  try {
    return categoryPath(await categoryTree(locale), slug);
  } catch (error) {
    logger.error({ event: "storefront.category_failed", err: error }, "storefront.category_failed");
    return null;
  }
}

interface ListingProps {
  readonly locale: ContentLocale;
  readonly slug: string;
  readonly sort: ListSort | undefined;
  readonly inStock: boolean;
  readonly page: number;
}

/**
 * The count, the sort/filter row, the cards and the pages. Streams after the page's status is
 * sent, so it NEVER calls `notFound()`: a category that lost its last product between the tree read
 * and this one shows the empty state instead.
 */
async function CategoryListing({ locale, slug, sort, inStock, page }: ListingProps) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  let result: StorefrontListing | null = null;
  let gone = false;
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
  } catch (error) {
    gone = isDomainError(error) && error.code === "catalog.category_not_found";
    if (!gone) {
      logger.error(
        { event: "storefront.category_failed", err: error },
        "storefront.category_failed",
      );
    }
  }
  if (gone) {
    return (
      <div className="mt-4">
        <EmptyState title={t("noProducts")} />
      </div>
    );
  }
  if (!result) {
    return (
      <div className="mt-4">
        <Alert variant="error" title={t("unavailable")} />
      </div>
    );
  }
  const filters = { q: undefined, sort, inStock };
  const href = (n: number) => `/${locale}/c/${slug}${listQuery(filters, n)}`;

  return (
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
  );
}
