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
  orderReviewed: "orders.order.reviewed",
  orderAdvanced: "orders.order.advanced",
  orderReReserved: "orders.order.re_reserved",
  orderCancelled: "orders.order.cancelled",
  refundRequested: "orders.refund.requested",
  refundStatusRecorded: "orders.refund.status_recorded",
  recallNoticesRequested: "orders.recall.notices_requested",
  deliverySettingsSet: "orders.delivery_settings.set",
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
/** The decision and where it sent the order; never the pharmacist's note. */
const orderReviewed = z.object({
  orderId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  status: z.string().max(30),
});
const orderAdvanced = z.object({
  orderId: z.uuid(),
  from: z.string().max(30),
  to: z.string().max(30),
});

/** igs-pharma#158: a stock-short order held again, and where it went. */
const orderReReserved = z.object({ orderId: z.uuid(), status: z.string().max(30) });
/** igs-pharma#158: a stock-short order cancelled, and its refund (null: none recorded). */
const orderCancelled = z.object({
  orderId: z.uuid(),
  from: z.string().max(30),
  reason: z.string().max(30),
  refundId: z.uuid().nullable(),
});

/**
 * igs-pharma#156: ids, the reason code, the amount and the approving pharmacist's id; never the
 * staff note or the customer. The requester is the audit entry's actor.
 */
const refundRequested = z.object({
  orderId: z.uuid(),
  refundId: z.uuid(),
  paymentId: z.uuid(),
  reason: z.string().max(30),
  amountCents: z.number().int().min(1),
  currency: z.string().length(3),
  approvedById: z.string().max(64).nullable(),
});
/** The provider's refund id (`re_…`, useless without our API key) and the outcome. */
const refundStatusRecorded = z.object({
  orderId: z.uuid(),
  refundId: z.uuid(),
  status: z.string().max(20),
  amountCents: z.number().int().min(1),
  currency: z.string().length(3),
  providerRefundId: z.string().max(70).nullable(),
  failureCode: z.string().max(40).nullable(),
});

/** igs-pharma#189: ids and counts only; never who the customers are. */
const recallNoticesRequested = z.object({
  recallId: z.uuid(),
  productId: z.uuid(),
  requested: z.number().int().min(0),
  affected: z.number().int().min(0),
});

/**
 * igs-pharma#202: amounts in cents and the new version only; the person who changed it is the audit
 * entry's actor. `previous*` are the amounts in force before (the defaults the first time, then `previousWasDefault`);
 * a null `previousFreeFromCents` means delivery was never free.
 */
const deliverySettingsSet = z.object({
  priceCents: z.number().int().min(0),
  freeFromCents: z.number().int().min(0).nullable(),
  previousPriceCents: z.number().int().min(0).nullable(),
  previousFreeFromCents: z.number().int().min(0).nullable(),
  /** `true`: staff had never saved, the `previous*` amounts are the defaults that were in force. */
  previousWasDefault: z.boolean().optional(),
  version: z.number().int().min(1),
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
  register(ORDERS_AUDIT.checkoutStarted, checkoutStarted);
  register(ORDERS_AUDIT.orderPlaced, orderPlaced);
  register(ORDERS_AUDIT.paymentAttached, paymentAttached);
  register(ORDERS_AUDIT.paymentStatusRecorded, paymentStatusRecorded);
  register(ORDERS_AUDIT.orderExpired, orderExpired);
  register(ORDERS_AUDIT.orderReviewed, orderReviewed);
  register(ORDERS_AUDIT.orderAdvanced, orderAdvanced);
  register(ORDERS_AUDIT.orderReReserved, orderReReserved);
  register(ORDERS_AUDIT.orderCancelled, orderCancelled);
  register(ORDERS_AUDIT.refundRequested, refundRequested);
  register(ORDERS_AUDIT.refundStatusRecorded, refundStatusRecorded);
  register(ORDERS_AUDIT.recallNoticesRequested, recallNoticesRequested);
  register(ORDERS_AUDIT.deliverySettingsSet, deliverySettingsSet);
}
