import type { CategoryRef } from "@igs/module-storefront";
import { ProductImagePlaceholder } from "@igs/ui";

import { categoryIconFor } from "../lib/category-icon";
import { CategoryIcon } from "./category-icon";

/**
 * The picture slot of a product until real images exist (igs-pharma#112, design system §10.4): the
 * illustration of its top-level category, in the same fixed 4:3 box as the placeholder, so nothing
 * moves when real images arrive. Decorative (`aria-hidden`): the product's name carries the meaning.
 * A product in no category keeps the neutral placeholder.
 */
export function ProductIllustration({ category }: { readonly category: CategoryRef | null }) {
  if (!category) return <ProductImagePlaceholder data-testid="product-illustration" />;
  return (
    <div
      aria-hidden="true"
      data-testid="product-illustration"
      data-icon={categoryIconFor(category.slug)}
      className="flex aspect-[4/3] w-full items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-subtle)]"
    >
      <CategoryIcon slug={category.slug} className="h-1/2 w-auto" />
    </div>
  );
}
