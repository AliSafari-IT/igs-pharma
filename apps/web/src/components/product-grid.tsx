import type { ContentLocale, StorefrontProductItem } from "@igs/module-catalog";
import type { PriceAndStock } from "../server/storefront";
import { ProductCard } from "./product-card";

interface Props {
  readonly locale: ContentLocale;
  readonly items: readonly StorefrontProductItem[];
  readonly stock: PriceAndStock;
}

/** The product cards in a grid: one column from 360 px, two from 640, three from 1024. */
export function ProductGrid({ locale, items, stock }: Props) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <ProductCard
          key={item.id}
          locale={locale}
          item={item}
          price={stock.prices.get(item.id)}
          inStock={stock.inStock.get(item.id) ?? false}
        />
      ))}
    </ul>
  );
}
