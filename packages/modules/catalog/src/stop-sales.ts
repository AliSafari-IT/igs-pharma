import { type Tx, command, conflict, notFound } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { CATALOG_AUDIT } from "./audit";
import { STOP_SALE_REASONS, type StopSaleReason } from "./domain";
import { products, stopSales } from "./schema";
import { inUuidSet } from "./visibility";

/**
 * Stop-sales (igs-pharma#187, REQ-SAF-01). A pharmacist's recall starts one and ending the recall
 * ends it: inventory runs these commands in the recall's transaction (`ctx.run`). While one is
 * active the product is not storefront-visible (`notStopped` in `storefrontVisible`), so the shop,
 * checkout and every fulfilment step treat it as unsellable through the one predicate.
 */

const reason = z.enum(STOP_SALE_REASONS);

/** Stops a product selling for `reason`, on behalf of `referenceId` (the recall's id). */
export const startStopSale = command({
  name: "catalog.product.stop_sale",
  input: z.object({ productId: z.uuid(), reason, referenceId: z.uuid() }),
  output: z.object({ stopSaleId: z.uuid() }),
  permission: PERMISSIONS.catalog.stopSalesManage,
  async handler({ input, ctx }) {
    const [product] = await ctx.tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, input.productId));
    if (!product) throw notFound("catalog.product_not_found");
    const [row] = await ctx.tx
      .insert(stopSales)
      .values({
        productId: product.id,
        reason: input.reason,
        referenceId: input.referenceId,
        startedByType: ctx.actor.type,
        startedById: ctx.actor.id,
        startedAt: ctx.now,
      })
      .onConflictDoNothing({ target: [stopSales.reason, stopSales.referenceId] })
      .returning({ id: stopSales.id });
    if (!row) throw conflict("catalog.stop_sale_exists");
    await ctx.audit.record({
      action: CATALOG_AUDIT.productSaleStopped,
      entityType: "product",
      entityId: product.id,
      data: {
        productId: product.id,
        stopSaleId: row.id,
        reason: input.reason,
        referenceId: input.referenceId,
      },
    });
    return { stopSaleId: row.id };
  },
});

/** Ends the active stop-sale started for `referenceId`; refused when there is none. */
export const endStopSale = command({
  name: "catalog.product.end_stop_sale",
  input: z.object({ reason, referenceId: z.uuid() }),
  output: z.object({ stopSaleId: z.uuid(), productId: z.uuid() }),
  permission: PERMISSIONS.catalog.stopSalesManage,
  async handler({ input, ctx }) {
    const [row] = await ctx.tx
      .update(stopSales)
      .set({ endedAt: ctx.now, endedByType: ctx.actor.type, endedById: ctx.actor.id })
      .where(
        and(
          eq(stopSales.reason, input.reason),
          eq(stopSales.referenceId, input.referenceId),
          isNull(stopSales.endedAt),
        ),
      )
      .returning({ id: stopSales.id, productId: stopSales.productId });
    if (!row) throw notFound("catalog.stop_sale_not_found");
    await ctx.audit.record({
      action: CATALOG_AUDIT.productSaleResumed,
      entityType: "product",
      entityId: row.productId,
      data: {
        productId: row.productId,
        stopSaleId: row.id,
        reason: input.reason,
        referenceId: input.referenceId,
      },
    });
    return { stopSaleId: row.id, productId: row.productId };
  },
});

/** The reasons each of `ids` is stopped for (back-office), as a map; products without one are absent. */
export async function activeStopSales(
  tx: Tx,
  ids: readonly string[],
): Promise<ReadonlyMap<string, readonly StopSaleReason[]>> {
  const out = new Map<string, StopSaleReason[]>();
  if (ids.length === 0) return out;
  const rows = await tx
    .select({ productId: stopSales.productId, reason: stopSales.reason })
    .from(stopSales)
    .where(and(inUuidSet(stopSales.productId, ids), isNull(stopSales.endedAt)));
  for (const row of rows) {
    out.set(row.productId, [...(out.get(row.productId) ?? []), row.reason as StopSaleReason]);
  }
  return out;
}
