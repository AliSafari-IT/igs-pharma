import { getTranslations } from "next-intl/server";

import { StorefrontSkeleton } from "../../components/storefront-skeleton";

/**
 * The loading state of the storefront's list pages (home, category, search; igs-pharma#104). The
 * product page has its own, shaped like a product.
 */
export default async function Loading() {
  const t = await getTranslations("common");
  return <StorefrontSkeleton label={t("loading")} variant="listing" />;
}
