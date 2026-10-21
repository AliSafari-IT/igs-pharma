// Checkout and placing the order (igs-pharma#116, D-045 steps 2–4) against real Postgres, with the
// RBAC catalogue from the database and the real audit port: re-pricing, all-or-nothing stock holds
// through inventory's INTERNAL reservation commands (S1), starting again, placing, retries, expiry
// and who may place which checkout.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { type KernelTestHandles, actors, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import {
  createProductRegulated,
  registerAuditActions as registerCatalogAudit,
  setProductStatusRegulated,
} from "@igs/module-catalog";
import { loadRbacCatalogue } from "@igs/module-identity";
import {
  adjustStock,
  registerAuditActions as registerInventoryAudit,
  reserveStock,
} from "@igs/module-inventory";
import { registerAuditActions as registerPricingAudit, setPrice } from "@igs/module-pricing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CHECKOUT_HOLD_MINUTES,
  getCart,
  getCheckout,
  getOrder,
  newCartToken,
  placeOrder,
  registerAuditActions,
  setCartLine,
  startCheckout,
} from "../src";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;
let t0: Date;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerCatalogAudit(registerAuditAction);
  registerInventoryAudit(registerAuditAction);
  registerPricingAudit(registerAuditAction);
  registerAuditActions(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  t0 = new Date();
  kernel.clock.set(t0);
});

const MINUTE = 60_000;
const pharmacist = actors.user({ id: randomUUID(), roles: ["pharmacist"], kind: "staff" });
const owner = actors.user({ id: randomUUID(), roles: ["owner"], kind: "staff" });
const guest = () => actors.anonymous();
const customer = (): Actor =>
  actors.user({ id: randomUUID(), roles: ["customer"], kind: "customer" });

const contact = { name: "Demo Klant", email: " Demo@Example.BE ", phone: "+32 470 12 34 56" };

let nextCnk = 9_700_100;

/** An active product with `stock` units and a price (incl. VAT), unless told otherwise. */
async function product(
  options: { medicine?: boolean; stock?: number; priceCents?: number | null } = {},
): Promise<string> {
  const cnk = String(nextCnk++);
  const medicine = options.medicine ?? false;
  const { productId } = await createProductRegulated(
    {
      cnk,
      productType: medicine ? "otc_medicine" : "medical_device",
      legalStatus: medicine ? "otc" : "general_sale",
      vatClass: medicine ? "BE_6" : "BE_21",
      approveContent: true,
      content: [
        { locale: "nl", name: `Product ${cnk}` },
        { locale: "fr", name: `Produit ${cnk}` },
      ],
    },
    pharmacist,
  );
  await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
  const stock = options.stock ?? 10;
  if (stock > 0) {
    await adjustStock({ productId, delta: stock, reason: "adjustment", note: "seed" }, owner);
  }
  if (options.priceCents !== null) {
    await setPrice({ productId, amountCents: options.priceCents ?? 1_000 }, owner);
  }
  return productId;
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, details: error.details };
    throw error;
  }
  return { code: "ok" };
};

const holdsOf = (checkoutId: string) =>
  iso.sql<{ product_id: string; quantity: number; kind: string; status: string }[]>`
    SELECT product_id, quantity, kind, status FROM inventory.reservations
    WHERE holder_ref = ${`checkout:${checkoutId}`} ORDER BY product_id`;

/** A guest with a cart holding `lines`. */
async function guestCart(lines: readonly { productId: string; quantity: number }[]) {
  const token = newCartToken();
  const actor = guest();
  for (const line of lines) await setCartLine({ cartToken: token, ...line }, actor);
  return { token, actor };
}

describe("the cart for display", () => {
  it("names each line in the shopper's language, with today's price and an indicative total", async () => {
    const productId = await product({ priceCents: 1_250 });
    const unpriced = await product({ priceCents: null });
    const { token, actor } = await guestCart([
      { productId, quantity: 2 },
      { productId: unpriced, quantity: 1 },
    ]);
    const cart = await getCart({ cartToken: token, locale: "fr" }, actor);
    expect(cart.lines).toEqual([
      expect.objectContaining({ productId, unitPriceCents: 1_250, sellable: true }),
      expect.objectContaining({ productId: unpriced, unitPriceCents: null, sellable: true }),
    ]);
    expect(cart.lines[0]?.name).toMatch(/^Produit /);
    expect(cart.lines[0]?.cnk).toMatch(/^[0-9]{7}$/);
    expect(cart.totalCents).toBe(2_500);
  });
});

