import type { AdjustReason, MovementReason } from "@igs/module-inventory";

/**
 * The English text staff see for inventory values and error codes (D-006: the kernel carries no
 * text; the back-office is English-only, so the mapping lives here).
 */
export const REASON_LABELS: Record<MovementReason, string> = {
  import: "Stock count (CSV)",
  adjustment: "Adjustment",
  correction: "Correction",
};

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
