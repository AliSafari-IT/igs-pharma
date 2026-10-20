import { z } from "zod";

/** Audit actions recorded by the orders commands (`<domain>.<noun>.<verb>`). */
export const ORDERS_AUDIT = {
  cartLineSet: "orders.cart.line_set",
  cartAttached: "orders.cart.attached",
  checkoutStarted: "orders.checkout.started",
  orderPlaced: "orders.order.placed",
  paymentAttached: "orders.payment.attached",
  paymentStatusRecorded: "orders.payment.status_recorded",
  orderExpired: "orders.order.expired",
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

const checkoutStarted = z.object({
  checkoutId: z.uuid(),
  lines: z.number().int().min(1),
  totalCents: z.number().int().min(0),
});
/** Never the contact (name, e-mail, phone). `replay`: the same checkout placed again. */
const orderPlaced = z.object({
  orderId: z.uuid(),
  checkoutId: z.uuid(),
  totalCents: z.number().int().min(0),
  replay: z.boolean(),
});

/** Ids and statuses only: never the provider's payment id or checkout link (they open the payment). */
const paymentAttached = z.object({
  paymentId: z.uuid(),
  orderId: z.uuid(),
  status: z.string().max(20),
});
const paymentStatusRecorded = paymentAttached.extend({ orderStatus: z.string().max(30) });
const orderExpired = z.object({ orderId: z.uuid() });

/** The signature of `registerAuditAction` from `@igs/module-audit`. */
export type RegisterAuditAction = (action: string, data: z.ZodObject<z.ZodRawShape>) => void;

/**
 * Registers the orders audit actions. Each composition root that runs orders commands calls it
 * once, before `configureKernel`, passing `registerAuditAction` from `@igs/module-audit`.
 */
export function registerAuditActions(register: RegisterAuditAction): void {
  register(ORDERS_AUDIT.cartLineSet, cartLineSet);
  register(ORDERS_AUDIT.cartAttached, cartAttached);
  register(ORDERS_AUDIT.checkoutStarted, checkoutStarted);
  register(ORDERS_AUDIT.orderPlaced, orderPlaced);
  register(ORDERS_AUDIT.paymentAttached, paymentAttached);
  register(ORDERS_AUDIT.paymentStatusRecorded, paymentStatusRecorded);
  register(ORDERS_AUDIT.orderExpired, orderExpired);
}
