// Home delivery on an order (igs-pharma#202, part 2) against real Postgres: the fee follows the
// staff's settings and the lines, it is part of the total and the payment, the address is kept apart,
// the database refuses an order whose parts do not add up, and the quote the storefront shows.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { isDomainError } from "@igs/kernel";
import { type KernelTestHandles, actors, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import {
  createProductRegulated,
  registerAuditActions as registerCatalogAudit,
  setProductStatusRegulated,
} from "@igs/module-catalog";
import { loadRbacCatalogue } from "@igs/module-identity";
import {
  receiveStock,
  registerAuditActions as registerInventoryAudit,
} from "@igs/module-inventory";
import { registerAuditActions as registerPricingAudit, setPrice } from "@igs/module-pricing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getDeliveryQuote,
  getOrder,
  getOrderForStaff,
  newCartToken,
  placeOrder,
  registerAuditActions,
  setCartLine,
  setDeliverySettings,
  startCheckout,
} from "../src";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;

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
beforeEach(async () => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date());
  await iso.sql`DELETE FROM orders.delivery_settings`;
});

const pharmacist = actors.user({ id: randomUUID(), roles: ["pharmacist"], kind: "staff" });
const owner = actors.user({ id: randomUUID(), roles: ["owner"], kind: "staff" });
/** The owner, with a passkey check from just now: needed to change the delivery settings. */
const freshOwner = () => ({ ...owner, passkeyCheckedAt: new Date() });
const guest = () => actors.anonymous();

const contact = { name: "Demo Klant", email: "demo@example.be", phone: "+32 470 12 34 56" };
const address = { street: "Demostraat 12 bus 3", postalCode: "1000", city: "Brussel" };

let nextCnk = 9_800_100;

async function product(priceCents: number): Promise<string> {
  const cnk = String(nextCnk++);
  const { productId } = await createProductRegulated(
    {
      cnk,
      productType: "medical_device",
      legalStatus: "general_sale",
      vatClass: "BE_21",
      approveContent: true,
      content: [
        { locale: "nl", name: `Product ${cnk}` },
        { locale: "fr", name: `Produit ${cnk}` },
      ],
    },
    pharmacist,
  );
  await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
  await receiveStock({ productId, quantity: 50 }, owner);
  await setPrice({ productId, amountCents: priceCents }, owner);
  return productId;
}

