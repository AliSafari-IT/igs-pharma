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
