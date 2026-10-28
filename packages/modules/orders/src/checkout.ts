import { sha256Hex } from "@igs/crypto";
import { newId } from "@igs/db/ids";
import {
  type Ctx,
  command,
  conflict,
  isDomainError,
  notFound,
  validationFailed,
} from "@igs/kernel";
import { sellableFacts } from "@igs/module-catalog";
import { releaseReservation, reserveStock } from "@igs/module-inventory";
import { storefrontPriceCards, vatPartCents } from "@igs/module-pricing";
import { brusselsLocal } from "@igs/time";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { ORDERS_AUDIT } from "./audit";
import { type Owner, cartToken, lockCart, newCartToken, ownerOf } from "./cart";
import {
  CHECKOUT_HOLD_MINUTES,
  MINUTE_MS,
  ORDER_LOCALES,
  formatOrderReference,
  holderOf,
  maxPerOrder,
} from "./domain";
import { notSellableIds } from "./eligibility";
import {
  cartLines,
  checkoutLines,
  checkouts,
  orderContacts,
  orderLines,
  ordersTable,
  payments,
  referenceCounters,
} from "./schema";

/**
 * Checkout and placing the order (igs-pharma#116, D-045 steps 2–4), for a guest or a signed-in
 * customer: whose checkout it is follows the cart (`ownerOf`). Both operations are `public` (a
 * guest holds no permission) and audited.
 *
 * Stock is held through inventory's INTERNAL reservation commands, run with `ctx.run` inside these
 * commands (S1): the customer holds no reservation permission and no route can reach them, so what
 * is reserved, and for which holder (`checkout:<id>`), is decided here only.
 *
 * Paying is the next step and happens outside any transaction (D-019): the route handler creates
 * the provider payment for the `created` payment row this file writes. Until it is paid the order is
 * `pending_payment` and the stock stays a HOLD of the checkout, which lapses after
 * `CHECKOUT_HOLD_MINUTES`.
 */

type Checkout = typeof checkouts.$inferSelect;

function requireOwner(ctx: Ctx, token: string | undefined): Owner {
  const owner = ownerOf(ctx, token);
  if (!owner) {
    throw validationFailed("orders.cart_token_required", [{ path: "cartToken", code: "required" }]);
  }
  return owner;
}

const checkoutOwnedBy = (owner: Owner) =>
  "customerId" in owner
    ? eq(checkouts.customerId, owner.customerId)
    : eq(checkouts.tokenHash, owner.tokenHash);

// ── start ────────────────────────────────────────────────────────────────────────────────────────

/** A line that could not be held: how many are available (0 for a product no longer sellable). */
interface Short {
  readonly productId: string;
  readonly available: number;
}

/** `id:available,id:available`: error details are scalars and carry no personal data. */
const shortList = (short: readonly Short[]) =>
  short.map((s) => `${s.productId}:${s.available}`).join(",");

/**
 * Starts the checkout of the actor's cart: re-checks every line (still sellable, within the
 * per-order limit, priced), copies the lines with today's prices and VAT (the client never sends a
 * price), and holds the stock of every line for `CHECKOUT_HOLD_MINUTES`. All or nothing: when a line
 * cannot be had, nothing is held and it is refused with
 * - `orders.checkout_unavailable` (`products`: the ids no longer sellable or priced),
 * - `orders.checkout_short` (`products`: `id:available` for each line with too little stock),
 * - `orders.cart_quantity_limit` (`productId`, `max`) when a line is above the per-order limit,
 * - `orders.cart_empty` for an empty cart.
 * A checkout the actor left open before is cancelled and its holds given back. The cart is kept.
 */
