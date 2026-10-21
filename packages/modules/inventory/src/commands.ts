import { command, conflict, notFound, validationFailed } from "@igs/kernel";
import { productRefsById } from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { reconcileAllocations } from "./allocations";
import { INVENTORY_AUDIT } from "./audit";
import { ADJUST_REASONS } from "./domain";
import { levelOf, lockStock, recordMovements, stockLevels } from "./ledger";
import { noLotOf } from "./lots";
import { lotLevels, lots } from "./schema";

/**
 * Inventory commands (igs-pharma#53). The absolute CSV import is retired: counts go through a
 * reconciliation (igs-pharma#166, reconciliations.ts). Every one runs through the kernel: authorize → validate → one
 * transaction (handler + audit), behind `inventory.stock.manage`. Stock is written only through
 * `recordMovements`; on-hand is derived (see `ledger.ts`).
 */

/**
 * Moves one lot's stock by `delta` with a reason and a note. Without `lotId`, a non-medicine's
 * `no_lot` lot; a medicine always names its lot (`inventory.lot_required`). Refuses to take the lot
 * below zero (`inventory.negative_stock`, with the lot's current on-hand).
 */
export const adjustStock = command({
  name: "inventory.stock.adjust",
  input: z.object({
    productId: z.uuid(),
    lotId: z.uuid().optional(),
    delta: z
      .number()
      .int()
      .min(-100_000)
      .max(100_000)
      .refine((value) => value !== 0, { message: "zero" }),
    reason: z.enum(ADJUST_REASONS),
    note: z.string().trim().min(1).max(200),
  }),
  output: z.object({
    movementId: z.uuid(),
    lotId: z.uuid(),
    onHand: z.number().int(),
    lotOnHand: z.number().int(),
  }),
  permission: PERMISSIONS.inventory.stockManage,
  async handler({ input, ctx }) {
    const [product] = await productRefsById(ctx.tx, [input.productId]);
    if (!product) throw notFound("inventory.product_not_found");
    await lockStock(ctx.tx);
    let lotId: string;
    if (input.lotId) {
      const [lot] = await ctx.tx
        .select({ id: lots.id })
        .from(lots)
        .where(and(eq(lots.id, input.lotId), eq(lots.productId, product.id)));
      if (!lot) throw notFound("inventory.lot_not_found");
      lotId = lot.id;
    } else if (product.isMedicine) {
      throw validationFailed("inventory.lot_required", [{ path: "lotId", code: "required" }]);
    } else {
      lotId = await noLotOf(ctx, product.id);
    }
    const [level] = await ctx.tx
      .select({ onHand: lotLevels.onHand })
      .from(lotLevels)
      .where(eq(lotLevels.lotId, lotId));
    const lotOnHand = level?.onHand ?? 0;
    if (lotOnHand + input.delta < 0) {
      throw conflict("inventory.negative_stock", { onHand: lotOnHand });
    }
    const { onHand } = levelOf(await stockLevels(ctx.tx, [product.id]), product.id);
    const [movement] = await recordMovements(ctx.tx, ctx, [
      { productId: product.id, lotId, delta: input.delta, reason: input.reason, note: input.note },
    ]);
    const movementId = movement?.id ?? "";
    await ctx.audit.record({
      action: INVENTORY_AUDIT.stockAdjusted,
      entityType: "product",
      entityId: product.id,
      data: {
        movementId,
        productId: product.id,
        lotId,
        delta: input.delta,
        reason: input.reason,
      },
    });
    await reconcileAllocations(ctx, [product.id]);
    return {
      movementId,
      lotId,
      onHand: onHand + input.delta,
      lotOnHand: lotOnHand + input.delta,
    };
  },
});
