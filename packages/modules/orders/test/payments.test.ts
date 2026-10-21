// Paying for an order (igs-pharma#116, D-045 steps 4–5) against real Postgres, with the RBAC
// catalogue from the database and the real audit port, and a FAKE payment provider (no network):
// starting a payment once, the forward-only status, paid → review or prepare, paid after the holds
// lapsed, failed → cancelled with the stock back, the amount check, expiry and reconciliation.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError, registerEvents } from "@igs/kernel";
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
  PAYMENTS_ACTOR,
  type PaymentProvider,
  type ProviderPaymentView,
  UNPAID_ORDER_HOURS,
  expireUnpaidOrders,
  getCart,
  getOrder,
  newCartToken,
  placeOrder,
  recordPaymentStatus,
  registerAuditActions,
  runPaymentReconciliation,
  setCartLine,
  startCheckout,
  startPayment,
  syncPayment,
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
  registerEvents(OrderMailRequested);
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
const at = (ms: number) => new Date(t0.getTime() + ms);
const pharmacist = actors.user({ id: randomUUID(), roles: ["pharmacist"], kind: "staff" });
const owner = actors.user({ id: randomUUID(), roles: ["owner"], kind: "staff" });
const guest = () => actors.anonymous();
const contact = { name: "Demo Klant", email: "demo@example.be", phone: "+32470123456" };
const urls = { storefrontUrl: "https://shop.example", webhookBaseUrl: "https://hooks.example" };

/** A provider in memory: payments it made, and their status as the test sets it. */
function fakeProvider() {
  const made = new Map<string, ProviderPaymentView & { idempotencyKey: string }>();
  const created: Parameters<PaymentProvider["createPayment"]>[0][] = [];
  const provider: PaymentProvider = {
    async createPayment(input) {
      created.push(input);
      const existing = [...made.values()].find((p) => p.idempotencyKey === input.idempotencyKey);
      if (existing) return existing;
      const id = `tr_test${made.size + 1}x${randomUUID().slice(0, 6)}`;
      const payment = {
        id,
        status: "open",
        amountCents: input.amountCents,
        currency: "EUR",
        checkoutUrl: `https://pay.example/${id}`,
        idempotencyKey: input.idempotencyKey,
      };
      made.set(id, payment);
      return payment;
    },
    async getPayment(id) {
      const payment = made.get(id);
      if (!payment) throw new Error("mollie.not_found (404)");
      return payment;
    },
  };
  const set = (id: string, patch: Partial<ProviderPaymentView>) => {
    const payment = made.get(id);
    if (payment) made.set(id, { ...payment, ...patch });
  };
  return { provider, created, made, set };
}

let nextCnk = 9_600_100;

async function product(options: { medicine?: boolean; stock?: number } = {}): Promise<string> {
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
  await adjustStock(
    { productId, delta: options.stock ?? 10, reason: "adjustment", note: "seed" },
    owner,
  );
  await setPrice({ productId, amountCents: 1_000 }, owner);
  return productId;
}

/** A guest who placed an order for `quantity` of a product. */
async function placedOrder(options: { medicine?: boolean; quantity?: number } = {}) {
  const productId = await product(options);
  const token = newCartToken();
  const actor = guest();
  await setCartLine({ cartToken: token, productId, quantity: options.quantity ?? 1 }, actor);
  const { checkoutId } = await startCheckout({ cartToken: token, locale: "fr" }, actor);
  const { orderId, paymentId } = await placeOrder({ cartToken: token, checkoutId, contact }, actor);
  return { productId, token, actor, checkoutId, orderId, paymentId };
}

const holdsOf = (checkoutId: string) =>
  iso.sql<{ kind: string; status: string }[]>`
    SELECT kind, status FROM inventory.reservations WHERE holder_ref = ${`checkout:${checkoutId}`}`;

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

const orderStatus = async (token: string, orderId: string, actor: Actor) =>
  (await getOrder({ cartToken: token, orderId }, actor)).status;

