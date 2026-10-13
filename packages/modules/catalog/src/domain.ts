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

/**
 * Regulated fields (D-034, igs-pharma#79): only a pharmacist sets them. Names are the product
 * fields, also used in audit records (field names, never values).
 */
export const REGULATED_FIELDS = [
  "productType",
  "legalStatus",
  "vatClass",
  "requiresPharmacistReview",
  "ageMin",
] as const;
export type RegulatedField = (typeof REGULATED_FIELDS)[number];

/** The regulated values of a product. */
export interface RegulatedValues {
  readonly productType: string;
  readonly legalStatus: string;
  readonly vatClass: string;
  readonly requiresPharmacistReview: boolean;
  readonly ageMin: number | null;
}

/** The regulated fields whose value differs between `a` and `b`, in `REGULATED_FIELDS` order. */
export const changedRegulatedFields = (a: RegulatedValues, b: RegulatedValues): RegulatedField[] =>
  REGULATED_FIELDS.filter((field) => a[field] !== b[field]);

/** A medicine: by product type or by legal status (`otc` and `rx` are medicines' statuses). */
export const isMedicine = (productType: string, legalStatus: string): boolean =>
  productType === "otc_medicine" ||
  productType === "rx_medicine" ||
  legalStatus === "otc" ||
  legalStatus === "rx";

/**
 * Whether `legalStatus` fits `productType`: `otc_medicine` is `otc`, `rx_medicine` is `rx`, every
 * other type is `pharmacy_only` or `general_sale`.
 */
export function legalStatusFits(productType: string, legalStatus: string): boolean {
  if (productType === "otc_medicine") return legalStatus === "otc";
  if (productType === "rx_medicine") return legalStatus === "rx";
  return legalStatus === "pharmacy_only" || legalStatus === "general_sale";
}

/** The VAT class a content editor's new product gets; a pharmacist adjusts it (D-034). */
export const DEFAULT_EDITOR_VAT_CLASS = "BE_21";

/**
 * What a content editor may create: a non-medicine in general sale, no pharmacist review, no age
 * limit, and the default VAT class. Anything else needs a pharmacist (`createProductRegulated`).
 */
export const isGeneralEnvelope = (values: RegulatedValues): boolean =>
  !isMedicine(values.productType, values.legalStatus) &&
  values.legalStatus === "general_sale" &&
  values.vatClass === DEFAULT_EDITOR_VAT_CLASS &&
  !values.requiresPharmacistReview &&
  values.ageMin === null;

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
export const CNK_PATTERN = /^[0-9]{7}$/;
export const isValidCnk = (value: string): boolean => CNK_PATTERN.test(value);

/** The required locales that `locales` lacks, in `REQUIRED_LOCALES` order (empty when complete). */
export function missingForActivation(locales: Iterable<string>): ContentLocale[] {
  const present = new Set(locales);
  return REQUIRED_LOCALES.filter((locale) => !present.has(locale));
}

/** A category or brand slug: lowercase letters and digits, single dashes between them. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Categories a product may belong to (igs-pharma#54). Generous for a pharmacy webshop, small
 * enough that one `set_categories` call stays cheap and its audit record short.
 */
export const MAX_CATEGORIES_PER_PRODUCT = 20;

/** How deep the category tree may go: a root is depth 1. Deeper menus don't help a shopper. */
export const MAX_CATEGORY_DEPTH = 4;

/** A category as the tree rules need it. */
export interface CategoryLink {
  readonly id: string;
  readonly parentId: string | null;
}

/**
 * Whether moving `categoryId` under `newParentId` would make a cycle: the new parent is the category
 * itself or one of its descendants. `links` is the whole tree.
 */
export function wouldCycle(
  links: readonly CategoryLink[],
  categoryId: string,
  newParentId: string | null,
): boolean {
  const parentOf = new Map(links.map((l) => [l.id, l.parentId]));
  const seen = new Set<string>();
  for (let at = newParentId; at !== null; at = parentOf.get(at) ?? null) {
    if (at === categoryId) return true;
    if (seen.has(at)) return true; // already broken; never loop
    seen.add(at);
  }
  return false;
}

/** The depth of `categoryId` in the tree (a root is 1); `0` when it is not in `links`. */
export function depthOf(links: readonly CategoryLink[], categoryId: string | null): number {
  const parentOf = new Map(links.map((l) => [l.id, l.parentId]));
  let depth = 0;
  const seen = new Set<string>();
  for (let at = categoryId; at !== null && parentOf.has(at) && !seen.has(at); ) {
    seen.add(at);
    depth++;
    at = parentOf.get(at) ?? null;
  }
  return depth;
}

/** How many levels the subtree under `categoryId` spans, the category itself included (≥ 1). */
export function subtreeHeight(links: readonly CategoryLink[], categoryId: string): number {
  const children = new Map<string, string[]>();
  for (const l of links) {
    if (l.parentId === null) continue;
    const list = children.get(l.parentId) ?? [];
    list.push(l.id);
    children.set(l.parentId, list);
  }
  const height = (id: string, guard: Set<string>): number => {
    if (guard.has(id)) return 0;
    guard.add(id);
    let max = 0;
    for (const child of children.get(id) ?? []) max = Math.max(max, height(child, guard));
    return max + 1;
  };
  return height(categoryId, new Set());
}
