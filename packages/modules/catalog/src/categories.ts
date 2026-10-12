import { type Ctx, command, conflict, notFound, query, validationFailed } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { and, asc, count, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { CATALOG_AUDIT } from "./audit";
import {
  type CategoryLink,
  MAX_CATEGORIES_PER_PRODUCT,
  MAX_CATEGORY_DEPTH,
  SLUG_PATTERN,
  depthOf,
  subtreeHeight,
  wouldCycle,
} from "./domain";
import { categories, productCategories, products } from "./schema";

/**
 * Catalog categories (igs-pharma#54): a tree of categories with Dutch and French names (German and
 * English optional), ordered among siblings, and the categories each product is in. Same
 * permissions as products: `catalog.products.read` to see them, `catalog.products.manage` to change
 * them.
 *
 * Tree writes (create, rename, move, delete) take one transaction advisory lock, so two moves can't
 * race into a cycle, sibling positions stay consistent, and two writes can't race for one slug
 * (the loser gets `catalog.category_slug_taken`, not the unique index's error). The tree is small (a webshop menu), so the
 * rules load it whole.
 */

const lockTree = (ctx: Ctx) =>
  ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('catalog.categories'))`);

const loadLinks = (ctx: Ctx): Promise<CategoryLink[]> =>
  ctx.tx.select({ id: categories.id, parentId: categories.parentId }).from(categories);

const optionalName = z
  .string()
  .trim()
  .max(100)
  .nullish()
  .transform((value) => (value ? value : null));

const categoryFields = {
  slug: z.string().trim().max(100).regex(SLUG_PATTERN),
  nameNl: z.string().trim().min(1).max(100),
  nameFr: z.string().trim().min(1).max(100),
  nameDe: optionalName,
  nameEn: optionalName,
};

const categoryIdOutput = z.object({ categoryId: z.uuid() });

async function requireSlugFree(ctx: Ctx, slug: string, except?: string): Promise<void> {
  const [taken] = await ctx.tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      except
        ? and(eq(categories.slug, slug), ne(categories.id, except))
        : eq(categories.slug, slug),
    );
  if (taken) throw conflict("catalog.category_slug_taken");
}

/** Sibling order everywhere (the commands and the list): `sort_order`, ties broken by id. */
const siblingOrder = [asc(categories.sortOrder), asc(categories.id)] as const;

const siblingsOf = (ctx: Ctx, parentId: string | null) =>
  ctx.tx
    .select({ id: categories.id, sortOrder: categories.sortOrder })
    .from(categories)
    .where(parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId))
    .orderBy(...siblingOrder);

/** Creates a category at the end of its parent's children (a root when `parentId` is `null`). */
export const createCategory = command({
  name: "catalog.category.create",
  input: z.object({ parentId: z.uuid().nullable().default(null), ...categoryFields }),
  output: categoryIdOutput,
  permission: PERMISSIONS.catalog.productsManage,
  async handler({ input, ctx }) {
    await lockTree(ctx);
    const links = await loadLinks(ctx);
    if (input.parentId !== null) {
      if (!links.some((l) => l.id === input.parentId)) throw notFound("catalog.category_not_found");
      if (depthOf(links, input.parentId) + 1 > MAX_CATEGORY_DEPTH)
        throw conflict("catalog.category_too_deep", { maxDepth: MAX_CATEGORY_DEPTH });
    }
    await requireSlugFree(ctx, input.slug);
    const siblings = await siblingsOf(ctx, input.parentId);
    const sortOrder = siblings.reduce((max, s) => Math.max(max, s.sortOrder + 1), 0);
    const [category] = await ctx.tx
      .insert(categories)
      .values({
        parentId: input.parentId,
        slug: input.slug,
        nameNl: input.nameNl,
        nameFr: input.nameFr,
        nameDe: input.nameDe,
        nameEn: input.nameEn,
        sortOrder,
      })
      .returning({ id: categories.id });
    if (!category) throw new Error("category insert returned no row");
    await ctx.audit.record({
      action: CATALOG_AUDIT.categoryCreated,
      entityType: "category",
      entityId: category.id,
      data: { categoryId: category.id, slug: input.slug, parentId: input.parentId },
    });
    return { categoryId: category.id };
  },
});

/** Renames a category: its slug and its names. Where it sits in the tree changes with `move`. */
export const updateCategory = command({
  name: "catalog.category.update",
  input: z.object({ categoryId: z.uuid(), ...categoryFields }),
  output: categoryIdOutput,
  permission: PERMISSIONS.catalog.productsManage,
  async handler({ input, ctx }) {
    await lockTree(ctx);
    const [current] = await ctx.tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, input.categoryId))
      .for("update");
    if (!current) throw notFound("catalog.category_not_found");
    await requireSlugFree(ctx, input.slug, input.categoryId);
    await ctx.tx
      .update(categories)
      .set({
        slug: input.slug,
        nameNl: input.nameNl,
        nameFr: input.nameFr,
        nameDe: input.nameDe,
        nameEn: input.nameEn,
        updatedAt: ctx.now,
      })
      .where(eq(categories.id, input.categoryId));
    await ctx.audit.record({
      action: CATALOG_AUDIT.categoryUpdated,
      entityType: "category",
      entityId: input.categoryId,
      data: { categoryId: input.categoryId, slug: input.slug },
    });
    return { categoryId: input.categoryId };
  },
});

/**
 * Puts a category under `parentId` (`null`: a root) at `position` among its new siblings (0 is the
 * first; past the end means last). Reordering is a move within the same parent. Refused when the
 * new parent is the category or one of its descendants (`catalog.category_cycle`), or when the
 * tree would get deeper than `MAX_CATEGORY_DEPTH` (`catalog.category_too_deep`), and when it is
 * already there (`catalog.category_unchanged`: every command writes an audit record).
 */
export const moveCategory = command({
  name: "catalog.category.move",
  input: z.object({
    categoryId: z.uuid(),
    parentId: z.uuid().nullable(),
    position: z.number().int().min(0).max(10_000),
  }),
  output: z.object({ categoryId: z.uuid(), parentId: z.uuid().nullable(), position: z.number() }),
  permission: PERMISSIONS.catalog.productsManage,
  async handler({ input, ctx }) {
    await lockTree(ctx);
    const links = await loadLinks(ctx);
    const self = links.find((l) => l.id === input.categoryId);
    if (!self) throw notFound("catalog.category_not_found");
    if (input.parentId !== null && !links.some((l) => l.id === input.parentId))
      throw notFound("catalog.category_not_found");
    if (wouldCycle(links, input.categoryId, input.parentId))
      throw conflict("catalog.category_cycle");
    if (
      depthOf(links, input.parentId) + subtreeHeight(links, input.categoryId) >
      MAX_CATEGORY_DEPTH
    )
      throw conflict("catalog.category_too_deep", { maxDepth: MAX_CATEGORY_DEPTH });

    const siblings = await siblingsOf(ctx, input.parentId);
    const others = siblings.filter((s) => s.id !== input.categoryId);
    const position = Math.min(input.position, others.length);
    const samePlace =
      self.parentId === input.parentId && siblings.findIndex((s) => s.id === self.id) === position;
    if (samePlace) throw conflict("catalog.category_unchanged");

    const ordered = [
      ...others.slice(0, position),
      { id: input.categoryId, sortOrder: -1 },
      ...others.slice(position),
    ];
    for (const [index, sibling] of ordered.entries()) {
      if (sibling.id === input.categoryId) {
        await ctx.tx
          .update(categories)
          .set({ parentId: input.parentId, sortOrder: index, updatedAt: ctx.now })
          .where(eq(categories.id, sibling.id));
      } else if (sibling.sortOrder !== index) {
        await ctx.tx
          .update(categories)
          .set({ sortOrder: index })
          .where(eq(categories.id, sibling.id));
      }
    }
    await ctx.audit.record({
      action: CATALOG_AUDIT.categoryMoved,
      entityType: "category",
      entityId: input.categoryId,
      data: {
        categoryId: input.categoryId,
        fromParentId: self.parentId,
        toParentId: input.parentId,
        position,
      },
    });
    return { categoryId: input.categoryId, parentId: input.parentId, position };
  },
});

/**
 * Deletes a category. Refused while it has sub-categories (`catalog.category_has_children`) or
 * products (`catalog.category_in_use`): move or empty it first.
 */
export const deleteCategory = command({
  name: "catalog.category.delete",
  input: z.object({ categoryId: z.uuid() }),
  output: categoryIdOutput,
  permission: PERMISSIONS.catalog.productsManage,
  async handler({ input, ctx }) {
    await lockTree(ctx);
    const [current] = await ctx.tx
      .select({ id: categories.id, slug: categories.slug })
      .from(categories)
      .where(eq(categories.id, input.categoryId))
      // FOR UPDATE waits for a `set_categories` that is adding a product to it (FOR SHARE)
      .for("update");
    if (!current) throw notFound("catalog.category_not_found");
    const [children] = await ctx.tx
      .select({ n: count() })
      .from(categories)
      .where(eq(categories.parentId, input.categoryId));
    if ((children?.n ?? 0) > 0)
      throw conflict("catalog.category_has_children", { children: children?.n ?? 0 });
    const [inUse] = await ctx.tx
      .select({ n: count() })
      .from(productCategories)
      .where(eq(productCategories.categoryId, input.categoryId));
    if ((inUse?.n ?? 0) > 0) throw conflict("catalog.category_in_use", { products: inUse?.n ?? 0 });
    await ctx.tx.delete(categories).where(eq(categories.id, input.categoryId));
    await ctx.audit.record({
      action: CATALOG_AUDIT.categoryDeleted,
      entityType: "category",
      entityId: input.categoryId,
      data: { categoryId: input.categoryId, slug: current.slug },
    });
    return { categoryId: input.categoryId };
  },
});

/**
 * Sets the categories a product is in, as a whole set: the ones given are kept or added, the others
 * removed. An empty list takes the product out of every category.
 */
export const setProductCategories = command({
  name: "catalog.product.set_categories",
  input: z.object({
    productId: z.uuid(),
    categoryIds: z
      .array(z.uuid())
      .max(MAX_CATEGORIES_PER_PRODUCT)
      .refine((ids) => new Set(ids).size === ids.length, { message: "duplicate category" }),
  }),
  output: z.object({ productId: z.uuid(), categoryIds: z.array(z.uuid()) }),
  permission: PERMISSIONS.catalog.productsManage,
  async handler({ input, ctx }) {
    const [product] = await ctx.tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, input.productId))
      .for("update");
    if (!product) throw notFound("catalog.product_not_found");
    if (input.categoryIds.length > 0) {
      // FOR SHARE: a category can't be deleted while it is being added here
      const found = await ctx.tx
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.id, input.categoryIds))
        .for("share");
      if (found.length !== input.categoryIds.length) {
        const known = new Set(found.map((c) => c.id));
        throw validationFailed(
          "catalog.category_not_found",
          input.categoryIds.flatMap((id, i) =>
            known.has(id) ? [] : [{ path: `categoryIds.${i}`, code: "category_not_found" }],
          ),
        );
      }
    }
    const before = await ctx.tx
      .select({ categoryId: productCategories.categoryId })
      .from(productCategories)
      .where(eq(productCategories.productId, input.productId));
    const had = new Set(before.map((l) => l.categoryId));
    const wanted = new Set(input.categoryIds);
    const removed = before.filter((l) => !wanted.has(l.categoryId)).length;
    const added = input.categoryIds.filter((id) => !had.has(id));
    if (removed > 0) {
      await ctx.tx
        .delete(productCategories)
        .where(
          input.categoryIds.length === 0
            ? eq(productCategories.productId, input.productId)
            : and(
                eq(productCategories.productId, input.productId),
                notInArray(productCategories.categoryId, input.categoryIds),
              ),
        );
    }
    if (added.length > 0) {
      await ctx.tx
        .insert(productCategories)
        .values(added.map((categoryId) => ({ productId: input.productId, categoryId })));
    }
    // category ids are identifiers, but a list doesn't fit an audit record: counts only
    await ctx.audit.record({
      action: CATALOG_AUDIT.productCategoriesSet,
      entityType: "product",
      entityId: input.productId,
      data: {
        productId: input.productId,
        added: added.length,
        removed,
        total: input.categoryIds.length,
      },
    });
    return { productId: input.productId, categoryIds: input.categoryIds };
  },
});

export interface CategoryNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly slug: string;
  readonly nameNl: string;
  readonly nameFr: string;
  readonly nameDe: string | null;
  readonly nameEn: string | null;
  /** 1 for a root. */
  readonly depth: number;
  /** Position among its siblings, 0 first. */
  readonly index: number;
  readonly siblingCount: number;
  readonly childCount: number;
  /** Products directly in this category (not in its sub-categories). */
  readonly productCount: number;
}

/**
 * The whole category tree as a flat list in reading order: each category comes before its
 * children, siblings in their sort order.
 */
export const listCategories = query({
  name: "catalog.category.list",
  input: z.object({}),
  permission: PERMISSIONS.catalog.productsRead,
  async handler({ ctx }): Promise<readonly CategoryNode[]> {
    const rows = await ctx.tx
      .select({
        id: categories.id,
        parentId: categories.parentId,
        slug: categories.slug,
        nameNl: categories.nameNl,
        nameFr: categories.nameFr,
        nameDe: categories.nameDe,
        nameEn: categories.nameEn,
        productCount: sql<number>`(SELECT count(*)::int FROM ${productCategories} WHERE ${productCategories.categoryId} = ${categories.id})`,
      })
      .from(categories)
      .orderBy(...siblingOrder);
    const childrenOf = new Map<string | null, typeof rows>();
    for (const row of rows) {
      const list = childrenOf.get(row.parentId) ?? [];
      list.push(row);
      childrenOf.set(row.parentId, list);
    }
    const out: CategoryNode[] = [];
    const walk = (parentId: string | null, depth: number) => {
      const children = childrenOf.get(parentId) ?? [];
      for (const [index, row] of children.entries()) {
        out.push({
          ...row,
          depth,
          index,
          siblingCount: children.length,
          childCount: childrenOf.get(row.id)?.length ?? 0,
        });
        walk(row.id, depth + 1);
      }
    };
    walk(null, 1);
    return out;
  },
});
