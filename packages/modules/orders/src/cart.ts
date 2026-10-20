import { randomBytes } from "node:crypto";

import { sha256Hex } from "@igs/crypto";
import { type Ctx, command, conflict, notFound, query, validationFailed } from "@igs/kernel";
import { sellableFacts } from "@igs/module-catalog";
import { storefrontPriceCards } from "@igs/module-pricing";
import { PERMISSIONS } from "@igs/rbac";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";

import { ORDERS_AUDIT } from "./audit";
import {
  CART_MAX_LINES,
  CART_TOKEN_PATTERN,
  CART_TTL_DAYS,
  DAY_MS,
  ORDER_LOCALES,
  maxPerOrder,
} from "./domain";
import { cartLines, carts } from "./schema";

/**
 * The shopping cart (igs-pharma#116, D-045 step 1). Server-side; it holds product ids and
 * quantities, never a price (checkout re-prices) and never a reservation.
 *
 * WHOSE cart: a signed-in customer (a `user` who holds `orders.create`) always works on their own
 * cart, found by their user id; anyone else (a guest, `anonymous`) on the cart its `__Host-igs-cart`
 * cookie opens, found by the cookie's SHA-256. The edge mints the cookie with `newCartToken()` and
 * passes it as `cartToken`. At sign-in the edge calls `attachCart`: the guest cart becomes the
 * customer's (or is merged into the one they already have) and loses its token hash, so the cookie
 * left behind opens nothing after sign-out.
 *
 * The cart operations are `public` (kernel.md, A1): a guest has no permission to hold. They audit
 * every change (actor `anonymous` for a guest) with ids and quantities only.
 */

type Cart = typeof carts.$inferSelect;

export const cartToken = z.string().regex(CART_TOKEN_PATTERN);

/** A fresh cart cookie value: 128 random bits, base64url (22 characters). */
export function newCartToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Whether the actor is a signed-in customer, who has a cart of their own. */
const isCustomer = (ctx: Pick<Ctx, "actor" | "can">): boolean =>
  ctx.actor.type === "user" && ctx.can(PERMISSIONS.orders.create);

const expiresFrom = (now: Date) => new Date(now.getTime() + CART_TTL_DAYS * DAY_MS);

const isExpired = (cart: Pick<Cart, "expiresAt">, now: Date) =>
  cart.expiresAt.getTime() <= now.getTime();

/** Whose cart (and checkout): a customer by user id, anyone else by the cookie's hash. */
export type Owner = { customerId: string } | { tokenHash: string };

/** How the actor's cart is found: by user id for a customer, by token hash for anyone else. */
export function ownerOf(
  ctx: Pick<Ctx, "actor" | "can">,
  token: string | undefined,
): Owner | undefined {
  if (isCustomer(ctx)) return { customerId: ctx.actor.id };
  return token === undefined ? undefined : { tokenHash: sha256Hex(token) };
}

const whereOwner = (owner: Owner) =>
  "customerId" in owner
    ? eq(carts.customerId, owner.customerId)
    : eq(carts.tokenHash, owner.tokenHash);

/**
 * The owner's cart, LOCKED, or `undefined`. An expired cart is deleted on the way (with its lines):
 * it is over, and makes room for a new one.
 */
export async function lockCart(ctx: Ctx, owner: Owner): Promise<Cart | undefined> {
  const [cart] = await ctx.tx.select().from(carts).where(whereOwner(owner)).for("update");
  if (!cart) return undefined;
  if (!isExpired(cart, ctx.now)) return cart;
  await ctx.tx.delete(carts).where(eq(carts.id, cart.id));
  return undefined;
}

