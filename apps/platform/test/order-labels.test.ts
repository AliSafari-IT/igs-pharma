import { describe, expect, it } from "vitest";

import {
  ORDER_QUEUES,
  ORDER_STATUS_LABELS,
  nextSteps,
  orderErrorMessage,
  shipmentFailureMessage,
} from "../src/components/order-labels";

describe("order labels", () => {
  it("every status is a queue tab", () => {
    expect([...ORDER_QUEUES].sort()).toEqual(Object.keys(ORDER_STATUS_LABELS).sort());
  });

  it("offers the next fulfilment steps only where staff can take them", () => {
    expect(nextSteps("ready_to_prepare", "pickup")).toEqual(["preparing"]);
    expect(nextSteps("preparing", "pickup")).toEqual(["ready_for_pickup"]);
    expect(nextSteps("ready_for_pickup", "pickup")).toEqual(["collected"]);
    for (const status of [
      "pending_payment",
      "in_review",
      "paid_stock_short",
      "collected",
      "delivered",
      "returned",
    ] as const) {
      expect(nextSteps(status, "pickup"), status).toEqual([]);
    }
  });

  it("a delivery order is packed, handed over, then delivered or back (#202)", () => {
    expect(nextSteps("preparing", "delivery")).toEqual(["ready_to_ship"]);
    expect(nextSteps("ready_to_ship", "delivery")).toEqual(["shipped"]);
    expect(nextSteps("shipped", "delivery")).toEqual(["delivered", "returned"]);
    const fallback = shipmentFailureMessage(null);
    for (const code of ["provider_refused", "announcement_failed", "provider_unauthorized"]) {
      expect(shipmentFailureMessage(code), code).not.toBe(fallback);
    }
  });

  it("explains the refusals staff can hit", () => {
    const fallback = orderErrorMessage("orders.unknown");
    for (const code of [
      "orders.stale_version",
      "orders.order_not_in_review",
      "orders.invalid_transition",
      "inventory.negative_stock",
      "orders.shipment_label_missing",
      "orders.shipment_not_failed",
    ]) {
      expect(orderErrorMessage(code), code).not.toBe(fallback);
    }
  });
});
