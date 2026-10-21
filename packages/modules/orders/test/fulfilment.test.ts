// Pharmacist review, fulfilment and the staff order reads, against real Postgres.
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
  listHolderAllocations,
  quarantineLot,
  receiveStock,
  registerAuditActions as registerInventoryAudit,
  releaseLot,
} from "@igs/module-inventory";
import { registerAuditActions as registerPricingAudit, setPrice } from "@igs/module-pricing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  OrderMailRequested,
  type PaymentProvider,
  type ProviderPaymentView,
  RefundRequested,
  advanceOrder,
  decideReview,
  getOrderForStaff,
  listOrdersForStaff,
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
const assistant = actors.user({ id: randomUUID(), roles: ["pharmacy_assistant"], kind: "staff" });
const support = actors.user({ id: randomUUID(), roles: ["customer_service"], kind: "staff" });
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

let nextCnk = 9_700_100;

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

const onHand = async (productId: string) =>
  Number(
    (
      await iso.sql<{ on_hand: number }[]>`
        SELECT on_hand FROM inventory.stock_levels WHERE product_id = ${productId}`
    )[0]?.on_hand,
  );

const holds = (checkoutId: string) =>
  iso.sql<{ status: string }[]>`
    SELECT status FROM inventory.reservations WHERE holder_ref = ${`checkout:${checkoutId}`}`;

const versionOf = async (orderId: string) => (await getOrderForStaff({ orderId }, owner)).version;

describe("pharmacist review", () => {
  it("approved: the order can be prepared; the decision, reviewer and note are kept", async () => {
    const { orderId } = await paidOrder(true);
    const view = await getOrderForStaff({ orderId }, pharmacist);
    expect(view.status).toBe("in_review");

    const result = await decideReview(
      { orderId, decision: "approved", note: "OK", expectedVersion: view.version },
      pharmacist,
    );
    expect(result).toMatchObject({ status: "ready_to_prepare", version: view.version + 1 });
    const after = await getOrderForStaff({ orderId }, owner);
    expect(after.review).toMatchObject({
      decision: "approved",
      note: "OK",
      reviewerId: pharmacist.id,
    });
    expect(after.events.at(-1)).toMatchObject({
      fromStatus: "in_review",
      toStatus: "ready_to_prepare",
      actorId: pharmacist.id,
    });
  });

  it("rejected: the order is cancelled, its stock goes back, and the refund is requested", async () => {
    const { orderId, checkoutId } = await paidOrder(true);
    await decideReview(
      { orderId, decision: "rejected", expectedVersion: await versionOf(orderId) },
      pharmacist,
    );
    const view = await getOrderForStaff({ orderId }, owner);
    expect(view).toMatchObject({ status: "cancelled", paymentStatus: "paid", refundDue: false });
    expect(view.refunds).toMatchObject([
      {
        status: "requested",
        reason: "pharmacist_rejected",
        amountCents: view.totalCents,
        requestedById: pharmacist.id,
        approvedById: pharmacist.id,
      },
    ]);
    expect((await holds(checkoutId)).map((h) => h.status)).toEqual(["released"]);
  });

  it("a payment that lands on an expired order is flagged as a refund too", async () => {
    const productId = await product(false);
    const token = newCartToken();
    const guest = actors.anonymous();
    await setCartLine({ cartToken: token, productId, quantity: 1 }, guest);
    const { checkoutId } = await startCheckout({ cartToken: token, locale: "nl" }, guest);
    const { orderId } = await placeOrder({ cartToken: token, checkoutId, contact }, guest);
    const provider = fakeProvider();
    const id = ((await startPayment(orderId, provider, urls)) as string)
      .split("/")
      .at(-1) as string;
    await iso.sql`UPDATE orders.orders SET status = 'expired', version = version + 1 WHERE id = ${orderId}`;
    provider.pay(id);
    await syncPayment(id, provider);
    expect(await getOrderForStaff({ orderId }, owner)).toMatchObject({
      status: "expired",
      paymentStatus: "paid",
      refundDue: true,
    });
  });

  it("only a pharmacist decides, once, on an order in review, with the version they saw", async () => {
    const { orderId } = await paidOrder(true);
    const version = await versionOf(orderId);
    for (const actor of [owner, assistant, support]) {
      expect(
        await codeOf(
          decideReview({ orderId, decision: "approved", expectedVersion: version }, actor),
        ),
      ).toBe("kernel.forbidden");
    }
    expect(
      await codeOf(
        decideReview({ orderId, decision: "approved", expectedVersion: version + 1 }, pharmacist),
      ),
    ).toBe("orders.stale_version");
    await decideReview({ orderId, decision: "approved", expectedVersion: version }, pharmacist);
    expect(
      await codeOf(
        decideReview({ orderId, decision: "rejected", expectedVersion: version + 1 }, pharmacist),
      ),
    ).toBe("orders.order_not_in_review");
  });

  it("the database refuses preparing a medicine order without an approved review", async () => {
    const { orderId } = await paidOrder(true);
    await expect(
      iso.sql`UPDATE orders.orders SET status = 'ready_to_prepare', version = version + 1 WHERE id = ${orderId}`,
    ).rejects.toThrow(/no approved review/);
    await expect(
      iso.sql`INSERT INTO orders.order_reviews (id, order_id, decision, reviewer_id)
        VALUES (${randomUUID()}, ${(await paidOrder(false)).orderId}, 'approved', 'x')`,
    ).rejects.toThrow(/not in_review/);
  });
});

