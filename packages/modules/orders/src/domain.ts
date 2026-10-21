/**
 * Orders domain rules (igs-pharma#116, D-045), free of I/O and of imports: drizzle-kit loads this
 * file through `schema.ts`.
 */

/**
 * The order lifecycle. Payment states (created, paid, refund pending, refunded…) are kept apart, on
 * the payment, so an order's state says only where the order itself stands.
 *
 * - `pending_payment`: placed, the customer is at the payment provider;
 * - `paid_stock_short`: paid after the stock hold lapsed and the stock is gone: staff re-reserve or
 *   refund, the customer is never charged silently for stock we do not have;
 * - `in_review`: paid, holds a medicine, waits for a pharmacist;
 * - `ready_to_prepare` → `preparing` → `ready_for_pickup` → `collected`;
 * - `cancelled`: payment failed or was cancelled, the pharmacist refused, or staff cancelled;
 * - `expired`: never paid (24 h).
 */
export const ORDER_STATUSES = [
  "pending_payment",
  "paid_stock_short",
  "in_review",
  "ready_to_prepare",
  "preparing",
  "ready_for_pickup",
  "collected",
  "cancelled",
  "expired",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Every allowed status change. The database enforces the same table (migration `0047_orders`,
 * `orders.order_guard`); a real-Postgres test tries every pair against both. End states have no
 * arrows. One more rule than the table: an order that holds a medicine (`needs_review`) reaches
 * `ready_to_prepare` only from `in_review`, so it is never prepared without a pharmacist.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_payment: ["paid_stock_short", "in_review", "ready_to_prepare", "cancelled", "expired"],
  paid_stock_short: ["in_review", "ready_to_prepare", "cancelled"],
  in_review: ["ready_to_prepare", "cancelled"],
  ready_to_prepare: ["preparing", "cancelled"],
  preparing: ["ready_for_pickup", "cancelled"],
  ready_for_pickup: ["collected", "cancelled"],
  collected: [],
  cancelled: [],
  expired: [],
};

/** Whether an order may move from `from` to `to` (the TypeScript twin of the database guard). */
export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  options: { readonly needsReview: boolean },
): boolean {
  if (!ORDER_TRANSITIONS[from].includes(to)) return false;
  // a medicine is never prepared without a pharmacist's approval
  return !(to === "ready_to_prepare" && options.needsReview && from !== "in_review");
}

/** The storefront locales an order is placed in (its e-mails go out in the same one). */
export const ORDER_LOCALES = ["nl", "fr", "de", "en"] as const;
export type OrderLocale = (typeof ORDER_LOCALES)[number];

/** Belgian VAT classes, the same values as the catalog's (copied onto the order line). */
export const ORDER_VAT_CLASSES = ["BE_6", "BE_21"] as const;

/** Phase 1 sells in euros only. */
export const ORDER_CURRENCY = "EUR";

/** A readable order reference: `IGS-2026-000123` (not an invoice number, O-4). */
export const ORDER_REFERENCE_PATTERN = /^IGS-[0-9]{4}-[0-9]{6,}$/;

// ── cart ─────────────────────────────────────────────────────────────────────────────────────────

/** At most this many lines (products) in one cart. */
export const CART_MAX_LINES = 30;

/**
 * How many of one product a cart and an order may hold (O-3, defaults until the pharmacist confirms
 * per product): two packs of a medicine, ten of anything else.
 */
export const MAX_PER_ORDER_MEDICINE = 2;
export const MAX_PER_ORDER_OTHER = 10;

export const maxPerOrder = (isMedicine: boolean): number =>
  isMedicine ? MAX_PER_ORDER_MEDICINE : MAX_PER_ORDER_OTHER;

/** A cart is kept this long after its last change (gdpr-and-privacy.md: carts, 30 days). */
export const CART_TTL_DAYS = 30;
export const DAY_MS = 86_400_000;

/**
 * The cart cookie's value: 128 random bits, base64url without padding (22 characters). Only its
 * SHA-256 is stored, so a database read never yields a usable cookie.
 */
export const CART_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

