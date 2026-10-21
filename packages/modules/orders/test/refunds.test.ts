// Refunds (igs-pharma#156): who may ask, what is refundable, and the worker's execution against a
// fake provider, on real Postgres.
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
  type ProviderRefundView,
  type RefundProvider,
  RefundRequested,
  decideReview,
  executeRefund,
  getOrderForStaff,
  handleRefundJobs,
  newCartToken,
  placeOrder,
  registerAuditActions,
  requestRefund,
  runPaymentReconciliation,
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
const assistant = actors.user({ id: randomUUID(), roles: ["pharmacy_assistant"], kind: "staff" });
const support = actors.user({ id: randomUUID(), roles: ["customer_service"], kind: "staff" });
const contact = { name: "Demo Klant", email: "demo@example.be", phone: "+32470123456" };
const urls = { storefrontUrl: "https://shop.example" };

function fakePayments(): PaymentProvider & { pay(id: string): void } {
  const made = new Map<string, ProviderPaymentView>();
  return {
    async createPayment(input) {
      const id = `tr_ref${made.size + 1}x${randomUUID().slice(0, 6)}`;
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

/** A provider that keeps its refunds; `refuse` makes the next call fail with that HTTP status. */
function fakeRefunds() {
  const refunds = new Map<string, ProviderRefundView & { paymentId: string }>();
  const state = { creates: 0, refuse: 0 };
  const fail = () => {
    if (!state.refuse) return;
    const status = state.refuse;
    state.refuse = 0;
    throw Object.assign(new Error(`mollie.refused (${status})`), { status, code: "refused" });
  };
  const provider: RefundProvider = {
    async createRefund(paymentId, input) {
      fail();
      state.creates++;
      const refund = {
        id: `re_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
        status: "pending",
        amountCents: input.amountCents,
        currency: "EUR",
        metadata: input.metadata,
        paymentId,
      };
      refunds.set(refund.id, refund);
      return refund;
    },
    async getRefund(_paymentId, refundId) {
      fail();
      const refund = refunds.get(refundId);
      if (!refund) throw Object.assign(new Error("not found"), { status: 404 });
      return refund;
    },
    async listRefunds(paymentId) {
      fail();
      return [...refunds.values()].filter((refund) => refund.paymentId === paymentId);
    },
  };
  return {
    provider,
    state,
    settle(status: string) {
      for (const [id, refund] of refunds) refunds.set(id, { ...refund, status });
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
  await setPrice({ productId, amountCents: 1_250 }, owner);
  return productId;
}

/** A guest order for one unit; `closeFirst`: it expires before the payment lands (paid after close). */
async function order(medicine: boolean, { closeFirst = false } = {}) {
  const productId = await product(medicine);
  const token = newCartToken();
  const guest = actors.anonymous();
  await setCartLine({ cartToken: token, productId, quantity: 1 }, guest);
  const { checkoutId } = await startCheckout({ cartToken: token, locale: "nl" }, guest);
  const { orderId } = await placeOrder({ cartToken: token, checkoutId, contact }, guest);
  const provider = fakePayments();
  const id = ((await startPayment(orderId, provider, urls)) as string).split("/").at(-1) as string;
  if (closeFirst) {
    await iso.sql`UPDATE orders.orders SET status = 'expired', version = version + 1 WHERE id = ${orderId}`;
  }
  provider.pay(id);
  await syncPayment(id, provider);
  return { orderId, providerPaymentId: id };
}

/** A paid order that expired first: the refund is due. */
const closedPaidOrder = () => order(false, { closeFirst: true });

/** A medicine order the pharmacist rejected (its refund is requested by the rejection). */
async function rejectedMedicineOrder() {
  const placed = await order(true);
  const { version } = await getOrderForStaff({ orderId: placed.orderId }, owner);
  await decideReview(
    { orderId: placed.orderId, decision: "rejected", expectedVersion: version },
    pharmacist,
  );
  return placed;
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

const refundRows = (orderId: string) =>
  iso.sql<
    {
      id: string;
      status: string;
      reason: string;
      provider_refund_id: string | null;
      failure_code: string | null;
      submitted_at: string | null;
      settled_at: string | null;
    }[]
  >`SELECT id, status, reason, provider_refund_id, failure_code, submitted_at, settled_at
    FROM orders.refunds WHERE order_id = ${orderId} ORDER BY requested_at, id`;

const auditOf = (orderId: string) =>
  iso.sql<{ action: string; actor_id: string; data: Record<string, unknown> }[]>`
    SELECT action, actor_id, data FROM audit.events
    WHERE entity_id = ${orderId} AND action LIKE 'orders.refund.%' ORDER BY seq`;

describe("requesting a refund", () => {
  it("only the owner and pharmacists may ask; the request is recorded before any provider call", async () => {
    const { orderId } = await closedPaidOrder();
    for (const actor of [assistant, support, actors.anonymous()]) {
      expect(await codeOf(requestRefund({ orderId, reason: "customer_request" }, actor))).toBe(
        "kernel.forbidden",
      );
    }
    expect(await getOrderForStaff({ orderId }, owner)).toMatchObject({ refundDue: true });

    const { refundId } = await requestRefund(
      { orderId, reason: "paid_after_close", note: "Paid after expiry" },
      owner,
    );
    const view = await getOrderForStaff({ orderId }, owner);
    expect(view.refundDue).toBe(false);
    expect(view.refunds).toMatchObject([
      {
        refundId,
        status: "requested",
        reason: "paid_after_close",
        note: "Paid after expiry",
        amountCents: 1_250,
        requestedById: owner.id,
        approvedById: null,
        providerRefundId: null,
      },
    ]);
    const outbox = await iso.sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM system.outbox WHERE topic = 'orders.refund.requested'
        AND payload->>'refundId' = ${refundId}`;
    expect(outbox.map((row) => row.payload)).toEqual([{ refundId, orderId }]);
    const [audited] = await auditOf(orderId);
    expect(audited).toMatchObject({ action: "orders.refund.requested", actor_id: owner.id });
    // ids, the reason and the amount; never the note or the customer
    expect(audited?.data).toEqual({
      orderId,
      refundId,
      paymentId: expect.any(String),
      reason: "paid_after_close",
      amountCents: 1_250,
      currency: "EUR",
      approvedById: null,
    });
  });

  it("refuses an order that is not closed and paid, and a second refund", async () => {
    const open = await order(false);
    expect(
      await codeOf(requestRefund({ orderId: open.orderId, reason: "customer_request" }, owner)),
    ).toBe("orders.order_not_refundable");

    const { orderId } = await closedPaidOrder();
    await requestRefund({ orderId, reason: "paid_after_close" }, owner);
    expect(await codeOf(requestRefund({ orderId, reason: "other" }, pharmacist))).toBe(
      "orders.refund_exists",
    );
    // the database refuses it too: one refund at a time per payment
    const [first] = await refundRows(orderId);
    await expect(iso.sql`
      INSERT INTO orders.refunds (id, order_id, payment_id, amount_cents, reason,
        requested_by_type, requested_by_id)
      SELECT ${randomUUID()}, order_id, payment_id, amount_cents, 'other', 'user', 'x'
      FROM orders.refunds WHERE id = ${first?.id ?? ""}`).rejects.toThrow(/refunds_one_active_idx/);
  });

  it("a medicine order's refund needs a pharmacist; owner is not enough", async () => {
    const { orderId, providerPaymentId } = await rejectedMedicineOrder();
    // the rejection asked for the refund itself, with the pharmacist as the approver
    const [auto] = await refundRows(orderId);
    expect(auto).toMatchObject({ status: "requested", reason: "pharmacist_rejected" });
    // the provider refuses it: the refund failed and is due again
    const refunds = fakeRefunds();
    refunds.state.refuse = 422;
    await executeRefund(auto?.id ?? "", refunds.provider);
    expect((await getOrderForStaff({ orderId }, owner)).refundDue).toBe(true);

    expect(await codeOf(requestRefund({ orderId, reason: "other" }, owner))).toBe(
      "orders.refund_needs_pharmacist",
    );
    const both = actors.user({ id: randomUUID(), roles: ["owner", "pharmacist"], kind: "staff" });
    await requestRefund({ orderId, reason: "other" }, both);
    const view = await getOrderForStaff({ orderId }, owner);
    expect(view.refunds[0]).toMatchObject({ status: "requested", approvedById: both.id });
    expect(view.refunds[1]).toMatchObject({ status: "failed", failureCode: "provider_refused" });
    expect(providerPaymentId).toMatch(/^tr_/);
  });
});

describe("executing a refund (the worker)", () => {
  it("asks the provider once, records its refund, then its outcome", async () => {
    const { orderId } = await closedPaidOrder();
    const { refundId } = await requestRefund({ orderId, reason: "paid_after_close" }, owner);
    const refunds = fakeRefunds();

    expect(await executeRefund(refundId, refunds.provider)).toMatchObject({
      status: "pending",
      changed: true,
    });
    const [pending] = await refundRows(orderId);
    expect(pending?.provider_refund_id).toMatch(/^re_/);
    expect(pending?.submitted_at).not.toBeNull();
    expect(pending?.settled_at).toBeNull();

    // a redelivered job: nothing new at the provider, nothing new recorded
    expect(await executeRefund(refundId, refunds.provider)).toMatchObject({ changed: false });
    expect(refunds.state.creates).toBe(1);

    refunds.settle("refunded");
    expect(await executeRefund(refundId, refunds.provider)).toMatchObject({
      status: "refunded",
      changed: true,
    });
    const [done] = await refundRows(orderId);
    expect(done?.settled_at).not.toBeNull();
    expect(await executeRefund(refundId, refunds.provider)).toMatchObject({ changed: false });

    const audited = await auditOf(orderId);
    expect(audited.map((entry) => [entry.action, entry.data["status"] ?? null])).toEqual([
      ["orders.refund.requested", null],
      ["orders.refund.status_recorded", "pending"],
      ["orders.refund.status_recorded", "refunded"],
    ]);
    expect(audited[2]?.data).toMatchObject({
      refundId,
      providerRefundId: done?.provider_refund_id,
      amountCents: 1_250,
      currency: "EUR",
      failureCode: null,
    });
  });

  it("a crash after the provider made the refund never makes a second one", async () => {
    const { orderId, providerPaymentId } = await closedPaidOrder();
    const { refundId } = await requestRefund({ orderId, reason: "paid_after_close" }, owner);
    const refunds = fakeRefunds();
    // the provider made it, but the worker died before recording it
    await refunds.provider.createRefund(providerPaymentId, {
      amountCents: 1_250,
      description: "x",
      metadata: { refundId, orderId },
      idempotencyKey: refundId,
    });
    await executeRefund(refundId, refunds.provider);
    expect(refunds.state.creates).toBe(1);
    expect((await refundRows(orderId))[0]?.status).toBe("pending");
  });

  it("a refusal fails the refund; a network error leaves it requested for a retry", async () => {
    const { orderId } = await closedPaidOrder();
    const { refundId } = await requestRefund({ orderId, reason: "paid_after_close" }, owner);
    const refunds = fakeRefunds();

    refunds.state.refuse = 503;
    await expect(executeRefund(refundId, refunds.provider)).rejects.toThrow(/503/);
    expect((await refundRows(orderId))[0]?.status).toBe("requested");

    refunds.state.refuse = 422;
    await executeRefund(refundId, refunds.provider);
    expect((await refundRows(orderId))[0]).toMatchObject({
      status: "failed",
      failure_code: "provider_refused",
      provider_refund_id: null,
    });
    expect(refunds.state.creates).toBe(0);
    expect((await auditOf(orderId)).at(-1)?.data).toMatchObject({
      status: "failed",
      failureCode: "provider_refused",
    });
  });

  it("the job handler executes the relayed event and drops one it cannot read", async () => {
    const { orderId } = await closedPaidOrder();
    const { refundId } = await requestRefund({ orderId, reason: "paid_after_close" }, owner);
    const refunds = fakeRefunds();
    const warnings: unknown[] = [];
    const runtime = {
      db: iso.db,
      now: () => new Date(),
      metrics: { increment: () => {} },
      logger: { info: () => {}, warn: (obj: unknown) => void warnings.push(obj) },
    };
    await handleRefundJobs(
      [
        { data: { eventId: "e-1", payload: { refundId: "not-a-uuid" } } },
        { data: { eventId: "e-2", payload: { refundId, orderId } } },
      ],
      refunds.provider,
      runtime as never,
    );
    expect(warnings).toMatchObject([{ alarm: "orders.refunds.payload_invalid" }]);
    expect((await refundRows(orderId))[0]?.status).toBe("pending");
  });

  it("the reconciliation picks up a refund whose job was lost", async () => {
    const { orderId } = await closedPaidOrder();
    const { refundId } = await requestRefund({ orderId, reason: "paid_after_close" }, owner);
    const refunds = fakeRefunds();
    kernel.clock.set(new Date(Date.now() + 11 * 60_000));
    const run = await runPaymentReconciliation(null, undefined, refunds.provider);
    expect(run.refunds).toBeGreaterThanOrEqual(1);
    expect((await refundRows(orderId))[0]).toMatchObject({ id: refundId, status: "pending" });
  });

  it("the database keeps a refund's facts and moves its status forward only", async () => {
    const { orderId } = await closedPaidOrder();
    const { refundId } = await requestRefund({ orderId, reason: "paid_after_close" }, owner);
    await expect(
      iso.sql`UPDATE orders.refunds SET amount_cents = 1 WHERE id = ${refundId}`,
    ).rejects.toThrow(/keeps its order/);
    await expect(
      iso.sql`UPDATE orders.refunds SET status = 'pending' WHERE id = ${refundId}`,
    ).rejects.toThrow(/provider refund id/);
    await iso.sql`UPDATE orders.refunds SET status = 'failed' WHERE id = ${refundId}`;
    await expect(
      iso.sql`UPDATE orders.refunds SET status = 'requested' WHERE id = ${refundId}`,
    ).rejects.toThrow(/may not move/);
    await expect(iso.sql`DELETE FROM orders.refunds WHERE id = ${refundId}`).rejects.toThrow();
    // only the full amount of a paid payment of a closed order
    const open = await order(false);
    await expect(iso.sql`
      INSERT INTO orders.refunds (id, order_id, payment_id, amount_cents, reason,
        requested_by_type, requested_by_id)
      SELECT ${randomUUID()}, order_id, id, amount_cents, 'other', 'user', 'x'
      FROM orders.payments WHERE order_id = ${open.orderId}`).rejects.toThrow(/closed order/);
  });
});