/** A guest's started checkout worth `unitCents × quantity`. */
async function checkoutWorth(unitCents: number, quantity = 1) {
  const productId = await product(unitCents);
  const token = newCartToken();
  const actor = guest();
  await setCartLine({ cartToken: token, productId, quantity }, actor);
  const started = await startCheckout({ cartToken: token, locale: "nl" }, actor);
  return { token, actor, checkoutId: started.checkoutId, itemsCents: started.totalCents };
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

const orderRow = (orderId: string) =>
  iso.sql<
    {
      total_cents: number;
      vat_cents: number;
      delivery_method: string;
      delivery_fee_cents: number;
      delivery_vat_cents: number;
      amount_cents: number;
    }[]
  >`
    SELECT o.total_cents, o.vat_cents, o.delivery_method, o.delivery_fee_cents, o.delivery_vat_cents,
           p.amount_cents
    FROM orders.orders o JOIN orders.payments p ON p.order_id = o.id WHERE o.id = ${orderId}`;

describe("a pickup order is unchanged", () => {
  it("costs only its lines, has no address and a payment of the same amount", async () => {
    const { token, actor, checkoutId, itemsCents } = await checkoutWorth(1_000, 2);
    const { orderId } = await placeOrder({ cartToken: token, checkoutId, contact }, actor);
    expect(await orderRow(orderId)).toEqual([
      expect.objectContaining({
        total_cents: itemsCents,
        delivery_method: "pickup",
        delivery_fee_cents: 0,
        delivery_vat_cents: 0,
        amount_cents: itemsCents,
      }),
    ]);
    const [row0] = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM orders.order_addresses WHERE order_id = ${orderId}`;
    const { n } = row0 ?? { n: -1 };
    expect(n).toBe(0);
    const view = await getOrder({ cartToken: token, orderId }, actor);
    expect(view).toMatchObject({
      deliveryMethod: "pickup",
      deliveryFeeCents: 0,
      deliveryAddress: null,
    });
  });
});

describe("a delivery order", () => {
  it("adds the staff's price (default 4.95) to the total, the VAT and the payment", async () => {
    const { token, actor, checkoutId, itemsCents } = await checkoutWorth(1_000); // 10.00 < 49.00
    const { orderId } = await placeOrder(
      { cartToken: token, checkoutId, contact, delivery: { method: "delivery", address } },
      actor,
    );
    const [row] = await orderRow(orderId);
    // 495 including 21 % VAT: 495 × 21 / 121 = 85.9 → 86
    expect(row).toMatchObject({
      total_cents: itemsCents + 495,
      delivery_method: "delivery",
      delivery_fee_cents: 495,
      delivery_vat_cents: 86,
      amount_cents: itemsCents + 495,
    });
    const [row0] = await iso.sql<{ lines_vat: number }[]>`
      SELECT sum(vat_cents)::int AS lines_vat FROM orders.order_lines WHERE order_id = ${orderId}`;
    const { lines_vat } = row0 ?? { lines_vat: -1 };
    expect(row?.vat_cents).toBe(lines_vat + 86);
  });

  it("keeps the address apart and shows it to its owner and to staff, not to another shopper", async () => {
    const { token, actor, checkoutId } = await checkoutWorth(1_000);
    const { orderId } = await placeOrder(
      { cartToken: token, checkoutId, contact, delivery: { method: "delivery", address } },
      actor,
    );
    const mine = await getOrder({ cartToken: token, orderId }, actor);
    expect(mine).toMatchObject({
      deliveryMethod: "delivery",
      deliveryFeeCents: 495,
      deliveryAddress: { ...address, country: "BE" },
    });
    const staff = await getOrderForStaff({ orderId }, owner);
    expect(staff).toMatchObject({
      deliveryMethod: "delivery",
      deliveryFeeCents: 495,
      deliveryAddress: { ...address, country: "BE" },
    });
    // someone else's cart cookie opens nothing
    expect(await codeOf(getOrder({ cartToken: newCartToken(), orderId }, guest()))).toBe(
      "orders.order_not_found",
    );
  });

  it("is free exactly AT the free-delivery value and above it, paid just below it", async () => {
    await setDeliverySettings({ priceCents: 595, freeFromCents: 2_000 }, freshOwner());
    const below = await checkoutWorth(1_999);
    const at = await checkoutWorth(2_000);
    const above = await checkoutWorth(1_000, 3);
    const fees: number[] = [];
    for (const c of [below, at, above]) {
      const { orderId } = await placeOrder(
        {
          cartToken: c.token,
          checkoutId: c.checkoutId,
          contact,
          delivery: { method: "delivery", address },
        },
        c.actor,
      );
      fees.push((await orderRow(orderId))[0]?.delivery_fee_cents ?? -1);
    }
    expect(fees).toEqual([595, 0, 0]);
  });

  it("is never free when staff leave the free-delivery value empty", async () => {
    await setDeliverySettings({ priceCents: 395, freeFromCents: null }, freshOwner());
    const { token, actor, checkoutId } = await checkoutWorth(50_000);
    const { orderId } = await placeOrder(
      { cartToken: token, checkoutId, contact, delivery: { method: "delivery", address } },
      actor,
    );
    expect((await orderRow(orderId))[0]?.delivery_fee_cents).toBe(395);
  });

  it("a change applies to the next order; a placed order keeps what it was charged", async () => {
    const first = await checkoutWorth(1_000);
    const a = await placeOrder(
      {
        cartToken: first.token,
        checkoutId: first.checkoutId,
        contact,
        delivery: { method: "delivery", address },
      },
      first.actor,
    );
    await setDeliverySettings({ priceCents: 795, freeFromCents: 9_900 }, freshOwner());
    const second = await checkoutWorth(1_000);
    const b = await placeOrder(
      {
        cartToken: second.token,
        checkoutId: second.checkoutId,
        contact,
        delivery: { method: "delivery", address },
      },
      second.actor,
    );
    expect((await orderRow(a.orderId))[0]?.delivery_fee_cents).toBe(495);
    expect((await orderRow(b.orderId))[0]?.delivery_fee_cents).toBe(795);
  });

  it("refuses to charge a fee other than the one the shopper was shown, and creates nothing", async () => {
    const { token, actor, checkoutId } = await checkoutWorth(1_000);
    const [before] = await iso.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM orders.orders`;
    // staff raise the price after the page was shown with 4.95
    await setDeliverySettings({ priceCents: 795, freeFromCents: 9_900 }, freshOwner());
    const input = (expectedFeeCents: number) => ({
      cartToken: token,
      checkoutId,
      contact,
      delivery: { method: "delivery" as const, address, expectedFeeCents },
    });
    expect(await codeOf(placeOrder(input(495), actor))).toBe("orders.delivery_fee_changed");
    const [after] = await iso.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM orders.orders`;
    expect(after?.n).toBe(before?.n);
    // confirming the new fee works
    const placed = await placeOrder(input(795), actor);
    expect((await orderRow(placed.orderId))[0]?.delivery_fee_cents).toBe(795);
  });

  it("placing the same checkout again returns the same order, one address, one payment", async () => {
    const { token, actor, checkoutId } = await checkoutWorth(1_000);
    const input = {
      cartToken: token,
      checkoutId,
      contact,
      delivery: { method: "delivery" as const, address },
    };
    const first = await placeOrder(input, actor);
    const again = await placeOrder(input, actor);
    expect(again.orderId).toBe(first.orderId);
    const [row0] = await iso.sql<{ addresses: number; payments: number }[]>`
      SELECT (SELECT count(*) FROM orders.order_addresses WHERE order_id = ${first.orderId})::int AS addresses,
             (SELECT count(*) FROM orders.payments WHERE order_id = ${first.orderId})::int AS payments`;
    const { addresses, payments } = row0 ?? { addresses: -1, payments: -1 };
    expect({ addresses, payments }).toEqual({ addresses: 1, payments: 1 });
  });

  it("refuses a bad address and creates nothing", async () => {
    const { token, actor, checkoutId } = await checkoutWorth(1_000);
    const [row0] = await iso.sql<{ before: number }[]>`
      SELECT count(*)::int AS before FROM orders.orders`;
    const { before } = row0 ?? { before: -1 };
    for (const bad of [
      { ...address, postalCode: "0123" },
      { ...address, postalCode: "12345" },
      { ...address, postalCode: "abcd" },
      { ...address, street: "   " },
      { ...address, city: "" },
      { ...address, street: "x".repeat(121) },
    ]) {
      expect(
        await codeOf(
          placeOrder(
            {
              cartToken: token,
              checkoutId,
              contact,
              delivery: { method: "delivery", address: bad },
            },
            actor,
          ),
        ),
        JSON.stringify(bad),
      ).toBe("kernel.validation_failed");
    }
    const [after] = await iso.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM orders.orders`;
    const { n } = after ?? { n: -1 };
    expect(n).toBe(before);
  });

  it("audits the way, the fee and the total, never the address", async () => {
    const { token, actor, checkoutId } = await checkoutWorth(1_000);
    const { orderId } = await placeOrder(
      { cartToken: token, checkoutId, contact, delivery: { method: "delivery", address } },
      actor,
    );
    const events = await iso.sql<{ data: Record<string, unknown> }[]>`
      SELECT data FROM audit.events WHERE entity_id = ${orderId} AND action = 'orders.order.placed'`;
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({
      deliveryMethod: "delivery",
      deliveryFeeCents: 495,
      replay: false,
    });
    expect(JSON.stringify(events)).not.toContain("Demostraat");
    expect(JSON.stringify(events)).not.toContain("1000");
  });
});

describe("the database keeps an order's delivery consistent", () => {
  /** Inserts an order row by hand, with a line, to try the triggers. */
  async function insertOrder(over: Record<string, string | number>, withAddress = false) {
    const checkoutId = randomUUID();
    const orderId = randomUUID();
    const values = {
      total: 1_000,
      vat: 100,
      method: "pickup",
      fee: 0,
      feeVat: 0,
      ...over,
    };
    return iso.sql.begin(async (sql) => {
      await sql`
        INSERT INTO orders.orders (id, reference, checkout_id, locale, status, needs_review, currency,
          total_cents, vat_cents, delivery_method, delivery_fee_cents, delivery_vat_cents, version,
          created_by_type, created_by_id, updated_by_type, updated_by_id)
        VALUES (${orderId}, ${`IGS-2026-9${Math.floor(Math.random() * 99999)}`.padEnd(15, "0").slice(0, 15)},
          ${checkoutId}, 'nl', 'pending_payment', false, 'EUR', ${values.total}, ${values.vat},
          ${values.method}, ${values.fee}, ${values.feeVat}, 1, 'system', 'test', 'system', 'test')`;
      await sql`
        INSERT INTO orders.order_lines (id, order_id, product_id, cnk, name, is_medicine, vat_class,
          quantity, unit_price_cents, line_total_cents, vat_cents)
        VALUES (${randomUUID()}, ${orderId}, ${randomUUID()}, '9999999', 'x', false, 'BE_21', 1, 1000, 1000, 100)`;
      if (withAddress) {
        await sql`
          INSERT INTO orders.order_addresses (order_id, street, postal_code, city, country)
          VALUES (${orderId}, 'Demostraat 1', '1000', 'Brussel', 'BE')`;
      }
      return orderId;
    });
  }

  it("a pickup order with a delivery fee is refused", async () => {
    await expect(insertOrder({ total: 1_495, vat: 186, fee: 495, feeVat: 86 })).rejects.toThrow();
  });

  it("a delivery order without an address is refused", async () => {
    await expect(
      insertOrder({ method: "delivery", total: 1_495, vat: 186, fee: 495, feeVat: 86 }),
    ).rejects.toThrow(/delivery addresses/);
  });

  it("a total that is not the lines plus the fee is refused", async () => {
    await expect(
      insertOrder({ method: "delivery", total: 1_000, vat: 100, fee: 495, feeVat: 86 }, true),
    ).rejects.toThrow(/does not match its lines/);
  });

  it("a placed order's delivery fee cannot change afterwards", async () => {
    const { token, actor, checkoutId } = await checkoutWorth(1_000);
    const { orderId } = await placeOrder(
      { cartToken: token, checkoutId, contact, delivery: { method: "delivery", address } },
      actor,
    );
    await expect(
      iso.sql`UPDATE orders.orders SET delivery_fee_cents = 0, version = version + 1 WHERE id = ${orderId}`,
    ).rejects.toThrow(/keeps its/);
    await expect(
      iso.sql`UPDATE orders.order_addresses SET city = 'Elders' WHERE order_id = ${orderId}`,
    ).rejects.toThrow();
  });
});

describe("the quote the storefront shows", () => {
  it("is the defaults until staff set a value, free from 49.00", async () => {
    expect(await getDeliveryQuote({ itemsTotalCents: 0 }, guest())).toEqual({
      feeCents: 495,
      vatCents: 86,
      isFree: false,
      freeFromCents: 4_900,
      missingCents: 4_900,
      priceCents: 495,
    });
    expect(await getDeliveryQuote({ itemsTotalCents: 3_000 }, guest())).toMatchObject({
      feeCents: 495,
      missingCents: 1_900,
    });
  });

  it("says free exactly at the value, and follows the staff's change at once", async () => {
    expect(await getDeliveryQuote({ itemsTotalCents: 4_900 }, guest())).toMatchObject({
      feeCents: 0,
      isFree: true,
      missingCents: null,
    });
    await setDeliverySettings({ priceCents: 695, freeFromCents: null }, freshOwner());
    expect(await getDeliveryQuote({ itemsTotalCents: 99_999 }, guest())).toEqual({
      feeCents: 695,
      vatCents: 121,
      isFree: false,
      freeFromCents: null,
      missingCents: null,
      priceCents: 695,
    });
  });

  it("refuses a negative or absurd basket value", async () => {
    expect(await codeOf(getDeliveryQuote({ itemsTotalCents: -1 }, guest()))).toBe(
      "kernel.validation_failed",
    );
    expect(await codeOf(getDeliveryQuote({ itemsTotalCents: 1.5 }, guest()))).toBe(
      "kernel.validation_failed",
    );
  });
});
