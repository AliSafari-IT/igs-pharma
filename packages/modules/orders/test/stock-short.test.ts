// Paid after the stock hold ended (igs-pharma#158): the order waits as `paid_stock_short` until
// staff hold the same products again or cancel and refund it; on real Postgres.
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
  adjustStock,
  listHolderReservations,
  registerAuditActions as registerInventoryAudit,
} from "@igs/module-inventory";
import { registerAuditActions as registerPricingAudit, setPrice } from "@igs/module-pricing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CHECKOUT_HOLD_MINUTES,
  OrderMailRequested,
  type PaymentProvider,
  type ProviderPaymentView,
  type RefundProvider,
  RefundRequested,
  STOCK_SHORT_DEADLINE_HOURS,
  advanceOrder,
  cancelStockShortOrder,
  executeRefund,
  getOrderForStaff,
  getStockShortSummary,
  newCartToken,
  placeOrder,
  reReserveOrder,
  registerAuditActions,
  runStockShortAlert,
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
const contact = { name: "An", email: "an@shop-customer.be", phone: "+32470123456" };
const urls = { storefrontUrl: "https://shop.example" };

function fakePayments(): PaymentProvider & { pay(id: string): void } {
  const made = new Map<string, ProviderPaymentView>();
  return {
    async createPayment(input) {
      const id = `tr_short${made.size + 1}x${randomUUID().slice(0, 6)}`;
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

let nextCnk = 9_730_100;

async function product(medicine: boolean, stock = 10): Promise<string> {
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
  await adjustStock({ productId, delta: stock, reason: "adjustment", note: "seed" }, owner);
  await setPrice({ productId, amountCents: 1_250 }, owner);
  return productId;
}

/** A guest order for 2 units, paid after its holds lapsed. */
async function stockShortOrder(medicine = false) {
  const productId = await product(medicine);
  const token = newCartToken();
  const guest = actors.anonymous();
  await setCartLine({ cartToken: token, productId, quantity: 2 }, guest);
  const { checkoutId } = await startCheckout({ cartToken: token, locale: "nl" }, guest);
  const { orderId } = await placeOrder({ cartToken: token, checkoutId, contact }, guest);
  const provider = fakePayments();
  const id = ((await startPayment(orderId, provider, urls)) as string).split("/").at(-1) as string;
  // time moves on past the hold, and stays there
  kernel.clock.set(new Date(kernel.clock.now().getTime() + (CHECKOUT_HOLD_MINUTES + 1) * 60_000));
  provider.pay(id);
  await syncPayment(id, provider);
  await syncPayment(id, provider);
  return { orderId, productId, checkoutId, providerPaymentId: id };
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

const view = (orderId: string) => getOrderForStaff({ orderId }, owner);
const versionOf = async (orderId: string) => (await view(orderId)).version;

const holds = (checkoutId: string) =>
  iso.sql<{ kind: string; status: string; quantity: number }[]>`
    SELECT kind, status, quantity FROM inventory.reservations
    WHERE holder_ref = ${`checkout:${checkoutId}`} ORDER BY created_at, id`;

const onHand = async (productId: string) =>
  Number(
    (
      await iso.sql<{ on_hand: number }[]>`
        SELECT on_hand FROM inventory.stock_levels WHERE product_id = ${productId}`
    )[0]?.on_hand,
  );

const mailKinds = async (orderId: string) =>
  (
    await iso.sql<{ kind: string }[]>`
      SELECT kind FROM orders.order_mails WHERE order_id = ${orderId} ORDER BY id`
  ).map((row) => row.kind);

const audited = async (orderId: string, action: string) =>
  iso.sql<{ actor_id: string; data: Record<string, unknown> }[]>`
    SELECT actor_id, data FROM audit.events WHERE entity_id = ${orderId} AND action = ${action}`;

describe("paid after the hold ended", () => {
  it("waits as paid_stock_short: nothing consumed, the stock mail, no fulfilment step", async () => {
    const { orderId, productId, checkoutId } = await stockShortOrder();
    const order = await view(orderId);
    expect(order).toMatchObject({ status: "paid_stock_short", paymentStatus: "paid" });
    expect(order.holderRef).toBe(`checkout:${checkoutId}`);
    expect(await onHand(productId)).toBe(10);
    // lapsed (the expiry job marks it later): its time is up
    const [lapsed] = await iso.sql<{ status: string; lapsed: boolean }[]>`
      SELECT status, expires_at <= ${kernel.clock.now().toISOString()}::timestamptz AS lapsed FROM inventory.reservations
      WHERE holder_ref = ${`checkout:${checkoutId}`}`;
    expect(lapsed).toEqual({ status: "active", lapsed: true });
    expect(await mailKinds(orderId)).toEqual(["stock_short"]);
    expect(
      await codeOf(
        advanceOrder({ orderId, to: "preparing", expectedVersion: order.version }, owner),
      ),
    ).toBe("orders.invalid_transition");
    // staff see the holder's reservations, whatever their status
    expect(
      (await listHolderReservations({ holderRef: order.holderRef }, assistant)).map((hold) => [
        hold.productId,
        hold.status,
      ]),
    ).toEqual([[productId, "active"]]);
  });
});

describe("reserving again", () => {
  it("holds the same products and quantities, then goes on to prepare; the customer is told", async () => {
    const { orderId, checkoutId } = await stockShortOrder();
    const before = await view(orderId);
    const result = await reReserveOrder({ orderId, expectedVersion: before.version }, assistant);
    expect(result).toMatchObject({ status: "ready_to_prepare", version: before.version + 1 });
    const after = await view(orderId);
    // the paid price never changes
    expect(after.lines).toEqual(before.lines);
    expect(after.totalCents).toBe(before.totalCents);
    expect(await holds(checkoutId)).toEqual([
      { kind: "hold", status: "expired", quantity: 2 },
      { kind: "order", status: "active", quantity: 2 },
    ]);
    expect(await mailKinds(orderId)).toEqual(["stock_short", "order_received"]);
    expect(await audited(orderId, "orders.order.re_reserved")).toMatchObject([
      { actor_id: assistant.id, data: { orderId, status: "ready_to_prepare" } },
    ]);
    // and the normal flow runs from here
    await advanceOrder({ orderId, to: "preparing", expectedVersion: after.version }, assistant);
  });

  it("a medicine order goes to the pharmacist's review, never straight to preparing", async () => {
    const { orderId } = await stockShortOrder(true);
    await reReserveOrder({ orderId, expectedVersion: await versionOf(orderId) }, assistant);
    expect((await view(orderId)).status).toBe("in_review");
  });

  it("still short: nothing is held, the order keeps waiting, and staff are told which product", async () => {
    const { orderId, productId, checkoutId } = await stockShortOrder();
    await adjustStock({ productId, delta: -9, reason: "adjustment", note: "broken" }, owner);
    const version = await versionOf(orderId);
    let details: unknown;
    try {
      await reReserveOrder({ orderId, expectedVersion: version }, assistant);
    } catch (error) {
      if (!isDomainError(error)) throw error;
      expect(error.code).toBe("orders.stock_still_short");
      details = error.details;
    }
    expect(details).toEqual({ productId, available: 1 });
    expect(await view(orderId)).toMatchObject({ status: "paid_stock_short", version });
    // nothing new held: the lapsed hold is all there is
    expect((await holds(checkoutId)).map((hold) => hold.kind)).toEqual(["hold"]);
    expect(await mailKinds(orderId)).toEqual(["stock_short"]);
  });

  it("customer service cannot; a repeat is refused (stale, then no longer short)", async () => {
    const { orderId } = await stockShortOrder();
    const version = await versionOf(orderId);
    expect(await codeOf(reReserveOrder({ orderId, expectedVersion: version }, support))).toBe(
      "kernel.forbidden",
    );
    await reReserveOrder({ orderId, expectedVersion: version }, assistant);
    expect(await codeOf(reReserveOrder({ orderId, expectedVersion: version }, assistant))).toBe(
      "orders.stale_version",
    );
    expect(await codeOf(reReserveOrder({ orderId, expectedVersion: version + 1 }, assistant))).toBe(
      "orders.order_not_stock_short",
    );
  });
});

describe("cancel and refund", () => {
  it("cancels, records the refund (reason stock_short), gives back any hold and tells the customer", async () => {
    const { orderId, checkoutId } = await stockShortOrder();
    const version = await versionOf(orderId);
    await cancelStockShortOrder({ orderId, expectedVersion: version, note: "Supplier out" }, owner);
    const order = await view(orderId);
    expect(order).toMatchObject({ status: "cancelled", refundDue: false });
    expect(order.refunds).toMatchObject([
      {
        status: "requested",
        reason: "stock_short",
        note: "Supplier out",
        amountCents: order.totalCents,
        approvedById: null,
      },
    ]);
    expect((await holds(checkoutId)).every((hold) => hold.status !== "active")).toBe(true);
    expect(await mailKinds(orderId)).toEqual(["stock_short", "refund_initiated"]);
    const [entry] = await audited(orderId, "orders.order.cancelled");
    expect(entry).toMatchObject({
      actor_id: owner.id,
      data: { orderId, from: "paid_stock_short", reason: "stock_short" },
    });
    expect(entry?.data["refundId"]).toBe(order.refunds[0]?.refundId);
    // processing it again changes nothing
    expect(await codeOf(cancelStockShortOrder({ orderId, expectedVersion: version }, owner))).toBe(
      "orders.stale_version",
    );
    expect(
      await codeOf(cancelStockShortOrder({ orderId, expectedVersion: version + 1 }, owner)),
    ).toBe("orders.order_not_stock_short");
    expect((await view(orderId)).refunds).toHaveLength(1);
  });

  it("a held line is given back when the order is cancelled", async () => {
    const { orderId, checkoutId } = await stockShortOrder();
    const other = await product(false);
    // another hold of the same holder still active (e.g. a second line held in time)
    await iso.sql`
      INSERT INTO inventory.reservations
        (id, product_id, location_id, quantity, kind, holder_ref, status, expires_at,
         created_by_type, created_by_id, updated_by_type, updated_by_id)
      VALUES (${randomUUID()}, ${other}, '0192f000-0000-7000-8000-000000000001', 1, 'hold',
        ${`checkout:${checkoutId}`}, 'active', now() + interval '1 hour',
        'system', 'checkout', 'system', 'checkout')`;
    await cancelStockShortOrder({ orderId, expectedVersion: await versionOf(orderId) }, owner);
    expect((await holds(checkoutId)).map((hold) => hold.status)).toEqual(["released", "released"]);
  });

  it("who may cancel: owner or pharmacist; a medicine needs the pharmacist", async () => {
    const plain = await stockShortOrder();
    const version = await versionOf(plain.orderId);
    for (const actor of [assistant, support]) {
      expect(
        await codeOf(
          cancelStockShortOrder({ orderId: plain.orderId, expectedVersion: version }, actor),
        ),
      ).toBe("kernel.forbidden");
    }
    const medicine = await stockShortOrder(true);
    const medicineVersion = await versionOf(medicine.orderId);
    expect(
      await codeOf(
        cancelStockShortOrder(
          { orderId: medicine.orderId, expectedVersion: medicineVersion },
          owner,
        ),
      ),
    ).toBe("orders.refund_needs_pharmacist");
    await cancelStockShortOrder(
      { orderId: medicine.orderId, expectedVersion: medicineVersion },
      pharmacist,
    );
    expect((await view(medicine.orderId)).refunds[0]).toMatchObject({
      reason: "stock_short",
      approvedById: pharmacist.id,
    });
  });

  it("a refund the provider refuses leaves the order refund-due, never silently settled", async () => {
    const { orderId } = await stockShortOrder();
    await cancelStockShortOrder({ orderId, expectedVersion: await versionOf(orderId) }, owner);
    const refusing: RefundProvider = {
      async createRefund() {
        throw Object.assign(new Error("refused"), { status: 422 });
      },
      async getRefund() {
        throw new Error("unused");
      },
      async listRefunds() {
        return [];
      },
    };
    const [refund] = (await view(orderId)).refunds;
    await executeRefund(refund?.refundId ?? "", refusing);
    expect(await view(orderId)).toMatchObject({ status: "cancelled", refundDue: true });
    expect((await view(orderId)).refunds[0]).toMatchObject({
      status: "failed",
      failureCode: "provider_refused",
    });
  });
});

describe("the deadline", () => {
  const HOUR = 3_600_000;

  it("an order waiting past the deadline is counted, shown and raises the alarm (ids only)", async () => {
    const { orderId } = await stockShortOrder();
    const fresh = await view(orderId);
    expect(fresh.stockShort?.overdue).toBe(false);
    const since = fresh.stockShort?.since as Date;
    expect(since).toBeInstanceOf(Date);

    const before = await getStockShortSummary({}, support);
    expect(before.waiting).toBeGreaterThanOrEqual(1);

    const later = new Date(since.getTime() + (STOCK_SHORT_DEADLINE_HOURS + 1) * HOUR);
    kernel.clock.set(later);
    expect((await view(orderId)).stockShort?.overdue).toBe(true);
    const after = await getStockShortSummary({}, support);
    expect(after.overdue).toBeGreaterThan(before.overdue);
    expect(after.overdue).toBeLessThanOrEqual(after.waiting);

    const warnings: Record<string, unknown>[] = [];
    const runtime = {
      db: iso.db,
      now: () => later,
      metrics: { increment: () => {} },
      logger: {
        info: () => {},
        warn: (obj: Record<string, unknown>) => void warnings.push(obj),
      },
    };
    const run = await runStockShortAlert(runtime as never);
    expect(run.overdue).toBe(after.overdue);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ alarm: "orders.stock_short_overdue" });
    expect(warnings[0]?.["orderIds"]).toContain(orderId);
    // nothing about the customer in the alarm
    expect(JSON.stringify(warnings[0])).not.toContain(contact.email);
  });

  it("no alarm once resolved, and none before the deadline", async () => {
    const { orderId } = await stockShortOrder();
    const since = (await view(orderId)).stockShort?.since as Date;
    await reReserveOrder({ orderId, expectedVersion: await versionOf(orderId) }, assistant);
    expect((await view(orderId)).stockShort).toBeNull();

    const warnings: Record<string, unknown>[] = [];
    const runtime = (now: Date) => ({
      db: iso.db,
      now: () => now,
      metrics: { increment: () => {} },
      logger: {
        info: () => {},
        warn: (obj: Record<string, unknown>) => void warnings.push(obj),
      },
    });
    await runStockShortAlert(runtime(new Date(since.getTime() + HOUR)) as never);
    expect(warnings.flatMap((w) => (w["orderIds"] as string[] | undefined) ?? [])).not.toContain(
      orderId,
    );
    await runStockShortAlert(
      runtime(new Date(since.getTime() + (STOCK_SHORT_DEADLINE_HOURS + 1) * HOUR)) as never,
    );
    expect(warnings.flatMap((w) => (w["orderIds"] as string[] | undefined) ?? [])).not.toContain(
      orderId,
    );
  });
});
