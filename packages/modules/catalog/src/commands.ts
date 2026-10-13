import { type Ctx, command, conflict, forbidden, notFound, validationFailed } from "@igs/kernel";
import { PERMISSIONS, hasPermission } from "@igs/rbac";
import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";

import { CATALOG_AUDIT } from "./audit";
import { isUniqueViolation, requireVersion } from "./concurrency";
import {
  CONTENT_LOCALES,
  LEGAL_STATUSES,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  type RegulatedValues,
  VAT_CLASSES,
  changedRegulatedFields,
  isGeneralEnvelope,
  isMedicine,
  isValidCnk,
  legalStatusFits,
  missingForActivation,
} from "./domain";
import { brands, productContent, products } from "./schema";

/**
 * Catalog commands (igs-pharma#50, #79). Every one runs through the kernel: authorize → validate →
 * one transaction (handler + audit). A product is created as a `draft`; it becomes `active` only
 * with Dutch and French content (`catalog.content_missing`).
 *
 * Two command families, one static permission each (D-005, D-034):
 * - content (`catalog.products.manage`: content editor, owner): text, brand, cold chain. They may
 *   carry the regulated values, but only to GUARD them: a change is refused with
 *   `catalog.regulated_fields_require_pharmacist`, a medicine is never activated
 *   (`catalog.medicine_activation_requires_pharmacist`), and a new product must be in the general
 *   envelope (`isGeneralEnvelope`).
 * - regulated (`catalog.products.regulated.manage`: pharmacist, titular; never the owner, D-030):
 *   `createProductRegulated`, `updateProductRegulated`, `setProductStatusRegulated`.
 *
 * Content is saved as a whole set: the locales in the input are written, the others removed.
 * Saving content stamps `approved_by`/`approved_at` with the saving actor (source `manual`), except
 * an editor's save on a medicine, which CLEARS the approval of the locales it wrote: only a
 * pharmacist approves medicine text (D-034).
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
/** `expectedVersion`: the version the edit form loaded (igs-pharma#80); a stale one is refused. */
const updateInput = z.object({
  productId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  ...productFields,
});
type ProductFields = z.infer<typeof createInput>;

const productIdOutput = z.object({ productId: z.uuid() });
const productWriteOutput = productIdOutput.extend({ version: z.number().int().min(1) });

function requireValidCnk(cnk: string): void {
  if (!isValidCnk(cnk))
    throw validationFailed("catalog.cnk_invalid", [{ path: "cnk", code: "cnk_invalid" }]);
}

async function requireBrand(ctx: Ctx, brandId: string | null): Promise<void> {
  if (brandId === null) return;
  const [brand] = await ctx.tx.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId));
  if (!brand) throw notFound("catalog.brand_not_found");
}

/** The unique constraint on `catalog.products.cnk` (migration 0013). */
const CNK_UNIQUE = "products_cnk_unique";

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

const regulatedOf = (input: RegulatedValues): RegulatedValues => ({
  productType: input.productType,
  legalStatus: input.legalStatus,
  vatClass: input.vatClass,
  requiresPharmacistReview: input.requiresPharmacistReview,
  ageMin: input.ageMin,
});

/** `otc_medicine` must be `otc`, `rx_medicine` `rx`, anything else `pharmacy_only` or `general_sale`. */
function requireConsistent(input: ProductFields): void {
  if (!legalStatusFits(input.productType, input.legalStatus)) {
    throw validationFailed("catalog.product_type_legal_status_mismatch", [
      { path: "legalStatus", code: "product_type_legal_status_mismatch" },
    ]);
  }
}

const REGULATED_REQUIRED = "catalog.regulated_fields_require_pharmacist";

/** Who approves the text a save writes: the saving actor, or nobody (a content editor's save on a medicine). */
type Approval = "actor" | "none";

