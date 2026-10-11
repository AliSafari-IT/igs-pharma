/**
 * Catalog domain rules (igs-pharma#50). Plain functions and constants without imports, so the
 * schema, the commands and the unit tests share one definition.
 */

/** domain-model §2. */
export const PRODUCT_TYPES = [
  "otc_medicine",
  "rx_medicine",
  "medical_device",
  "food_supplement",
  "cosmetic",
  "biocide",
  "general",
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const LEGAL_STATUSES = ["otc", "rx", "pharmacy_only", "general_sale"] as const;
export type LegalStatus = (typeof LEGAL_STATUSES)[number];

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Belgian VAT rates that apply to the catalogue: 6 % (medicines, most care products) and 21 %. */
export const VAT_CLASSES = ["BE_6", "BE_21"] as const;
export type VatClass = (typeof VAT_CLASSES)[number];

export const CONTENT_LOCALES = ["nl", "fr", "de", "en"] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

/** v1 writes `manual` only; `medipim` and `sam` arrive with the imports. */
export const CONTENT_SOURCES = ["manual", "medipim", "sam"] as const;

/**
 * Locales a product needs before it may become `active` (MVP-lite: Dutch and French, the two
 * languages a Belgian pharmacy must serve).
 */
export const REQUIRED_LOCALES: readonly ContentLocale[] = ["nl", "fr"];

/** A CNK is exactly 7 ASCII digits (no spaces, no check-digit arithmetic in v1). */
export const isValidCnk = (value: string): boolean => /^[0-9]{7}$/.test(value);

/** The required locales that `locales` lacks, in `REQUIRED_LOCALES` order (empty when complete). */
export function missingForActivation(locales: Iterable<string>): ContentLocale[] {
  const present = new Set(locales);
  return REQUIRED_LOCALES.filter((locale) => !present.has(locale));
}
