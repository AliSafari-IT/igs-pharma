// Customer order mails (igs-pharma#157): each tied to the state it reports, once, sent by the
// worker; on real Postgres.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { registerEvents } from "@igs/kernel";
import { type KernelTestHandles, actors, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import {
  createProductRegulated,
  registerAuditActions as registerCatalogAudit,
  setProductStatusRegulated,
} from "@igs/module-catalog";
import { loadRbacCatalogue } from "@igs/module-identity";
import { adjustStock, registerAuditActions as registerInventoryAudit } from "@igs/module-inventory";
import { registerAuditActions as registerPricingAudit, setPrice } from "@igs/module-pricing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CHECKOUT_HOLD_MINUTES,
  OrderMailRequested,
  type OrderMailToSend,
  type PaymentProvider,
  type ProviderPaymentView,
  type ProviderRefundView,
  type RefundProvider,
  RefundRequested,
  advanceOrder,
  decideReview,
  deliverOrderMail,
  executeRefund,
  getOrderForStaff,
  handleOrderMailJobs,
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
const urls = { storefrontUrl: "https://shop.example" };

function fakePayments(status = "paid"): PaymentProvider & { settle(id: string): void } {
  const made = new Map<string, ProviderPaymentView>();
  return {
    async createPayment(input) {
      const id = `tr_mail${made.size + 1}x${randomUUID().slice(0, 6)}`;
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
    settle(id) {
      const payment = made.get(id);
      if (payment) made.set(id, { ...payment, status });
    },
  };
}

const refunded: RefundProvider = {
  async createRefund(_paymentId, input): Promise<ProviderRefundView> {
    return {
      id: `re_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      status: "refunded",
      amountCents: input.amountCents,
      currency: "EUR",
      metadata: input.metadata,
    };
  },
  async getRefund() {
    throw new Error("unused");
  },
  async listRefunds() {
    return [];
  },
};

let nextCnk = 9_720_100;

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
  await adjustStock({ productId, delta: 10, reason: "adjustment", note: "seed" }, owner);
  await setPrice({ productId, amountCents: 1_250 }, owner);
  return productId;
}

/** A guest order; `pay`: the payment's outcome; `lapse`: the holds end before it is paid. */
async function order(
  medicine: boolean,
  { pay = "paid", lapse = false, email = "an@shop-customer.be", locale = "fr" } = {},
) {
  const productId = await product(medicine);
  const token = newCartToken();
  const guest = actors.anonymous();
  await setCartLine({ cartToken: token, productId, quantity: 1 }, guest);
  const { checkoutId } = await startCheckout({ cartToken: token, locale }, guest);
  const { orderId } = await placeOrder(
    { cartToken: token, checkoutId, contact: { name: "An", email, phone: "+32470123456" } },
    guest,
  );
  const provider = fakePayments(pay);
  const id = ((await startPayment(orderId, provider, urls)) as string).split("/").at(-1) as string;
  if (lapse) kernel.clock.set(new Date(Date.now() + (CHECKOUT_HOLD_MINUTES + 1) * 60_000));
  provider.settle(id);
  await syncPayment(id, provider);
  // a second webhook for the same payment
  await syncPayment(id, provider);
  kernel.clock.set(new Date());
  return { orderId, providerPaymentId: id };
}

const mails = (orderId: string) =>
  iso.sql<{ id: string; kind: string; status: string; refund_id: string | null }[]>`
    SELECT id, kind, status, refund_id FROM orders.order_mails
    WHERE order_id = ${orderId} ORDER BY id`;

const kinds = async (orderId: string) => (await mails(orderId)).map((mail) => mail.kind);

const published = async (orderId: string) =>
  (
    await iso.sql<{ payload: { kind: string } }[]>`
      SELECT payload FROM system.outbox
      WHERE topic = 'orders.mail.requested' AND payload->>'orderId' = ${orderId}`
  ).map((row) => row.payload.kind);

const versionOf = async (orderId: string) => (await getOrderForStaff({ orderId }, owner)).version;

async function step(orderId: string, to: "preparing" | "ready_for_pickup" | "collected") {
  await advanceOrder({ orderId, to, expectedVersion: await versionOf(orderId) }, owner);
}

describe("which mail a state change asks for", () => {
  it("a paid order: received, once, even when the webhook comes twice", async () => {
    const { orderId } = await order(false);
    expect(await kinds(orderId)).toEqual(["order_received"]);
    expect(await published(orderId)).toEqual(["order_received"]);
  });

  it("a paid medicine order: received (in review), not approved and not ready", async () => {
    const { orderId } = await order(true);
    expect((await getOrderForStaff({ orderId }, owner)).status).toBe("in_review");
    expect(await kinds(orderId)).toEqual(["order_received"]);
    await decideReview(
      { orderId, decision: "approved", expectedVersion: await versionOf(orderId) },
      pharmacist,
    );
    await step(orderId, "preparing");
    // approving and preparing tell the customer nothing new
    expect(await kinds(orderId)).toEqual(["order_received"]);
    await step(orderId, "ready_for_pickup");
    expect(await kinds(orderId)).toEqual(["order_received", "ready_for_pickup"]);
    await step(orderId, "collected");
    expect(await kinds(orderId)).toEqual(["order_received", "ready_for_pickup"]);
  });

  it("paid after the holds lapsed: the stock-problem mail only, never 'received'", async () => {
    const { orderId } = await order(false, { lapse: true });
    expect((await getOrderForStaff({ orderId }, owner)).status).toBe("paid_stock_short");
    expect(await kinds(orderId)).toEqual(["stock_short"]);
  });

  it("a failed payment: no mail", async () => {
    const { orderId } = await order(false, { pay: "failed" });
    expect(await kinds(orderId)).toEqual([]);
  });

  it("a rejected order: refund initiated with its refund; refund completed once Mollie says so", async () => {
    const { orderId } = await order(true);
    await decideReview(
      { orderId, decision: "rejected", expectedVersion: await versionOf(orderId) },
      pharmacist,
    );
    const [, initiated] = await mails(orderId);
    expect(initiated).toMatchObject({ kind: "refund_initiated", status: "pending" });
    const [refund] = (await getOrderForStaff({ orderId }, owner)).refunds;
    expect(initiated?.refund_id).toBe(refund?.refundId);

    await executeRefund(refund?.refundId ?? "", refunded);
    await executeRefund(refund?.refundId ?? "", refunded);
    expect(await kinds(orderId)).toEqual([
      "order_received",
      "refund_initiated",
      "refund_completed",
    ]);
  });
});

describe("the database refuses a mail that does not match the state", () => {
  const insert = (orderId: string, kind: string, refundId: string | null = null) =>
    iso.sql`INSERT INTO orders.order_mails (id, order_id, kind, refund_id)
      VALUES (${randomUUID()}, ${orderId}, ${kind}, ${refundId})`;

  it("no 'ready', 'stock short' or 'received' for an order that is not there", async () => {
    const { orderId } = await order(false);
    // ready_to_prepare: not ready for pickup, not short
    await expect(insert(orderId, "ready_for_pickup")).rejects.toThrow(/not in the state/);
    await expect(insert(orderId, "stock_short")).rejects.toThrow(/not in the state/);
    const unpaid = await order(false, { pay: "failed" });
    await expect(insert(unpaid.orderId, "order_received")).rejects.toThrow(/not in the state/);
    // and no second mail of a kind
    await expect(insert(orderId, "order_received")).rejects.toThrow(/order_mails_order_kind_idx/);
  });

  it("no 'refund completed' before the refund is refunded; a mail never goes back to pending", async () => {
    const { orderId } = await order(true);
    await decideReview(
      { orderId, decision: "rejected", expectedVersion: await versionOf(orderId) },
      pharmacist,
    );
    const [refund] = (await getOrderForStaff({ orderId }, owner)).refunds;
    await expect(insert(orderId, "refund_completed", refund?.refundId ?? null)).rejects.toThrow(
      /not in the state/,
    );
    const [first] = await mails(orderId);
    await iso.sql`UPDATE orders.order_mails SET status = 'sent' WHERE id = ${first?.id ?? ""}`;
    await expect(
      iso.sql`UPDATE orders.order_mails SET status = 'pending' WHERE id = ${first?.id ?? ""}`,
    ).rejects.toThrow(/only moves from pending/);
  });
});

describe("sending (the worker)", () => {
  const sender = () => {
    const sent: OrderMailToSend[] = [];
    return { sent, send: async (mail: OrderMailToSend) => void sent.push(mail) };
  };

  it("sends in the order's language with the refund's amount, once", async () => {
    const { orderId } = await order(true, { locale: "de" });
    const { sent, send } = sender();
    const [received] = await mails(orderId);
    expect(await deliverOrderMail(received?.id ?? "", send)).toBe("sent");
    expect(await deliverOrderMail(received?.id ?? "", send)).toBe("skipped");
    await decideReview(
      { orderId, decision: "rejected", expectedVersion: await versionOf(orderId) },
      pharmacist,
    );
    const [, initiated] = await mails(orderId);
    expect(await deliverOrderMail(initiated?.id ?? "", send)).toBe("sent");
    const { reference, totalCents } = await getOrderForStaff({ orderId }, owner);
    expect(sent).toEqual([
      {
        to: "an@shop-customer.be",
        name: "An",
        locale: "de",
        kind: "order_received",
        reference,
        amountCents: undefined,
      },
      {
        to: "an@shop-customer.be",
        name: "An",
        locale: "de",
        kind: "refund_initiated",
        reference,
        amountCents: totalCents,
      },
    ]);
    expect((await mails(orderId)).map((mail) => mail.status)).toEqual(["sent", "sent"]);
  });

  it("a 'received' mail still waiting when the order is cancelled is not sent", async () => {
    const { orderId } = await order(true);
    await decideReview(
      { orderId, decision: "rejected", expectedVersion: await versionOf(orderId) },
      pharmacist,
    );
    const { sent, send } = sender();
    const [received] = await mails(orderId);
    expect(await deliverOrderMail(received?.id ?? "", send)).toBe("skipped");
    expect(sent).toEqual([]);
  });

  it("skips a mail the order has moved past, and the reserved test domains", async () => {
    const { orderId } = await order(false);
    await step(orderId, "preparing");
    await step(orderId, "ready_for_pickup");
    await step(orderId, "collected");
    const { sent, send } = sender();
    const ready = (await mails(orderId)).find((mail) => mail.kind === "ready_for_pickup");
    expect(await deliverOrderMail(ready?.id ?? "", send)).toBe("skipped");

    const demo = await order(false, { email: "demo-order-1@example.test" });
    const [received] = await mails(demo.orderId);
    expect(await deliverOrderMail(received?.id ?? "", send)).toBe("skipped");
    expect(sent).toEqual([]);
  });

  it("a failed send stays pending for the retry; the job handler drops a payload it cannot read", async () => {
    const { orderId } = await order(false);
    const [mail] = await mails(orderId);
    await expect(
      deliverOrderMail(mail?.id ?? "", async () => {
        throw new Error("smtp down");
      }),
    ).rejects.toThrow(/smtp down/);
    expect((await mails(orderId))[0]?.status).toBe("pending");

    const warnings: unknown[] = [];
    const { sent, send } = sender();
    const runtime = {
      db: iso.db,
      now: () => new Date(),
      metrics: { increment: () => {} },
      logger: { info: () => {}, warn: (obj: unknown) => void warnings.push(obj) },
    };
    await handleOrderMailJobs(
      [
        { data: { eventId: "e-1", payload: { mailId: "nope" } } },
        {
          data: {
            eventId: "e-2",
            payload: { mailId: mail?.id, orderId, kind: "order_received" },
          },
        },
      ],
      send,
      runtime as never,
    );
    expect(warnings).toMatchObject([{ alarm: "orders.mail.payload_invalid" }]);
    expect(sent.map((item) => item.kind)).toEqual(["order_received"]);
  });
});
