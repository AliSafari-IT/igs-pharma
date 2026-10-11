import { z } from "zod";

import { PRODUCT_STATUSES } from "./domain";

/** Audit actions recorded by the catalog commands (`<domain>.<noun>.<verb>`). */
export const CATALOG_AUDIT = {
  productCreated: "catalog.product.created",
  productUpdated: "catalog.product.updated",
  productStatusChanged: "catalog.product.status_changed",
  brandCreated: "catalog.brand.created",
} as const;

const productChange = z.object({ productId: z.uuid(), cnk: z.string() });
const statusChange = z.object({
  productId: z.uuid(),
  from: z.enum(PRODUCT_STATUSES),
  to: z.enum(PRODUCT_STATUSES),
});
const brandCreated = z.object({ brandId: z.uuid(), slug: z.string() });

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
  register(CATALOG_AUDIT.productStatusChanged, statusChange);
  register(CATALOG_AUDIT.brandCreated, brandCreated);
}