/** The owner's cart, LOCKED, created when there is none. */
async function lockOrCreateCart(ctx: Ctx, owner: Owner): Promise<Cart> {
  const existing = await lockCart(ctx, owner);
  if (existing) return existing;
  // a concurrent first add for the same owner hits the unique index: then read the winner's cart
  await ctx.tx
    .insert(carts)
    .values({
      customerId: "customerId" in owner ? owner.customerId : null,
      tokenHash: "tokenHash" in owner ? owner.tokenHash : null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      expiresAt: expiresFrom(ctx.now),
    })
    .onConflictDoNothing();
  const [cart] = await ctx.tx.select().from(carts).where(whereOwner(owner)).for("update");
  if (!cart) throw notFound("orders.cart_not_found");
  return cart;
}

/** A change keeps the cart another `CART_TTL_DAYS`. */
const touch = (ctx: Ctx, cartId: string) =>
  ctx.tx
    .update(carts)
    .set({ updatedAt: ctx.now, expiresAt: expiresFrom(ctx.now) })
    .where(eq(carts.id, cartId));

async function lineCount(ctx: Pick<Ctx, "tx">, cartId: string): Promise<number> {
  const [row] = await ctx.tx
    .select({ n: count() })
    .from(cartLines)
    .where(eq(cartLines.cartId, cartId));
  return Number(row?.n ?? 0);
}

// ── read ─────────────────────────────────────────────────────────────────────────────────────────

export interface CartLineView {
  readonly productId: string;
  readonly quantity: number;
  /**
   * Whether the product can still be bought. A product that was archived, hidden or whose medicine
   * text lost its approval since it was added stays in the cart, marked, so the shopper sees why it
   * will not be ordered; checkout refuses it.
   */
  readonly sellable: boolean;
  /** How many of it one order may hold (O-3); `null` for a line that is not sellable. */
  readonly maxQuantity: number | null;
  /** For display, `null` when not sellable: the CNK, the name in the asked locale, today's price incl. VAT. */
  readonly cnk: string | null;
  readonly name: string | null;
  readonly unitPriceCents: number | null;
}

export interface CartView {
  /** `null` while there is no cart (nothing added yet, or it expired). */
  readonly cartId: string | null;
  readonly lines: readonly CartLineView[];
  readonly maxLines: number;
  /**
   * What the sellable, priced lines cost at today's prices (incl. VAT): an indication only, the
   * checkout re-prices.
   */
  readonly totalCents: number;
}

const emptyCart: CartView = { cartId: null, lines: [], maxLines: CART_MAX_LINES, totalCents: 0 };

/**
 * The actor's cart, its lines in the order they were added. A guest without a cookie, or whose
 * cookie opens nothing (expired, attached to an account since), has an empty cart.
 */
export const getCart = query({
  name: "orders.cart.get",
  input: z.object({
    cartToken: cartToken.optional(),
    /** The language of the line names (default Dutch). */
    locale: z.enum(ORDER_LOCALES).default("nl"),
  }),
  permission: "public",
  async handler({ input, ctx }): Promise<CartView> {
    const owner = ownerOf(ctx, input.cartToken);
    if (!owner) return emptyCart;
    const [cart] = await ctx.tx.select().from(carts).where(whereOwner(owner));
    if (!cart || isExpired(cart, ctx.now)) return emptyCart;

    const lines = await ctx.tx
      .select({ productId: cartLines.productId, quantity: cartLines.quantity })
      .from(cartLines)
      .where(eq(cartLines.cartId, cart.id))
      .orderBy(asc(cartLines.addedAt), asc(cartLines.productId));
    const ids = lines.map((line) => line.productId);
    const facts = new Map(
      (await sellableFacts(ctx.tx, ids, input.locale)).map((fact) => [fact.id, fact]),
    );
    const prices = await storefrontPriceCards(ctx.tx, ids, ctx.now);
    const views = lines.map((line): CartLineView => {
      const fact = facts.get(line.productId);
      return {
        productId: line.productId,
        quantity: line.quantity,
        sellable: fact !== undefined,
        maxQuantity: fact ? maxPerOrder(fact.isMedicine) : null,
        cnk: fact?.cnk ?? null,
        name: fact?.name ?? null,
        unitPriceCents: fact ? (prices.get(line.productId)?.amountCents ?? null) : null,
      };
    });
    return {
      cartId: cart.id,
      lines: views,
      maxLines: CART_MAX_LINES,
      totalCents: views.reduce((sum, line) => sum + (line.unitPriceCents ?? 0) * line.quantity, 0),
    };
  },
});

