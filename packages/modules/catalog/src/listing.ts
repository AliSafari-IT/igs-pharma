import { type Tx, forbidden } from "@igs/kernel";
import { PERMISSIONS, type Permission } from "@igs/rbac";
import { type SQL, and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  type ContentLocale,
  SEARCH_FOLD_FROM,
  SEARCH_FOLD_TO,
  type VatClass,
  escapeLikeTerm,
  foldSearch,
  searchTerms,
} from "./domain";
import { brands, categories, productCategories, productContent, products } from "./schema";
import { isMedicineSql, storefrontVisible } from "./visibility";

/**
 * Helpers of the storefront read model (igs-pharma#103). Plain functions on the caller's
 * transaction, not kernel queries: the calling query (`catalog.storefront.read`) has authorized the
 * actor. EVERY product they return is storefront-visible (`storefrontVisible()`), so a hidden product
 * can neither be listed, counted nor probed through them. The one exception is
 * `productVisibilityFacts`, which exists to explain a hidden product to STAFF and refuses anyone
 * without `catalog.products.read`.
 *
 * The text shown for a product is ONE language row, never a mix: the shopper's locale row when it
 * exists and (for a medicine) was approved by a pharmacist, otherwise the Dutch row.
 */

type CategoryNames = {
  readonly nameNl: string;
  readonly nameFr: string;
  readonly nameDe: string | null;
  readonly nameEn: string | null;
};

/** A category's name in `locale`; German and English fall back to Dutch. */
export function categoryNameIn(row: CategoryNames, locale: ContentLocale): string {
  if (locale === "fr") return row.nameFr;
  if (locale === "de") return row.nameDe ?? row.nameNl;
  if (locale === "en") return row.nameEn ?? row.nameNl;
  return row.nameNl;
}

const foldSql = (expression: SQL | string) =>
  sql`translate(lower(${typeof expression === "string" ? sql.raw(expression) : expression}), ${SEARCH_FOLD_FROM}, ${SEARCH_FOLD_TO})`;

/** A storefront-visible product that matches a request's filters. */
export interface StorefrontCandidate {
  readonly id: string;
  readonly cnk: string;
  readonly name: string;
  readonly brandName: string | null;
  readonly shortDescription: string | null;
  readonly contentLocale: ContentLocale;
  readonly isMedicine: boolean;
  readonly createdAt: Date;
  /** 0 exact CNK, 1 name starts with the query, 2 name contains it, 3 brand or description; 0 without a query. */
  readonly rank: number;
}

export interface CandidateFilters {
  readonly locale: ContentLocale;
  readonly q?: string | undefined;
  readonly categorySlug?: string | undefined;
}

export interface CandidateSet {
  readonly candidates: readonly StorefrontCandidate[];
  /** The category the set is filtered by; `null` without a filter. */
  readonly category: { readonly slug: string; readonly name: string } | null;
}

/** The categories with the number of storefront-visible products directly in each. */
async function categoryRows(tx: Tx) {
  const rows = await tx
    .select({
      id: categories.id,
      parentId: categories.parentId,
      slug: categories.slug,
      nameNl: categories.nameNl,
      nameFr: categories.nameFr,
      nameDe: categories.nameDe,
      nameEn: categories.nameEn,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.id));
  const links = await tx
    .select({ categoryId: productCategories.categoryId, productId: productCategories.productId })
    .from(productCategories)
    .innerJoin(products, eq(products.id, productCategories.productId))
    .where(storefrontVisible());
  const productsOf = new Map<string, string[]>();
  for (const link of links) {
    const list = productsOf.get(link.categoryId);
    if (list) list.push(link.productId);
    else productsOf.set(link.categoryId, [link.productId]);
  }
  return { rows, productsOf };
}

/** The ids of a category and all its descendants. */
function subtreeIds(
  rows: readonly { id: string; parentId: string | null }[],
  rootId: string,
): string[] {
  const children = new Map<string | null, string[]>();
  for (const row of rows) {
    const list = children.get(row.parentId);
    if (list) list.push(row.id);
    else children.set(row.parentId, [row.id]);
  }
  const ids: string[] = [];
  const walk = (id: string) => {
    ids.push(id);
    for (const child of children.get(id) ?? []) walk(child);
  };
  walk(rootId);
  return ids;
}

/** `catalog.category_not_found` carrier: the caller turns it into the typed error. */
export class CategoryNotFound extends Error {
  constructor() {
    super("catalog.category_not_found");
  }
}

/**
 * Every storefront-visible product matching the filters, with the text of ONE language row: the
 * shopper's when it exists and (for a medicine) is approved, else Dutch. `q`: every word must appear
 * in the shown name or short description, or in the brand name (case- and accent-insensitive); a
 * 7-digit `q` also matches the CNK exactly. `categorySlug`: that category or any below it; unknown
 * or without a visible product below it throws {@link CategoryNotFound}.
 */
