import type { ContentLocale } from "@igs/module-catalog";
import type { StorefrontListItem } from "@igs/module-storefront";
import { ProductCard } from "./product-card";

interface Props {
  readonly locale: ContentLocale;
  readonly items: readonly StorefrontListItem[];
}

/** The product cards in a grid: one column from 360 px, two from 640, three from 1024. */
export function ProductGrid({ locale, items }: Props) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <ProductCard key={item.id} locale={locale} item={item} />
      ))}
    </ul>
  );
}