describe("starting the checkout", () => {
  it("copies the lines with today's prices and VAT, and holds the stock for 15 minutes", async () => {
    const medicine = await product({ medicine: true, priceCents: 599 });
    const other = await product({ priceCents: 1_210 });
    const { token, actor } = await guestCart([
      { productId: medicine, quantity: 2 },
      { productId: other, quantity: 1 },
    ]);

    const started = await startCheckout({ cartToken: token, locale: "fr" }, actor);
    expect(started).toMatchObject({
      totalCents: 2 * 599 + 1_210,
      // 6 % of 1 198 incl. VAT is 68; 21 % of 1 210 is 210
      vatCents: 68 + 210,
      needsReview: true,
      lineCount: 2,
    });
    expect(started.expiresAt.getTime()).toBe(t0.getTime() + CHECKOUT_HOLD_MINUTES * MINUTE);

    const lines = await iso.sql<{ name: string; quantity: number; unit_price_cents: number }[]>`
      SELECT name, quantity, unit_price_cents FROM orders.checkout_lines
      WHERE checkout_id = ${started.checkoutId} ORDER BY position`;
    expect(
      lines.map((l) => [l.name.startsWith("Produit"), l.quantity, l.unit_price_cents]),
    ).toEqual([
      [true, 2, 599],
      [true, 1, 1_210],
    ]);
    expect((await holdsOf(started.checkoutId)).map((h) => [h.quantity, h.kind, h.status])).toEqual(
      expect.arrayContaining([
        [2, "hold", "active"],
        [1, "hold", "active"],
      ]),
    );
    const [audit] = await iso.sql<{ actor_type: string }[]>`
      SELECT actor_type FROM audit.events WHERE action = 'orders.checkout.started' AND entity_id = ${started.checkoutId}`;
    expect(audit?.actor_type).toBe("anonymous");
  });

  it("is all or nothing: a short line holds nothing and names every short line", async () => {
    const plenty = await product({ stock: 10 });
    const scarce = await product({ stock: 1 });
    const { token, actor } = await guestCart([
      { productId: plenty, quantity: 3 },
      { productId: scarce, quantity: 2 },
    ]);
    expect(await codeOf(startCheckout({ cartToken: token, locale: "nl" }, actor))).toEqual({
      code: "orders.checkout_short",
      details: { products: `${scarce}:1` },
    });
    const [held] = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM inventory.reservations WHERE product_id IN (${plenty}, ${scarce})`;
    expect(held?.n).toBe(0);
    const [checkouts] = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM orders.checkouts WHERE token_hash IS NOT NULL
        AND id IN (SELECT checkout_id FROM orders.checkout_lines WHERE product_id = ${plenty})`;
    expect(checkouts?.n).toBe(0);
  });

  it("refuses products that are no longer sellable or have no price, and an empty cart", async () => {
    const archived = await product();
    const unpriced = await product({ priceCents: null });
    const { token, actor } = await guestCart([
      { productId: archived, quantity: 1 },
      { productId: unpriced, quantity: 1 },
    ]);
    await setProductStatusRegulated({ productId: archived, status: "archived" }, pharmacist);
    const refused = await codeOf(startCheckout({ cartToken: token, locale: "nl" }, actor));
    expect(refused.code).toBe("orders.checkout_unavailable");
    expect(String(refused.details?.["products"]).split(",").sort()).toEqual(
      [archived, unpriced].sort(),
    );

    expect(
      (await codeOf(startCheckout({ cartToken: newCartToken(), locale: "nl" }, guest()))).code,
    ).toBe("orders.cart_empty");
    expect((await codeOf(startCheckout({ locale: "nl" }, guest()))).code).toBe(
      "orders.cart_token_required",
    );
  });

  it("starting again cancels the open checkout and gives its stock back", async () => {
    const productId = await product({ stock: 2 });
    const { token, actor } = await guestCart([{ productId, quantity: 2 }]);
    const first = await startCheckout({ cartToken: token, locale: "nl" }, actor);
    // the whole stock is held: starting again must release it first, or it would be short
    const second = await startCheckout({ cartToken: token, locale: "nl" }, actor);
    expect((await holdsOf(first.checkoutId)).map((h) => h.status)).toEqual(["released"]);
    expect((await holdsOf(second.checkoutId)).map((h) => h.status)).toEqual(["active"]);
    expect(
      (await codeOf(placeOrder({ cartToken: token, checkoutId: first.checkoutId, contact }, actor)))
        .code,
    ).toBe("orders.checkout_cancelled");
  });

  it("S1: the customer holds no reservation permission, yet the checkout reserves for them", async () => {
    const productId = await product();
    const alice = customer();
    await setCartLine({ productId, quantity: 1 }, alice);
    const { checkoutId } = await startCheckout({ locale: "nl" }, alice);
    expect(await holdsOf(checkoutId)).toHaveLength(1);
    // called directly, the reservation command refuses the customer and the guest
    for (const actor of [alice, guest()]) {
      expect(
        (
          await codeOf(
            reserveStock({ productId, quantity: 1, holderRef: `checkout:${checkoutId}` }, actor),
          )
        ).code,
      ).toBe("kernel.forbidden");
    }
  });
});