describe("fulfilment", () => {
  it("prepare, ready for pickup, collected: collecting turns the holds into a sale", async () => {
    const { orderId, productId, checkoutId } = await paidOrder(false);
    expect(await onHand(productId)).toBe(10);
    let version = await versionOf(orderId);
    for (const to of ["preparing", "ready_for_pickup", "collected"] as const) {
      ({ version } = await advanceOrder({ orderId, to, expectedVersion: version }, assistant));
    }
    expect((await getOrderForStaff({ orderId }, owner)).status).toBe("collected");
    expect(await onHand(productId)).toBe(8);
    expect((await holds(checkoutId)).map((h) => h.status)).toEqual(["consumed"]);
  });

  it("refuses a skipped step, a stale version and customer service", async () => {
    const { orderId } = await paidOrder(false);
    const version = await versionOf(orderId);
    expect(
      await codeOf(advanceOrder({ orderId, to: "collected", expectedVersion: version }, owner)),
    ).toBe("orders.invalid_transition");
    expect(
      await codeOf(advanceOrder({ orderId, to: "preparing", expectedVersion: version - 1 }, owner)),
    ).toBe("orders.stale_version");
    expect(
      await codeOf(advanceOrder({ orderId, to: "preparing", expectedVersion: version }, support)),
    ).toBe("kernel.forbidden");
  });

  it("is not packed while its lots are not sellable, and is once they are again (#165)", async () => {
    const { orderId, checkoutId } = await paidOrder(false);
    const holderRef = `checkout:${checkoutId}`;
    const [line] = await listHolderAllocations({ holderRef }, owner);
    expect(line).toMatchObject({ quantity: 2, allocated: 2 });
    const lotId = line?.lots[0]?.lotId as string;
    let { version } = await advanceOrder(
      { orderId, to: "preparing", expectedVersion: await versionOf(orderId) },
      assistant,
    );
    await quarantineLot({ lotId, reason: "quality" }, pharmacist);
    expect(
      await codeOf(
        advanceOrder({ orderId, to: "ready_for_pickup", expectedVersion: version }, assistant),
      ),
    ).toBe("inventory.allocation_short");
    expect((await getOrderForStaff({ orderId }, owner)).status).toBe("preparing");

    await releaseLot({ lotId }, pharmacist);
    ({ version } = await advanceOrder(
      { orderId, to: "ready_for_pickup", expectedVersion: version },
      assistant,
    ));
    expect((await getOrderForStaff({ orderId }, owner)).status).toBe("ready_for_pickup");
  });

  it("a medicine order waits for the pharmacist before it is prepared", async () => {
    const { orderId } = await paidOrder(true);
    expect(
      await codeOf(
        advanceOrder(
          { orderId, to: "preparing", expectedVersion: await versionOf(orderId) },
          owner,
        ),
      ),
    ).toBe("orders.invalid_transition");
  });
});

describe("staff reads", () => {
  it("lists a queue oldest first with counts and the contact; customer service can read", async () => {
    const first = await paidOrder(true);
    const second = await paidOrder(true);
    const page = await listOrdersForStaff({ status: "in_review", pageSize: 100 }, support);
    const ids = page.items.map((item) => item.orderId);
    expect(ids.indexOf(first.orderId)).toBeLessThan(ids.indexOf(second.orderId));
    expect(page.items.every((item) => item.status === "in_review")).toBe(true);
    expect(page.total).toBe(page.counts.in_review);
    expect(page.items.find((item) => item.orderId === first.orderId)).toMatchObject({
      contactName: "Demo Klant",
      paymentStatus: "paid",
      refundDue: false,
    });
    const detail = await getOrderForStaff({ orderId: first.orderId }, support);
    expect(detail.contact).toEqual(contact);
    expect(detail.lines).toHaveLength(1);
  });

  it("is staff-only: a shopper gets nothing", async () => {
    const { orderId } = await paidOrder(false);
    expect(await codeOf(getOrderForStaff({ orderId }, actors.anonymous()))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(listOrdersForStaff({}, actors.anonymous()))).toBe("kernel.forbidden");
  });
});
