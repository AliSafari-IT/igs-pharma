import { z } from "zod";

import { CNK_PATTERN, PRODUCT_STATUSES, REGULATED_FIELDS, STOP_SALE_REASONS } from "./domain";

/** Audit actions recorded by the catalog commands (`<domain>.<noun>.<verb>`). */
export const CATALOG_AUDIT = {
  productCreated: "catalog.product.created",
  productUpdated: "catalog.product.updated",
  productCnkChanged: "catalog.product.cnk_changed",
  productStatusChanged: "catalog.product.status_changed",
  productRegulatedChanged: "catalog.product.regulated_changed",
  brandCreated: "catalog.brand.created",
  categoryCreated: "catalog.category.created",
  categoryUpdated: "catalog.category.updated",
  categoryMoved: "catalog.category.moved",
  categoryDeleted: "catalog.category.deleted",
  productCategoriesSet: "catalog.product.categories_set",
  productSaleStopped: "catalog.product.sale_stopped",
  productSaleResumed: "catalog.product.sale_resumed",
} as const;

const cnk = z.string().regex(CNK_PATTERN);
/** `version` is the row's version AFTER the write (igs-pharma#80): an integer, never personal data. */
const productChange = z.object({ productId: z.uuid(), cnk, version: z.number().int().min(1) });
const cnkChange = z.object({ productId: z.uuid(), fromCnk: cnk, toCnk: cnk });
const statusChange = z.object({
  productId: z.uuid(),
  from: z.enum(PRODUCT_STATUSES),
  to: z.enum(PRODUCT_STATUSES),
  version: z.number().int().min(1),
});
/**
 * Which regulated fields changed: their names, comma-separated, never their values (D-028; audit
 * data holds flat values only).
 */
const regulatedChange = z.object({
  productId: z.uuid(),
  changed: z
    .string()
    .min(1)
    .refine((names) =>
      names.split(",").every((n) => (REGULATED_FIELDS as readonly string[]).includes(n)),
    ),
});
const brandCreated = z.object({ brandId: z.uuid(), slug: z.string() });
const categoryCreated = z.object({
  categoryId: z.uuid(),
  slug: z.string(),
  parentId: z.uuid().nullable(),
});
const categoryChange = z.object({ categoryId: z.uuid(), slug: z.string() });
const categoryUpdated = categoryChange.extend({ version: z.number().int().min(1) });
const categoryMoved = z.object({
  categoryId: z.uuid(),
  fromParentId: z.uuid().nullable(),
  toParentId: z.uuid().nullable(),
  position: z.number().int(),
  version: z.number().int().min(1),
});
const productCategoriesSet = z.object({
  productId: z.uuid(),
  added: z.number().int(),
  removed: z.number().int(),
  total: z.number().int(),
});

/** igs-pharma#187: ids and the reason only. */
const stopSale = z.object({
  productId: z.uuid(),
  stopSaleId: z.uuid(),
  reason: z.enum(STOP_SALE_REASONS),
  referenceId: z.uuid(),
});

/** The signature of `registerAuditAction` from `@igs/module-audit`. */
export type RegisterAuditAction = (action: string, data: z.ZodObject<z.ZodRawShape>) => void;

/**
 * Registers the catalog audit actions (identifiers and status only, D-028; never product text).
 * Each composition root that runs catalog commands calls it once, before `configureKernel`,
 * passing `registerAuditAction` from `@igs/module-audit`.
 */
export function registerAuditActions(register: RegisterAuditAction): void {
  register(CATALOG_AUDIT.productCreated, productChange);
  register(CATALOG_AUDIT.productUpdated, productChange);
  register(CATALOG_AUDIT.productCnkChanged, cnkChange);
  register(CATALOG_AUDIT.productStatusChanged, statusChange);
  register(CATALOG_AUDIT.productRegulatedChanged, regulatedChange);
  register(CATALOG_AUDIT.brandCreated, brandCreated);
  register(CATALOG_AUDIT.categoryCreated, categoryCreated);
  register(CATALOG_AUDIT.categoryUpdated, categoryUpdated);
  register(CATALOG_AUDIT.categoryMoved, categoryMoved);
  register(CATALOG_AUDIT.categoryDeleted, categoryChange);
  register(CATALOG_AUDIT.productCategoriesSet, productCategoriesSet);
  register(CATALOG_AUDIT.productSaleStopped, stopSale);
  register(CATALOG_AUDIT.productSaleResumed, stopSale);
}
