import type {
  ContentLocale,
  LegalStatus,
  ProductStatus,
  ProductType,
  VatClass,
} from "@igs/module-catalog";

/**
 * The English text staff see for catalog values and error codes (D-006: the kernel carries no
 * text; the back-office is English-only, so the mapping lives here).
 */
export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  otc_medicine: "OTC medicine",
  rx_medicine: "Prescription medicine",
  medical_device: "Medical device",
  food_supplement: "Food supplement",
  cosmetic: "Cosmetic",
  biocide: "Biocide",
  general: "General",
};

export const LEGAL_STATUS_LABELS: Record<LegalStatus, string> = {
  otc: "OTC (no prescription)",
  rx: "Prescription only",
  pharmacy_only: "Pharmacy only",
  general_sale: "General sale",
};

export const VAT_CLASS_LABELS: Record<VatClass, string> = { BE_6: "6 %", BE_21: "21 %" };

export const STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

/**
 * The label of a status read from the URL (`?status=`), or `undefined` for anything else. Own
 * keys only: `in` would also accept `toString` and the other `Object.prototype` names.
 */
export const statusLabelFor = (value: string | undefined): string | undefined =>
  value !== undefined && Object.hasOwn(STATUS_LABELS, value)
    ? STATUS_LABELS[value as ProductStatus]
    : undefined;

export const STATUS_BADGE: Record<ProductStatus, "neutral" | "success" | "amber"> = {
  draft: "neutral",
  active: "success",
  archived: "amber",
};

export const LOCALE_LABELS: Record<ContentLocale, string> = {
  nl: "Dutch",
  fr: "French",
  de: "German",
  en: "English",
};

const ERRORS: Record<string, string> = {
  "catalog.cnk_invalid": "A CNK is exactly 7 digits.",
  "catalog.cnk_taken": "Another product already has this CNK.",
  "catalog.product_not_found": "This product no longer exists.",
  "catalog.brand_not_found": "That brand no longer exists. Pick another one.",
  "catalog.content_missing": "An active product needs a Dutch and a French name.",
  "catalog.status_unchanged": "The product already has that status.",
  "catalog.category_not_found": "That category no longer exists. Reload the page.",
  "catalog.category_slug_taken": "Another category already uses this web address.",
  "catalog.category_cycle": "A category can't go under itself or one of its own sub-categories.",
  "catalog.category_too_deep": "Categories can be at most 4 levels deep.",
  "catalog.category_unchanged": "The category is already there.",
  "catalog.category_has_children":
    "This category still has sub-categories. Move or delete them first.",
  "catalog.category_in_use": "Products are still in this category. Take them out first.",
  "kernel.forbidden": "You don't have permission to change the catalogue.",
  "kernel.mfa_required": "Confirm your 2-step login first.",
  "kernel.validation_failed": "Some fields are not filled in correctly.",
};

export const catalogErrorMessage = (code: string | undefined) =>
  (code && Object.hasOwn(ERRORS, code) && ERRORS[code]) || "That didn't work. Try again.";
