import { describe, expect, it } from "vitest";

import {
  ORDER_QUEUES,
  ORDER_STATUS_LABELS,
  nextStep,
  orderErrorMessage,
} from "../src/components/order-labels";

describe("order labels", () => {
  it("every status is a queue tab", () => {
    expect([...ORDER_QUEUES].sort()).toEqual(Object.keys(ORDER_STATUS_LABELS).sort());
  });

  it("offers the next fulfilment step only where staff can take one", () => {
    expect(nextStep("ready_to_prepare")).toBe("preparing");
    expect(nextStep("preparing")).toBe("ready_for_pickup");
    expect(nextStep("ready_for_pickup")).toBe("collected");
    for (const status of [
      "pending_payment",
      "in_review",
      "paid_stock_short",
      "collected",
    ] as const) {
      expect(nextStep(status), status).toBeNull();
    }
  });

  it("explains the refusals staff can hit", () => {
    const fallback = orderErrorMessage("orders.unknown");
    for (const code of [
      "orders.stale_version",
      "orders.order_not_in_review",
      "orders.invalid_transition",
      "inventory.negative_stock",
    ]) {
      expect(orderErrorMessage(code), code).not.toBe(fallback);
    }
  });
});