export const startCheckout = command({
  name: "orders.checkout.start",
  input: z.object({ cartToken: cartToken.optional(), locale: z.enum(ORDER_LOCALES) }),
  output: z.object({
    checkoutId: z.uuid(),
    expiresAt: z.coerce.date(),
    totalCents: z.number().int(),
    vatCents: z.number().int(),
    needsReview: z.boolean(),
    lineCount: z.number().int(),
  }),
  permission: "public",
  async handler({ input, ctx }) {
    const owner = requireOwner(ctx, input.cartToken);
    const cart = await lockCart(ctx, owner);
    const lines = cart
      ? await ctx.tx
          .select({ productId: cartLines.productId, quantity: cartLines.quantity })
          .from(cartLines)
          .where(eq(cartLines.cartId, cart.id))
          .orderBy(asc(cartLines.addedAt), asc(cartLines.productId))
      : [];
    if (lines.length === 0) throw conflict("orders.cart_empty");

    // starting again gives back the holds of the checkout left open before
    const previous = await ctx.tx
      .select()
      .from(checkouts)
      .where(and(checkoutOwnedBy(owner), eq(checkouts.status, "open")))
      .for("update");
    for (const open of previous) {
      await ctx.run(releaseReservation, {
        holderRef: holderOf(open.id),
        reason: "checkout_cancelled",
      });
      await ctx.tx
        .update(checkouts)
        .set({ status: "cancelled", updatedAt: ctx.now })
        .where(eq(checkouts.id, open.id));
    }

    const ids = lines.map((line) => line.productId);
    const facts = new Map(
      (await sellableFacts(ctx.tx, ids, input.locale)).map((fact) => [fact.id, fact]),
    );
    const prices = await storefrontPriceCards(ctx.tx, ids, ctx.now);
    const unavailable = ids.filter((id) => !facts.has(id) || !prices.has(id));
    if (unavailable.length > 0) {
      throw conflict("orders.checkout_unavailable", { products: unavailable.join(",") });
    }

    const id = newId();
    const rows = lines.map((line, position) => {
      const fact = facts.get(line.productId);
      const price = prices.get(line.productId);
      if (!fact || !price) throw notFound("orders.checkout_unavailable"); // checked above
      const max = maxPerOrder(fact.isMedicine);
      if (line.quantity > max) {
        throw conflict("orders.cart_quantity_limit", { productId: line.productId, max });
      }
      const lineTotalCents = line.quantity * price.amountCents;
      return {
        checkoutId: id,
        productId: line.productId,
        cnk: fact.cnk,
        name: fact.name,
        isMedicine: fact.isMedicine,
        vatClass: price.vatClass,
        quantity: line.quantity,
        unitPriceCents: price.amountCents,
        lineTotalCents,
        vatCents: vatPartCents(lineTotalCents, price.vatRateBp),
        position,
      };
    });
    const totalCents = rows.reduce((sum, row) => sum + row.lineTotalCents, 0);
    const vatCents = rows.reduce((sum, row) => sum + row.vatCents, 0);
    const needsReview = rows.some((row) => row.isMedicine);
    const expiresAt = new Date(ctx.now.getTime() + CHECKOUT_HOLD_MINUTES * MINUTE_MS);

    await ctx.tx.insert(checkouts).values({
      id,
      customerId: "customerId" in owner ? owner.customerId : null,
      tokenHash: "tokenHash" in owner ? owner.tokenHash : null,
      locale: input.locale,
      status: "open",
      needsReview,
      totalCents,
      vatCents,
      expiresAt,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.tx.insert(checkoutLines).values(rows);

    // hold every line; collect the short ones so the shopper sees all of them at once
    const short: Short[] = [];
    for (const row of rows) {
      try {
        await ctx.run(reserveStock, {
          productId: row.productId,
          quantity: row.quantity,
          holderRef: holderOf(id),
          holdMinutes: CHECKOUT_HOLD_MINUTES,
        });
      } catch (error) {
        // refused before it wrote anything, so the transaction is still usable
        if (!isDomainError(error) || error.code !== "inventory.insufficient_stock") throw error;
        short.push({ productId: row.productId, available: Number(error.details?.["available"]) });
      }
    }
    // all or nothing: throwing rolls back the checkout and every hold taken above
    if (short.length > 0) throw conflict("orders.checkout_short", { products: shortList(short) });

    await ctx.audit.record({
      action: ORDERS_AUDIT.checkoutStarted,
      entityType: "checkout",
      entityId: id,
      data: { checkoutId: id, lines: rows.length, totalCents },
    });
    return { checkoutId: id, expiresAt, totalCents, vatCents, needsReview, lineCount: rows.length };
  },
});

// ── place ────────────────────────────────────────────────────────────────────────────────────────

/** Contact for a pickup order: who it is for and how to reach them (D-045 step 3). */
const contact = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  phone: z
    .string()
    .transform((value) => value.replace(/[\s.()/-]/g, ""))
    .pipe(z.string().regex(/^\+?[0-9]{6,15}$/)),
});

/** The next `IGS-<year>-<number>` of this Brussels calendar year (the counter row serialises writers). */
async function nextReference(ctx: Ctx): Promise<string> {
  const { year } = brusselsLocal(ctx.now.getTime());
  const [row] = await ctx.tx
    .insert(referenceCounters)
    .values({ year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: referenceCounters.year,
      set: { lastNumber: sql`${referenceCounters.lastNumber} + 1` },
    })
    .returning({ lastNumber: referenceCounters.lastNumber });
  return formatOrderReference(year, row?.lastNumber ?? 1);
}

const placedOutput = z.object({
  orderId: z.uuid(),
  reference: z.string(),
  paymentId: z.uuid(),
  /** Opens the order's status page without the cart cookie; returned once, `null` on a replay. */
  statusToken: z.string().nullable(),
});