describe("starting a payment", () => {
  it("creates one provider payment per order payment, with our id as the idempotency key", async () => {
    const { provider, created } = fakeProvider();
    const { orderId, paymentId, token, actor } = await placedOrder();

    const url = await startPayment(orderId, provider, urls);
    expect(url).toMatch(/^https:\/\/pay\.example\/tr_/);
    expect(created).toEqual([
      {
        amountCents: 1_000,
        description: expect.stringMatching(/^IGS-Pharma IGS-[0-9]{4}-[0-9]{6}$/),
        redirectUrl: `https://shop.example/fr/orders/${orderId}`,
        webhookUrl: "https://hooks.example/api/webhooks/mollie",
        locale: "fr",
        metadata: { orderId, paymentId },
        idempotencyKey: paymentId,
      },
    ]);
    // pressing "Pay now" again resumes the same payment: no second provider payment
    expect(await startPayment(orderId, provider, urls)).toBe(url);
    expect(created).toHaveLength(1);
    expect((await getOrder({ cartToken: token, orderId }, actor)).paymentStatus).toBe("open");
  });

  it("without a webhook origin, the provider gets no webhook (reconciliation reads the status)", async () => {
    const { provider, created } = fakeProvider();
    const { orderId } = await placedOrder();
    await startPayment(orderId, provider, { storefrontUrl: "https://shop.example" });
    expect(created[0]?.webhookUrl).toBeUndefined();
  });
});

describe("recording what the provider says", () => {
  it("paid: the holds become an order, a medicine goes to the pharmacist, the cart is emptied", async () => {
    const { provider, made, set } = fakeProvider();
    const { orderId, token, actor, checkoutId } = await placedOrder({ medicine: true });
    await startPayment(orderId, provider, urls);
    const [id] = [...made.keys()];
    set(id as string, { status: "paid" });

    const result = await syncPayment(id as string, provider);
    expect(result).toMatchObject({
      paymentStatus: "paid",
      orderStatus: "in_review",
      changed: true,
    });
    expect(await holdsOf(checkoutId)).toEqual([{ kind: "order", status: "active" }]);
    expect((await getCart({ cartToken: token }, actor)).lines).toEqual([]);
    // a second webhook for the same news changes nothing
    expect((await syncPayment(id as string, provider)).changed).toBe(false);

    const events = await iso.sql<{ from_status: string; to_status: string; actor_type: string }[]>`
      SELECT from_status, to_status, actor_type FROM orders.order_events WHERE order_id = ${orderId} ORDER BY at, id`;
    expect(events.at(-1)).toEqual({
      from_status: "pending_payment",
      to_status: "in_review",
      actor_type: "system",
    });
  });

  it("paid without a medicine: ready to prepare", async () => {
    const { provider, made, set } = fakeProvider();
    const { orderId, token, actor } = await placedOrder();
    await startPayment(orderId, provider, urls);
    const [id] = [...made.keys()];
    set(id as string, { status: "paid" });
    await syncPayment(id as string, provider);
    expect(await orderStatus(token, orderId, actor)).toBe("ready_to_prepare");
  });

  it("paid after the holds lapsed: paid_stock_short, never a silent charge for missing stock", async () => {
    const { provider, made, set } = fakeProvider();
    const { orderId, token, actor } = await placedOrder();
    await startPayment(orderId, provider, urls);
    kernel.clock.set(at((CHECKOUT_HOLD_MINUTES + 1) * MINUTE));
    const [id] = [...made.keys()];
    set(id as string, { status: "paid" });
    expect((await syncPayment(id as string, provider)).orderStatus).toBe("paid_stock_short");
    expect(await orderStatus(token, orderId, actor)).toBe("paid_stock_short");
    // the cart stays: staff will contact the shopper
    expect((await getCart({ cartToken: token }, actor)).lines).toHaveLength(1);
  });

  it("failed: the order is cancelled, the stock goes back, the cart stays for another try", async () => {
    const { provider, made, set } = fakeProvider();
    const { orderId, token, actor, checkoutId } = await placedOrder();
    await startPayment(orderId, provider, urls);
    const [id] = [...made.keys()];
    set(id as string, { status: "failed" });
    expect((await syncPayment(id as string, provider)).orderStatus).toBe("cancelled");
    expect(await holdsOf(checkoutId)).toEqual([{ kind: "hold", status: "released" }]);
    expect((await getCart({ cartToken: token }, actor)).lines).toHaveLength(1);
    // a late "paid" for a failed payment is not forward: ignored
    set(id as string, { status: "paid" });
    expect((await syncPayment(id as string, provider)).changed).toBe(false);
    expect(await orderStatus(token, orderId, actor)).toBe("cancelled");
  });

  it("only moves forward, refuses a paid amount that is not the order's, and an unknown payment", async () => {
    const { provider, made } = fakeProvider();
    const { orderId, token, actor } = await placedOrder();
    await startPayment(orderId, provider, urls);
    const [id] = [...made.keys()] as [string];
    const record = (status: string, amountCents = 1_000) =>
      recordPaymentStatus(
        { providerPaymentId: id, status, amountCents, currency: "EUR" },
        PAYMENTS_ACTOR,
      );

    expect((await record("pending")).changed).toBe(true);
    expect((await record("open")).changed).toBe(false); // older news
    expect(await codeOf(record("paid", 999))).toBe("orders.payment_amount_mismatch");
    expect(await orderStatus(token, orderId, actor)).toBe("pending_payment");
    expect(
      await codeOf(
        recordPaymentStatus(
          { providerPaymentId: "tr_unknown123", status: "paid", amountCents: 1, currency: "EUR" },
          PAYMENTS_ACTOR,
        ),
      ),
    ).toBe("orders.payment_not_found");
  });

  it("is system-only: a shopper, a customer or staff cannot record a payment status", async () => {
    const input = {
      providerPaymentId: "tr_abcd1234",
      status: "paid",
      amountCents: 1,
      currency: "EUR",
    };
    for (const actor of [guest(), actors.user({ roles: ["customer"], kind: "customer" }), owner]) {
      expect(await codeOf(recordPaymentStatus(input, actor))).toBe("kernel.forbidden");
    }
  });
});

