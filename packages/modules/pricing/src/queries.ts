import { type Tx, notFound, query } from "@igs/kernel";
import { type VatClass, productRefsForActor } from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import {
  LOWEST_PRICE_WINDOW_DAYS,
  type PricePoint,
  comparePoints,
  lowestPriceInWindow,
  priceAt,
  splitVat,
} from "./domain";
import { prices, vatClasses } from "./schema";

/** Pricing queries for the back-office (igs-pharma#59). v1 reads the `web` channel only. */

const CHANNEL = "web";

/** At most this many history rows are returned, newest first. */
export const PRICE_HISTORY_LIMIT = 200;

export interface PriceView {
  readonly id: string;
  /** Including VAT. */
  readonly amountCents: number;
  readonly validFrom: Date;
  readonly reason: string | null;
  readonly createdByType: string;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface CurrentPrice {
  readonly productId: string;
  readonly priceId: string;
  /** Including VAT. */
  readonly amountCents: number;
  readonly validFrom: Date;
  readonly vatClass: VatClass;
  readonly vatRateBp: number;
  readonly vatCents: number;
  readonly exVatCents: number;
}

const priceColumns = {
  id: prices.id,
  productId: prices.productId,
  amountCents: prices.amountCents,
  validFrom: prices.validFrom,
  reason: prices.reason,
  createdByType: prices.createdByType,
  createdBy: prices.createdBy,
  createdAt: prices.createdAt,
};

/** Every VAT class's rate at `at`, by code (the latest row with `valid_from <= at`). */
async function vatRatesAt(tx: Tx, at: Date): Promise<ReadonlyMap<string, number>> {
  const rows = await tx
    .select({ code: vatClasses.code, rateBp: vatClasses.rateBp })
    .from(vatClasses)
    .where(lte(vatClasses.validFrom, at))
    .orderBy(vatClasses.code, desc(vatClasses.validFrom));
  const rates = new Map<string, number>();
  for (const row of rows) if (!rates.has(row.code)) rates.set(row.code, row.rateBp);
  return rates;
}

function rateOf(rates: ReadonlyMap<string, number>, vatClass: string): number {
  const rate = rates.get(vatClass);
  // the migration seeds every class of the catalogue; a missing one is a deployment fault
  if (rate === undefined) throw new Error(`pricing: no VAT rate for ${vatClass}`);
  return rate;
}

/** The web prices of these products that started on or before `at`, in any order. */
async function pricesUpTo(tx: Tx, productIds: readonly string[], at: Date) {
  return tx
    .select(priceColumns)
    .from(prices)
    .where(
      and(
        inArray(prices.productId, [...productIds]),
        eq(prices.channel, CHANNEL),
        lte(prices.validFrom, at),
      ),
    );
}

const byProduct = <P extends { productId: string }>(rows: readonly P[]) => {
  const map = new Map<string, P[]>();
  for (const row of rows) {
    const list = map.get(row.productId);
    if (list) list.push(row);
    else map.set(row.productId, [row]);
  }
  return map;
};

/**
 * The current web price of each of these products, with its VAT part; a product without a price
 * (or an unknown id) is simply absent. For the product list's Price column and the Price panel.
 */
export const currentPrices = query({
  name: "pricing.price.current",
  input: z.object({ productIds: z.array(z.uuid()).min(1).max(100) }),
  permission: PERMISSIONS.pricing.priceRead,
  async handler({ input, ctx }): Promise<readonly CurrentPrice[]> {
    // the storefront actor prices storefront-visible products only (D-034)
    const refs = await productRefsForActor(ctx.tx, input.productIds, ctx.can);
    if (refs.length === 0) return [];
    const rows = byProduct(
      await pricesUpTo(
        ctx.tx,
        refs.map((r) => r.id),
        ctx.now,
      ),
    );
    const rates = await vatRatesAt(ctx.tx, ctx.now);
    return refs.flatMap((ref) => {
      const current = priceAt(rows.get(ref.id) ?? [], ctx.now);
      if (!current) return [];
      const vatRateBp = rateOf(rates, ref.vatClass);
      return [
        {
          productId: ref.id,
          priceId: current.id,
          amountCents: current.amountCents,
          validFrom: current.validFrom,
          vatClass: ref.vatClass,
          vatRateBp,
          ...splitVat(current.amountCents, vatRateBp),
        },
      ];
    });
  },
});

export interface PriceHistoryRow extends PriceView {
  /** The price this row replaced (in force just before its `validFrom`), `null` for the first one. */
  readonly previousAmountCents: number | null;
}

export interface ProductPrices {
  readonly productId: string;
  readonly vatClass: VatClass;
  readonly vatRateBp: number;
  readonly current: CurrentPrice | null;
  /** Changes that start later, soonest first. */
  readonly scheduled: readonly PriceHistoryRow[];
  /** Prices that have started, newest first (at most `PRICE_HISTORY_LIMIT`). */
  readonly history: readonly PriceHistoryRow[];
}

/** A product's web price: the current one, the scheduled changes and the history. */
export const listPrices = query({
  name: "pricing.price.list",
  input: z.object({ productId: z.uuid() }),
  permission: PERMISSIONS.pricing.priceRead,
  async handler({ input, ctx }): Promise<ProductPrices> {
    const [ref] = await productRefsForActor(ctx.tx, [input.productId], ctx.can);
    if (!ref) throw notFound("pricing.unknown_product");
    const rows = await ctx.tx
      .select(priceColumns)
      .from(prices)
      .where(and(eq(prices.productId, ref.id), eq(prices.channel, CHANNEL)));
    rows.sort(comparePoints);
    const vatRateBp = rateOf(await vatRatesAt(ctx.tx, ctx.now), ref.vatClass);

    const withPrevious: PriceHistoryRow[] = rows.map((row, index) => {
      // the price in force just before this one started: the last earlier row
      const before = rows
        .slice(0, index)
        .filter((r) => r.validFrom.getTime() < row.validFrom.getTime());
      const { productId: _productId, ...view } = row;
      return { ...view, previousAmountCents: before.at(-1)?.amountCents ?? null };
    });
    const now = ctx.now.getTime();
    const current = priceAt(rows, ctx.now);
    return {
      productId: ref.id,
      vatClass: ref.vatClass,
      vatRateBp,
      current: current
        ? {
            productId: ref.id,
            priceId: current.id,
            amountCents: current.amountCents,
            validFrom: current.validFrom,
            vatClass: ref.vatClass,
            vatRateBp,
            ...splitVat(current.amountCents, vatRateBp),
          }
        : null,
      scheduled: withPrevious.filter((r) => r.validFrom.getTime() > now),
      history: withPrevious
        .filter((r) => r.validFrom.getTime() <= now)
        .reverse()
        .slice(0, PRICE_HISTORY_LIMIT),
    };
  },
});

/**
 * The lowest web price in force at any moment of the 30 days before `at` (default now), for a price
 * reduction; `amountCents: null` when the product had no price in that window.
 */
export const lowestPriceLast30Days = query({
  name: "pricing.price.lowest_30d",
  input: z.object({ productId: z.uuid(), at: z.coerce.date().optional() }),
  permission: PERMISSIONS.pricing.priceRead,
  async handler({ input, ctx }): Promise<{ productId: string; amountCents: number | null }> {
    const [ref] = await productRefsForActor(ctx.tx, [input.productId], ctx.can);
    if (!ref) throw notFound("pricing.unknown_product");
    const at = input.at ?? ctx.now;
    const points: PricePoint[] = await pricesUpTo(ctx.tx, [ref.id], at);
    return {
      productId: ref.id,
      amountCents: lowestPriceInWindow(points, at, LOWEST_PRICE_WINDOW_DAYS),
    };
  },
});