export async function searchStorefrontCandidates(
  tx: Tx,
  filters: CandidateFilters,
): Promise<CandidateSet> {
  const localized = alias(productContent, "localized");
  const dutch = alias(productContent, "dutch");
  const medicine = isMedicineSql();
  // the shown row: the shopper's locale when it exists and (for a medicine) is approved, else Dutch
  const useLocal = sql`(${localized.productId} IS NOT NULL AND (NOT ${medicine} OR ${localized.approvedBy} IS NOT NULL))`;
  const shown = <T>(local: SQL | unknown, nl: SQL | unknown) =>
    sql<T>`CASE WHEN ${useLocal} THEN ${local} ELSE ${nl} END`;
  const shownName = shown<string>(localized.name, dutch.name);
  const shownSearch = shown<string>(localized.searchText, dutch.searchText);

  const filtersSql: (SQL | undefined)[] = [storefrontVisible()];

  let category: CandidateSet["category"] = null;
  if (filters.categorySlug) {
    const { rows, productsOf } = await categoryRows(tx);
    const root = rows.find((row) => row.slug === filters.categorySlug);
    if (!root) throw new CategoryNotFound();
    const ids = subtreeIds(rows, root.id);
    if (!ids.some((id) => (productsOf.get(id)?.length ?? 0) > 0)) throw new CategoryNotFound();
    category = { slug: root.slug, name: categoryNameIn(root, filters.locale) };
    filtersSql.push(
      sql`EXISTS (SELECT 1 FROM ${productCategories} WHERE ${productCategories.productId} = ${products.id} AND ${inArray(productCategories.categoryId, ids)})`,
    );
  }

  const query = filters.q?.trim() ?? "";
  const terms = query ? searchTerms(query) : [];
  const brandFolded = foldSql(sql`coalesce(${brands.name}, '')`);
  if (terms.length > 0) {
    const matches = terms.map((term) => {
      const pattern = `%${escapeLikeTerm(term)}%`;
      // The first line is a superset of the shown-row test (any language row of the product holds the
      // term): it is implied by the exact test below, so the result does not change, but it lets the
      // trigram index answer the text half (the CASE over two joined rows cannot use an index).
      return sql`((${products.id} IN (SELECT ${productContent.productId} FROM ${productContent} WHERE ${productContent.searchText} LIKE ${pattern}) AND ${shownSearch} LIKE ${pattern}) OR ${brandFolded} LIKE ${pattern})`;
    });
    const textMatch = and(...matches) as SQL;
    filtersSql.push(
      /^[0-9]{7}$/.test(query) ? sql`(${products.cnk} = ${query} OR ${textMatch})` : textMatch,
    );
  }

  const foldedQuery = foldSearch(query);
  const rank = terms.length
    ? sql<number>`CASE
        WHEN ${products.cnk} = ${query} THEN 0
        WHEN ${foldSql(shownName)} LIKE ${`${escapeLikeTerm(foldedQuery)}%`} THEN 1
        WHEN ${foldSql(shownName)} LIKE ${`%${escapeLikeTerm(foldedQuery)}%`} THEN 2
        ELSE 3 END`
    : sql<number>`0`;

  const rows = await tx
    .select({
      id: products.id,
      cnk: products.cnk,
      createdAt: products.createdAt,
      isMedicine: sql<boolean>`${medicine}`,
      brandName: brands.name,
      name: shownName,
      shortDescription: shown<string | null>(localized.shortDescription, dutch.shortDescription),
      contentLocale: shown<ContentLocale>(sql`${localized.locale}`, sql`${dutch.locale}`),
      rank,
    })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(dutch, and(eq(dutch.productId, products.id), eq(dutch.locale, "nl")))
    .leftJoin(
      localized,
      and(eq(localized.productId, products.id), eq(localized.locale, filters.locale)),
    )
    .where(and(...filtersSql));
  return {
    candidates: rows.map((row) => ({ ...row, rank: Number(row.rank) })),
    category,
  };
}

/** One storefront-visible product with its full text, by CNK, or `null` (hidden is indistinguishable from unknown). */
export interface StorefrontProductDetail extends StorefrontCandidate {
  readonly vatClass: VatClass;
  readonly description: string | null;
  readonly warnings: string | null;
  readonly breadcrumb: readonly { readonly slug: string; readonly name: string }[];
  readonly categories: readonly { readonly slug: string; readonly name: string }[];
}

