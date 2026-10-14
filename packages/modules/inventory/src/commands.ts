import { newId } from "@igs/db/ids";
import { command, conflict, notFound, validationFailed } from "@igs/kernel";
import { productRefsById } from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { INVENTORY_AUDIT } from "./audit";
import { ADJUST_REASONS, IMPORT_PLAN_TTL_MS, MAX_IMPORT_CHARS } from "./domain";
import { levelOf, lockStock, planImport, recordMovements, stockLevels } from "./ledger";
import { importPlans } from "./schema";

/**
 * Inventory commands (igs-pharma#53). Every one runs through the kernel: authorize → validate → one
 * transaction (handler + audit), behind `inventory.stock.manage`. Stock is written only through
 * `recordMovements`; on-hand is derived (see `ledger.ts`).
 */

const planRowOutput = z.object({
  line: z.number().int(),
  cnk: z.string(),
  productId: z.uuid(),
  nameNl: z.string().nullable(),
  onHand: z.number().int(),
  target: z.number().int(),
  delta: z.number().int(),
});

/**
 * Step 1 of a stock-file import (igs-pharma#83, D4/D5): validates the file against the catalog and
 * the ledger and stores what it showed as a plan (product, on-hand at preview, count in the file).
 * Returns the plan id, a fresh nonce for every preview, which is the submission the confirm step
 * applies. A file with any problem fails with `inventory.import_invalid` (every bad line as
 * `line.<n>`, `file` for the file as a whole) and stores nothing. Writes no stock.
 */
export const prepareStockImport = command({
  name: "inventory.stock.import_prepare",
  input: z.object({ csv: z.string().max(MAX_IMPORT_CHARS) }),
  output: z.object({ planId: z.uuid(), rows: z.array(planRowOutput) }),
  permission: PERMISSIONS.inventory.stockManage,
  async handler({ input, ctx }) {
    const plan = await planImport(ctx.tx, input.csv);
    if (plan.errors.length > 0) {
      throw validationFailed(
        "inventory.import_invalid",
        plan.errors.map((e) => ({ path: e.line === 0 ? "file" : `line.${e.line}`, code: e.code })),
      );
    }
    const planId = newId();
    await ctx.tx.insert(importPlans).values({
      id: planId,
      actorId: ctx.actor.id,
      rows: plan.rows.map((row) => ({
        productId: row.productId,
        cnk: row.cnk,
        expectedOnHand: row.onHand,
        target: row.target,
      })),
      createdAt: ctx.now,
      expiresAt: new Date(ctx.now.getTime() + IMPORT_PLAN_TTL_MS),
    });
    await ctx.audit.record({
      action: INVENTORY_AUDIT.stockImportPrepared,
      entityType: "stock_import",
      entityId: planId,
      data: { planId, rows: plan.rows.length },
    });
    return { planId, rows: plan.rows.map((r) => ({ ...r })) };
  },
});

/**
 * The idempotency key of a confirm: the plan, so a double click replays the first result, while the
 * same file previewed again is a new plan (a new submission) and applies again.
 */
export const stockImportKey = (planId: string): string => `plan:${planId}`;

/**
 * Step 2: applies exactly the plan that `prepareStockImport` stored (the client sends only its id):
 * sets every product in it to its count, writing one `import` movement per product whose count
 * differs. All or nothing: when the on-hand of ANY product in the plan is not what the preview
 * showed, the whole import is refused with `inventory.import_stale` (a count of changed rows, no
 * ids) and nothing is written. A plan belongs to its preparer and expires after an hour.
 */
export const importStock = command({
  name: "inventory.stock.import",
  input: z.object({ planId: z.uuid() }),
  output: z.object({
    importId: z.uuid(),
    rows: z.number().int(),
    changed: z.number().int(),
  }),
  permission: PERMISSIONS.inventory.stockManage,
  async handler({ input, ctx }) {
    const [plan] = await ctx.tx.select().from(importPlans).where(eq(importPlans.id, input.planId));
    // someone else's plan is "not found": its existence is not theirs to learn
    if (!plan || plan.actorId !== ctx.actor.id) throw notFound("inventory.import_plan_not_found");
    if (plan.expiresAt.getTime() <= ctx.now.getTime()) {
      throw conflict("inventory.import_plan_expired");
    }
    await lockStock(ctx.tx);
    const levels = await stockLevels(
      ctx.tx,
      plan.rows.map((row) => row.productId),
    );
    const changedRows = plan.rows.filter(
      (row) => levelOf(levels, row.productId).onHand !== row.expectedOnHand,
    ).length;
    if (changedRows > 0) throw conflict("inventory.import_stale", { changedRows });
    const changes = plan.rows.filter((row) => row.target !== row.expectedOnHand);
    await recordMovements(
      ctx.tx,
      ctx,
      changes.map((row) => ({
        productId: row.productId,
        delta: row.target - row.expectedOnHand,
        reason: "import" as const,
      })),
      { importId: plan.id },
    );
    await ctx.audit.record({
      action: INVENTORY_AUDIT.stockImported,
      entityType: "stock_import",
      entityId: plan.id,
      data: { importId: plan.id, rows: plan.rows.length, changed: changes.length },
    });
    return { importId: plan.id, rows: plan.rows.length, changed: changes.length };
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
    const [movement] = await recordMovements(ctx.tx, ctx, [
      { productId: product.id, delta: input.delta, reason: input.reason, note: input.note },
    ]);
    const movementId = movement?.id ?? "";
    await ctx.audit.record({
      action: INVENTORY_AUDIT.stockAdjusted,
      entityType: "product",
      entityId: product.id,
      data: {
        movementId,
        productId: product.id,
        delta: input.delta,
        reason: input.reason,
      },
    });
    return { movementId, onHand: onHand + input.delta };
  },
});
