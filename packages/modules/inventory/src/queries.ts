import { notFound, query } from "@igs/kernel";
import { productRefsById, productRefsForActor, searchProductRefs } from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  type Availability,
  DEFAULT_LOCATION_ID,
  type MovementReason,
  type ReservationKind,
  availabilityOf,
} from "./domain";
import { availabilityFor, levelOf, stockLevels } from "./ledger";
import { reservations, stockMovements } from "./schema";

/** Inventory queries for the back-office (igs-pharma#53). */

export interface StockListItem {
  readonly productId: string;
  readonly cnk: string;
  readonly nameNl: string | null;
  readonly onHand: number;
  readonly lastMovementAt: Date | null;
  /** Set aside for checkouts (live holds) and orders (igs-pharma#99). */
  readonly reserved: number;
  /** `onHand − reserved`, never below 0: what a new hold may take. */
  readonly available: number;
  /** How many units the pharmacy is short for its orders (the shelf holds less than the orders reserved). */
  readonly short: number;
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
    const ids = items.map((ref) => ref.id);
    const levels = await stockLevels(ctx.tx, ids);
    const availability = await availabilityFor(ctx.tx, ids, ctx.now);
    return {
      items: items.map((ref) => {
        const a = availability.get(ref.id);
        return {
          productId: ref.id,
          cnk: ref.cnk,
          nameNl: ref.nameNl,
          ...levelOf(levels, ref.id),
          reserved: (a?.held ?? 0) + (a?.ordered ?? 0),
          available: a?.available ?? 0,
          short: a?.short ?? 0,
        };
      }),
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

/** One active reservation as the Stock page shows it. */
export interface ReservationView {
  readonly id: string;
  readonly kind: ReservationKind;
  readonly quantity: number;
  /** The opaque reference of the checkout or order that holds it. */
  readonly holderRef: string;
  readonly createdAt: Date;
  /** Holds only; an order has none. */
  readonly expiresAt: Date | null;
}

export interface ProductStock extends Availability {
  readonly productId: string;
  readonly cnk: string;
  readonly nameNl: string | null;
  readonly lastMovementAt: Date | null;
  /** The active reservations, newest first (at most `RESERVATION_LIST_LIMIT`). */
  readonly reservations: readonly ReservationView[];
  /** The latest movements, newest first (at most `MOVEMENT_HISTORY_LIMIT`). */
  readonly movements: readonly StockMovementView[];
}

export const MOVEMENT_HISTORY_LIMIT = 200;
export const RESERVATION_LIST_LIMIT = 200;

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
    const availability = (await availabilityFor(ctx.tx, [ref.id], ctx.now)).get(ref.id);
    const active = await ctx.tx
      .select({
        id: reservations.id,
        kind: reservations.kind,
        quantity: reservations.quantity,
        holderRef: reservations.holderRef,
        createdAt: reservations.createdAt,
        expiresAt: reservations.expiresAt,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.productId, ref.id),
          eq(reservations.locationId, DEFAULT_LOCATION_ID),
          eq(reservations.status, "active"),
        ),
      )
      .orderBy(desc(reservations.createdAt), desc(reservations.id))
      .limit(RESERVATION_LIST_LIMIT);
    return {
      productId: ref.id,
      cnk: ref.cnk,
      nameNl: ref.nameNl,
      lastMovementAt: levelOf(levels, ref.id).lastMovementAt,
      ...(availability ?? availabilityOf(0, 0, 0)),
      // a hold the expiry job has not marked yet is already over: the page does not list it
      reservations: active
        .filter(
          (r) => !(r.kind === "hold" && r.expiresAt && r.expiresAt.getTime() <= ctx.now.getTime()),
        )
        .map((r) => ({ ...r, kind: r.kind as ReservationKind })),
      movements: movements.map((m) => ({ ...m, reason: m.reason as MovementReason })),
    };
  },
});

export interface ProductAvailability {
  readonly productId: string;
  /** Whether any stock is available (on hand and not reserved). The count itself is never returned. */
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
    // igs-pharma#99: in stock means something is AVAILABLE, i.e. on hand minus what is reserved
    const availability = await availabilityFor(
      ctx.tx,
      refs.map((ref) => ref.id),
      ctx.now,
    );
    return refs.map((ref) => ({
      productId: ref.id,
      inStock: (availability.get(ref.id)?.available ?? 0) > 0,
    }));
  },
});
