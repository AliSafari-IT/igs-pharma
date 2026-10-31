import type { VisibilityReason } from "@igs/module-storefront";

/**
 * The English text staff see for "why is this product not on the webshop" (igs-pharma#103; D-006:
 * the module carries codes only, the back-office is English-only, so the mapping lives here).
 */
const LOCALE_NAMES: Record<"nl" | "fr", string> = { nl: "Dutch", fr: "French" };

export function visibilityReasonLabel(reason: VisibilityReason): string {
  switch (reason.code) {
    case "draft":
      return "The product is a draft. Make it active.";
    case "archived":
      return "The product is archived. Restore it and make it active.";
    case "prescription_only":
      return "Prescription-only products are never shown in the webshop.";
    case "no_price":
      return "The product has no current price. Set a price.";
    case "text_not_approved":
      return `A pharmacist has not approved the ${reason.locales
        .map((locale) => LOCALE_NAMES[locale])
        .join(" and ")} text of this medicine yet.`;
    case "stop_sale":
      return "A recall stops this product selling. It returns when a pharmacist ends the recall.";
  }
}
