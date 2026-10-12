import { type Tx, notFound, query } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { and, asc, count, eq, exists, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { CONTENT_LOCALES, type ContentLocale, type VatClass } from "./domain";
import { brands, categories, productCategories, productContent, products } from "./schema";

/**
 * Storefront reads (igs-pharma#62), behind `catalog.storefront.read`: ACTIVE products and the
 * categories that have some, in the shopper's language. A draft or archived product does not exist
 * for these queries. Names fall back to Dutch (German and English content is optional); a product's
 * texts come from one language row, never a mix.
 */

const localeInput = z.enum(CONTENT_LOCALES);

type CategoryNames = {
  readonly nameNl: string;
  readonly nameFr: string;
  readonly nameDe: string | null;
  readonly nameEn: string | null;
};

/** A category's name in `locale`; German and English fall back to Dutch. */
function categoryName(row: CategoryNames, locale: ContentLocale): string {
  if (locale === "fr") return row.nameFr;
  if (locale === "de") return row.nameDe ?? row.nameNl;
  if (locale === "en") return row.nameEn ?? row.nameNl;
  return row.nameNl;
}

export interface StorefrontCategory {
  readonly id: string;
  readonly parentId: string | null;
  readonly slug: string;
  readonly name: string;
  readonly depth: number;
  /** Active products in this category and everything below it. */
  readonly productCount: number;
}

/** Every category row with the number of active products directly in it. */
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
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.id));
  const counts = await tx
    .select({ categoryId: productCategories.categoryId, direct: count() })
    .from(productCategories)
    .innerJoin(products, eq(products.id, productCategories.productId))
    .where(eq(products.status, "active"))
    .groupBy(productCategories.categoryId);
  const directOf = new Map(counts.map((c) => [c.categoryId, c.direct]));
  return rows.map((row) => ({ ...row, direct: directOf.get(row.id) ?? 0 }));
}

type CategoryRow = Awaited<ReturnType<typeof categoryRows>>[number];

const childrenByParent = (rows: readonly CategoryRow[]) => {
  const map = new Map<string | null, CategoryRow[]>();
  for (const row of rows) {
    const list = map.get(row.parentId) ?? [];
    list.push(row);
    map.set(row.parentId, list);
  }
  return map;
};

/** The ids of a category and all its descendants. */
function subtreeIds(rows: readonly CategoryRow[], rootId: string): string[] {
  const children = childrenByParent(rows);
  const ids: string[] = [];
  const walk = (id: string) => {
    ids.push(id);
    for (const child of children.get(id) ?? []) walk(child.id);
  };
  walk(rootId);
  return ids;
}

/**
 * The category tree as a flat list in reading order (a category before its children), only the
 * categories that have at least one active product in them or below.
 */
export const listStorefrontCategories = query({
  name: "catalog.storefront.categories",
  input: z.object({ locale: localeInput }),
  permission: PERMISSIONS.catalog.storefrontRead,
  async handler({ input, ctx }): Promise<readonly StorefrontCategory[]> {
    const rows = await categoryRows(ctx.tx);
    const children = childrenByParent(rows);
    const totals = new Map<string, number>();
    const total = (row: CategoryRow): number => {
      const known = totals.get(row.id);
      if (known !== undefined) return known;
      const sum = row.direct + (children.get(row.id) ?? []).reduce((n, c) => n + total(c), 0);
      totals.set(row.id, sum);
      return sum;
    };
    const out: StorefrontCategory[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const row of children.get(parentId) ?? []) {
        const productCount = total(row);
        if (productCount === 0) continue;
        out.push({
          id: row.id,
          parentId: row.parentId,
          slug: row.slug,
          name: categoryName(row, input.locale),
          depth,
          productCount,
        });
        walk(row.id, depth + 1);
      }
    };
    walk(null, 1);
    return out;
  },
});

export interface StorefrontProductItem {
  readonly id: string;
  readonly cnk: string;
  readonly name: string;
  readonly brandName: string | null;
  readonly shortDescription: string | null;
}

export interface StorefrontProductPage {
  readonly items: readonly StorefrontProductItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  /** The category the list is filtered by, when it is. */
  readonly category: { readonly slug: string; readonly name: string } | null;
}

/**
 * Active products by name, paged. With `categorySlug`, those in that category or below it
 * (`catalog.category_not_found` for an unknown slug).
 */
