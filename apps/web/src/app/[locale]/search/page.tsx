import type { ContentLocale } from "@igs/module-catalog";
import {
  type ListSort,
  type StorefrontListing,
  listStorefrontProducts,
} from "@igs/module-storefront";
import { logger } from "@igs/observability/logger";
import { Alert, EmptyState, Link, Pagination } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { ListControls } from "../../../components/list-controls";
import { ListingSkeleton } from "../../../components/listing-skeleton";
import { ProductGrid } from "../../../components/product-grid";
import { StorefrontFrame } from "../../../components/storefront-frame";
import { topLevel } from "../../../lib/category-path";
import {
  type RawParams,
  isCnk,
  listQuery,
  parseListParams,
  searchStreams,
} from "../../../lib/list-params";
import { ensureKernelConfigured } from "../../../server/kernel";
import { STOREFRONT_ACTOR, categoryTree, localeOf } from "../../../server/storefront";

export const metadata = { robots: { index: false, follow: true } };

const SORTS: readonly ListSort[] = ["relevance", "latest", "name", "price_asc", "price_desc"];

interface Props {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<RawParams>;
}

/** What one search came back with: the listing, or `null` when it failed (already logged). */
interface Outcome {
  readonly result: StorefrontListing | null;
}

/**
 * Product search (igs-pharma#104): by name, brand or CNK, ranked by `@igs/module-storefront`. A
 * query that is exactly a CNK and finds that product goes straight to it. Never indexed: search
 * result pages are not content.
 *
 * Loading (design-system §10.8): the heading, the too-short alert and the prompt render at once and
 * the results stream behind `<Suspense>`. The one thing that changes the response itself, the
 * exact-CNK redirect, is decided BEFORE anything streams: a CNK query is looked up up front (a
 * single-key lookup, little to wait for), because a `redirect()` inside a streamed boundary could no
 * longer send a 307.
 */
export default async function SearchPage({ params, searchParams }: Props) {
  const locale = localeOf((await params).locale);
  if (!locale) notFound();
  const t = await getTranslations({ locale, namespace: "storefront" });
  const common = await getTranslations({ locale, namespace: "common" });
  const { q, qTooShort, sort, inStock, page } = parseListParams(await searchParams);

  let outcome: Outcome | undefined;
  if (q && isCnk(q)) {
    outcome = await runSearch(locale, q, sort, inStock, page);
    // an exact CNK that is on the shelf: the product page is the answer (no redirect for a miss)
    const only = outcome.result?.items[0];
    if (outcome.result?.items.length === 1 && only) redirect(`/${locale}/p/${only.cnk}`);
  }
  const filters = { q, sort, inStock };
  const results = (
    <SearchResults
      locale={locale}
      q={q}
      sort={sort}
      inStock={inStock}
      page={page}
      outcome={outcome}
    />
  );

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
      {searchStreams(q) ? (
        // a new key per query, so a new search, sort or page shows the placeholder again
        <Suspense
          key={listQuery(filters, page)}
          fallback={<ListingSkeleton label={common("loading")} />}
        >
          {results}
        </Suspense>
      ) : (
        results
      )}
    </StorefrontFrame>
  );
}

async function runSearch(
  locale: ContentLocale,
  q: string,
  sort: ListSort | undefined,
  inStock: boolean,
  page: number,
): Promise<Outcome> {
  try {
    await ensureKernelConfigured();
    const result = await listStorefrontProducts(
      {
        locale,
        q,
        page,
        ...(sort ? { sort } : {}),
        ...(inStock ? { availability: "in_stock" as const } : {}),
      },
      STOREFRONT_ACTOR,
    );
    return { result };
  } catch (error) {
    logger.error({ event: "storefront.search_failed", err: error }, "storefront.search_failed");
    return { result: null };
  }
}

interface ResultsProps {
  readonly locale: ContentLocale;
  readonly q: string | undefined;
  readonly sort: ListSort | undefined;
  readonly inStock: boolean;
  readonly page: number;
  /** Already looked up (a CNK query); otherwise this component runs the search itself. */
  readonly outcome: Outcome | undefined;
}

/**
 * The failure alert, the count, the sort/filter row, the cards, the pages, the empty state and the
 * "browse by category" way out. Streams after the page's status is sent, so it NEVER calls
 * `redirect()` or `notFound()`.
 */
async function SearchResults({ locale, q, sort, inStock, page, outcome }: ResultsProps) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  const result = q ? (outcome ?? (await runSearch(locale, q, sort, inStock, page))).result : null;
  const failed = Boolean(q) && !result;

  let categories: ReturnType<typeof topLevel> = [];
  if (!q || failed || result?.items.length === 0) {
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
    <>
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
              sorts={SORTS}
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
    </>
  );
}