// ── checkout and payment ─────────────────────────────────────────────────────────────────────────

/**
 * A checkout freezes the cart's lines and prices and holds the stock for `CHECKOUT_HOLD_MINUTES`.
 * `open` until the order is placed (`placed`) or the shopper starts again (`cancelled`).
 */
export const CHECKOUT_STATUSES = ["open", "placed", "cancelled"] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

/** How long a checkout holds the stock (inventory's default hold). */
export const CHECKOUT_HOLD_MINUTES = 15;
export const MINUTE_MS = 60_000;

/** Payment providers. Phase 1: Mollie, instant methods only. */
export const PAYMENT_PROVIDERS = ["mollie"] as const;

/**
 * A payment's state, kept apart from the order's: `created` before the provider knows it, then the
 * provider's own statuses (Mollie: open, pending, authorized, paid, failed, canceled, expired).
 */
export const PAYMENT_STATUSES = [
  "created",
  "open",
  "pending",
  "authorized",
  "paid",
  "failed",
  "canceled",
  "expired",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Inventory holder ref of a checkout's (and its order's) stock holds. */
export const holderOf = (checkoutId: string) => `checkout:${checkoutId}`;

/** Pharmacist review decisions. */
export const REVIEW_DECISIONS = ["approved", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
/** Max length of the staff-only review note. */
export const REVIEW_NOTE_MAX = 500;

/** `IGS-<year>-<number, 6 digits at least>`. */
export const formatOrderReference = (year: number, number: number): string =>
  `IGS-${year}-${String(number).padStart(6, "0")}`;

// ── refunds ──────────────────────────────────────────────────────────────────────────────────────

/**
 * A refund's state (igs-pharma#156). `requested`: recorded, the provider not yet asked; `pending`:
 * the provider accepted it; then `refunded`, `failed` or `canceled`. Only forward; end states stay.
 */
export const REFUND_STATUSES = ["requested", "pending", "refunded", "failed", "canceled"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Statuses that block another refund of the same payment (full refunds only). */
export const ACTIVE_REFUND_STATUSES = [
  "requested",
  "pending",
  "refunded",
] as const satisfies readonly RefundStatus[];

/** Why an order is refunded. `pharmacist_rejected` is set by the review itself. */
export const REFUND_REASONS = [
  "pharmacist_rejected",
  "stock_short",
  "paid_after_close",
  "customer_request",
  "other",
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/** Max length of the staff-only refund note. */
export const REFUND_NOTE_MAX = 500;

/** Order statuses whose paid payment is refunded: the order is closed. */
export const REFUNDABLE_ORDER_STATUSES = [
  "cancelled",
  "expired",
] as const satisfies readonly OrderStatus[];

// ── customer mails ───────────────────────────────────────────────────────────────────────────────

/**
 * The order mails (igs-pharma#157), each tied to one state: `order_received` (paid, now checked by
 * the pharmacy: in review or ready to prepare), `stock_short` (paid, stock short),
 * `ready_for_pickup`, `refund_initiated` (a refund recorded) and `refund_completed` (refunded).
 */
export const ORDER_MAIL_KINDS = [
  "order_received",
  "stock_short",
  "ready_for_pickup",
  "refund_initiated",
  "refund_completed",
] as const;
export type OrderMailKind = (typeof ORDER_MAIL_KINDS)[number];

/** The kinds about one refund (they carry its id); the others are about the order. */
export const REFUND_MAIL_KINDS = [
  "refund_initiated",
  "refund_completed",
] as const satisfies readonly OrderMailKind[];

/** `pending` until the worker sent it (`sent`) or found nothing to send (`skipped`). */
export const ORDER_MAIL_STATUSES = ["pending", "sent", "skipped"] as const;
export type OrderMailStatus = (typeof ORDER_MAIL_STATUSES)[number];

/**
 * A paid order short of stock must be resolved (held again, or cancelled and refunded) within this
 * many hours of becoming short (igs-pharma#158 follow-up); past it, staff are alerted.
 */
export const STOCK_SHORT_DEADLINE_HOURS = 24;