describe("placing the order", () => {
  it("creates the order, its lines, the contact and a payment to send to the provider", async () => {
    const medicine = await product({ medicine: true, priceCents: 450 });
    const { token, actor } = await guestCart([{ productId: medicine, quantity: 2 }]);
    const { checkoutId, totalCents } = await startCheckout(
      { cartToken: token, locale: "nl" },
      actor,
    );

    const placed = await placeOrder({ cartToken: token, checkoutId, contact }, actor);
    expect(placed.reference).toMatch(new RegExp(`^IGS-${t0.getUTCFullYear()}-[0-9]{6}$`));

    const [order] = await iso.sql<
      {
        status: string;
        needs_review: boolean;
        total_cents: number;
        checkout_id: string;
        customer_id: string | null;
      }[]
    >`SELECT status, needs_review, total_cents, checkout_id, customer_id FROM orders.orders WHERE id = ${placed.orderId}`;
    expect(order).toEqual({
      status: "pending_payment",
      needs_review: true,
      total_cents: totalCents,
      checkout_id: checkoutId,
      customer_id: null,
    });
    const [line] = await iso.sql<{ quantity: number; unit_price_cents: number }[]>`
      SELECT quantity, unit_price_cents FROM orders.order_lines WHERE order_id = ${placed.orderId}`;
    expect(line).toEqual({ quantity: 2, unit_price_cents: 450 });
    expect(
      await iso.sql`SELECT name, email, phone FROM orders.order_contacts WHERE order_id = ${placed.orderId}`,
    ).toEqual([{ name: "Demo Klant", email: "demo@example.be", phone: "+32470123456" }]);
    expect(
      await iso.sql`SELECT id, status, amount_cents, provider FROM orders.payments WHERE order_id = ${placed.orderId}`,
    ).toEqual([
      { id: placed.paymentId, status: "created", amount_cents: totalCents, provider: "mollie" },
    ]);
    // the stock stays held by the checkout until the payment is confirmed
    expect((await holdsOf(checkoutId)).map((h) => [h.kind, h.status])).toEqual([
      ["hold", "active"],
    ]);

    // the audit trail has ids and an amount, never the contact
    const events = await iso.sql<{ data: Record<string, unknown> }[]>`
      SELECT data FROM audit.events WHERE action = 'orders.order.placed' AND entity_id = ${placed.orderId}`;
    expect(events[0]?.data).toEqual({
      orderId: placed.orderId,
      checkoutId,
      totalCents,
      replay: false,
    });
    expect(JSON.stringify(events)).not.toContain("example.be");

    // placing again (a double click) returns the same order, without a second status token
    expect(await placeOrder({ cartToken: token, checkoutId, contact }, actor)).toEqual({
      ...placed,
      statusToken: null,
    });
    const [orders] = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM orders.orders WHERE checkout_id = ${checkoutId}`;
    expect(orders?.n).toBe(1);
  });

  it("references count up within the year", async () => {
    const references: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { token, actor } = await guestCart([{ productId: await product(), quantity: 1 }]);
      const { checkoutId } = await startCheckout({ cartToken: token, locale: "nl" }, actor);
      references.push(
        (await placeOrder({ cartToken: token, checkoutId, contact }, actor)).reference,
      );
    }
    const [a, b] = references.map((r) => Number(r.split("-")[2]));
    expect(b).toBe((a ?? 0) + 1);
  });

  it("refuses a lapsed checkout, another shopper's, and a bad contact", async () => {
    const productId = await product();
    const { token, actor } = await guestCart([{ productId, quantity: 1 }]);
    const { checkoutId } = await startCheckout({ cartToken: token, locale: "nl" }, actor);

    // someone else's cookie, or none, cannot see it
    expect(
      (await codeOf(placeOrder({ cartToken: newCartToken(), checkoutId, contact }, guest()))).code,
    ).toBe("orders.checkout_not_found");
    expect((await codeOf(placeOrder({ checkoutId, contact }, customer()))).code).toBe(
      "orders.checkout_not_found",
    );
    expect(
      (
        await codeOf(
          placeOrder(
            { cartToken: token, checkoutId, contact: { ...contact, email: "not-an-email" } },
            actor,
          ),
        )
      ).code,
    ).toBe("kernel.validation_failed");

    kernel.clock.set(new Date(t0.getTime() + CHECKOUT_HOLD_MINUTES * MINUTE));
    expect((await codeOf(placeOrder({ cartToken: token, checkoutId, contact }, actor))).code).toBe(
      "orders.checkout_expired",
    );
  });

  it("a signed-in customer's order carries their id", async () => {
    const bob = customer();
    await setCartLine({ productId: await product(), quantity: 1 }, bob);
    const { checkoutId } = await startCheckout({ locale: "en" }, bob);
    const { orderId } = await placeOrder({ checkoutId, contact }, bob);
    const [order] = await iso.sql<{ customer_id: string; locale: string }[]>`
      SELECT customer_id, locale FROM orders.orders WHERE id = ${orderId}`;
    expect(order).toEqual({ customer_id: bob.id, locale: "en" });
  });
});

describe("reading a checkout and an order (owner only)", () => {
  it("shows the owner the checkout, then the order placed from it; anyone else gets not_found", async () => {
    const medicine = await product({ medicine: true, priceCents: 450 });
    const { token, actor } = await guestCart([{ productId: medicine, quantity: 1 }]);
    const { checkoutId } = await startCheckout({ cartToken: token, locale: "fr" }, actor);

    const view = await getCheckout({ cartToken: token, checkoutId }, actor);
    expect(view).toMatchObject({
      checkoutId,
      status: "open",
      locale: "fr",
      expired: false,
      needsReview: true,
      totalCents: 450,
      orderId: null,
    });
    expect(view.lines).toEqual([
      expect.objectContaining({
        productId: medicine,
        quantity: 1,
        unitPriceCents: 450,
        isMedicine: true,
      }),
    ]);

    const { orderId, reference } = await placeOrder(
      { cartToken: token, checkoutId, contact },
      actor,
    );
    expect((await getCheckout({ cartToken: token, checkoutId }, actor)).orderId).toBe(orderId);
    const order = await getOrder({ cartToken: token, orderId }, actor);
    expect(order).toMatchObject({
      orderId,
      reference,
      status: "pending_payment",
      needsReview: true,
      totalCents: 450,
      paymentStatus: "created",
    });
    // never the contact
    expect(JSON.stringify(order)).not.toContain("example.be");
    // a later payment attempt (a retry) is the one the order page shows
    await iso.sql`
      INSERT INTO orders.payments (id, order_id, provider, amount_cents, status, created_at, updated_at)
      VALUES (${randomUUID()}, ${orderId}, 'mollie', 450, 'open', now() + interval '1 minute', now() + interval '1 minute')`;
    expect((await getOrder({ cartToken: token, orderId }, actor)).paymentStatus).toBe("open");

    for (const [who, input] of [
      ["another guest", { cartToken: newCartToken() }],
      ["no cookie", {}],
    ] as const) {
      expect((await codeOf(getCheckout({ ...input, checkoutId }, guest()))).code, who).toBe(
        "orders.checkout_not_found",
      );
      expect((await codeOf(getOrder({ ...input, orderId }, guest()))).code, who).toBe(
        "orders.order_not_found",
      );
    }
    // a signed-in customer cannot read a guest's order either
    expect((await codeOf(getOrder({ orderId }, customer()))).code).toBe("orders.order_not_found");
  });

  it("a customer reads their own order, and says when the checkout's holds lapsed", async () => {
    const carol = customer();
    await setCartLine({ productId: await product(), quantity: 1 }, carol);
    const { checkoutId } = await startCheckout({ locale: "nl" }, carol);
    kernel.clock.set(new Date(t0.getTime() + CHECKOUT_HOLD_MINUTES * MINUTE));
    expect((await getCheckout({ checkoutId }, carol)).expired).toBe(true);
    expect((await codeOf(getCheckout({ checkoutId }, customer()))).code).toBe(
      "orders.checkout_not_found",
    );
  });
});
