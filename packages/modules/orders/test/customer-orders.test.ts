// The customer's own orders and the order status link, against real Postgres.
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
  getOrder,
  listOwnOrders,
  newCartToken,
  placeOrder,
  registerAuditActions,
  setCartLine,
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
beforeEach(() => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date());
});

const pharmacist = actors.user({ id: randomUUID(), roles: ["pharmacist"], kind: "staff" });
const owner = actors.user({ id: randomUUID(), roles: ["owner"], kind: "staff" });
const contact = { name: "Demo Klant", email: "demo@example.be", phone: "+32470123456" };

let nextCnk = 9_800_100;

async function product(medicine: boolean): Promise<string> {
  const cnk = String(nextCnk++);
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
  await receiveStock(
    {
      productId,
      quantity: 10,
      ...(medicine ? { lotNumber: "T-1", expiryDate: "2099-12-31" } : {}),
    },
    owner,
  );
  await setPrice({ productId, amountCents: 1_000 }, owner);
  return productId;
}

const customer = () => actors.user({ id: randomUUID(), roles: ["customer"], kind: "customer" });

/** An order placed by `actor` (a guest with `token`, or a customer). */
async function placed(actor = actors.anonymous(), token: string | undefined = newCartToken()) {
  const productId = await product(false);
  await setCartLine({ cartToken: token, productId, quantity: 1 }, actor);
  const { checkoutId } = await startCheckout({ cartToken: token, locale: "nl" }, actor);
  return {
    token,
    checkoutId,
    ...(await placeOrder({ cartToken: token, checkoutId, contact }, actor)),
  };
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

describe("the status link", () => {
  it("opens the order without the cart cookie; only the hash is stored; a replay returns no token", async () => {
    const { orderId, statusToken, token, checkoutId } = await placed();
    expect(statusToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const stranger = actors.anonymous();
    const view = await getOrder({ orderId, statusToken: statusToken as string }, stranger);
    expect(view.orderId).toBe(orderId);
    const [row] = await iso.sql<{ status_token_hash: string }[]>`
      SELECT status_token_hash FROM orders.orders WHERE id = ${orderId}`;
    expect(row?.status_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.status_token_hash).not.toContain(statusToken as string);

    const again = await placeOrder({ cartToken: token, checkoutId, contact }, actors.anonymous());
    expect(again).toMatchObject({ orderId, statusToken: null });
  });

  it("a wrong token, or none, is the same not-found", async () => {
    const { orderId } = await placed();
    const stranger = actors.anonymous();
    expect(await codeOf(getOrder({ orderId, statusToken: newCartToken() }, stranger))).toBe(
      "orders.order_not_found",
    );
    expect(await codeOf(getOrder({ orderId }, stranger))).toBe("orders.order_not_found");
    expect(await codeOf(getOrder({ orderId, cartToken: newCartToken() }, stranger))).toBe(
      "orders.order_not_found",
    );
  });
});

describe("my orders", () => {
  it("lists only the customer's own orders, newest first", async () => {
    const alice = customer();
    const first = await placed(alice, undefined);
    kernel.clock.set(new Date(Date.now() + 60_000));
    const second = await placed(alice, undefined);
    await placed(customer(), undefined);
    await placed();

    const page = await listOwnOrders({}, alice);
    expect(page.items.map((o) => o.orderId)).toEqual([second.orderId, first.orderId]);
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({ status: "pending_payment", paymentStatus: "created" });
  });

  it("is for signed-in customers only", async () => {
    expect(await codeOf(listOwnOrders({}, actors.anonymous()))).toBe("kernel.forbidden");
    expect(await codeOf(listOwnOrders({}, owner))).toBe("kernel.forbidden");
  });
});
