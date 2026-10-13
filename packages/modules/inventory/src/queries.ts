import { notFound, query } from "@igs/kernel";
import { productRefsById, productRefsForActor, searchProductRefs } from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { DEFAULT_LOCATION_ID, MAX_IMPORT_CHARS, type MovementReason } from "./domain";
import { type ImportPlan, levelOf, planImport, stockLevels } from "./ledger";
import { stockMovements } from "./schema";

/** Inventory queries for the back-office (igs-pharma#53). */

export interface StockListItem {
  readonly productId: string;
  readonly cnk: string;
  readonly nameNl: string | null;
  readonly onHand: number;
  readonly lastMovementAt: Date | null;
}

export interface StockPage {
  readonly items: readonly StockListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** Every catalog product with its on-hand, by CNK; `q` matches a CNK prefix or a name. */
export const listStock = query({
  name: "inventory.stock.list",
  input: z.object({
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  }),
  permission: PERMISSIONS.inventory.stockRead,
  async handler({ input, ctx }): Promise<StockPage> {
    const { items, total } = await searchProductRefs(ctx.tx, {
      q: input.q,
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    });
    const levels = await stockLevels(
      ctx.tx,
      items.map((ref) => ref.id),
    );
    return {
      items: items.map((ref) => ({
        productId: ref.id,
        cnk: ref.cnk,
        nameNl: ref.nameNl,
        ...levelOf(levels, ref.id),
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  },
});

export interface StockMovementView {
  readonly id: string;
  readonly delta: number;
  readonly reason: MovementReason;
  readonly note: string | null;
  readonly importId: string | null;
  readonly actorType: string;
  readonly actorId: string;
  readonly at: Date;
}

export interface ProductStock {
  readonly productId: string;
  readonly cnk: string;
  readonly nameNl: string | null;
  readonly onHand: number;
  readonly lastMovementAt: Date | null;
  /** The latest movements, newest first (at most `MOVEMENT_HISTORY_LIMIT`). */
  readonly movements: readonly StockMovementView[];
}

export const MOVEMENT_HISTORY_LIMIT = 200;

/** One product's on-hand and movement history (`inventory.product_not_found`). */
export const getStock = query({
  name: "inventory.stock.get",
  input: z.object({ productId: z.uuid() }),
  permission: PERMISSIONS.inventory.stockRead,
  async handler({ input, ctx }): Promise<ProductStock> {
    const [ref] = await productRefsById(ctx.tx, [input.productId]);
    if (!ref) throw notFound("inventory.product_not_found");
    const levels = await stockLevels(ctx.tx, [ref.id]);
    const movements = await ctx.tx
      .select({
        id: stockMovements.id,
        delta: stockMovements.delta,
        reason: stockMovements.reason,
        note: stockMovements.note,
        importId: stockMovements.importId,
        actorType: stockMovements.actorType,
        actorId: stockMovements.actorId,
        at: stockMovements.at,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.productId, ref.id),
          eq(stockMovements.locationId, DEFAULT_LOCATION_ID),
        ),
      )
      .orderBy(desc(stockMovements.at), desc(stockMovements.id))
      .limit(MOVEMENT_HISTORY_LIMIT);
    return {
      productId: ref.id,
      cnk: ref.cnk,
      nameNl: ref.nameNl,
      ...levelOf(levels, ref.id),
      movements: movements.map((m) => ({ ...m, reason: m.reason as MovementReason })),
    };
  },
});

/**
 * The dry run of `inventory.stock.import`: what the file would change, and every problem in it.
 * Behind `inventory.stock.manage`, as only someone who may import needs it.
 */
export const previewStockImport = query({
  name: "inventory.stock.import_preview",
  input: z.object({ csv: z.string().max(MAX_IMPORT_CHARS) }),
  permission: PERMISSIONS.inventory.stockManage,
  async handler({ input, ctx }): Promise<ImportPlan> {
    return planImport(ctx.tx, input.csv);
  },
});

export interface ProductAvailability {
  readonly productId: string;
  /** Whether any stock is on hand. The count itself is never returned. */
  readonly inStock: boolean;
}

/**
 * Whether each of these products is in stock, for the storefront (igs-pharma#62). Returns only
 * `inStock`, never how many, so the storefront actor cannot leak stock levels; an unknown id is
 * simply absent.
 */
export const getAvailability = query({
  name: "inventory.availability.get",
  input: z.object({ productIds: z.array(z.uuid()).min(1).max(100) }),
  permission: PERMISSIONS.inventory.availabilityRead,
  async handler({ input, ctx }): Promise<readonly ProductAvailability[]> {
    // the storefront actor sees storefront-visible products only (D-034)
    const refs = await productRefsForActor(ctx.tx, input.productIds, ctx.can);
    const levels = await stockLevels(
      ctx.tx,
      refs.map((ref) => ref.id),
    );
    return refs.map((ref) => ({
      productId: ref.id,
      inStock: levelOf(levels, ref.id).onHand > 0,
    }));
  },
});
