// The shopping cart (igs-pharma#116, D-045 step 1) against real Postgres, with the RBAC catalogue
// loaded from the database and the real audit port: guest carts by cookie, the per-order limits,
// sellability, expiry, and attaching a guest cart to a customer at sign-in.
import { randomUUID } from "node:crypto";

import { sha256Hex } from "@igs/crypto";
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CART_MAX_LINES,
  CART_TTL_DAYS,
  MAX_PER_ORDER_MEDICINE,
  MAX_PER_ORDER_OTHER,
  attachCart,
  getCart,
  newCartToken,
  registerAuditActions,
  setCartLine,
} from "../src";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;
let t0: Date;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerCatalogAudit(registerAuditAction);
  registerAuditActions(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  t0 = new Date();
  kernel.clock.set(t0); // audit partitions exist around "now"
});

const DAY = 86_400_000;

const pharmacist = actors.user({ id: randomUUID(), roles: ["pharmacist"], kind: "staff" });
const staff = actors.user({ id: randomUUID(), roles: ["owner"], kind: "staff" });
const guest = () => actors.anonymous();
const customer = (): Actor =>
  actors.user({ id: randomUUID(), roles: ["customer"], kind: "customer" });

let nextCnk = 9_800_100;

/** An ACTIVE, storefront-visible product: a medicine with approved text, or a care product. */
async function product(kind: "medicine" | "other" = "other"): Promise<string> {
  const cnk = String(nextCnk++);
  const medicine = kind === "medicine";
  const { productId } = await createProductRegulated(
    {
      cnk,
      productType: medicine ? "otc_medicine" : "medical_device",
      legalStatus: medicine ? "otc" : "general_sale",
      vatClass: medicine ? "BE_6" : "BE_21",
      approveContent: true,
      content: [
        { locale: "nl", name: `Demo ${cnk}` },
        { locale: "fr", name: `Demo ${cnk} FR` },
      ],
    },
    pharmacist,
  );
  await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
  return productId;
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

const auditOf = (cartId: string) =>
  iso.sql<{ action: string; actor_type: string; data: Record<string, unknown> }[]>`
    SELECT action, actor_type, data FROM audit.events WHERE entity_id = ${cartId} ORDER BY at, id`;

const cartRow = (cartId: string) =>
  iso.sql<{ token_hash: string | null; customer_id: string | null; expires_at: string }[]>`
    SELECT token_hash, customer_id, expires_at FROM orders.carts WHERE id = ${cartId}`;

describe("a guest's cart", () => {
  it("is opened by its cookie, stores only the cookie's hash, and audits as anonymous", async () => {
    const productId = await product();
    const token = newCartToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const set = await setCartLine({ cartToken: token, productId, quantity: 3 }, guest());
    expect(set).toMatchObject({ productId, quantity: 3, lineCount: 1 });
    const cartId = set.cartId as string;

    expect(await getCart({ cartToken: token }, guest())).toEqual({
      cartId,
      lines: [{ productId, quantity: 3, sellable: true, maxQuantity: MAX_PER_ORDER_OTHER }],
      maxLines: CART_MAX_LINES,
    });
    const [row] = await cartRow(cartId);
    expect(row).toMatchObject({ token_hash: sha256Hex(token), customer_id: null });
    expect(new Date(row?.expires_at ?? 0).getTime()).toBe(t0.getTime() + CART_TTL_DAYS * DAY);
    expect(await auditOf(cartId)).toEqual([
      {
        action: "orders.cart.line_set",
        actor_type: "anonymous",
        data: { cartId, productId, quantity: 3 },
      },
    ]);

    // another cookie is another cart; no cookie is an empty cart
    expect((await getCart({ cartToken: newCartToken() }, guest())).lines).toEqual([]);
    expect(await getCart({}, guest())).toMatchObject({ cartId: null, lines: [] });
  });

  it("needs a cookie to change, and rejects a malformed one", async () => {
    const productId = await product();
    expect(await codeOf(setCartLine({ productId, quantity: 1 }, guest()))).toBe(
      "orders.cart_token_required",
    );
    expect(await codeOf(setCartLine({ cartToken: "short", productId, quantity: 1 }, guest()))).toBe(
      "kernel.validation_failed",
    );
  });

  it("changes a quantity, removes a line with 0, and audits only real changes", async () => {
    const [a, b] = [await product(), await product()];
    const token = newCartToken();
    const { cartId } = await setCartLine({ cartToken: token, productId: a, quantity: 1 }, guest());
    await setCartLine({ cartToken: token, productId: b, quantity: 2 }, guest());
    // the same quantity again changes nothing
    expect(
      await setCartLine({ cartToken: token, productId: b, quantity: 2 }, guest()),
    ).toMatchObject({ lineCount: 2 });
    await setCartLine({ cartToken: token, productId: a, quantity: 4 }, guest());
    expect(
      await setCartLine({ cartToken: token, productId: b, quantity: 0 }, guest()),
    ).toMatchObject({ quantity: 0, lineCount: 1 });
    // removing what is not there changes nothing either
    await setCartLine({ cartToken: token, productId: b, quantity: 0 }, guest());

    expect((await getCart({ cartToken: token }, guest())).lines).toEqual([
      { productId: a, quantity: 4, sellable: true, maxQuantity: MAX_PER_ORDER_OTHER },
    ]);
    expect((await auditOf(cartId as string)).map((e) => e.data["quantity"])).toEqual([1, 2, 4, 0]);
  });

  it("holds at most two packs of a medicine and ten of anything else (O-3)", async () => {
    const [medicine, other] = [await product("medicine"), await product()];
    const token = newCartToken();
    expect(
      await codeOf(
        setCartLine(
          { cartToken: token, productId: medicine, quantity: MAX_PER_ORDER_MEDICINE + 1 },
          guest(),
        ),
      ),
    ).toBe("orders.cart_quantity_limit");
    await setCartLine({ cartToken: token, productId: medicine, quantity: 2 }, guest());
    expect(
      await codeOf(
        setCartLine(
          { cartToken: token, productId: other, quantity: MAX_PER_ORDER_OTHER + 1 },
          guest(),
        ),
      ),
    ).toBe("orders.cart_quantity_limit");
    expect((await getCart({ cartToken: token }, guest())).lines).toEqual([
      { productId: medicine, quantity: 2, sellable: true, maxQuantity: MAX_PER_ORDER_MEDICINE },
    ]);
  });

  it("takes only sellable products, and marks a line whose product stopped being sellable", async () => {
    const productId = await product();
    const token = newCartToken();
    // unknown and not-yet-active products look the same
    expect(
      await codeOf(
        setCartLine({ cartToken: token, productId: randomUUID(), quantity: 1 }, guest()),
      ),
    ).toBe("catalog.product_not_sellable");

    await setCartLine({ cartToken: token, productId, quantity: 1 }, guest());
    await setProductStatusRegulated({ productId, status: "archived" }, pharmacist);
    expect((await getCart({ cartToken: token }, guest())).lines).toEqual([
      { productId, quantity: 1, sellable: false, maxQuantity: null },
    ]);
    // it can no longer be raised, but it can be removed
    expect(await codeOf(setCartLine({ cartToken: token, productId, quantity: 2 }, guest()))).toBe(
      "catalog.product_not_sellable",
    );
    expect(await setCartLine({ cartToken: token, productId, quantity: 0 }, guest())).toMatchObject({
      lineCount: 0,
    });
  });

  it(`holds at most ${CART_MAX_LINES} lines`, async () => {
    const token = newCartToken();
    const { cartId } = await setCartLine(
      { cartToken: token, productId: await product(), quantity: 1 },
      guest(),
    );
    for (let i = 1; i < CART_MAX_LINES; i++) {
      await iso.sql`
        INSERT INTO orders.cart_lines (cart_id, product_id, quantity) VALUES (${cartId as string}, ${randomUUID()}, 1)`;
    }
    const extra = await product();
    expect(
      await codeOf(setCartLine({ cartToken: token, productId: extra, quantity: 1 }, guest())),
    ).toBe("orders.cart_full");
    // a line already in the cart can still change
    const [first] = (await getCart({ cartToken: token }, guest())).lines;
    expect(
      await codeOf(
        setCartLine(
          { cartToken: token, productId: first?.productId as string, quantity: 2 },
          guest(),
        ),
      ),
    ).toBe("ok");
  });

  it(`is gone ${CART_TTL_DAYS} days after its last change`, async () => {
    const productId = await product();
    const token = newCartToken();
    const { cartId } = await setCartLine({ cartToken: token, productId, quantity: 1 }, guest());
    kernel.clock.set(new Date(t0.getTime() + (CART_TTL_DAYS - 1) * DAY));
    // a change keeps it another 30 days
    await setCartLine({ cartToken: token, productId, quantity: 2 }, guest());
    kernel.clock.set(new Date(t0.getTime() + (2 * CART_TTL_DAYS - 1) * DAY - 1));
    expect((await getCart({ cartToken: token }, guest())).cartId).toBe(cartId);

    kernel.clock.set(new Date(t0.getTime() + (2 * CART_TTL_DAYS - 1) * DAY));
    expect(await getCart({ cartToken: token }, guest())).toMatchObject({ cartId: null, lines: [] });
    // the next change starts a new cart; the expired one is deleted on the way
    const fresh = await setCartLine({ cartToken: token, productId, quantity: 1 }, guest());
    expect(fresh.cartId).not.toBe(cartId);
    expect(await cartRow(cartId as string)).toEqual([]);
  });
});

describe("a customer's cart", () => {
  it("is their own whatever the cookie says", async () => {
    const productId = await product();
    const alice = customer();
    const { cartId } = await setCartLine({ productId, quantity: 1 }, alice);
    expect(await cartRow(cartId as string)).toEqual([
      expect.objectContaining({ token_hash: null, customer_id: alice.id }),
    ]);
    expect((await getCart({ cartToken: newCartToken() }, alice)).cartId).toBe(cartId);
    // another customer sees their own (empty) cart, not Alice's
    expect((await getCart({}, customer())).lines).toEqual([]);
  });

  it("a guest cart attached at sign-in becomes the customer's, and the cookie opens nothing after", async () => {
    const productId = await product();
    const token = newCartToken();
    const { cartId } = await setCartLine({ cartToken: token, productId, quantity: 2 }, guest());
    const bob = customer();

    expect(await attachCart({ cartToken: token }, bob)).toEqual({ cartId, lineCount: 1 });
    expect(await cartRow(cartId as string)).toEqual([
      expect.objectContaining({ token_hash: null, customer_id: bob.id }),
    ]);
    expect((await getCart({}, bob)).lines).toEqual([
      { productId, quantity: 2, sellable: true, maxQuantity: MAX_PER_ORDER_OTHER },
    ]);
    // signed out again, the old cookie opens an empty cart
    expect((await getCart({ cartToken: token }, guest())).lines).toEqual([]);
    expect((await auditOf(cartId as string)).at(-1)).toEqual({
      action: "orders.cart.attached",
      actor_type: "user",
      data: { cartId, merged: 1, dropped: 0 },
    });
    // attaching again (a second tab) changes nothing
    expect(await attachCart({ cartToken: token }, bob)).toEqual({ cartId, lineCount: 1 });
  });

  it("merges into the cart the customer already has: quantities add up to the limit, unsellable lines drop", async () => {
    const [medicine, other, gone, fresh] = [
      await product("medicine"),
      await product(),
      await product(),
      await product(),
    ];
    const carol = customer();
    const own = await setCartLine({ productId: medicine, quantity: 2 }, carol);
    await setCartLine({ productId: other, quantity: 4 }, carol);

    const token = newCartToken();
    const guestCart = await setCartLine(
      { cartToken: token, productId: medicine, quantity: 1 },
      guest(),
    );
    await setCartLine({ cartToken: token, productId: other, quantity: 3 }, guest());
    await setCartLine({ cartToken: token, productId: gone, quantity: 1 }, guest());
    await setCartLine({ cartToken: token, productId: fresh, quantity: 1 }, guest());
    await setProductStatusRegulated({ productId: gone, status: "archived" }, pharmacist);

    expect(await attachCart({ cartToken: token }, carol)).toEqual({
      cartId: own.cartId,
      lineCount: 3,
    });
    const lines = new Map(
      (await getCart({}, carol)).lines.map((line) => [line.productId, line.quantity]),
    );
    expect(Object.fromEntries(lines)).toEqual({
      [medicine]: MAX_PER_ORDER_MEDICINE, // 2 + 1, capped
      [other]: 7,
      [fresh]: 1,
    });
    expect(await cartRow(guestCart.cartId as string)).toEqual([]);
    expect((await auditOf(own.cartId as string)).at(-1)?.data).toEqual({
      cartId: own.cartId,
      merged: 3,
      dropped: 1,
    });
  });

  it("only a customer may attach a cart", async () => {
    const token = newCartToken();
    await setCartLine({ cartToken: token, productId: await product(), quantity: 1 }, guest());
    expect(await codeOf(attachCart({ cartToken: token }, guest()))).toBe("kernel.forbidden");
    expect(await codeOf(attachCart({ cartToken: token }, staff))).toBe("kernel.forbidden");
    // a cookie without a cart attaches nothing
    expect(await attachCart({ cartToken: newCartToken() }, customer())).toEqual({
      cartId: null,
      lineCount: 0,
    });
  });
});
