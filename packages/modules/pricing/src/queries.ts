import { type Tx, notFound, query } from "@igs/kernel";
import {
  type ProductRef,
  type VatClass,
  productRefsForActor,
  storefrontProductRefsById,
} from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import {
  LOWEST_PRICE_WINDOW_DAYS,
  type PricePoint,
  type PriceReduction,
  comparePoints,
  priceAt,
  priceReductionAt,
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

/** The current price of each of `refs`, in the order of `refs`; a product without one is skipped. */
async function currentPricesOf(
  tx: Tx,
  refs: readonly ProductRef[],
  now: Date,
): Promise<readonly CurrentPrice[]> {
  if (refs.length === 0) return [];
  const rows = byProduct(
    await pricesUpTo(
      tx,
      refs.map((r) => r.id),
      now,
    ),
  );
  const rates = await vatRatesAt(tx, now);
  return refs.flatMap((ref) => {
    const current = priceAt(rows.get(ref.id) ?? [], now);
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
}

/**
 * The current web price of each of these products, with its VAT part; a product without a price
 * (or an unknown id) is simply absent. For the product list's Price column and the Price panel.
 */
export const currentPrices = query({
  name: "pricing.price.current",
  input: z.object({ productIds: z.array(z.uuid()).min(1).max(100) }),
  permission: PERMISSIONS.pricing.priceRead,
  async handler({ input, ctx }): Promise<readonly CurrentPrice[]> {
    const refs = await productRefsForActor(ctx.tx, input.productIds, ctx.can);
    return currentPricesOf(ctx.tx, refs, ctx.now);
  },
});

/** What the storefront may know about a price: the amount and its VAT part, nothing else. */
export interface StorefrontPrice {
  readonly productId: string;
  /** Including VAT. */
  readonly amountCents: number;
  readonly vatClass: VatClass;
  readonly vatRateBp: number;
  readonly vatCents: number;
  readonly exVatCents: number;
}

/**
 * The CURRENT web price of each of these ACTIVE products (igs-pharma#96), behind its own narrow
 * permission `pricing.storefront.read`. The storefront actor holds this and not `pricing.price.read`,
 * so it cannot call the history, schedule or reference-price queries (`kernel.forbidden`), and the
 * answer here carries no price id, start time, reason or author.
 */
export const storefrontPrices = query({
  name: "pricing.storefront.current",
  input: z.object({ productIds: z.array(z.uuid()).min(1).max(100) }),
  permission: PERMISSIONS.pricing.storefrontRead,
  async handler({ input, ctx }): Promise<readonly StorefrontPrice[]> {
    const refs = await storefrontProductRefsById(ctx.tx, input.productIds);
    const current = await currentPricesOf(ctx.tx, refs, ctx.now);
    return current.map(({ productId, amountCents, vatClass, vatRateBp, vatCents, exVatCents }) => ({
      productId,
      amountCents,
      vatClass,
      vatRateBp,
      vatCents,
      exVatCents,
    }));
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
 * The reference price of a price reduction (Omnibus, art. 6a Directive 98/6/EC): when the web price
 * in force at `at` (default now) is a reduction, the lowest price in force in the 30 Brussels
 * calendar days BEFORE that price took over, otherwise `reduction: null`. `fullWindow: false` means
 * the product was priced for less than 30 days before the reduction. Nothing displays it yet.
 */
export const referencePrice30Days = query({
  name: "pricing.price.reference_30d",
  input: z.object({ productId: z.uuid(), at: z.coerce.date().optional() }),
  permission: PERMISSIONS.pricing.priceRead,
  async handler({ input, ctx }): Promise<{ productId: string; reduction: PriceReduction | null }> {
    const [ref] = await productRefsForActor(ctx.tx, [input.productId], ctx.can);
    if (!ref) throw notFound("pricing.unknown_product");
    const at = input.at ?? ctx.now;
    const points: PricePoint[] = await pricesUpTo(ctx.tx, [ref.id], at);
    return { productId: ref.id, reduction: priceReductionAt(points, at, LOWEST_PRICE_WINDOW_DAYS) };
  },
});
