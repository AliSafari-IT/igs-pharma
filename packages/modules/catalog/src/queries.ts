import { notFound, query } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { type SQL, and, asc, count, desc, eq, exists, ilike, like, or } from "drizzle-orm";
import { z } from "zod";

import {
  type ContentLocale,
  type LegalStatus,
  PRODUCT_STATUSES,
  type ProductStatus,
  type ProductType,
  type VatClass,
} from "./domain";
import { brands, productContent, products } from "./schema";

/** Catalog queries for the back-office (igs-pharma#50), behind `catalog.products.read`. */

/** `%`, `_` and `\` are LIKE wildcards: match them literally. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface ProductListItem {
  readonly id: string;
  readonly cnk: string;
  /** The Dutch name, `null` while the product has no Dutch content. */
  readonly nameNl: string | null;
  readonly status: ProductStatus;
  readonly updatedAt: Date;
}

export interface ProductPage {
  readonly items: readonly ProductListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Products, most recently changed first, paged. `q` matches a CNK prefix or a substring of the
 * name in any language (case-insensitive).
 */
export const listProducts = query({
  name: "catalog.product.list",
  input: z.object({
    q: z.string().trim().max(100).default(""),
    status: z.enum(PRODUCT_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  }),
  permission: PERMISSIONS.catalog.productsRead,
  async handler({ input, ctx }): Promise<ProductPage> {
    const filters: SQL[] = [];
    if (input.status) filters.push(eq(products.status, input.status));
    if (input.q) {
      const term = escapeLike(input.q);
      const byName = ctx.tx
        .select({ one: productContent.productId })
        .from(productContent)
        .where(
          and(eq(productContent.productId, products.id), ilike(productContent.name, `%${term}%`)),
        );
      filters.push(or(like(products.cnk, `${term}%`), exists(byName)) as SQL);
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const [totalRow] = await ctx.tx.select({ total: count() }).from(products).where(where);
    const rows = await ctx.tx
      .select({
        id: products.id,
        cnk: products.cnk,
        nameNl: productContent.name,
        status: products.status,
        updatedAt: products.updatedAt,
      })
      .from(products)
      .leftJoin(
        productContent,
        and(eq(productContent.productId, products.id), eq(productContent.locale, "nl")),
      )
      .where(where)
      .orderBy(desc(products.updatedAt), desc(products.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    return {
      items: rows.map((r) => ({ ...r, status: r.status as ProductStatus })),
      total: totalRow?.total ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    };
  },
});

export interface ProductContentView {
  readonly locale: ContentLocale;
  readonly name: string;
  readonly shortDescription: string | null;
  readonly description: string | null;
  readonly warnings: string | null;
  readonly source: string;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
}

export interface ProductView {
  readonly id: string;
  readonly cnk: string;
  readonly productType: ProductType;
  readonly legalStatus: LegalStatus;
  readonly status: ProductStatus;
  readonly vatClass: VatClass;
  readonly requiresPharmacistReview: boolean;
  readonly ageMin: number | null;
  readonly coldChain: boolean;
  readonly brandId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly content: readonly ProductContentView[];
}

/** One product with all its content, or `catalog.product_not_found`. */
export const getProduct = query({
  name: "catalog.product.get",
  input: z.object({ productId: z.uuid() }),
  permission: PERMISSIONS.catalog.productsRead,
  async handler({ input, ctx }): Promise<ProductView> {
    const [product] = await ctx.tx.select().from(products).where(eq(products.id, input.productId));
    if (!product) throw notFound("catalog.product_not_found");
    const content = await ctx.tx
      .select({
        locale: productContent.locale,
        name: productContent.name,
        shortDescription: productContent.shortDescription,
        description: productContent.description,
        warnings: productContent.warnings,
        source: productContent.source,
        approvedBy: productContent.approvedBy,
        approvedAt: productContent.approvedAt,
      })
      .from(productContent)
      .where(eq(productContent.productId, input.productId))
      .orderBy(asc(productContent.locale));
    return {
      ...product,
      productType: product.productType as ProductType,
      legalStatus: product.legalStatus as LegalStatus,
      status: product.status as ProductStatus,
      vatClass: product.vatClass as VatClass,
      content: content.map((c) => ({ ...c, locale: c.locale as ContentLocale })),
    };
  },
});

export interface BrandView {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

/** Every brand by name, for the product form (v1 expects a few hundred at most). */
export const listBrands = query({
  name: "catalog.brand.list",
  input: z.object({}),
  permission: PERMISSIONS.catalog.productsRead,
  async handler({ ctx }): Promise<readonly BrandView[]> {
    return ctx.tx
      .select({ id: brands.id, name: brands.name, slug: brands.slug })
      .from(brands)
      .orderBy(asc(brands.name))
      .limit(1000);
  },
});
