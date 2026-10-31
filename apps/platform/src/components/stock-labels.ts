import type {
  AdjustReason,
  ExpiryState,
  LotTracking,
  MovementReason,
  QuarantineReason,
  RecallScope,
  RecallSource,
  ReleaseReason,
  ReservationKind,
} from "@igs/module-inventory";
import type { BadgeVariant } from "@igs/ui";

/**
 * The English text staff see for inventory values and error codes (D-006: the kernel carries no
 * text; the back-office is English-only, so the mapping lives here).
 */
export const REASON_LABELS: Record<MovementReason, string> = {
  import: "Stock count (CSV, before lots)",
  reconciliation: "Stock count",
  adjustment: "Adjustment",
  correction: "Correction",
  sale: "Sale (picked for an order)",
  receipt: "Received into the web stock",
  return: "Returned to the pharmacy",
};

/** A lot as staff read it (igs-pharma#164): its number, or what it is when it has none. */
export function lotLabel(lot: { tracking: LotTracking; lotNumber: string | null }): string {
  if (lot.tracking === "lot") return lot.lotNumber ?? "";
  return lot.tracking === "no_lot" ? "No lot" : "Lot not recorded";
}

/** Where a lot stands: one label, the most pressing reason it can't be sold first. */
export function lotState(lot: {
  tracking: LotTracking;
  expiryState: ExpiryState;
  quarantine: { reason: QuarantineReason } | null;
}): { label: string; variant: BadgeVariant } {
  if (lot.quarantine) {
    return { label: `Quarantined: ${QUARANTINE_LABELS[lot.quarantine.reason]}`, variant: "error" };
  }
  if (lot.tracking === "unknown") return { label: "Record its lot", variant: "error" };
  if (lot.expiryState === "expired") return { label: "Expired", variant: "error" };
  if (lot.expiryState === "within_expiry_buffer") {
    return { label: "Too close to expiry", variant: "amber" };
  }
  return { label: "Sellable", variant: "success" };
}

/** Why a lot is quarantined. A type-only copy of `QUARANTINE_REASONS` for client components. */
export const QUARANTINE_REASON_OPTIONS = [
  "quality",
  "recall",
  "damaged",
  "other",
] as const satisfies readonly QuarantineReason[];

export const QUARANTINE_LABELS: Record<QuarantineReason, string> = {
  quality: "quality",
  recall: "recall",
  damaged: "damaged",
  other: "other",
};

const day = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

/** `2027-03-31` as "31 Mar 2027" (a calendar date: no time zone shift). */
export const formatDate = (value: string): string => day.format(new Date(`${value}T00:00:00Z`));

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
  "inventory.row_malformed":
    "Write the line as CNK;lot;expiry;counted (leave lot and expiry empty for stock without a lot).",
  "inventory.import_empty": "The file has no count lines.",
  "inventory.too_many_rows": "The file has more than 5,000 lines. Split it into smaller files.",
  "inventory.lot_number_invalid": "This is not a lot number as printed on a pack.",
  "inventory.expiry_invalid":
    "Write the expiry date as YYYY-MM-DD or DD/MM/YYYY, and only with a lot number.",
  "inventory.lot_required": "A medicine is always counted per lot: add its lot number.",
  "inventory.lot_unknown":
    "This lot is not in the web stock. Receive it on the product's stock page first.",
  "inventory.lot_ambiguous":
    "Several lots have this number with different expiry dates: add the expiry date.",
  "inventory.duplicate_lot": "This lot is already counted on an earlier line.",
};

export const rowErrorMessage = (code: string): string =>
  (Object.hasOwn(ROW_ERRORS, code) && ROW_ERRORS[code]) || "This line is not valid.";

