import { type Ctx, command, conflict, notFound, validationFailed } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";

import { CATALOG_AUDIT } from "./audit";
import {
  CONTENT_LOCALES,
  LEGAL_STATUSES,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  VAT_CLASSES,
  isValidCnk,
  missingForActivation,
} from "./domain";
import { brands, productContent, products } from "./schema";

/**
 * Catalog commands (igs-pharma#50). Every one runs through the kernel: authorize → validate → one
 * transaction (handler + audit), all behind `catalog.products.manage`. A product is created as a
 * `draft`; it becomes `active` only with Dutch and French content (`catalog.content_missing`).
 *
 * Content is saved as a whole set: the locales in the input are written, the others removed.
 * Saving content stamps `approved_by`/`approved_at` with the saving actor: in v1 every text is
 * written by hand by a content editor, so writing it is approving it (source `manual`).
 */

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const contentInput = z.object({
  locale: z.enum(CONTENT_LOCALES),
  name: z.string().trim().min(1).max(200),
  shortDescription: nullableText(500),
  description: nullableText(10_000),
  warnings: nullableText(5_000),
});

const productFields = {
  /** Checked in the handler, so a wrong one fails with `catalog.cnk_invalid`. */
  cnk: z.string().trim().max(32),
  productType: z.enum(PRODUCT_TYPES),
  legalStatus: z.enum(LEGAL_STATUSES),
  vatClass: z.enum(VAT_CLASSES),
  requiresPharmacistReview: z.boolean().default(false),
  ageMin: z.number().int().min(0).max(120).nullable().default(null),
  coldChain: z.boolean().default(false),
  brandId: z.uuid().nullable().default(null),
  content: z
    .array(contentInput)
    .max(CONTENT_LOCALES.length)
    .default([])
    .refine((items) => new Set(items.map((c) => c.locale)).size === items.length, {
      message: "duplicate locale",
    }),
};

const createInput = z.object(productFields);
const updateInput = z.object({ productId: z.uuid(), ...productFields });
type ProductFields = z.infer<typeof createInput>;

const productIdOutput = z.object({ productId: z.uuid() });

function requireValidCnk(cnk: string): void {
  if (!isValidCnk(cnk))
    throw validationFailed("catalog.cnk_invalid", [{ path: "cnk", code: "cnk_invalid" }]);
}

async function requireBrand(ctx: Ctx, brandId: string | null): Promise<void> {
  if (brandId === null) return;
  const [brand] = await ctx.tx.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId));
  if (!brand) throw notFound("catalog.brand_not_found");
}

const coreValues = (input: ProductFields) => ({
  cnk: input.cnk,
  productType: input.productType,
  legalStatus: input.legalStatus,
  vatClass: input.vatClass,
  requiresPharmacistReview: input.requiresPharmacistReview,
  ageMin: input.ageMin,
  coldChain: input.coldChain,
  brandId: input.brandId,
});

/** Replaces the product's content with `content` (see the module comment). */
async function saveContent(ctx: Ctx, productId: string, content: ProductFields["content"]) {
  const locales = content.map((c) => c.locale);
  await ctx.tx
    .delete(productContent)
    .where(
      locales.length === 0
        ? eq(productContent.productId, productId)
        : and(eq(productContent.productId, productId), notInArray(productContent.locale, locales)),
    );
  if (content.length === 0) return;
  const approvedBy = ctx.actor.type === "user" ? ctx.actor.id : null;
  for (const item of content) {
    const values = {
      name: item.name,
      shortDescription: item.shortDescription,
      description: item.description,
      warnings: item.warnings,
      source: "manual",
      approvedBy,
      approvedAt: ctx.now,
      updatedAt: ctx.now,
    };
    await ctx.tx
      .insert(productContent)
      .values({ productId, locale: item.locale, ...values })
      .onConflictDoUpdate({
        target: [productContent.productId, productContent.locale],
        set: values,
      });
  }
}

/** Creates a `draft` product with its content. */
export const createProduct = command({
  name: "catalog.product.create",
  input: createInput,
  output: productIdOutput,
  permission: PERMISSIONS.catalog.productsManage,
  async handler({ input, ctx }) {
    requireValidCnk(input.cnk);
    await requireBrand(ctx, input.brandId);
    const [product] = await ctx.tx
      .insert(products)
      .values({ ...coreValues(input), status: "draft" })
      .onConflictDoNothing({ target: products.cnk })
      .returning({ id: products.id });
    if (!product) throw conflict("catalog.cnk_taken");
    await saveContent(ctx, product.id, input.content);
    await ctx.audit.record({
      action: CATALOG_AUDIT.productCreated,
      entityType: "product",
      entityId: product.id,
      data: { productId: product.id, cnk: input.cnk },
    });
    return { productId: product.id };
  },
});

