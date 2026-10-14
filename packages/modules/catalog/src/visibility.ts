import { type Tx, notFound } from "@igs/kernel";
import { type SQL, and, eq, ne, sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

import { productContent, products } from "./schema";

/**
 * A medicine, in SQL: product type `otc_medicine`, or legal status `otc` (the SQL twin of
 * `isMedicine` in the domain; prescription medicines never reach the storefront anyway).
 */
export const isMedicineSql = (): SQL =>
  sql`(${products.productType} IN ('otc_medicine', 'rx_medicine') OR ${products.legalStatus} IN ('otc', 'rx'))`;

/** The product has a text in `locale` that a pharmacist approved (`approved_by` set). */
const approvedText = (locale: "nl" | "fr"): SQL =>
  sql`EXISTS (SELECT 1 FROM ${productContent} WHERE ${productContent.productId} = ${products.id} AND ${productContent.locale} = ${locale} AND ${productContent.approvedBy} IS NOT NULL)`;

/**
 * The approved-content gate (D-034, igs-pharma#103): a MEDICINE is visible only when the texts in
 * both required locales (`nl`, `fr`) were approved by a pharmacist, so the rule does not depend on the
 * shopper's language. Non-medicines are unaffected.
 */
export const approvedForStorefront = (): SQL =>
  sql`(NOT ${isMedicineSql()} OR (${approvedText("nl")} AND ${approvedText("fr")}))`;

/**
 * D-034: what the storefront may list, show and price. Phase 1 sells OTC only, and prescription
 * medicines must never be advertised or sold at a distance. A product is storefront-visible only
 * when it is active, not prescription-only (`legal_status <> 'rx'` and `product_type <>
 * 'rx_medicine'`; `pharmacy_only` stays visible) AND, for a medicine, its text is approved
 * (`approvedForStorefront`). This is the ONE predicate every storefront-actor read applies; a hidden
 * product behaves exactly like one that does not exist.
 */
export const storefrontVisible = () =>
  and(
    eq(products.status, "active"),
    ne(products.legalStatus, "rx"),
    ne(products.productType, "rx_medicine"),
    approvedForStorefront(),
  );

/**
 * `column IN (the uuids)` with ONE bound parameter (a JSON array) instead of one per id: a candidate
 * set of thousands of products stays a single, cheap statement.
 */
export const inUuidSet = (column: SQL | AnyColumn, ids: readonly string[]): SQL =>
  sql`${column} IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;

/** The ids among `ids` that are storefront-visible. */
export async function storefrontVisibleIds(
  tx: Tx,
  ids: readonly string[],
): Promise<readonly string[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(inUuidSet(products.id, ids), storefrontVisible()));
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
