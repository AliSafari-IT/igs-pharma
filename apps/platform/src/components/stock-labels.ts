import type {
  AdjustReason,
  MovementReason,
  ReleaseReason,
  ReservationKind,
} from "@igs/module-inventory";

/**
 * The English text staff see for inventory values and error codes (D-006: the kernel carries no
 * text; the back-office is English-only, so the mapping lives here).
 */
export const REASON_LABELS: Record<MovementReason, string> = {
  import: "Stock count (CSV)",
  adjustment: "Adjustment",
  correction: "Correction",
  sale: "Sale (picked for an order)",
};

/** What a reservation is, in the pharmacy's words (igs-pharma#99). */
export const KIND_LABELS: Record<ReservationKind, string> = {
  hold: "Checkout in progress",
  order: "Order",
};

/**
 * The reasons offered when staff release a reservation. A type-only copy of `RELEASE_REASONS`
 * (client components must not import the inventory module itself).
 */
export const RELEASE_REASON_OPTIONS = [
  "checkout_cancelled",
  "order_cancelled",
  "refunded",
  "staff_correction",
] as const satisfies readonly ReleaseReason[];

export const RELEASE_REASON_LABELS: Record<ReleaseReason, string> = {
  checkout_cancelled: "Checkout cancelled",
  order_cancelled: "Order cancelled",
  refunded: "Refunded before picking",
  staff_correction: "Set aside by mistake",
};

/** "3 min", "2 h 5 min", "4 days": how long ago `from` was at `now`. */
export function formatAge(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * The reasons offered in the Adjust dialog, in order. A type-only copy of `ADJUST_REASONS`: client
 * components must not import the inventory module itself (server code).
 */
export const ADJUST_REASON_OPTIONS = [
  "adjustment",
  "correction",
] as const satisfies readonly AdjustReason[];

/** One problem line of a stock file. */
const ROW_ERRORS: Record<string, string> = {
  "inventory.unknown_cnk": "No product in the catalogue has this CNK.",
  "inventory.cnk_invalid": "The CNK must be exactly 7 digits.",
  "inventory.quantity_invalid": "The quantity must be a whole number from 0 to 1,000,000.",
  "inventory.duplicate_cnk": "This CNK is already on an earlier line.",
  "inventory.row_malformed": "Write the line as CNK;quantity.",
  "inventory.import_empty": "The file has no stock lines.",
  "inventory.too_many_rows": "The file has more than 5,000 lines. Split it into smaller files.",
};

export const rowErrorMessage = (code: string): string =>
  (Object.hasOwn(ROW_ERRORS, code) && ROW_ERRORS[code]) || "This line is not valid.";

const ERRORS: Record<string, string> = {
  "inventory.import_invalid": "The file has problems, so no stock was changed.",
  "inventory.file_missing": "Choose a CSV file to upload.",
  "inventory.file_too_large": "The file is larger than 250 KB. Split it into smaller files.",
  "inventory.product_not_found": "This product no longer exists.",
  "inventory.negative_stock": "Stock can't go below zero.",
  "inventory.reservation_not_found": "This reservation no longer exists. Reload the page.",
  "inventory.reservation_not_active":
    "This reservation has already ended (released, picked or expired). Reload the page.",
  "inventory.insufficient_stock": "There is not enough stock available to set aside.",
  "inventory.reservation_expired": "This checkout took too long: the stock was given back.",
  "inventory.import_stale":
    "Stock changed after you previewed this file, so nothing was imported. Upload the file again to see the new numbers.",
  "inventory.import_plan_expired":
    "This preview is more than an hour old, so nothing was imported. Upload the file again.",
  "inventory.import_plan_not_found": "This preview can't be found. Upload the file again.",
  "kernel.idempotency_in_progress": "This file is being imported right now. Reload in a moment.",
  "kernel.forbidden": "You don't have permission to work with stock.",
  "kernel.mfa_required": "Confirm your 2-step login first.",
  "kernel.validation_failed": "Some fields are not filled in correctly.",
};

export const stockErrorMessage = (code: string | undefined): string =>
  (code && Object.hasOwn(ERRORS, code) && ERRORS[code]) || "That didn't work. Try again.";

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Brussels",
});

export const formatMoment = (value: Date): string => dateTime.format(value);