/**
 * Replaces a product's core fields and content. An `active` product must keep its Dutch and French
 * content (`catalog.content_missing`); its status changes only through `setProductStatus`.
 */
export const updateProduct = command({
  name: "catalog.product.update",
  input: updateInput,
  output: productIdOutput,
  permission: PERMISSIONS.catalog.productsManage,
  async handler({ input, ctx }) {
    requireValidCnk(input.cnk);
    const [current] = await ctx.tx
      .select({ id: products.id, cnk: products.cnk, status: products.status })
      .from(products)
      .where(eq(products.id, input.productId))
      .for("update");
    if (!current) throw notFound("catalog.product_not_found");
    if (current.status === "active") {
      const missing = missingForActivation(input.content.map((c) => c.locale));
      if (missing.length > 0)
        throw conflict("catalog.content_missing", { missing: missing.join(",") });
    }
    await requireBrand(ctx, input.brandId);
    if (input.cnk !== current.cnk) {
      const [taken] = await ctx.tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.cnk, input.cnk));
      if (taken) throw conflict("catalog.cnk_taken");
    }
    await ctx.tx
      .update(products)
      .set({ ...coreValues(input), updatedAt: ctx.now })
      .where(eq(products.id, input.productId));
    await saveContent(ctx, input.productId, input.content);
    await ctx.audit.record({
      action: CATALOG_AUDIT.productUpdated,
      entityType: "product",
      entityId: input.productId,
      data: { productId: input.productId, cnk: input.cnk },
    });
    return { productId: input.productId };
  },
});

/** Moves a product between `draft`, `active` and `archived`; `active` needs NL and FR content. */
export const setProductStatus = command({
  name: "catalog.product.set_status",
  input: z.object({ productId: z.uuid(), status: z.enum(PRODUCT_STATUSES) }),
  output: z.object({ productId: z.uuid(), status: z.enum(PRODUCT_STATUSES) }),
  permission: PERMISSIONS.catalog.productsManage,
  async handler({ input, ctx }) {
    const [current] = await ctx.tx
      .select({ id: products.id, status: products.status })
      .from(products)
      .where(eq(products.id, input.productId))
      .for("update");
    if (!current) throw notFound("catalog.product_not_found");
    const from = current.status as (typeof PRODUCT_STATUSES)[number];
    if (from === input.status) throw conflict("catalog.status_unchanged", { status: from });
    if (input.status === "active") {
      const rows = await ctx.tx
        .select({ locale: productContent.locale })
        .from(productContent)
        .where(eq(productContent.productId, input.productId));
      const missing = missingForActivation(rows.map((r) => r.locale));
      if (missing.length > 0)
        throw conflict("catalog.content_missing", { missing: missing.join(",") });
    }
    await ctx.tx
      .update(products)
      .set({ status: input.status, updatedAt: ctx.now })
      .where(eq(products.id, input.productId));
    await ctx.audit.record({
      action: CATALOG_AUDIT.productStatusChanged,
      entityType: "product",
      entityId: input.productId,
      data: { productId: input.productId, from, to: input.status },
    });
    return { productId: input.productId, status: input.status };
  },
});

/** Creates a brand; its slug (lowercase letters, digits and dashes) is unique. */
export const createBrand = command({
  name: "catalog.brand.create",
  input: z.object({
    name: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
  }),
  output: z.object({ brandId: z.uuid() }),
  permission: PERMISSIONS.catalog.productsManage,
  async handler({ input, ctx }) {
    const [brand] = await ctx.tx
      .insert(brands)
      .values({ name: input.name, slug: input.slug })
      .onConflictDoNothing({ target: brands.slug })
      .returning({ id: brands.id });
    if (!brand) throw conflict("catalog.brand_slug_taken");
    await ctx.audit.record({
      action: CATALOG_AUDIT.brandCreated,
      entityType: "brand",
      entityId: brand.id,
      data: { brandId: brand.id, slug: input.slug },
    });
    return { brandId: brand.id };
  },
});
