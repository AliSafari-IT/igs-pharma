import type {
  FulfilmentStep,
  OrderStatus,
  PaymentStatus,
  RefundReason,
  RefundStatus,
  ReviewDecision,
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
  "pending_payment",
  "collected",
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
};

/** The next fulfilment step from a status, if staff can take one. */
export function nextStep(status: OrderStatus): FulfilmentStep | null {
  switch (status) {
    case "ready_to_prepare":
      return "preparing";
    case "preparing":
      return "ready_for_pickup";
    case "ready_for_pickup":
      return "collected";
    default:
      return null;
  }
}

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
  "orders.order_not_refundable": "Only a paid order that is cancelled or expired can be refunded.",
  "orders.refund_exists": "A refund for this order is already under way or done.",
  "orders.refund_needs_pharmacist":
    "This order holds a medicine: a pharmacist asks for its refund.",
  "kernel.forbidden": "You don't have access to this.",
  "kernel.mfa_required": "Confirm your sign-in with your second step first.",
  "kernel.validation_failed": "Check what you entered.",
};

export const orderErrorMessage = (code: string | undefined): string =>
  (code && Object.hasOwn(ERRORS, code) && ERRORS[code]) || "That didn't work. Try again.";
