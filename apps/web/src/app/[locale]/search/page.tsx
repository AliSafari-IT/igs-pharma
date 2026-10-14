import { type StorefrontListing, listStorefrontProducts } from "@igs/module-storefront";
import { logger } from "@igs/observability/logger";
import { Alert, EmptyState, Link, Pagination } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { ListControls } from "../../../components/list-controls";
import { ProductGrid } from "../../../components/product-grid";
import { StorefrontFrame } from "../../../components/storefront-frame";
import { topLevel } from "../../../lib/category-path";
import { type RawParams, isCnk, listQuery, parseListParams } from "../../../lib/list-params";
import { ensureKernelConfigured } from "../../../server/kernel";
import { STOREFRONT_ACTOR, categoryTree, localeOf } from "../../../server/storefront";

export const metadata = { robots: { index: false, follow: true } };

interface Props {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<RawParams>;
}

/**
 * Product search (igs-pharma#104): by name, brand or CNK, ranked by `@igs/module-storefront`. A
 * query that is exactly a CNK and finds that product goes straight to it. Never indexed: search
 * result pages are not content.
 */
export default async function SearchPage({ params, searchParams }: Props) {
  const locale = localeOf((await params).locale);
  if (!locale) notFound();
  const t = await getTranslations({ locale, namespace: "storefront" });
  const { q, qTooShort, sort, inStock, page } = parseListParams(await searchParams);

  let result: StorefrontListing | null = null;
  let categories: ReturnType<typeof topLevel> = [];
  let failed = false;
  if (q) {
    try {
      await ensureKernelConfigured();
      result = await listStorefrontProducts(
        {
          locale,
          q,
          page,
          ...(sort ? { sort } : {}),
          ...(inStock ? { availability: "in_stock" as const } : {}),
        },
        STOREFRONT_ACTOR,
      );
    } catch (error) {
      failed = true;
      logger.error({ event: "storefront.search_failed", err: error }, "storefront.search_failed");
    }
    // an exact CNK that is on the shelf: the product page is the answer (no redirect for a miss)
    const only = result?.items[0];
    if (isCnk(q) && result?.items.length === 1 && only) redirect(`/${locale}/p/${only.cnk}`);
  }
  if (!q || (result && result.items.length === 0) || failed) {
    try {
      await ensureKernelConfigured();
      categories = topLevel(await categoryTree(locale));
    } catch {
      // the categories are a nicety on an empty page
    }
  }
  const filters = { q, sort, inStock };
  const href = (n: number) => `/${locale}/search${listQuery(filters, n)}`;

  return (
    <StorefrontFrame locale={locale} path={`/search${listQuery(filters, page)}`} query={q}>
      <h1 className="font-display text-3xl font-medium text-[var(--color-primary)]">
        {q ? t("searchHeading", { q }) : t("searchTitle")}
      </h1>
      {qTooShort ? (
        <p role="alert" className="mt-3 text-[var(--color-error-text)]">
          {t("searchTooShort")}
        </p>
      ) : null}
      {!q && !qTooShort ? (
        <p className="mt-2 text-[var(--color-text-subtle)]">{t("searchPrompt")}</p>
      ) : null}
      {failed ? (
        <div className="mt-4">
          <Alert variant="error" title={t("unavailable")} />
        </div>
      ) : null}
      {result && result.items.length > 0 ? (
        <>
          <p className="mt-1 text-[var(--color-text-subtle)]" aria-live="polite">
            {t("productCount", { count: result.total })}
          </p>
          <div className="mt-4">
            <ListControls
              locale={locale}
              action={`/${locale}/search`}
              sorts={["relevance", "latest", "name", "price_asc", "price_desc"]}
              sort={sort}
              inStock={inStock}
              q={q}
            />
          </div>
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
      ) : null}
      {q && result && result.items.length === 0 ? (
        <div className="mt-4 flex flex-col gap-4">
          <EmptyState
            title={inStock ? t("searchNoResultsInStock", { q }) : t("searchNoResults", { q })}
          />
          <p>{t("searchNoResultsHint")}</p>
        </div>
      ) : null}
      {categories.length > 0 ? (
        <section aria-labelledby="search-categories" className="mt-8">
          <h2 id="search-categories" className="mb-3 font-display text-2xl font-semibold">
            {t("categoriesHeading")}
          </h2>
          <ul className="flex flex-wrap gap-x-4">
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/${locale}/c/${category.slug}`}
                  className="inline-flex min-h-[44px] items-center"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </StorefrontFrame>
  );
}