export const listStorefrontProducts = query({
  name: "catalog.storefront.products",
  input: z.object({
    locale: localeInput,
    categorySlug: z.string().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(24),
  }),
  permission: PERMISSIONS.catalog.storefrontRead,
  async handler({ input, ctx }): Promise<StorefrontProductPage> {
    let category: StorefrontProductPage["category"] = null;
    const filters = [eq(products.status, "active")];
    if (input.categorySlug) {
      const rows = await categoryRows(ctx.tx);
      const root = rows.find((row) => row.slug === input.categorySlug);
      if (!root) throw notFound("catalog.category_not_found");
      category = { slug: root.slug, name: categoryName(root, input.locale) };
      const ids = subtreeIds(rows, root.id);
      filters.push(
        exists(
          ctx.tx
            .select({ one: productCategories.productId })
            .from(productCategories)
            .where(
              and(
                eq(productCategories.productId, products.id),
                inArray(productCategories.categoryId, ids),
              ),
            ),
        ),
      );
    }
    const where = and(...filters);

    const localized = alias(productContent, "localized");
    const dutch = alias(productContent, "dutch");
    const [totalRow] = await ctx.tx.select({ total: count() }).from(products).where(where);
    const rows = await ctx.tx
      .select({
        id: products.id,
        cnk: products.cnk,
        brandName: brands.name,
        locName: localized.name,
        locShort: localized.shortDescription,
        nlName: dutch.name,
        nlShort: dutch.shortDescription,
      })
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .leftJoin(
        localized,
        and(eq(localized.productId, products.id), eq(localized.locale, input.locale)),
      )
      .leftJoin(dutch, and(eq(dutch.productId, products.id), eq(dutch.locale, "nl")))
      .where(where)
      .orderBy(asc(sql`coalesce(${localized.name}, ${dutch.name})`), asc(products.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

    return {
      items: rows.map((row) => ({
        id: row.id,
        cnk: row.cnk,
        name: row.locName ?? row.nlName ?? row.cnk,
        brandName: row.brandName,
        // the texts of one language row: the short description of the row the name came from
        shortDescription: row.locName !== null ? row.locShort : row.nlShort,
      })),
      total: totalRow?.total ?? 0,
      page: input.page,
      pageSize: input.pageSize,
      category,
    };
  },
});

export interface StorefrontProduct {
  readonly id: string;
  readonly cnk: string;
  readonly name: string;
  readonly brandName: string | null;
  readonly shortDescription: string | null;
  readonly description: string | null;
  readonly warnings: string | null;
  readonly vatClass: VatClass;
  /** The language the texts are in (Dutch when the shopper's language has no content). */
  readonly contentLocale: ContentLocale;
  readonly categories: readonly { readonly slug: string; readonly name: string }[];
}

/** One active product by CNK with its texts, or `catalog.product_not_found`. */
export const getStorefrontProduct = query({
  name: "catalog.storefront.product",
  input: z.object({ cnk: z.string().regex(/^[0-9]{7}$/), locale: localeInput }),
  permission: PERMISSIONS.catalog.storefrontRead,
  async handler({ input, ctx }): Promise<StorefrontProduct> {
    const [product] = await ctx.tx
      .select({
        id: products.id,
        cnk: products.cnk,
        vatClass: products.vatClass,
        brandName: brands.name,
      })
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(and(eq(products.cnk, input.cnk), eq(products.status, "active")));
    if (!product) throw notFound("catalog.product_not_found");

    const content = await ctx.tx
      .select({
        locale: productContent.locale,
        name: productContent.name,
        shortDescription: productContent.shortDescription,
        description: productContent.description,
        warnings: productContent.warnings,
      })
      .from(productContent)
      .where(
        and(
          eq(productContent.productId, product.id),
          inArray(productContent.locale, [input.locale, "nl"]),
        ),
      );
    const text =
      content.find((c) => c.locale === input.locale) ?? content.find((c) => c.locale === "nl");
    if (!text) throw notFound("catalog.product_not_found");

    const rows = await categoryRows(ctx.tx);
    const links = await ctx.tx
      .select({ categoryId: productCategories.categoryId })
      .from(productCategories)
      .where(eq(productCategories.productId, product.id));
    const linked = new Set(links.map((l) => l.categoryId));

    return {
      id: product.id,
      cnk: product.cnk,
      name: text.name,
      brandName: product.brandName,
      shortDescription: text.shortDescription,
      description: text.description,
      warnings: text.warnings,
      vatClass: product.vatClass as VatClass,
      contentLocale: text.locale as ContentLocale,
      categories: rows
        .filter((row) => linked.has(row.id))
        .map((row) => ({ slug: row.slug, name: categoryName(row, input.locale) })),
    };
  },
});
