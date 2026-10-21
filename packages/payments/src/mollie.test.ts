import { describe, expect, it } from "vitest";

import {
  INSTANT_METHODS,
  MollieError,
  centsToValue,
  createMollieClient,
  valueToCents,
} from "./index";

const KEY = `test_${"x".repeat(30)}`;

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const payment = (overrides: Record<string, unknown> = {}) => ({
  id: "tr_abc123XYZ",
  status: "open",
  amount: { value: "12.34", currency: "EUR" },
  metadata: { orderId: "o-1", paymentId: "p-1" },
  _links: { checkout: { href: "https://www.mollie.com/checkout/select-method/abc" } },
  ...overrides,
});

describe("amounts", () => {
  it("cents and Mollie's decimal strings convert both ways, exactly", () => {
    expect([centsToValue(1234), centsToValue(5), centsToValue(100)]).toEqual([
      "12.34",
      "0.05",
      "1.00",
    ]);
    expect([valueToCents("12.34"), valueToCents("0.05")]).toEqual([1234, 5]);
    expect(() => centsToValue(0)).toThrow();
    expect(() => valueToCents("12.3")).toThrow(MollieError);
  });
});

describe("createPayment", () => {
  it("posts the amount, instant methods only, the locale and our idempotency key", async () => {
    const { impl, calls } = fakeFetch(201, payment());
    const client = createMollieClient(KEY, impl);
    const created = await client.createPayment({
      amountCents: 1234,
      description: "IGS-2026-000001",
      redirectUrl: "https://shop.example/nl/orders/o-1",
      webhookUrl: "https://shop.example/api/webhooks/mollie",
      locale: "fr",
      metadata: { orderId: "o-1", paymentId: "p-1" },
      idempotencyKey: "p-1",
    });
    expect(created).toEqual({
      id: "tr_abc123XYZ",
      status: "open",
      amountCents: 1234,
      currency: "EUR",
      checkoutUrl: "https://www.mollie.com/checkout/select-method/abc",
      metadata: { orderId: "o-1", paymentId: "p-1" },
    });
    const [call] = calls;
    expect(call?.url).toBe("https://api.mollie.com/v2/payments");
    const headers = call?.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${KEY}`);
    expect(headers["idempotency-key"]).toBe("p-1");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      amount: { currency: "EUR", value: "12.34" },
      description: "IGS-2026-000001",
      redirectUrl: "https://shop.example/nl/orders/o-1",
      webhookUrl: "https://shop.example/api/webhooks/mollie",
      method: [...INSTANT_METHODS],
      locale: "fr_BE",
      metadata: { orderId: "o-1", paymentId: "p-1" },
    });
  });

  it("leaves the webhook out when there is none", async () => {
    const { impl, calls } = fakeFetch(201, payment());
    await createMollieClient(KEY, impl).createPayment({
      amountCents: 100,
      description: "x",
      redirectUrl: "https://shop.example/",
      locale: "nl",
      metadata: {},
      idempotencyKey: "k",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).not.toHaveProperty("webhookUrl");
  });
});

describe("getPayment", () => {
  it("reads a payment back; no checkout link once it is paid", async () => {
    const { impl, calls } = fakeFetch(200, payment({ status: "paid", _links: {} }));
    const read = await createMollieClient(KEY, impl).getPayment("tr_abc123XYZ");
    expect(read).toMatchObject({ status: "paid", amountCents: 1234, checkoutUrl: null });
    expect(calls[0]?.url).toBe("https://api.mollie.com/v2/payments/tr_abc123XYZ");
  });

  it("refuses an id that is not Mollie's without calling it (no path tricks)", async () => {
    const { impl, calls } = fakeFetch(200, payment());
    const client = createMollieClient(KEY, impl);
    for (const bad of ["../payments", "tr_", "tr_abc/../x", "abc"]) {
      await expect(client.getPayment(bad), bad).rejects.toMatchObject({ code: "invalid_id" });
    }
    expect(calls).toHaveLength(0);
  });

  it("turns refusals and odd answers into MollieError, never echoing the body", async () => {
    const notFound = createMollieClient(KEY, fakeFetch(404, { detail: "secret echo" }).impl);
    const error = await notFound.getPayment("tr_abc123XYZ").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MollieError);
    expect(error).toMatchObject({ status: 404, code: "not_found" });
    expect(String((error as Error).message)).not.toContain("secret");

    const odd = createMollieClient(KEY, fakeFetch(200, payment({ status: "weird" })).impl);
    await expect(odd.getPayment("tr_abc123XYZ")).rejects.toMatchObject({ code: "invalid_status" });

    const down = createMollieClient(KEY, (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch);
    await expect(down.getPayment("tr_abc123XYZ")).rejects.toMatchObject({ code: "unreachable" });
  });
});

const refund = (overrides: Record<string, unknown> = {}) => ({
  resource: "refund",
  id: "re_4qqhO89gsT",
  status: "pending",
  amount: { value: "12.34", currency: "EUR" },
  metadata: { refundId: "r-1", orderId: "o-1" },
  ...overrides,
});

describe("refunds", () => {
  it("refunds the amount with our idempotency key", async () => {
    const { impl, calls } = fakeFetch(201, refund());
    const made = await createMollieClient(KEY, impl).createRefund("tr_abc123XYZ", {
      amountCents: 1234,
      description: "IGS-2026-000001",
      metadata: { refundId: "r-1", orderId: "o-1" },
      idempotencyKey: "r-1",
    });
    expect(made).toEqual({
      id: "re_4qqhO89gsT",
      status: "pending",
      amountCents: 1234,
      currency: "EUR",
      metadata: { refundId: "r-1", orderId: "o-1" },
    });
    const [call] = calls;
    expect(call?.url).toBe("https://api.mollie.com/v2/payments/tr_abc123XYZ/refunds");
    expect((call?.init.headers as Record<string, string>)["idempotency-key"]).toBe("r-1");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      amount: { currency: "EUR", value: "12.34" },
      description: "IGS-2026-000001",
      metadata: { refundId: "r-1", orderId: "o-1" },
    });
  });

  it("reads one refund back and lists a payment's refunds", async () => {
    const one = fakeFetch(200, refund({ status: "refunded" }));
    expect(
      await createMollieClient(KEY, one.impl).getRefund("tr_abc123XYZ", "re_4qqhO89gsT"),
    ).toMatchObject({ status: "refunded" });
    expect(one.calls[0]?.url).toBe(
      "https://api.mollie.com/v2/payments/tr_abc123XYZ/refunds/re_4qqhO89gsT",
    );
    const list = fakeFetch(200, { count: 1, _embedded: { refunds: [refund()] } });
    expect(await createMollieClient(KEY, list.impl).listRefunds("tr_abc123XYZ")).toHaveLength(1);
    const empty = fakeFetch(200, { count: 0, _embedded: { refunds: [] } });
    expect(await createMollieClient(KEY, empty.impl).listRefunds("tr_abc123XYZ")).toEqual([]);
  });

  it("refuses odd ids without calling Mollie, and odd answers", async () => {
    const { impl, calls } = fakeFetch(200, refund());
    const client = createMollieClient(KEY, impl);
    await expect(client.getRefund("tr_abc123XYZ", "../x")).rejects.toMatchObject({
      code: "invalid_id",
    });
    await expect(client.listRefunds("tr_/x")).rejects.toMatchObject({ code: "invalid_id" });
    expect(calls).toHaveLength(0);
    const odd = createMollieClient(KEY, fakeFetch(200, refund({ status: "weird" })).impl);
    await expect(odd.getRefund("tr_abc123XYZ", "re_4qqhO89gsT")).rejects.toMatchObject({
      code: "invalid_status",
    });
    const refused = createMollieClient(KEY, fakeFetch(422, { detail: "too much" }).impl);
    await expect(
      refused.createRefund("tr_abc123XYZ", {
        amountCents: 1,
        description: "x",
        metadata: {},
        idempotencyKey: "k",
      }),
    ).rejects.toMatchObject({ status: 422, code: "refused" });
  });
});
