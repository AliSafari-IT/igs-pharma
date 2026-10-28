import { type Ctx, type Tx, conflict } from "@igs/kernel";
import { storefrontVisibleIds } from "@igs/module-catalog";
import { asc, eq } from "drizzle-orm";

import { orderLines } from "./schema";

/**
 * The eligibility recheck (milestone 5.1; review 2026-10-13, REQ-ORD-01). An order line is a snapshot
 * taken when the order was placed; a product can stop being sellable after that (made inactive,
 * turned prescription-only, its medicine text no longer approved). Every step that moves goods or money
 * forward asks the catalogue again, with the same predicate the storefront uses (`storefrontVisible`,
 * D-034). A product the catalogue cannot confirm counts as not sellable: the check fails closed.
 */

/** The ids among `productIds` that are not sellable now, in the order given, without duplicates. */
export async function notSellableIds(
  tx: Tx,
  productIds: readonly string[],
): Promise<readonly string[]> {
  const unique = [...new Set(productIds)];
  const visible = new Set(await storefrontVisibleIds(tx, unique));
  return unique.filter((id) => !visible.has(id));
}

/** The products of an order that are not sellable now. */
export async function notSellableLinesOf(tx: Tx, orderId: string): Promise<readonly string[]> {
  const lines = await tx
    .select({ productId: orderLines.productId })
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId))
    .orderBy(asc(orderLines.productId));
  return notSellableIds(
    tx,
    lines.map((line) => line.productId),
  );
}

/**
 * Throws `orders.line_not_sellable` (`products`: the ids, comma-separated) when a product of the order
 * is not sellable now. Staff then cancel the order with `cancelNotSellableOrder`, which refunds it.
 */
export async function assertOrderSellable(ctx: Ctx, orderId: string): Promise<void> {
  const products = await notSellableLinesOf(ctx.tx, orderId);
  if (products.length > 0) {
    throw conflict("orders.line_not_sellable", { products: products.join(",") });
  }
}

/**
 * Where a paid order goes once its stock is confirmed: a medicine to the pharmacist's review, anything
 * else to "to prepare". An order with a product that is not sellable any more goes to the pharmacist
 * too, whatever it holds: it is never prepared, and the pharmacist's refusal refunds it.
 */
export async function paidOrderStatus(
  ctx: Ctx,
  order: { readonly id: string; readonly needsReview: boolean },
): Promise<"in_review" | "ready_to_prepare"> {
  if (order.needsReview) return "in_review";
  const products = await notSellableLinesOf(ctx.tx, order.id);
  return products.length > 0 ? "in_review" : "ready_to_prepare";
}
