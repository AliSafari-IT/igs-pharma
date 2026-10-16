import { getTranslations } from "next-intl/server";

import { StorefrontSkeleton } from "../../../../components/storefront-skeleton";

/** The loading state of a product page (igs-pharma#104): image box, title, price, button. */
export default async function Loading() {
  const t = await getTranslations("common");
  return <StorefrontSkeleton label={t("loading")} variant="product" />;
}