/** Replaces the product's content with `content` (see the module comment). */
async function saveContent(
  ctx: Ctx,
  productId: string,
  content: ProductFields["content"],
  approval: Approval,
) {
  const locales = content.map((c) => c.locale);
  await ctx.tx
    .delete(productContent)
    .where(
      locales.length === 0
        ? eq(productContent.productId, productId)
        : and(eq(productContent.productId, productId), notInArray(productContent.locale, locales)),
    );
  if (content.length === 0) return;
  const approved = approval === "actor" && ctx.actor.type === "user";
  const approvedBy = approved ? ctx.actor.id : null;
  const approvedAt = approved ? ctx.now : null;
  for (const item of content) {
    const values = {
      name: item.name,
      shortDescription: item.shortDescription,
      description: item.description,
      warnings: item.warnings,
      source: "manual",
      approvedBy,
      approvedAt,
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

async function insertProduct(
  ctx: Ctx,
  input: ProductFields,
): Promise<{ productId: string; version: number }> {
  requireValidCnk(input.cnk);
  await requireBrand(ctx, input.brandId);
  const [product] = await ctx.tx
    .insert(products)
    .values({ ...coreValues(input), status: "draft" })
    .onConflictDoNothing({ target: products.cnk })
    .returning({ id: products.id });
  if (!product) throw conflict("catalog.cnk_taken");
  // a new product is never a medicine unless a pharmacist creates it: the saving actor approves
  await saveContent(ctx, product.id, input.content, "actor");
  await ctx.audit.record({
    action: CATALOG_AUDIT.productCreated,
    entityType: "product",
    entityId: product.id,
    data: { productId: product.id, cnk: input.cnk, version: 1 },
  });
  return { productId: product.id, version: 1 };
}

/**
 * Creates a `draft` product in the general envelope (a non-medicine in general sale, default VAT
 * class, no pharmacist review, no age limit). Medicines and other regulated values need
 * `createProductRegulated`.
 */
export const createProduct = command({
  name: "catalog.product.create",
  input: createInput,
  output: productWriteOutput,
  permission: PERMISSIONS.catalog.productsManage,
  async handler({ input, ctx }) {
    if (!isGeneralEnvelope(regulatedOf(input))) throw forbidden(REGULATED_REQUIRED);
    return insertProduct(ctx, input);
  },
});

/** Creates a `draft` product with any regulated values (a pharmacist; D-034). */
export const createProductRegulated = command({
  name: "catalog.product.create_regulated",
  input: createInput,
  output: productWriteOutput,
  permission: PERMISSIONS.catalog.productsRegulatedManage,
  async handler({ input, ctx }) {
    requireConsistent(input);
    return insertProduct(ctx, input);
  },
});

type Family = "content" | "regulated";

/** The update both families share; `family` decides who may change the regulated fields. */
async function applyUpdate(ctx: Ctx, input: z.infer<typeof updateInput>, family: Family) {
  requireValidCnk(input.cnk);
  const [current] = await ctx.tx
    .select({
      id: products.id,
      cnk: products.cnk,
      status: products.status,
      version: products.version,
      productType: products.productType,
      legalStatus: products.legalStatus,
      vatClass: products.vatClass,
      requiresPharmacistReview: products.requiresPharmacistReview,
      ageMin: products.ageMin,
    })
    .from(products)
    .where(eq(products.id, input.productId))
    .for("update");
  if (!current) throw notFound("catalog.product_not_found");
  requireVersion(current.version, input.expectedVersion);
  const changed = changedRegulatedFields(current, regulatedOf(input));
  if (family === "content") {
    // equal values pass, so the full form keeps working; a different one is a pharmacist's change
    if (changed.length > 0) throw forbidden(REGULATED_REQUIRED, { fields: changed.join(",") });
  } else {
    requireConsistent(input);
  }
  if (current.status === "active") {
    const missing = missingForActivation(input.content.map((c) => c.locale));
    if (missing.length > 0)
      throw conflict("catalog.content_missing", { missing: missing.join(",") });
  }
  await requireBrand(ctx, input.brandId);
  const cnkChanged = input.cnk !== current.cnk;
  if (cnkChanged) {
    // the CNK is a business key (igs-pharma#80): a live product keeps it; correct it by archiving first
    if (current.status === "active") throw conflict("catalog.cnk_locked");
    const [taken] = await ctx.tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.cnk, input.cnk));
    if (taken) throw conflict("catalog.cnk_taken");
  }
  const version = current.version + 1;
  try {
    // a savepoint: a lost race for the CNK (the SELECT above is not a lock) is a typed conflict,
    // not the unique index's raw error
    await ctx.tx.transaction((sp) =>
      sp
        .update(products)
        .set({ ...coreValues(input), version, updatedAt: ctx.now })
        .where(eq(products.id, input.productId)),
    );
  } catch (error) {
    if (isUniqueViolation(error, CNK_UNIQUE)) throw conflict("catalog.cnk_taken");
    throw error;
  }
  // only a pharmacist approves medicine text (D-034): an editor's save on a medicine clears it
  const approval: Approval =
    family === "content" && isMedicine(current.productType, current.legalStatus) ? "none" : "actor";
  await saveContent(ctx, input.productId, input.content, approval);
  await ctx.audit.record({
    action: CATALOG_AUDIT.productUpdated,
    entityType: "product",
    entityId: input.productId,
    data: { productId: input.productId, cnk: input.cnk, version },
  });
  if (cnkChanged) {
    await ctx.audit.record({
      action: CATALOG_AUDIT.productCnkChanged,
      entityType: "product",
      entityId: input.productId,
      data: { productId: input.productId, fromCnk: current.cnk, toCnk: input.cnk },
    });
  }
  if (changed.length > 0) {
    await ctx.audit.record({
      action: CATALOG_AUDIT.productRegulatedChanged,
      entityType: "product",
      entityId: input.productId,
      data: { productId: input.productId, changed: changed.join(",") },
    });
  }
  return { productId: input.productId, version };
}

/**
 * Replaces a product's content and non-regulated fields (content editor, owner). The regulated
 * values in the input must equal the stored ones (`catalog.regulated_fields_require_pharmacist`).
 * `expectedVersion` is the version the form loaded (`catalog.stale_version` otherwise, before
 * anything is written). An `active` product must keep its Dutch and French content
 * (`catalog.content_missing`) and its CNK (`catalog.cnk_locked`: archive it first to correct the
 * CNK); its status changes only through `setProductStatus`. A CNK change on a draft or archived
 * product is audited (`catalog.product.cnk_changed`). On a medicine the saved text is left unapproved.
 */
export const updateProduct = command({
  name: "catalog.product.update",
  input: updateInput,
  output: productWriteOutput,
  permission: PERMISSIONS.catalog.productsManage,
  handler: ({ input, ctx }) => applyUpdate(ctx, input, "content"),
});

/** Replaces a product's core fields, regulated ones included, and content; approves the text (a pharmacist). */
export const updateProductRegulated = command({
  name: "catalog.product.update_regulated",
  input: updateInput,
  output: productWriteOutput,
  permission: PERMISSIONS.catalog.productsRegulatedManage,
  handler: ({ input, ctx }) => applyUpdate(ctx, input, "regulated"),
});

const statusInput = z.object({ productId: z.uuid(), status: z.enum(PRODUCT_STATUSES) });
const statusOutput = z.object({
  productId: z.uuid(),
  status: z.enum(PRODUCT_STATUSES),
  version: z.number().int().min(1),
});

async function applyStatus(ctx: Ctx, input: z.infer<typeof statusInput>, family: Family) {
  const [current] = await ctx.tx
    .select({
      id: products.id,
      status: products.status,
      version: products.version,
      productType: products.productType,
      legalStatus: products.legalStatus,
    })
    .from(products)
    .where(eq(products.id, input.productId))
    .for("update");
  if (!current) throw notFound("catalog.product_not_found");
  const from = current.status as (typeof PRODUCT_STATUSES)[number];
  if (from === input.status) throw conflict("catalog.status_unchanged", { status: from });
  if (
    family === "content" &&
    input.status === "active" &&
    isMedicine(current.productType, current.legalStatus)
  ) {
    throw forbidden("catalog.medicine_activation_requires_pharmacist");
  }
  if (input.status === "active") {
    const rows = await ctx.tx
      .select({ locale: productContent.locale })
      .from(productContent)
      .where(eq(productContent.productId, input.productId));
    const missing = missingForActivation(rows.map((r) => r.locale));
    if (missing.length > 0)
      throw conflict("catalog.content_missing", { missing: missing.join(",") });
  }
  // every write bumps the version, so an edit form loaded before this change is refused (igs-pharma#80)
  const version = current.version + 1;
  await ctx.tx
    .update(products)
    .set({ status: input.status, version, updatedAt: ctx.now })
    .where(eq(products.id, input.productId));
  await ctx.audit.record({
    action: CATALOG_AUDIT.productStatusChanged,
    entityType: "product",
    entityId: input.productId,
    data: { productId: input.productId, from, to: input.status, version },
  });
  return { productId: input.productId, status: input.status, version };
}

/**
 * Moves a product between `draft`, `active` and `archived`; `active` needs NL and FR content.
 * Activating a medicine needs a pharmacist (`setProductStatusRegulated`).
 */
export const setProductStatus = command({
  name: "catalog.product.set_status",
  input: statusInput,
  output: statusOutput,
  permission: PERMISSIONS.catalog.productsManage,
  handler: ({ input, ctx }) => applyStatus(ctx, input, "content"),
});

/** Moves any product between statuses, medicines included (a pharmacist; D-034). */
export const setProductStatusRegulated = command({
  name: "catalog.product.set_status_regulated",
  input: statusInput,
  output: statusOutput,
  permission: PERMISSIONS.catalog.productsRegulatedManage,
  handler: ({ input, ctx }) => applyStatus(ctx, input, "regulated"),
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

/**
 * Whether these roles may create or change regulated fields and activate medicines. For the
 * back-office to choose the command family and show the fields read-only; the commands still
 * enforce it (D-005).
 */
export const canManageRegulated = (roles: readonly string[]): boolean =>
  hasPermission(roles, PERMISSIONS.catalog.productsRegulatedManage);
