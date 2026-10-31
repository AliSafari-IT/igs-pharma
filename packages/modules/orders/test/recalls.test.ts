// Recalls, part 2 (igs-pharma#189, REQ-SAF-01) against real Postgres: the orders a recall affects,
// the notice to their customers (no product in the mail), and no end while an order is open or a
// collected one was never told.
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
  configureRecallEndGuard,
  endRecall,
  receiveStock,
  registerAuditActions as registerInventoryAudit,
  startRecall,
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
  getOrderForStaff,
  listRecallAffectedOrders,
  newCartToken,
  placeOrder,
  recallEndGuard,
  registerAuditActions,
  requestRecallNotices,
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
  configureRecallEndGuard(recallEndGuard);
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
const assistant = actors.user({ id: randomUUID(), roles: ["pharmacy_assistant"], kind: "staff" });
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

let nextCnk = 9_720_100;

/** An active care product with 10 units in its "no lot" lot, priced; returns its id and that lot. */
async function product(): Promise<{ productId: string; noLot: string }> {
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
  const { lotId } = await receiveStock({ productId, quantity: 10 }, owner);
  await setPrice({ productId, amountCents: 1_000 }, owner);
  return { productId, noLot: lotId };
}

/** A guest order for 2 units of the product, paid. */
async function paidOrder(productId: string) {
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
  return orderId;
}

const versionOf = async (orderId: string) => (await getOrderForStaff({ orderId }, owner)).version;

async function collect(orderId: string) {
  let version = await versionOf(orderId);
  for (const to of ["preparing", "ready_for_pickup", "collected"] as const) {
    ({ version } = await advanceOrder({ orderId, to, expectedVersion: version }, assistant));
  }
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

const notices = (orderId: string) =>
  iso.sql<{ kind: string; status: string }[]>`
    SELECT kind, status FROM orders.order_mails WHERE order_id = ${orderId} AND kind = 'recall_notice'`;

describe("a recall of every lot", () => {
  it("lists every order of the product; ends only once they are closed and the collected ones told", async () => {
    const { productId } = await product();
    const collected = await paidOrder(productId);
    await collect(collected);
    const open = await paidOrder(productId);

    const { recallId } = await startRecall(
      { productId, source: "manufacturer", note: "Batch problem" },
      pharmacist,
    );
    const affected = await listRecallAffectedOrders({ recallId }, assistant);
    expect(
      affected.map((order) => [order.orderId, order.status, order.paid, order.notice]),
    ).toEqual([
      [collected, "collected", true, "none"],
      [open, "ready_to_prepare", true, "none"],
    ]);
    expect(affected[0]).toMatchObject({
      contactName: "Demo Klant",
      contactEmail: "demo@example.be",
    });

    // an open order blocks the end; the stop-sale makes it cancellable (and refunded) at once (#182)
    expect(await codeOf(endRecall({ recallId }, pharmacist))).toBe("orders.recall_orders_open");
    await cancelNotSellableOrder(
      { orderId: open, expectedVersion: await versionOf(open), note: "Recalled" },
      owner,
    );
    // a collected order whose customer was never told blocks it too
    expect(await codeOf(endRecall({ recallId }, pharmacist))).toBe("orders.recall_notices_missing");

    // the notice: a pharmacist's act, one per paid order, never twice
    expect(await codeOf(requestRecallNotices({ recallId }, owner))).toBe("kernel.forbidden");
    expect(await requestRecallNotices({ recallId }, pharmacist)).toEqual({
      requested: 2,
      affected: 2,
    });
    expect(await requestRecallNotices({ recallId }, pharmacist)).toEqual({
      requested: 0,
      affected: 2,
    });
    expect(await notices(collected)).toEqual([{ kind: "recall_notice", status: "pending" }]);
    expect((await listRecallAffectedOrders({ recallId }, assistant))[0]?.notice).toBe("pending");

    const [audit] = await iso.sql<{ data: Record<string, unknown> }[]>`
      SELECT data FROM audit.events WHERE action = 'orders.recall.notices_requested'
      AND entity_id = ${productId} ORDER BY seq LIMIT 1`;
    expect(audit?.data).toEqual({ recallId, productId, requested: 2, affected: 2 });

    expect(await codeOf(endRecall({ recallId }, pharmacist))).toBe("ok");
  });
});

describe("a recall of chosen lots", () => {
  it("affects only the orders picked from those lots", async () => {
    const { productId, noLot } = await product();
    // a lot that expires first: orders are picked from it (FEFO)
    const { lotId: early } = await receiveStock(
      { productId, quantity: 5, lotNumber: "EARLY-1", expiryDate: "2098-01-01" },
      owner,
    );
    const orderId = await paidOrder(productId);

    const other = await startRecall(
      { productId, lotIds: [noLot], source: "pharmacy", note: "x" },
      pharmacist,
    );
    expect(await listRecallAffectedOrders({ recallId: other.recallId }, assistant)).toEqual([]);
    // nothing affected: it ends at once
    await endRecall({ recallId: other.recallId }, pharmacist);

    const picked = await startRecall(
      { productId, lotIds: [early], source: "famhp", note: "x" },
      pharmacist,
    );
    expect(
      (await listRecallAffectedOrders({ recallId: picked.recallId }, assistant)).map(
        (order) => order.orderId,
      ),
    ).toEqual([orderId]);
  });
});

describe("the recall notice mail", () => {
  it("is refused by the database for an order that was never paid", async () => {
    const { productId } = await product();
    const token = newCartToken();
    const guest = actors.anonymous();
    await setCartLine({ cartToken: token, productId, quantity: 1 }, guest);
    const { checkoutId } = await startCheckout({ cartToken: token, locale: "nl" }, guest);
    const { orderId } = await placeOrder({ cartToken: token, checkoutId, contact }, guest);
    await expect(
      iso.sql`INSERT INTO orders.order_mails (id, order_id, kind) VALUES (${randomUUID()}, ${orderId}, 'recall_notice')`,
    ).rejects.toThrow(/not in the state/);
  });
});
