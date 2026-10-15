/**
 * Which icon a storefront category tile shows (igs-pharma#112, V2 item 2). The eight top-level
 * demo categories have their own icon; every other slug (real categories come from the catalogue)
 * gets the generic one, so a tile never renders without an icon.
 */
export const CATEGORY_ICONS = [
  "pain-fever",
  "cold-flu",
  "allergy",
  "vitamins",
  "skin-care",
  "first-aid",
  "hygiene",
  "baby",
  "generic",
] as const;

export type CategoryIconName = (typeof CATEGORY_ICONS)[number];

const BY_SLUG: ReadonlyMap<string, CategoryIconName> = new Map<string, CategoryIconName>([
  ["pain-fever", "pain-fever"],
  ["cold-flu", "cold-flu"],
  ["allergy", "allergy"],
  ["vitamins", "vitamins"],
  ["skin-care", "skin-care"],
  ["first-aid", "first-aid"],
  ["hygiene", "hygiene"],
  ["baby", "baby"],
]);

/** The icon for a category slug; `generic` for any slug without one of its own. */
export const categoryIconFor = (slug: string): CategoryIconName => BY_SLUG.get(slug) ?? "generic";