describe("expiry and reconciliation", () => {
  it(`an order unpaid for ${UNPAID_ORDER_HOURS} hours expires and gives its stock back`, async () => {
    const { orderId, token, actor, checkoutId } = await placedOrder();
    kernel.clock.set(at(UNPAID_ORDER_HOURS * 60 * MINUTE - 1));
    await expireUnpaidOrders({}, PAYMENTS_ACTOR);
    expect(await orderStatus(token, orderId, actor)).toBe("pending_payment");
    kernel.clock.set(at(UNPAID_ORDER_HOURS * 60 * MINUTE));
    await runPaymentReconciliation(null, {
      db: iso.db,
      now: () => new Date(),
      metrics: { increment: () => {} },
      logger: { error: () => {} },
    } as never);
    expect(await orderStatus(token, orderId, actor)).toBe("expired");
    expect((await holdsOf(checkoutId)).map((h) => h.status)).toEqual(["released"]);
  });

  it("never expires an order whose provider payment is still running; it waits for the provider", async () => {
    const { provider, made, set } = fakeProvider();
    const { orderId, token, actor } = await placedOrder();
    await startPayment(orderId, provider, urls);
    const [id] = [...made.keys()];
    kernel.clock.set(at(UNPAID_ORDER_HOURS * 60 * MINUTE + MINUTE));
    expect((await expireUnpaidOrders({}, PAYMENTS_ACTOR)).expired).toBe(0);
    expect(await orderStatus(token, orderId, actor)).toBe("pending_payment");
    // the provider ends it unpaid: the order is cancelled, not left waiting
    set(id as string, { status: "expired" });
    await syncPayment(id as string, provider);
    expect(await orderStatus(token, orderId, actor)).toBe("cancelled");
  });

  it("a payment that lands on a closed order leaves it closed and raises an alarm", async () => {
    const { provider, made, set } = fakeProvider();
    const { orderId, token, actor } = await placedOrder();
    await startPayment(orderId, provider, urls);
    const [id] = [...made.keys()];
    // the race the expiry guard cannot see (closed between Mollie's create and our attach)
    await iso.sql`UPDATE orders.orders SET status = 'expired', version = version + 1 WHERE id = ${orderId}`;
    set(id as string, { status: "paid" });
    const result = await syncPayment(id as string, provider);
    expect(result).toMatchObject({ changed: true, paymentStatus: "paid", orderStatus: "expired" });
    expect(await orderStatus(token, orderId, actor)).toBe("expired");
    expect(kernel.errors).toContainEqual(
      expect.objectContaining({ alarm: "orders.payments.paid_after_close", orderId }),
    );
  });

  it("re-reads a provider payment left quiet for ten minutes (a lost webhook)", async () => {
    const { provider, made, set } = fakeProvider();
    const { orderId, token, actor } = await placedOrder();
    await startPayment(orderId, provider, urls);
    const [id] = [...made.keys()];
    set(id as string, { status: "paid" });
    const logs: unknown[] = [];
    const runtime = {
      db: iso.db,
      now: () => new Date(),
      metrics: { increment: () => {} },
      logger: { error: () => {}, info: (obj: unknown) => void logs.push(obj), warn: () => {} },
    } as never;

    kernel.clock.set(at(9 * MINUTE));
    expect((await runPaymentReconciliation(provider, runtime)).synced).toBe(0);
    kernel.clock.set(at(10 * MINUTE));
    expect((await runPaymentReconciliation(provider, runtime)).synced).toBeGreaterThanOrEqual(1);
    expect(await orderStatus(token, orderId, actor)).toBe("ready_to_prepare");
  });
});
