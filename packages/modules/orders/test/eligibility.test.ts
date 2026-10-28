// The eligibility recheck (milestone 5.1): a product that stops being sellable after it entered a
// checkout or an order is caught at every later step, against real Postgres.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { isDomainError, registerEvents } from "@igs/kernel";
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
  OrderMailRequested,
  type PaymentProvider,
  type ProviderPaymentView,
  RefundRequested,
  advanceOrder,
  cancelNotSellableOrder,
  decideReview,
  getOrderForStaff,
  newCartToken,
  placeOrder,
  registerAuditActions,
  setCartLine,
  startCheckout,
  startPayment,
  syncPayment,
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
  registerEvents(RefundRequested, OrderMailRequested);
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
const urls = { storefrontUrl: "https://shop.example" };

function fakeProvider(): PaymentProvider & { pay(id: string): void } {
  const made = new Map<string, ProviderPaymentView>();
  return {
    async createPayment(input) {
      const id = `tr_ful${made.size + 1}x${randomUUID().slice(0, 6)}`;
      const payment = {
        id,
        status: "open",
        amountCents: input.amountCents,
        currency: "EUR",
        checkoutUrl: `https://pay.example/${id}`,
      };
      made.set(id, payment);
      return payment;
    },
    async getPayment(id) {
      const payment = made.get(id);
      if (!payment) throw new Error("not found");
      return payment;
    },
    pay(id) {
      const payment = made.get(id);
      if (payment) made.set(id, { ...payment, status: "paid" });
    },
  };
}

let nextCnk = 9_710_100;

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