/** The order (and its payment) already placed from `checkout`. */
async function placedFrom(ctx: Ctx, checkout: Checkout) {
  const [order] = await ctx.tx
    .select({ orderId: ordersTable.id, reference: ordersTable.reference })
    .from(ordersTable)
    .where(eq(ordersTable.checkoutId, checkout.id));
  const [payment] = order
    ? await ctx.tx
        .select({ paymentId: payments.id })
        .from(payments)
        .where(eq(payments.orderId, order.orderId))
        .orderBy(asc(payments.createdAt))
        .limit(1)
    : [];
  if (!order || !payment) throw notFound("orders.order_not_found");
  return { ...order, ...payment, statusToken: null };
}

/**
 * Places the order of an open checkout, with the contact for the pickup: copies the checkout's lines
 * and totals onto a new order in `pending_payment` with a readable reference, stores the contact
 * apart, and creates its payment in `created` for the route handler to send to the provider. The
 * stock stays held by the checkout until the payment is confirmed.
 * - `orders.checkout_not_found`: no such checkout for this actor (another shopper's looks the same);
 * - `orders.checkout_expired`: the holds lapsed, start the checkout again;
 * - `orders.checkout_cancelled`: a newer checkout replaced it;
 * - `orders.checkout_unavailable` (`products`): a product stopped being sellable since the checkout
 *   started (the eligibility recheck); start the checkout again without it.
 * Placing an already placed checkout again returns the same order (a double click, a retry).
 */
export const placeOrder = command({
  name: "orders.order.place",
  input: z.object({ cartToken: cartToken.optional(), checkoutId: z.uuid(), contact }),
  output: placedOutput,
  permission: "public",
  async handler({ input, ctx }) {
    const owner = requireOwner(ctx, input.cartToken);
    const [checkout] = await ctx.tx
      .select()
      .from(checkouts)
      .where(and(eq(checkouts.id, input.checkoutId), checkoutOwnedBy(owner)))
      .for("update");
    if (!checkout) throw notFound("orders.checkout_not_found");
    if (checkout.status === "placed") {
      const placed = await placedFrom(ctx, checkout);
      // a retry changes nothing; it is still recorded who asked
      await audit(ctx, placed.orderId, checkout.id, checkout.totalCents, true);
      return placed;
    }
    if (checkout.status === "cancelled") throw conflict("orders.checkout_cancelled");
    if (checkout.expiresAt.getTime() <= ctx.now.getTime()) {
      throw conflict("orders.checkout_expired");
    }

    const lines = await ctx.tx
      .select()
      .from(checkoutLines)
      .where(eq(checkoutLines.checkoutId, checkout.id))
      .orderBy(asc(checkoutLines.position));
    // the eligibility recheck: a product may have stopped being sellable since the checkout started
    const unavailable = await notSellableIds(
      ctx.tx,
      lines.map((line) => line.productId),
    );
    if (unavailable.length > 0) {
      throw conflict("orders.checkout_unavailable", { products: unavailable.join(",") });
    }
    const orderId = newId();
    const paymentId = newId();
    const reference = await nextReference(ctx);
    const statusToken = newCartToken();
    await ctx.tx.insert(ordersTable).values({
      id: orderId,
      reference,
      customerId: checkout.customerId,
      checkoutId: checkout.id,
      statusTokenHash: sha256Hex(statusToken),
      locale: checkout.locale,
      status: "pending_payment",
      needsReview: checkout.needsReview,
      totalCents: checkout.totalCents,
      vatCents: checkout.vatCents,
      version: 1,
      createdByType: ctx.actor.type,
      createdById: ctx.actor.id,
      createdAt: ctx.now,
      updatedByType: ctx.actor.type,
      updatedById: ctx.actor.id,
      updatedAt: ctx.now,
    });
    await ctx.tx.insert(orderLines).values(
      lines.map((line) => ({
        id: newId(),
        orderId,
        productId: line.productId,
        cnk: line.cnk,
        name: line.name,
        isMedicine: line.isMedicine,
        vatClass: line.vatClass,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        lineTotalCents: line.lineTotalCents,
        vatCents: line.vatCents,
      })),
    );
    await ctx.tx.insert(orderContacts).values({ orderId, ...input.contact, createdAt: ctx.now });
    await ctx.tx.insert(payments).values({
      id: paymentId,
      orderId,
      provider: "mollie",
      amountCents: checkout.totalCents,
      status: "created",
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.tx
      .update(checkouts)
      .set({ status: "placed", updatedAt: ctx.now })
      .where(eq(checkouts.id, checkout.id));
    await audit(ctx, orderId, checkout.id, checkout.totalCents, false);
    return { orderId, reference, paymentId, statusToken };
  },
});

/** Ids and an amount only (D-028): never the contact. */
function audit(ctx: Ctx, orderId: string, checkoutId: string, totalCents: number, replay: boolean) {
  return ctx.audit.record({
    action: ORDERS_AUDIT.orderPlaced,
    entityType: "order",
    entityId: orderId,
    data: { orderId, checkoutId, totalCents, replay },
  });
}
