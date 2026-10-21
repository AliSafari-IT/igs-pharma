// The storefront checkout (igs-pharma#116): the contact rules, the failure mapping, the status keys
// and that every message the checkout and order pages use exists in every locale.
import { describe, expect, it } from "vitest";

import { resultOfCode } from "../src/lib/cart-area";
import {
  brusselsDate,
  brusselsTime,
  contactErrors,
  normalisePhone,
  payReturnOf,
  paymentNoticeOf,
  placeFailureOf,
  statusMessageKey,
  statusTokenOf,
  uuidOf,
} from "../src/lib/checkout-area";

/** ORDER_STATUSES of @igs/module-orders (not importable here: it pulls in server-only code). */
const ORDER_STATUSES = [
  "pending_payment",
  "paid_stock_short",
  "in_review",
  "ready_to_prepare",
  "preparing",
  "ready_for_pickup",
  "collected",
  "cancelled",
  "expired",
] as const;

const good = { name: "Demo Klant", email: "demo@example.be", phone: "+32 470 12 34 56" };

describe("the contact step", () => {
  it("accepts a name, an e-mail and a phone number with the usual separators", () => {
    expect(contactErrors(good)).toEqual({});
    expect(normalisePhone("+32 (0)470/12.34-56")).toBe("+320470123456");
  });

  it("names each problem per field", () => {
    expect(contactErrors({ name: " ", email: "nope", phone: "12" })).toEqual({
      name: "nameRequired",
      email: "emailInvalid",
      phone: "phoneInvalid",
    });
    expect(contactErrors({ ...good, name: "x".repeat(121) })).toEqual({ name: "nameTooLong" });
    expect(contactErrors({ ...good, phone: "+32 470 12 34 56 78 90 12" })).toEqual({
      phone: "phoneInvalid",
    });
  });
});

describe("refusals", () => {
  it("map place-order codes to failures and checkout-start codes to cart results", () => {
    expect(placeFailureOf("orders.checkout_expired")).toBe("expired");
    expect(placeFailureOf("orders.checkout_cancelled")).toBe("cancelled");
    expect(placeFailureOf("orders.checkout_not_found")).toBe("notFound");
    expect(placeFailureOf("kernel.validation_failed")).toBe("invalid");
    expect(placeFailureOf("kernel.anything")).toBe("failed");
    expect(resultOfCode("orders.checkout_short")).toBe("short");
    expect(resultOfCode("orders.checkout_unavailable")).toBe("unavailable");
    expect(resultOfCode("orders.cart_empty")).toBe("empty");
  });

  it("accept only a UUID from a URL or a form", () => {
    expect(uuidOf("0192f000-0000-7000-8000-000000000001")).not.toBeNull();
    for (const bad of [undefined, "", "../x", "0192F000-0000-7000-8000-000000000001"]) {
      expect(uuidOf(bad), String(bad)).toBeNull();
    }
  });

  it("show the hold time in Brussels", () => {
    // 12:00 UTC in October (summer time) is 14:00 in Brussels
    expect(brusselsTime(new Date("2026-10-20T12:00:00Z"), "nl-BE")).toBe("14:00");
  });
});

describe("messages", () => {
  it("every status, field error and failure has a message in every locale", async () => {
    const keys = {
      checkout: [
        "nameRequired",
        "nameTooLong",
        "emailInvalid",
        "phoneInvalid",
        "failureExpired",
        "failureCancelled",
        "failureNotFound",
        "failureInvalid",
        "failureFailed",
      ],
      order: [
        ...ORDER_STATUSES.map(statusMessageKey),
        "payNow",
        "payDetail",
        "paymentSoon",
        "paymentProcessing",
        "paymentFailed",
        "backToCart",
        "stockShort",
        "paymentUnavailable",
        "statusLinkTitle",
        "statusLinkBody",
      ],
      account: [
        "navOrders",
        "ordersViewAll",
        "ordersIntro",
        "ordersEmpty",
        "ordersUnavailable",
        "ordersFreshBody",
        "ordersColReference",
        "ordersColDate",
        "ordersColStatus",
        "ordersColTotal",
        "ordersPages",
        "ordersPrevious",
        "ordersNext",
      ],
      cart: ["resultShort", "resultEmpty"],
    } as const;
    expect(statusMessageKey("ready_for_pickup")).toBe("statusReadyForPickup");
    for (const locale of ["nl", "fr", "de", "en"]) {
      const messages = (await import(`../../../packages/i18n/messages/${locale}.json`)).default;
      for (const [namespace, list] of Object.entries(keys)) {
        for (const key of list) {
          expect(messages[namespace][key], `${locale} ${namespace}.${key}`).toBeTruthy();
        }
      }
    }
  });
});

describe("paymentNoticeOf (igs-pharma#116)", () => {
  it("offers Pay now while the order waits and payment is configured", () => {
    expect(paymentNoticeOf("pending_payment", "created", true)).toBe("pay");
    expect(paymentNoticeOf("pending_payment", "open", true)).toBe("pay");
    expect(paymentNoticeOf("pending_payment", "created", false)).toBe("paymentSoon");
    expect(paymentNoticeOf("pending_payment", "open", false)).toBe("paymentSoon");
  });

  it("never offers to pay again while the bank confirms, or once the order moved on", () => {
    expect(paymentNoticeOf("pending_payment", "pending", true)).toBe("paymentProcessing");
    expect(paymentNoticeOf("pending_payment", "authorized", true)).toBe("paymentProcessing");
    expect(paymentNoticeOf("in_review", "paid", true)).toBeNull();
    expect(paymentNoticeOf("ready_to_prepare", "paid", true)).toBeNull();
    expect(paymentNoticeOf("expired", "created", true)).toBeNull();
  });

  it("says a failed payment cancelled the order, and a late one left stock short", () => {
    for (const status of ["failed", "canceled", "expired"]) {
      expect(paymentNoticeOf("cancelled", status, true)).toBe("paymentFailed");
    }
    expect(paymentNoticeOf("cancelled", null, true)).toBeNull();
    expect(paymentNoticeOf("paid_stock_short", "paid", true)).toBe("stockShort");
  });

  it("reads only the known return reason", () => {
    expect(payReturnOf("unavailable")).toBe("unavailable");
    expect(payReturnOf(["unavailable"])).toBeNull();
    expect(payReturnOf("<script>")).toBeNull();
    expect(payReturnOf(undefined)).toBeNull();
  });
});

describe("the order status link (igs-pharma#116)", () => {
  it("reads only a well-formed token from ?t=", () => {
    expect(statusTokenOf("n4tmZ53R5qsKPVfCoBDzAQ")).toBe("n4tmZ53R5qsKPVfCoBDzAQ");
    for (const bad of [
      undefined,
      "",
      "short",
      "n4tmZ53R5qsKPVfCoBDzAQx",
      "n4tmZ53R5qsKPVfCoBDz+Q",
      ["n4tmZ53R5qsKPVfCoBDzAQ"],
    ]) {
      expect(statusTokenOf(bad)).toBeNull();
    }
  });

  it("dates an order in Brussels", () => {
    expect(brusselsDate(new Date("2026-10-21T23:30:00Z"), "nl-BE")).toBe("22 okt 2026");
  });
});
