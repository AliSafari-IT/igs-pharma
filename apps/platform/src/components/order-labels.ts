import type {
  DeliveryMethod,
  FulfilmentStep,
  OrderStatus,
  PaymentStatus,
  RefundReason,
  RefundStatus,
  ReviewDecision,
  ShipmentStatus,
} from "@igs/module-orders";
import type { BadgeVariant } from "@igs/ui";

/** Back-office text for order values and error codes (type-only imports: safe in client code). */

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  paid_stock_short: "Paid, stock short",
  in_review: "Pharmacist review",
  ready_to_prepare: "To prepare",
  preparing: "Preparing",
  ready_for_pickup: "Ready for pickup",
  collected: "Collected",
  ready_to_ship: "Packed, to hand over",
  shipped: "With the carrier",
  delivered: "Delivered",
  returned: "Parcel returned",
  cancelled: "Cancelled",
  expired: "Expired",
};

export const ORDER_STATUS_BADGE: Record<OrderStatus, BadgeVariant> = {
  pending_payment: "neutral",
  paid_stock_short: "error",
  in_review: "amber",
  ready_to_prepare: "primary",
  preparing: "primary",
  ready_for_pickup: "success",
  collected: "neutral",
  ready_to_ship: "success",
  shipped: "primary",
  delivered: "neutral",
  returned: "error",
  cancelled: "neutral",
  expired: "neutral",
};

/** The queue tabs, in working order; "All" is the tab without a status. */
export const ORDER_QUEUES = [
  "in_review",
  "paid_stock_short",
  "ready_to_prepare",
  "preparing",
  "ready_for_pickup",
  "ready_to_ship",
  "shipped",
  "returned",
  "pending_payment",
  "collected",
  "delivered",
  "cancelled",
  "expired",
] as const satisfies readonly OrderStatus[];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  created: "Not started",
  open: "Open",
  pending: "Pending",
  authorized: "Authorised",
  paid: "Paid",
  failed: "Failed",
  canceled: "Cancelled by customer",
  expired: "Expired",
};

export const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = {
  approved: "Approved",
  rejected: "Rejected",
};

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  requested: "Requested",
  pending: "Sent to Mollie",
  refunded: "Refunded",
  failed: "Failed",
  canceled: "Cancelled at Mollie",
};

export const REFUND_STATUS_BADGE: Record<RefundStatus, BadgeVariant> = {
  requested: "amber",
  pending: "amber",
  refunded: "success",
  failed: "error",
  canceled: "neutral",
};

export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  pharmacist_rejected: "Pharmacist rejected the order",
  stock_short: "Stock short",
  not_sellable: "A product is no longer sellable",
  paid_after_close: "Paid after the order closed",
  customer_request: "Customer request",
  other: "Other",
};

/** The reasons staff choose from (the pharmacist's rejection sets its own). */
export const REFUND_REASON_OPTIONS = [
  "paid_after_close",
  "customer_request",
  "stock_short",
  "other",
] as const satisfies readonly RefundReason[];

/** The button that moves an order to this step. */
export const STEP_ACTION_LABELS: Record<FulfilmentStep, string> = {
  preparing: "Start preparing",
  ready_for_pickup: "Mark ready for pickup",
  collected: "Mark collected",
  ready_to_ship: "Packed: make the label",
  shipped: "Handed to the carrier",
  delivered: "Mark delivered",
  returned: "Parcel came back",
};

/**
 * The fulfilment steps staff can take from a status, the usual one first. A delivery order
 * (igs-pharma#202) is packed, handed over, then delivered (the carrier usually tells us; staff only
 * when it doesn't) or comes back.
 */
export function nextSteps(status: OrderStatus, method: DeliveryMethod): readonly FulfilmentStep[] {
  switch (status) {
    case "ready_to_prepare":
      return ["preparing"];
    case "preparing":
      return [method === "delivery" ? "ready_to_ship" : "ready_for_pickup"];
    case "ready_for_pickup":
      return ["collected"];
    case "ready_to_ship":
      return ["shipped"];
    case "shipped":
      return ["delivered", "returned"];
    default:
      return [];
  }
}

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  requested: "Label being made",
  created: "Label ready",
  failed: "Label refused",
  cancel_requested: "Cancelling at Sendcloud",
  cancelled: "Cancelled at Sendcloud",
};

export const SHIPMENT_STATUS_BADGE: Record<ShipmentStatus, BadgeVariant> = {
  requested: "amber",
  created: "success",
  failed: "error",
  cancel_requested: "amber",
  cancelled: "neutral",
};

const SHIPMENT_FAILURES: Record<string, string> = {
  provider_refused:
    "Sendcloud refused the parcel (often the address or the shipping method). Check it in Sendcloud, then try again.",
  announcement_failed:
    "The carrier refused the parcel. Fix it in Sendcloud's panel (the address, usually), then try again.",
  provider_unauthorized:
    "Sendcloud refused our keys. Ask the owner to check the Sendcloud settings.",
  provider_not_found: "Sendcloud doesn't know this parcel. Try again to make a new one.",
};

export const shipmentFailureMessage = (code: string | null): string =>
  (code && Object.hasOwn(SHIPMENT_FAILURES, code) && SHIPMENT_FAILURES[code]) ||
  "Sendcloud refused the parcel. Check it in Sendcloud, then try again.";

const ERRORS: Record<string, string> = {
  "orders.stale_version":
    "Someone else changed this order meanwhile. The page shows it as it is now.",
  "orders.order_not_in_review": "This order is no longer waiting for a pharmacist.",
  "orders.invalid_transition": "This order can't take that step from where it is now.",
  "orders.order_not_found": "This order doesn't exist.",
  "inventory.negative_stock":
    "The shelf holds less than this order: correct the stock count before marking it collected.",
  "inventory.reservation_not_active":
    "The stock for this order was already handed out or released.",
  "inventory.reservation_not_confirmed": "The stock for this order isn't confirmed yet.",
  "inventory.stock_not_sellable":
    "Part of the stock for this order can't be sold (quarantined, too close to expiry, or its lot not recorded). It can't be packed until sellable stock comes in.",
  "inventory.allocation_short":
    "There aren't enough sellable lots for this order: it can't be packed until stock comes in or a lot is released.",
  "orders.line_not_sellable":
    "A product of this order is no longer sellable (made inactive, prescription-only, or its text no longer approved). It can't be approved, prepared or handed over: cancel and refund the order.",
  "orders.order_sellable":
    "Every product of this order is still sellable: there is nothing to cancel here.",
  "orders.order_not_cancellable": "This order can't be cancelled from where it is now.",
  "orders.order_not_stock_short": "This order is no longer waiting for stock.",
  "orders.stock_still_short":
    "There still isn't enough stock for every product of this order. Nothing was reserved.",
  "orders.order_not_refundable":
    "Only a paid order that is cancelled, expired or whose parcel came back can be refunded.",
  "orders.shipment_label_missing":
    "The parcel has no label yet: it can't be handed to the carrier (or printed) until Sendcloud made one.",
  "orders.shipment_not_failed":
    "This label isn't refused (any more): there is nothing to try again.",
  "orders.refund_exists": "A refund for this order is already under way or done.",
  "orders.refund_needs_pharmacist":
    "This order holds a medicine: a pharmacist asks for its refund.",
  "kernel.forbidden": "You don't have access to this.",
  "kernel.mfa_required": "Confirm your sign-in with your second step first.",
  "kernel.validation_failed": "Check what you entered.",
};

export const orderErrorMessage = (code: string | undefined): string =>
  (code && Object.hasOwn(ERRORS, code) && ERRORS[code]) || "That didn't work. Try again.";