const ERRORS: Record<string, string> = {
  "inventory.reconciliation_invalid": "The file has problems, so nothing was counted.",
  "inventory.count_empty": "Enter the count of at least one lot.",
  "inventory.quantity_invalid": "A count is a whole number from 0 to 1,000,000.",
  "inventory.reconciliation_not_found": "This count doesn't exist. Start a new one.",
  "inventory.reconciliation_stale":
    "Stock moved since this count was previewed, so nothing was changed. Discard it and count again.",
  "inventory.reconciliation_discarded": "This count was discarded. Start a new one.",
  "inventory.reconciliation_not_open": "This count has already been applied or discarded.",
  "inventory.file_missing": "Choose a CSV file to upload.",
  "inventory.file_too_large": "The file is larger than 250 KB. Split it into smaller files.",
  "inventory.product_not_found": "This product no longer exists.",
  "inventory.negative_stock": "Stock can't go below zero.",
  "inventory.reservation_not_found": "This reservation no longer exists. Reload the page.",
  "inventory.reservation_not_active":
    "This reservation has already ended (released, picked or expired). Reload the page.",
  "inventory.insufficient_stock": "There is not enough stock available to set aside.",
  "inventory.reservation_expired": "This checkout took too long: the stock was given back.",
  "inventory.reservation_mismatch":
    "The reservation does not match what was asked for (other lines or quantities). Reload the page.",
  "inventory.reservation_quantity_mismatch":
    "This holder already has a different quantity set aside. Release it first.",
  "inventory.import_stale":
    "Stock changed after you previewed this file, so nothing was imported. Upload the file again to see the new numbers.",
  "inventory.import_plan_expired":
    "This preview is more than an hour old, so nothing was imported. Upload the file again.",
  "inventory.import_plan_not_found": "This preview can't be found. Upload the file again.",
  "inventory.lot_required":
    "Fill in the lot number and the expiry date: a medicine's stock is always kept per lot.",
  "inventory.expiry_in_past": "This lot has expired already: expired stock can't be received.",
  "inventory.lot_not_found": "This lot no longer exists. Reload the page.",
  "inventory.lot_quarantined": "This lot is already in quarantine.",
  "inventory.lot_not_quarantined": "This lot is not in quarantine.",
  "inventory.lot_under_recall":
    "This lot belongs to an active recall. It stays in quarantine until a pharmacist ends the recall.",
  "inventory.recall_active": "This product already has an active recall.",
  "inventory.recall_not_found": "This recall doesn't exist. Reload the page.",
  "inventory.recall_ended": "This recall has already ended.",
  "inventory.recall_lots_missing": "Choose at least one lot, or recall every lot.",
  "inventory.stock_not_sellable":
    "The stock left for this order can't be sold (quarantined, too close to expiry, or its lot not recorded).",
  "inventory.allocation_short":
    "The sellable stock is already allocated to older orders, so this order can't be picked yet.",
  "kernel.idempotency_in_progress": "This file is being imported right now. Reload in a moment.",
  "kernel.forbidden": "You don't have permission to work with stock.",
  "kernel.mfa_required": "Confirm your 2-step login first.",
  "kernel.validation_failed": "Some fields are not filled in correctly.",
};

/** Who calls a recall. A type-only copy of `RECALL_SOURCES` for client components (igs-pharma#187). */
export const RECALL_SOURCE_OPTIONS = [
  "famhp",
  "manufacturer",
  "wholesaler",
  "pharmacy",
] as const satisfies readonly RecallSource[];

/** `RECALL_NOTE_MAX`, for client components. */
export const RECALL_NOTE_LIMIT = 500;

/** Who called a recall (igs-pharma#187). */
export const RECALL_SOURCE_LABELS: Record<RecallSource, string> = {
  famhp: "FAMHP (federal agency)",
  manufacturer: "Manufacturer or marketing authorisation holder",
  wholesaler: "Wholesaler",
  pharmacy: "This pharmacy",
};

export const RECALL_SCOPE_LABELS: Record<RecallScope, string> = {
  all_lots: "Every lot",
  lots: "Chosen lots",
};

export const stockErrorMessage = (code: string | undefined): string =>
  (code && Object.hasOwn(ERRORS, code) && ERRORS[code]) || "That didn't work. Try again.";

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Brussels",
});

export const formatMoment = (value: Date): string => dateTime.format(value);