// ── change ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Sets how many of a product the cart holds; `quantity: 0` removes the line. The product must be
 * storefront-visible (`catalog.product_not_sellable` otherwise, so a hidden product and a missing one
 * look the same); removing works for any product. Refused with `orders.cart_quantity_limit` (and the
 * `max`) above the per-order limit, and `orders.cart_full` (and the `max`) for a new line in a cart
 * that already has `CART_MAX_LINES`. A guest without a token gets `orders.cart_token_required`.
 * Setting the quantity a line already has changes nothing.
 */
export const setCartLine = command({
  name: "orders.cart.set_line",
  input: z.object({
    cartToken: cartToken.optional(),
    productId: z.uuid(),
    quantity: z.number().int().min(0).max(100),
  }),
  output: z.object({
    cartId: z.uuid().nullable(),
    productId: z.uuid(),
    quantity: z.number().int(),
    lineCount: z.number().int(),
  }),
  permission: "public",
  // audits only when something changed: setting the same quantity again is not a change
  audit: "none",
  async handler({ input, ctx }) {
    const owner = ownerOf(ctx, input.cartToken);
    if (!owner) {
      throw validationFailed("orders.cart_token_required", [
        { path: "cartToken", code: "required" },
      ]);
    }

    if (input.quantity === 0) {
      const cart = await lockCart(ctx, owner);
      if (!cart) return { cartId: null, productId: input.productId, quantity: 0, lineCount: 0 };
      const removed = await ctx.tx
        .delete(cartLines)
        .where(and(eq(cartLines.cartId, cart.id), eq(cartLines.productId, input.productId)))
        .returning({ productId: cartLines.productId });
      if (removed.length > 0) {
        await touch(ctx, cart.id);
        await audit(ctx, cart.id, input.productId, 0);
      }
      return {
        cartId: cart.id,
        productId: input.productId,
        quantity: 0,
        lineCount: await lineCount(ctx, cart.id),
      };
    }

    const [fact] = await sellableFacts(ctx.tx, [input.productId]);
    if (!fact) throw notFound("catalog.product_not_sellable");
    const max = maxPerOrder(fact.isMedicine);
    if (input.quantity > max) throw conflict("orders.cart_quantity_limit", { max });

    const cart = await lockOrCreateCart(ctx, owner);
    const [line] = await ctx.tx
      .select({ quantity: cartLines.quantity })
      .from(cartLines)
      .where(and(eq(cartLines.cartId, cart.id), eq(cartLines.productId, input.productId)));
    const lines = await lineCount(ctx, cart.id);
    if (line?.quantity === input.quantity) {
      return {
        cartId: cart.id,
        productId: input.productId,
        quantity: input.quantity,
        lineCount: lines,
      };
    }
    if (!line && lines >= CART_MAX_LINES) {
      throw conflict("orders.cart_full", { max: CART_MAX_LINES });
    }
    await ctx.tx
      .insert(cartLines)
      .values({
        cartId: cart.id,
        productId: input.productId,
        quantity: input.quantity,
        addedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .onConflictDoUpdate({
        target: [cartLines.cartId, cartLines.productId],
        set: { quantity: input.quantity, updatedAt: ctx.now },
      });
    await touch(ctx, cart.id);
    await audit(ctx, cart.id, input.productId, input.quantity);
    return {
      cartId: cart.id,
      productId: input.productId,
      quantity: input.quantity,
      lineCount: line ? lines : lines + 1,
    };
  },
});

function audit(ctx: Ctx, cartId: string, productId: string, quantity: number) {
  return ctx.audit.record({
    action: ORDERS_AUDIT.cartLineSet,
    entityType: "cart",
    entityId: cartId,
    data: { cartId, productId, quantity },
  });
}

/**
 * At sign-in: the guest cart the cookie opens becomes the signed-in customer's. When the customer
 * already has a cart (from another device or an earlier visit), the guest lines are merged into it:
 * the quantities of a product in both are added up to the per-order limit, and a line is dropped when
 * its product is no longer sellable or the cart is full. The guest cart is then deleted. Either way
 * the cookie no longer opens a cart, so the edge may keep or replace it. Nothing to attach (no cart,
 * an expired one) changes nothing.
 */
export const attachCart = command({
  name: "orders.cart.attach",
  input: z.object({ cartToken }),
  output: z.object({ cartId: z.uuid().nullable(), lineCount: z.number().int() }),
  permission: PERMISSIONS.orders.create,
  // audits only when a guest cart was attached
  audit: "none",
  async handler({ input, ctx }) {
    // the guest cart first, then the customer's: every attach takes the two locks in this order
    const guest = await lockCart(ctx, { tokenHash: sha256Hex(input.cartToken) });
    const own = await lockCart(ctx, { customerId: ctx.actor.id });
    if (!guest) {
      return { cartId: own?.id ?? null, lineCount: own ? await lineCount(ctx, own.id) : 0 };
    }

    if (!own) {
      await ctx.tx
        .update(carts)
        .set({
          customerId: ctx.actor.id,
          tokenHash: null,
          updatedAt: ctx.now,
          expiresAt: expiresFrom(ctx.now),
        })
        .where(eq(carts.id, guest.id));
      const lines = await lineCount(ctx, guest.id);
      await attachedAudit(ctx, guest.id, lines, 0);
      return { cartId: guest.id, lineCount: lines };
    }

    const guestLines = await ctx.tx
      .select()
      .from(cartLines)
      .where(eq(cartLines.cartId, guest.id))
      .orderBy(asc(cartLines.addedAt), asc(cartLines.productId));
    const ownLines = await ctx.tx
      .select({ productId: cartLines.productId, quantity: cartLines.quantity })
      .from(cartLines)
      .where(eq(cartLines.cartId, own.id));
    const held = new Map(ownLines.map((line) => [line.productId, line.quantity]));
    const facts = new Map(
      (
        await sellableFacts(
          ctx.tx,
          guestLines.map((line) => line.productId),
        )
      ).map((f) => [f.id, f]),
    );

    let merged = 0;
    let dropped = 0;
    let lines = ownLines.length;
    for (const line of guestLines) {
      const fact = facts.get(line.productId);
      const already = held.get(line.productId);
      if (!fact || (already === undefined && lines >= CART_MAX_LINES)) {
        dropped++;
        continue;
      }
      const quantity = Math.min((already ?? 0) + line.quantity, maxPerOrder(fact.isMedicine));
      await ctx.tx
        .insert(cartLines)
        .values({
          cartId: own.id,
          productId: line.productId,
          quantity,
          addedAt: ctx.now,
          updatedAt: ctx.now,
        })
        .onConflictDoUpdate({
          target: [cartLines.cartId, cartLines.productId],
          set: { quantity, updatedAt: ctx.now },
        });
      if (already === undefined) lines++;
      merged++;
    }
    await ctx.tx.delete(carts).where(eq(carts.id, guest.id));
    await touch(ctx, own.id);
    await attachedAudit(ctx, own.id, merged, dropped);
    return { cartId: own.id, lineCount: lines };
  },
});

function attachedAudit(ctx: Ctx, cartId: string, merged: number, dropped: number) {
  return ctx.audit.record({
    action: ORDERS_AUDIT.cartAttached,
    entityType: "cart",
    entityId: cartId,
    data: { cartId, merged, dropped },
  });
}
