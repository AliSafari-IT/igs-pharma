import { type Tx, notFound, query } from "@igs/kernel";
import {
  allProductIds,
  productRefsById,
  productRefsForActor,
  searchProductRefs,
  storefrontVisibleIds,
} from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  type Availability,
  DEFAULT_LOCATION_ID,
  HOLDER_REF_PATTERN,
  type MovementReason,
  type ReservationKind,
  type ReservationStatus,
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

/** What a shelf looks like to a shopper: never a count. `low` is 1..threshold available. */
export type AvailabilityStatus = "available" | "low" | "out";

/** The default threshold at or below which availability counts as `low` (igs-pharma#103). */
export const DEFAULT_LOW_STOCK = 3;

/** `available` above the threshold, `low` from 1 up to it, `out` at zero. */
export function availabilityStatus(available: number, lowStock: number): AvailabilityStatus {
  if (available <= 0) return "out";
  return available <= lowStock ? "low" : "available";
}

export interface StockSummary {
  /** Products with 1 up to `DEFAULT_LOW_STOCK` available. */
  readonly low: number;
  /** Products with nothing available (none on hand, or all of it reserved). */
  readonly out: number;
  /** Reservations still setting stock aside: active orders, and holds not yet past `expires_at`. */
  readonly activeReservations: number;
  /**
   * Products SHORT for their orders: the active orders reserve more than the shelf holds
   * (`availabilityOf().short > 0`, the stock list's "Short by" badge, igs-pharma#112).
   */
  readonly short: number;
}

/**
 * The dashboard's stock numbers (igs-pharma#115) in one statement instead of a scan of every page of
 * `listStock`. It counts over exactly the products `listStock` lists (every catalog product) with
 * exactly its definitions: on hand is the sum of the movements at the default location
 * (`stockLevels`), what is set aside is the active orders plus the holds with `now < expires_at`
 * (`reservedQuantities`), and available is `max(0, on hand − held − ordered)` (`availabilityOf`).
 * A product without movements has 0 on hand, so it counts as out. `activeReservations` counts the
 * reservations `getStock` shows: active, and for a hold not yet lapsed. `short` counts the products
 * whose active orders exceed on hand (`availabilityOf().short > 0`); holds never make one short.
 */
export const getStockSummary = query({
  name: "inventory.stock.summary",
  input: z.object({}),
  permission: PERMISSIONS.inventory.stockRead,
  async handler({ ctx }): Promise<StockSummary> {
    const ids = await allProductIds(ctx.tx);
    if (ids.length === 0) return { low: 0, out: 0, activeReservations: 0, short: 0 };
    const now = ctx.now.toISOString();
    const rows = Array.from(
      await ctx.tx.execute<{
        low: number;
        out: number;
        active_reservations: number;
        short: number;
      }>(sql`
        WITH listed AS (
          SELECT DISTINCT value::uuid AS product_id
          FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)
        ),
        on_hand AS (
          SELECT product_id, coalesce(sum(delta), 0)::int AS on_hand
          FROM inventory.stock_movements
          WHERE location_id = ${DEFAULT_LOCATION_ID}::uuid
            AND product_id IN (SELECT product_id FROM listed)
          GROUP BY product_id
        ),
        reserved AS (
          SELECT
            product_id,
            coalesce(
              sum(quantity) FILTER (WHERE kind = 'hold' AND expires_at > ${now}::timestamptz), 0
            )::int AS held,
            coalesce(sum(quantity) FILTER (WHERE kind = 'order'), 0)::int AS ordered,
            (count(*) FILTER (WHERE kind = 'order' OR expires_at > ${now}::timestamptz))::int AS live
          FROM inventory.reservations
          WHERE status = 'active'
            AND location_id = ${DEFAULT_LOCATION_ID}::uuid
            AND product_id IN (SELECT product_id FROM listed)
          GROUP BY product_id
        ),
        availability AS (
          SELECT
            greatest(
              0, coalesce(o.on_hand, 0) - coalesce(r.held, 0) - coalesce(r.ordered, 0)
            ) AS available,
            coalesce(r.ordered, 0) > coalesce(o.on_hand, 0) AS is_short,
            coalesce(r.live, 0) AS live
          FROM listed l
          LEFT JOIN on_hand o ON o.product_id = l.product_id
          LEFT JOIN reserved r ON r.product_id = l.product_id
        )
        SELECT
          (count(*) FILTER (WHERE available BETWEEN 1 AND ${DEFAULT_LOW_STOCK}::int))::int AS low,
          (count(*) FILTER (WHERE available <= 0))::int AS "out",
          coalesce(sum(live), 0)::int AS active_reservations,
          (count(*) FILTER (WHERE is_short))::int AS "short"
        FROM availability`),
    );
    const row = rows[0];
    return {
      low: Number(row?.low ?? 0),
      out: Number(row?.out ?? 0),
      activeReservations: Number(row?.active_reservations ?? 0),
      short: Number(row?.short ?? 0),
    };
  },
});

/**
 * The availability of these products for the storefront read model (igs-pharma#103): a plain
 * function on the caller's transaction (the calling query has authorized the actor). It builds on
 * `availabilityFor`, so "available" already means on hand minus holds and orders (#99). Only
 * STOREFRONT-VISIBLE products are answered; a hidden or unknown id is simply absent. Never a count.
 */
export async function storefrontAvailability(
  tx: Tx,
  productIds: readonly string[],
  now: Date,
  lowStock: number = DEFAULT_LOW_STOCK,
): Promise<ReadonlyMap<string, AvailabilityStatus>> {
  if (productIds.length === 0) return new Map();
  const visible = await storefrontVisibleIds(tx, [...new Set(productIds)]);
  const availability = await availabilityFor(tx, visible, now);
  return new Map(
    visible.map((id) => [id, availabilityStatus(availability.get(id)?.available ?? 0, lowStock)]),
  );
}

/** One reservation of a holder, whatever its status (igs-pharma#158). */
export interface HolderReservation {
  readonly reservationId: string;
  readonly productId: string;
  readonly kind: ReservationKind;
  readonly status: ReservationStatus;
  readonly quantity: number;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
}

/**
 * Every reservation of one holder (a checkout and its order), newest first: what staff see when an
 * order was paid after its holds lapsed.
 */
export const listHolderReservations = query({
  name: "inventory.reservation.list_holder",
  input: z.object({ holderRef: z.string().regex(HOLDER_REF_PATTERN) }),
  permission: PERMISSIONS.inventory.stockRead,
  async handler({ input, ctx }): Promise<readonly HolderReservation[]> {
    const rows = await ctx.tx
      .select({
        reservationId: reservations.id,
        productId: reservations.productId,
        kind: reservations.kind,
        status: reservations.status,
        quantity: reservations.quantity,
        expiresAt: reservations.expiresAt,
        createdAt: reservations.createdAt,
      })
      .from(reservations)
      .where(eq(reservations.holderRef, input.holderRef))
      .orderBy(desc(reservations.createdAt), desc(reservations.id))
      .limit(RESERVATION_LIST_LIMIT);
    return rows.map((row) => ({
      ...row,
      kind: row.kind as ReservationKind,
      status: row.status as ReservationStatus,
    }));
  },
});