/** A guest order for 2 units, paid. */
async function paidOrder(medicine: boolean) {
  const productId = await product(medicine);
  const token = newCartToken();
  const guest = actors.anonymous();
  await setCartLine({ cartToken: token, productId, quantity: 2 }, guest);
  const { checkoutId } = await startCheckout({ cartToken: token, locale: "nl" }, guest);
  const { orderId } = await placeOrder({ cartToken: token, checkoutId, contact }, guest);
  const provider = fakeProvider();
  const url = await startPayment(orderId, provider, urls);
  const id = (url as string).split("/").at(-1) as string;
  provider.pay(id);
  await syncPayment(id, provider);
  return { productId, checkoutId, orderId };
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

const holds = (checkoutId: string) =>
  iso.sql<{ status: string }[]>`
    SELECT status FROM inventory.reservations WHERE holder_ref = ${`checkout:${checkoutId}`}`;

const versionOf = async (orderId: string) => (await getOrderForStaff({ orderId }, owner)).version;

/** The product stops being sellable (here: archived; prescription-only or unapproved text act alike). */
const stopSelling = (productId: string) =>
  setProductStatusRegulated({ productId, status: "archived" }, pharmacist);

/** Places a guest order for 2 units and returns how to pay it, without paying yet. */
async function placedOrder(medicine: boolean) {
  const productId = await product(medicine);
  const token = newCartToken();
  const guest = actors.anonymous();
  await setCartLine({ cartToken: token, productId, quantity: 2 }, guest);
  const { checkoutId } = await startCheckout({ cartToken: token, locale: "nl" }, guest);
  const { orderId } = await placeOrder({ cartToken: token, checkoutId, contact }, guest);
  const provider = fakeProvider();
  const id = ((await startPayment(orderId, provider, urls)) as string).split("/").at(-1) as string;
  const pay = async () => {
    provider.pay(id);
    await syncPayment(id, provider);
  };
  return { productId, checkoutId, orderId, pay };
}

describe("placing the order", () => {
  it("refuses a product that stopped being sellable after the checkout started", async () => {
    const productId = await product(false);
    const token = newCartToken();
    const guest = actors.anonymous();
    await setCartLine({ cartToken: token, productId, quantity: 1 }, guest);
    const { checkoutId } = await startCheckout({ cartToken: token, locale: "nl" }, guest);
    await stopSelling(productId);

    let details: unknown;
    try {
      await placeOrder({ cartToken: token, checkoutId, contact }, guest);
    } catch (error) {
      if (!isDomainError(error)) throw error;
      details = { code: error.code, ...error.details };
    }
    expect(details).toEqual({ code: "orders.checkout_unavailable", products: productId });
    const [orders] = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM orders.orders WHERE checkout_id = ${checkoutId}`;
    expect(orders?.n).toBe(0);
  });
});

describe("paid after the product stopped being sellable", () => {
  it("goes to the pharmacist instead of 'to prepare', even without a medicine", async () => {
    const { productId, orderId, pay } = await placedOrder(false);
    await stopSelling(productId);
    await pay();
    const view = await getOrderForStaff({ orderId }, owner);
    expect(view).toMatchObject({ status: "in_review", needsReview: false });
    expect(view.notSellable).toEqual([productId]);
  });

  it("the pharmacist cannot approve it, and rejecting it refunds it", async () => {
    const { productId, orderId, checkoutId, pay } = await placedOrder(true);
    await pay();
    await stopSelling(productId);
    expect(
      await codeOf(
        decideReview(
          { orderId, decision: "approved", expectedVersion: await versionOf(orderId) },
          pharmacist,
        ),
      ),
    ).toBe("orders.line_not_sellable");
    expect((await getOrderForStaff({ orderId }, owner)).status).toBe("in_review");

    await decideReview(
      { orderId, decision: "rejected", expectedVersion: await versionOf(orderId) },
      pharmacist,
    );
    const view = await getOrderForStaff({ orderId }, owner);
    expect(view).toMatchObject({ status: "cancelled", notSellable: [] });
    expect(view.refunds).toMatchObject([{ reason: "pharmacist_rejected" }]);
    expect((await holds(checkoutId)).map((row) => row.status)).toEqual(["released"]);
  });
});

describe("in fulfilment", () => {
  it("stops every step, and only the cancel with a refund is left", async () => {
    const { productId, orderId, checkoutId } = await paidOrder(false);
    expect(
      await codeOf(
        cancelNotSellableOrder({ orderId, expectedVersion: await versionOf(orderId) }, owner),
      ),
    ).toBe("orders.order_sellable");
    await advanceOrder(
      { orderId, to: "preparing", expectedVersion: await versionOf(orderId) },
      owner,
    );
    await stopSelling(productId);

    expect(
      await codeOf(
        advanceOrder(
          { orderId, to: "ready_for_pickup", expectedVersion: await versionOf(orderId) },
          owner,
        ),
      ),
    ).toBe("orders.line_not_sellable");
    expect((await getOrderForStaff({ orderId }, owner)).notSellable).toEqual([productId]);

    const result = await cancelNotSellableOrder(
      { orderId, expectedVersion: await versionOf(orderId), note: "Archived by the pharmacist" },
      owner,
    );
    expect(result.status).toBe("cancelled");
    const view = await getOrderForStaff({ orderId }, owner);
    expect(view.events.at(-1)).toMatchObject({ fromStatus: "preparing", toStatus: "cancelled" });
    expect(view.refunds).toMatchObject([{ reason: "not_sellable", status: "requested" }]);
    expect((await holds(checkoutId)).map((row) => row.status)).toEqual(["released"]);
  });

  it("a medicine order is cancelled by a pharmacist, not by the owner alone", async () => {
    const { productId, orderId } = await paidOrder(true);
    await decideReview(
      { orderId, decision: "approved", expectedVersion: await versionOf(orderId) },
      pharmacist,
    );
    await stopSelling(productId);
    expect(
      await codeOf(
        advanceOrder(
          { orderId, to: "preparing", expectedVersion: await versionOf(orderId) },
          owner,
        ),
      ),
    ).toBe("orders.line_not_sellable");
    expect(
      await codeOf(
        cancelNotSellableOrder({ orderId, expectedVersion: await versionOf(orderId) }, owner),
      ),
    ).toBe("orders.refund_needs_pharmacist");
    const result = await cancelNotSellableOrder(
      { orderId, expectedVersion: await versionOf(orderId) },
      pharmacist,
    );
    expect(result.status).toBe("cancelled");
  });

  it("cannot cancel an order in review or a closed one this way", async () => {
    const { productId, orderId, pay } = await placedOrder(false);
    await stopSelling(productId);
    await pay();
    expect(
      await codeOf(
        cancelNotSellableOrder({ orderId, expectedVersion: await versionOf(orderId) }, owner),
      ),
    ).toBe("orders.order_not_cancellable");
  });
});
