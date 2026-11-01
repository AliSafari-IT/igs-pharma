// Home delivery, part 3 (igs-pharma#202) against real Postgres: packing a delivery order asks for its
// label, the worker makes it at a fake Sendcloud (never twice), handing it over takes the stock out and
// mails the tracking link, the carrier's "delivered" closes it, a returned parcel never goes back
// into stock, and a cancelled packed order cancels its parcel. No network: Sendcloud is a fake.
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
  type ProviderParcelView,
  type ProviderPaymentView,
  RefundRequested,
  ShipmentRequested,
  type ShippingProvider,
  advanceOrder,
  cancelNotSellableOrder,
  getOrder,
  getOrderForStaff,
  getShipmentLabel,
  newCartToken,
  placeOrder,
  registerAuditActions,
  requestRefund,
  retryShipment,
  runShipmentReconciliation,
  setCartLine,
  startCheckout,
  startPayment,
  syncPayment,
  syncShipment,
} from "../src";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;

beforeAll(async () => {
  process.env["NEXT_PUBLIC_FEATURE_CART"] = "true";
  process.env["NEXT_PUBLIC_FEATURE_HOME_DELIVERY"] = "true";
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerCatalogAudit(registerAuditAction);
  registerInventoryAudit(registerAuditAction);
  registerPricingAudit(registerAuditAction);
  registerAuditActions(registerAuditAction);
  registerEvents(RefundRequested, OrderMailRequested, ShipmentRequested);
});
afterAll(async () => {
  // biome-ignore lint/performance/noDelete: unset, not the string "undefined"
  delete process.env["NEXT_PUBLIC_FEATURE_CART"];
  // biome-ignore lint/performance/noDelete: unset, not the string "undefined"
  delete process.env["NEXT_PUBLIC_FEATURE_HOME_DELIVERY"];
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
const address = { street: "Demostraat 12 bus 3", postalCode: "1000", city: "Brussel" };
const urls = { storefrontUrl: "https://shop.example" };
const settings = { shippingMethodId: 8, weightGrams: 1000 };

function fakePayments(): PaymentProvider & { pay(id: string): void } {
  const made = new Map<string, ProviderPaymentView>();
  return {
    async createPayment(input) {
      const id = `tr_shp${made.size + 1}x${randomUUID().slice(0, 6)}`;
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

/** A Sendcloud stand-in: parcels by id, every call counted, answers that can be scripted. */
function fakeSendcloud() {
  const parcels = new Map<string, ProviderParcelView>();
  const calls: string[] = [];
  let nextId = 5000;
  const state = {
    /** The next create answers with this HTTP status (as the real client's error) instead. */
    refuseWith: null as number | null,
    /** The carrier has not answered yet: no tracking number. */
    announcing: false,
    cancelAnswer: "cancelled" as "cancelled" | "queued" | "gone",
  };
  const provider: ShippingProvider = {
    async createParcel(input) {
      calls.push("create");
      if (state.refuseWith) {
        const error = Object.assign(new Error("sendcloud.refused"), { status: state.refuseWith });
        throw error;
      }
      const id = String(nextId++);
      const parcel: ProviderParcelView = {
        id,
        statusId: 1000,
        trackingNumber: state.announcing ? null : `3232${id}`,
        trackingUrl: state.announcing ? null : `https://tracking.example/${id}`,
        carrier: "bpost",
        externalReference: input.externalReference,
      };
      parcels.set(id, parcel);
      expect(input).toMatchObject({ ...address, country: "BE", ...settings, name: contact.name });
      return parcel;
    },
    async getParcel(id) {
      calls.push("get");
      const parcel = parcels.get(id);
      if (!parcel) throw Object.assign(new Error("not found"), { status: 404 });
      return parcel;
    },
    async findParcel(ref) {
      calls.push("find");
      return [...parcels.values()].find((parcel) => parcel.externalReference === ref) ?? null;
    },
    async cancelParcel(id) {
      calls.push(`cancel:${id}`);
      return state.cancelAnswer;
    },
  };
  const set = (id: string, change: Partial<ProviderParcelView>) => {
    const parcel = parcels.get(id);
    if (parcel) parcels.set(id, { ...parcel, ...change });
  };
  return { provider, parcels, calls, state, set };
}

let nextCnk = 9_600_100;

async function product(): Promise<string> {
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
  await receiveStock({ productId, quantity: 10 }, owner);
  await setPrice({ productId, amountCents: 1_000 }, owner);
  return productId;
}

/** A paid guest order for 2 units, delivered at home (or collected), ready to prepare. */
async function paidOrder(method: "delivery" | "pickup" = "delivery") {
  const productId = await product();
  const token = newCartToken();
  const guest = actors.anonymous();
  await setCartLine({ cartToken: token, productId, quantity: 2 }, guest);
  const { checkoutId } = await startCheckout({ cartToken: token, locale: "nl" }, guest);
  const { orderId } = await placeOrder(
    {
      cartToken: token,
      checkoutId,
      contact,
      ...(method === "delivery"
        ? { delivery: { method: "delivery" as const, address, expectedFeeCents: 495 } }
        : {}),
    },
    guest,
  );
  const payments = fakePayments();
  const url = await startPayment(orderId, payments, urls);
  const id = (url as string).split("/").at(-1) as string;
  payments.pay(id);
  await syncPayment(id, payments);
  return { productId, checkoutId, orderId, guest, token };
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

const versionOf = async (orderId: string) => (await getOrderForStaff({ orderId }, owner)).version;

const step = async (
  orderId: string,
  to: "preparing" | "ready_to_ship" | "shipped" | "delivered" | "returned" | "ready_for_pickup",
  actor = assistant,
) => advanceOrder({ orderId, to, expectedVersion: await versionOf(orderId) }, actor);

/** A paid delivery order, prepared and packed: its shipment is requested. */
async function packedOrder() {
  const order = await paidOrder();
  await step(order.orderId, "preparing");
  await step(order.orderId, "ready_to_ship");
  const view = await getOrderForStaff({ orderId: order.orderId }, owner);
  return { ...order, shipmentId: view.shipment?.shipmentId as string };
}

const mailKinds = async (orderId: string) =>
  (
    await iso.sql<{ kind: string }[]>`
      SELECT kind FROM orders.order_mails WHERE order_id = ${orderId} ORDER BY created_at, id`
  ).map((row) => row.kind);

describe("packing a delivery order", () => {
  it("asks for the label: a requested shipment, and the outbox event for the worker", async () => {
    const { orderId, shipmentId } = await packedOrder();
    const view = await getOrderForStaff({ orderId }, owner);
    expect(view.status).toBe("ready_to_ship");
    expect(view.shipment).toMatchObject({ status: "requested", trackingNumber: null });
    const events = await iso.sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM system.outbox WHERE topic = 'orders.shipment.requested'
        AND payload->>'orderId' = ${orderId}`;
    expect(events.map((row) => row.payload)).toEqual([{ shipmentId, orderId }]);
  });

  it("a pickup order never takes a shipping step, a delivery order never a pickup one", async () => {
    const pickup = await paidOrder("pickup");
    await step(pickup.orderId, "preparing");
    expect(await codeOf(step(pickup.orderId, "ready_to_ship"))).toBe("orders.invalid_transition");
    const delivery = await paidOrder();
    await step(delivery.orderId, "preparing");
    expect(await codeOf(step(delivery.orderId, "ready_for_pickup"))).toBe(
      "orders.invalid_transition",
    );
  });
});

describe("the worker makes the label", () => {
  it("once: tracking recorded, a second run and a lost answer never make a second parcel", async () => {
    const { orderId, shipmentId } = await packedOrder();
    const sendcloud = fakeSendcloud();
    const made = await syncShipment(shipmentId, sendcloud.provider, settings);
    expect(made).toMatchObject({ status: "created", changed: true });
    expect(sendcloud.calls).toEqual(["find", "create"]);
    const view = await getOrderForStaff({ orderId }, owner);
    expect(view.shipment).toMatchObject({
      status: "created",
      carrier: "bpost",
      trackingNumber: expect.stringMatching(/^3232/),
      trackingUrl: expect.stringMatching(/^https:\/\/tracking\.example\//),
    });
    // a repeat changes nothing and calls nobody
    expect(await syncShipment(shipmentId, sendcloud.provider, settings)).toMatchObject({
      changed: false,
    });
    expect(sendcloud.calls).toEqual(["find", "create"]);
    expect(await getShipmentLabel({ orderId }, assistant)).toMatchObject({
      parcelId: view.shipment?.providerParcelId,
    });
  });

  it("a parcel Sendcloud already made for our id (the answer was lost) is taken, not made again", async () => {
    const { shipmentId } = await packedOrder();
    const sendcloud = fakeSendcloud();
    sendcloud.parcels.set("777", {
      id: "777",
      statusId: 1000,
      trackingNumber: "T777",
      trackingUrl: null,
      carrier: "bpost",
      externalReference: shipmentId,
    });
    expect(await syncShipment(shipmentId, sendcloud.provider, settings)).toMatchObject({
      status: "created",
    });
    expect(sendcloud.calls).toEqual(["find"]);
  });

  it("still announcing: the parcel id is kept and the label taken on a later run", async () => {
    const { shipmentId, orderId } = await packedOrder();
    const sendcloud = fakeSendcloud();
    sendcloud.state.announcing = true;
    expect(await syncShipment(shipmentId, sendcloud.provider, settings)).toMatchObject({
      status: "requested",
      changed: true,
    });
    const parcelId = (await getOrderForStaff({ orderId }, owner)).shipment?.providerParcelId;
    expect(parcelId).toMatch(/^[0-9]+$/);
    sendcloud.set(parcelId as string, { trackingNumber: "T1", trackingUrl: "https://t.example/1" });
    expect(await syncShipment(shipmentId, sendcloud.provider, settings)).toMatchObject({
      status: "created",
    });
    expect(sendcloud.calls).toEqual(["find", "create", "get"]);
  });

  it("not set up: the shipment waits; a refusal fails it, staff fix it and ask again", async () => {
    const { orderId, shipmentId } = await packedOrder();
    const sendcloud = fakeSendcloud();
    expect(await syncShipment(shipmentId, sendcloud.provider, null)).toMatchObject({
      status: "requested",
      changed: false,
    });
    expect(sendcloud.calls).toEqual([]);

    sendcloud.state.refuseWith = 400;
    expect(await syncShipment(shipmentId, sendcloud.provider, settings)).toMatchObject({
      status: "failed",
    });
    expect((await getOrderForStaff({ orderId }, owner)).shipment).toMatchObject({
      status: "failed",
      failureCode: "provider_refused",
    });
    // nothing to hand over without a label
    expect(await codeOf(step(orderId, "shipped"))).toBe("orders.shipment_label_missing");
    expect(await codeOf(getShipmentLabel({ orderId }, assistant))).toBe(
      "orders.shipment_label_missing",
    );

    // a 5xx or the network: thrown for a retry, nothing recorded
    sendcloud.state.refuseWith = 503;
    expect(await codeOf(retryShipment({ orderId }, support))).toBe("kernel.forbidden");
    await retryShipment({ orderId }, assistant);
    await expect(syncShipment(shipmentId, sendcloud.provider, settings)).rejects.toThrow();
    expect((await getOrderForStaff({ orderId }, owner)).shipment?.status).toBe("requested");

    sendcloud.state.refuseWith = null;
    expect(await syncShipment(shipmentId, sendcloud.provider, settings)).toMatchObject({
      status: "created",
    });
    expect(await codeOf(retryShipment({ orderId }, assistant))).toBe("orders.shipment_not_failed");
  });

  it("the carrier refused the announcement: failed, and the parcel id kept for the retry", async () => {
    const { orderId, shipmentId } = await packedOrder();
    const sendcloud = fakeSendcloud();
    const original = sendcloud.provider.createParcel;
    sendcloud.provider.createParcel = async (input) => {
      const parcel = await original(input);
      sendcloud.set(parcel.id, { statusId: 1002, trackingNumber: null });
      return { ...parcel, statusId: 1002, trackingNumber: null };
    };
    expect(await syncShipment(shipmentId, sendcloud.provider, settings)).toMatchObject({
      status: "failed",
    });
    const shipment = (await getOrderForStaff({ orderId }, owner)).shipment;
    expect(shipment).toMatchObject({ failureCode: "announcement_failed" });
    expect(shipment?.providerParcelId).toMatch(/^[0-9]+$/);
    // fixed in Sendcloud's panel, then asked again: the same parcel is read, none made
    sendcloud.set(shipment?.providerParcelId as string, { statusId: 1000, trackingNumber: "T9" });
    await retryShipment({ orderId }, assistant);
    expect(await syncShipment(shipmentId, sendcloud.provider, settings)).toMatchObject({
      status: "created",
    });
    expect(sendcloud.calls.filter((call) => call === "create")).toHaveLength(1);
  });
});

describe("handing over, delivery and return", () => {
  it("shipped: the stock leaves, the customer gets the tracking link; delivered by the carrier", async () => {
    const { orderId, shipmentId, productId, guest, token } = await packedOrder();
    const sendcloud = fakeSendcloud();
    await syncShipment(shipmentId, sendcloud.provider, settings);
    expect(await onHand(productId)).toBe(10);
    await step(orderId, "shipped");
    expect(await onHand(productId)).toBe(8);
    expect(await mailKinds(orderId)).toEqual(["order_received", "shipped"]);

    const customer = await getOrder({ orderId, cartToken: token }, guest);
    expect(customer).toMatchObject({
      status: "shipped",
      tracking: { number: expect.stringMatching(/^3232/), url: expect.stringMatching(/^https:/) },
    });

    // the reconciliation reads the parcel: on its way, then delivered
    expect(
      await runShipmentReconciliation({ provider: sendcloud.provider, settings }),
    ).toMatchObject({ delivered: 0 });
    const parcelId = (await getOrderForStaff({ orderId }, owner)).shipment
      ?.providerParcelId as string;
    sendcloud.set(parcelId, { statusId: 11 });
    expect(
      await runShipmentReconciliation({ provider: sendcloud.provider, settings }),
    ).toMatchObject({ delivered: 1 });
    const view = await getOrderForStaff({ orderId }, owner);
    expect(view.status).toBe("delivered");
    expect(view.events.at(-1)).toMatchObject({ toStatus: "delivered", actorType: "system" });
    // an end state: nothing more to read
    expect(
      await runShipmentReconciliation({ provider: sendcloud.provider, settings }),
    ).toMatchObject({ delivered: 0, synced: 0 });
  });

  it("returned: nothing goes back into stock, and staff may refund it", async () => {
    const { orderId, shipmentId, productId } = await packedOrder();
    await syncShipment(shipmentId, fakeSendcloud().provider, settings);
    await step(orderId, "shipped");
    expect(await onHand(productId)).toBe(8);
    await step(orderId, "returned");
    expect(await onHand(productId)).toBe(8);
    const view = await getOrderForStaff({ orderId }, owner);
    expect(view).toMatchObject({ status: "returned", refundDue: false });
    expect(await codeOf(step(orderId, "delivered"))).toBe("orders.invalid_transition");
    const { refundId } = await requestRefund({ orderId, reason: "other" }, owner);
    expect(refundId).toBeTruthy();
  });

  it("staff can record the delivery when the carrier says nothing", async () => {
    const { orderId, shipmentId } = await packedOrder();
    await syncShipment(shipmentId, fakeSendcloud().provider, settings);
    await step(orderId, "shipped");
    await step(orderId, "delivered");
    expect((await getOrderForStaff({ orderId }, owner)).status).toBe("delivered");
  });
});

describe("a packed order cancelled", () => {
  it("cancels its parcel at Sendcloud; a queued cancellation is retried", async () => {
    const { orderId, shipmentId, productId } = await packedOrder();
    const sendcloud = fakeSendcloud();
    await syncShipment(shipmentId, sendcloud.provider, settings);
    const parcelId = (await getOrderForStaff({ orderId }, owner)).shipment?.providerParcelId;
    // a product stops being sellable: the packed order is cancelled and refunded
    await setProductStatusRegulated({ productId, status: "archived" }, pharmacist);
    const view = await getOrderForStaff({ orderId }, owner);
    expect(view.notSellable).toEqual([productId]);
    await cancelNotSellableOrder({ orderId, expectedVersion: view.version }, owner);
    expect((await getOrderForStaff({ orderId }, owner)).shipment?.status).toBe("cancel_requested");
    sendcloud.state.cancelAnswer = "queued";
    expect(await syncShipment(shipmentId, sendcloud.provider, settings)).toMatchObject({
      status: "cancel_requested",
    });
    sendcloud.state.cancelAnswer = "gone";
    expect(await syncShipment(shipmentId, sendcloud.provider, settings)).toMatchObject({
      status: "cancelled",
    });
    expect(sendcloud.calls.filter((call) => call.startsWith("cancel:"))).toEqual([
      `cancel:${parcelId}`,
      `cancel:${parcelId}`,
    ]);
  });
});
