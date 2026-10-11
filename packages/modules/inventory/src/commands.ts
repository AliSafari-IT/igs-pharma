import { sha256Hex } from "@igs/crypto";
import { newId } from "@igs/db/ids";
import { type Ctx, command, conflict, notFound, validationFailed } from "@igs/kernel";
import { productRefsById } from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { z } from "zod";

import { INVENTORY_AUDIT } from "./audit";
import {
  ADJUST_REASONS,
  DEFAULT_LOCATION_ID,
  MAX_IMPORT_CHARS,
  type MovementReason,
} from "./domain";
import { levelOf, lockStock, planImport, stockLevels } from "./ledger";
import { stockMovements } from "./schema";

/**
 * Inventory commands (igs-pharma#53). Every one runs through the kernel: authorize → validate → one
 * transaction (handler + audit), behind `inventory.stock.manage`. They only ever INSERT ledger
 * movements; on-hand is derived (see `ledger.ts`).
 */

const movement = (
  ctx: Ctx,
  values: { productId: string; delta: number; reason: MovementReason },
) => ({
  id: newId(),
  productId: values.productId,
  locationId: DEFAULT_LOCATION_ID,
  delta: values.delta,
  reason: values.reason,
  actorType: ctx.actor.type,
  actorId: ctx.actor.id,
  at: ctx.now,
});

/**
 * The idempotency key of a stock file: its hash, so uploading the same file again replays the first
 * import's result instead of writing anything. Callers pass it as `{ idempotencyKey }`.
 */
export const stockImportKey = (csv: string): string => `file:${sha256Hex(csv)}`;

/**
 * Sets the on-hand of every product in the file to its count, writing one `import` movement per
 * product whose count changed. All or nothing: the whole file is validated first and any problem
 * (unknown CNK, malformed line…) fails with `inventory.import_invalid`, listing every bad line as
 * `line.<n>` (`file` for the file as a whole), and writes nothing.
 */
export const importStock = command({
  name: "inventory.stock.import",
  input: z.object({ csv: z.string().max(MAX_IMPORT_CHARS) }),
  output: z.object({
    importId: z.uuid(),
    rows: z.number().int(),
    changed: z.number().int(),
  }),
  permission: PERMISSIONS.inventory.stockManage,
  async handler({ input, ctx }) {
    await lockStock(ctx.tx);
    const plan = await planImport(ctx.tx, input.csv);
    if (plan.errors.length > 0) {
      throw validationFailed(
        "inventory.import_invalid",
        plan.errors.map((e) => ({ path: e.line === 0 ? "file" : `line.${e.line}`, code: e.code })),
      );
    }
    const importId = newId();
    const changes = plan.rows.filter((row) => row.delta !== 0);
    if (changes.length > 0) {
      await ctx.tx.insert(stockMovements).values(
        changes.map((row) => ({
          ...movement(ctx, { productId: row.productId, delta: row.delta, reason: "import" }),
          importId,
        })),
      );
    }
    await ctx.audit.record({
      action: INVENTORY_AUDIT.stockImported,
      entityType: "stock_import",
      entityId: importId,
      data: { importId, rows: plan.rows.length, changed: changes.length },
    });
    return { importId, rows: plan.rows.length, changed: changes.length };
  },
});

/**
 * Moves one product's stock by `delta` with a reason and a note. Refuses to take stock below zero
 * (`inventory.negative_stock`, with the current on-hand).
 */
export const adjustStock = command({
  name: "inventory.stock.adjust",
  input: z.object({
    productId: z.uuid(),
    delta: z
      .number()
      .int()
      .min(-100_000)
      .max(100_000)
      .refine((value) => value !== 0, { message: "zero" }),
    reason: z.enum(ADJUST_REASONS),
    note: z.string().trim().min(1).max(200),
  }),
  output: z.object({ movementId: z.uuid(), onHand: z.number().int() }),
  permission: PERMISSIONS.inventory.stockManage,
  async handler({ input, ctx }) {
    const [product] = await productRefsById(ctx.tx, [input.productId]);
    if (!product) throw notFound("inventory.product_not_found");
    await lockStock(ctx.tx);
    const { onHand } = levelOf(await stockLevels(ctx.tx, [product.id]), product.id);
    if (onHand + input.delta < 0) throw conflict("inventory.negative_stock", { onHand });
    const row = movement(ctx, { productId: product.id, delta: input.delta, reason: input.reason });
    await ctx.tx.insert(stockMovements).values({ ...row, note: input.note });
    await ctx.audit.record({
      action: INVENTORY_AUDIT.stockAdjusted,
      entityType: "product",
      entityId: product.id,
      data: {
        movementId: row.id,
        productId: product.id,
        delta: input.delta,
        reason: input.reason,
      },
    });
    return { movementId: row.id, onHand: onHand + input.delta };
  },
});
