import { type Tx, notFound } from "@igs/kernel";
import { and, eq, inArray, ne } from "drizzle-orm";

import { products } from "./schema";

/**
 * D-034: what the storefront may list, show and price. Phase 1 sells OTC only, and prescription
 * medicines must never be advertised or sold at a distance. A product is storefront-visible only
 * when it is active AND not prescription-only (`legal_status <> 'rx'` and
 * `product_type <> 'rx_medicine'`). `pharmacy_only` stays visible. This is the ONE predicate every
 * storefront-actor read applies; a hidden product behaves exactly like one that does not exist.
 */
export const storefrontVisible = () =>
  and(
    eq(products.status, "active"),
    ne(products.legalStatus, "rx"),
    ne(products.productType, "rx_medicine"),
  );

/** The ids among `ids` that are storefront-visible. */
export async function storefrontVisibleIds(
  tx: Tx,
  ids: readonly string[],
): Promise<readonly string[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(inArray(products.id, [...ids]), storefrontVisible()));
  return rows.map((row) => row.id);
}

/**
 * Defence in depth for the future cart and checkout: call this before a product enters a basket or
 * an order. Throws `catalog.product_not_sellable` (not found) for a product that is not
 * storefront-visible or does not exist, so the two cannot be told apart.
 */
export async function assertSellable(tx: Tx, productId: string): Promise<void> {
  const [visible] = await storefrontVisibleIds(tx, [productId]);
  if (!visible) throw notFound("catalog.product_not_sellable");
}