export async function getStorefrontProductDetail(
  tx: Tx,
  cnk: string,
  locale: ContentLocale,
): Promise<StorefrontProductDetail | null> {
  const localized = alias(productContent, "localized");
  const dutch = alias(productContent, "dutch");
  const medicine = isMedicineSql();
  const useLocal = sql`(${localized.productId} IS NOT NULL AND (NOT ${medicine} OR ${localized.approvedBy} IS NOT NULL))`;
  const shown = <T>(local: unknown, nl: unknown) =>
    sql<T>`CASE WHEN ${useLocal} THEN ${local} ELSE ${nl} END`;
  const [row] = await tx
    .select({
      id: products.id,
      cnk: products.cnk,
      vatClass: products.vatClass,
      createdAt: products.createdAt,
      isMedicine: sql<boolean>`${medicine}`,
      brandName: brands.name,
      name: shown<string>(localized.name, dutch.name),
      shortDescription: shown<string | null>(localized.shortDescription, dutch.shortDescription),
      description: shown<string | null>(localized.description, dutch.description),
      warnings: shown<string | null>(localized.warnings, dutch.warnings),
      contentLocale: shown<ContentLocale>(sql`${localized.locale}`, sql`${dutch.locale}`),
    })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(dutch, and(eq(dutch.productId, products.id), eq(dutch.locale, "nl")))
    .leftJoin(localized, and(eq(localized.productId, products.id), eq(localized.locale, locale)))
    .where(and(eq(products.cnk, cnk), storefrontVisible()));
  if (!row) return null;

  const { rows } = await categoryRows(tx);
  const links = await tx
    .select({ categoryId: productCategories.categoryId })
    .from(productCategories)
    .where(eq(productCategories.productId, row.id));
  const linked = new Set(links.map((l) => l.categoryId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depthOf = (id: string): number => {
    let depth = 0;
    for (let at: string | null | undefined = id; at; at = byId.get(at)?.parentId) depth++;
    return depth;
  };
  const mine = rows.filter((r) => linked.has(r.id));
  // the breadcrumb follows the deepest category (the first in tree order among equals)
  const deepest = [...mine].sort((a, b) => depthOf(b.id) - depthOf(a.id))[0];
  const breadcrumb: { slug: string; name: string }[] = [];
  for (let at = deepest; at; at = at.parentId ? byId.get(at.parentId) : undefined) {
    breadcrumb.unshift({ slug: at.slug, name: categoryNameIn(at, locale) });
  }
  return {
    id: row.id,
    cnk: row.cnk,
    name: row.name,
    brandName: row.brandName,
    shortDescription: row.shortDescription,
    contentLocale: row.contentLocale,
    isMedicine: row.isMedicine,
    createdAt: row.createdAt,
    rank: 0,
    vatClass: row.vatClass as VatClass,
    description: row.description,
    warnings: row.warnings,
    breadcrumb,
    categories: mine.map((r) => ({ slug: r.slug, name: categoryNameIn(r, locale) })),
  };
}

/** The category tree for the storefront: every category, and the visible products directly in each. */
export interface StorefrontCategoryIndex {
  readonly categories: readonly {
    readonly id: string;
    readonly parentId: string | null;
    readonly slug: string;
    readonly name: string;
  }[];
  /** Storefront-visible product ids directly in each category. */
  readonly productsByCategory: ReadonlyMap<string, readonly string[]>;
}

export async function storefrontCategoryIndex(
  tx: Tx,
  locale: ContentLocale,
): Promise<StorefrontCategoryIndex> {
  const { rows, productsOf } = await categoryRows(tx);
  return {
    categories: rows.map((r) => ({
      id: r.id,
      parentId: r.parentId,
      slug: r.slug,
      name: categoryNameIn(r, locale),
    })),
    productsByCategory: productsOf,
  };
}

/** What decides whether the catalog lets the storefront show a product (the facts, not the verdict). */
export interface VisibilityFacts {
  readonly productId: string;
  readonly status: "draft" | "active" | "archived";
  readonly legalStatus: string;
  readonly productType: string;
  readonly isMedicine: boolean;
  /** Whether a pharmacist approved the text of each required locale (absent text counts as not approved). */
  readonly approved: { readonly nl: boolean; readonly fr: boolean };
}

/**
 * The facts behind "is this product on the storefront", for STAFF who hold `catalog.products.read`
 * (the back-office explanation). Throws `kernel.forbidden` for anyone else: it is the one helper
 * here that speaks about a product the storefront cannot see. `null` for an unknown id.
 */
export async function productVisibilityFacts(
  tx: Tx,
  productId: string,
  can: (permission: Permission) => boolean,
): Promise<VisibilityFacts | null> {
  if (!can(PERMISSIONS.catalog.productsRead)) throw forbidden("kernel.forbidden");
  const [product] = await tx
    .select({
      id: products.id,
      status: products.status,
      legalStatus: products.legalStatus,
      productType: products.productType,
      isMedicine: sql<boolean>`${isMedicineSql()}`,
    })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) return null;
  const content = await tx
    .select({ locale: productContent.locale, approvedBy: productContent.approvedBy })
    .from(productContent)
    .where(
      and(eq(productContent.productId, productId), inArray(productContent.locale, ["nl", "fr"])),
    );
  const approved = (locale: string) =>
    content.some((row) => row.locale === locale && row.approvedBy !== null);
  return {
    productId: product.id,
    status: product.status as VisibilityFacts["status"],
    legalStatus: product.legalStatus,
    productType: product.productType,
    isMedicine: product.isMedicine,
    approved: { nl: approved("nl"), fr: approved("fr") },
  };
}
