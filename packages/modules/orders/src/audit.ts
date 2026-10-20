import { z } from "zod";

/** Audit actions recorded by the orders commands (`<domain>.<noun>.<verb>`). */
export const ORDERS_AUDIT = {
  cartLineSet: "orders.cart.line_set",
  cartAttached: "orders.cart.attached",
} as const;

/** Ids and counts only (D-028): never the cart token, which opens the cart. */
const cartLineSet = z.object({
  cartId: z.uuid(),
  productId: z.uuid(),
  quantity: z.number().int().min(0),
});
const cartAttached = z.object({
  cartId: z.uuid(),
  merged: z.number().int().min(0),
  dropped: z.number().int().min(0),
});

/** The signature of `registerAuditAction` from `@igs/module-audit`. */
export type RegisterAuditAction = (action: string, data: z.ZodObject<z.ZodRawShape>) => void;

/**
 * Registers the orders audit actions. Each composition root that runs orders commands calls it
 * once, before `configureKernel`, passing `registerAuditAction` from `@igs/module-audit`.
 */
export function registerAuditActions(register: RegisterAuditAction): void {
  register(ORDERS_AUDIT.cartLineSet, cartLineSet);
  register(ORDERS_AUDIT.cartAttached, cartAttached);
}
