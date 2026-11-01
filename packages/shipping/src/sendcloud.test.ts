import { describe, expect, it } from "vitest";

import { SendcloudError, createSendcloudClient, gramsToKilos, toParcel } from "./index";

function fakeFetch(...answers: { status: number; body?: unknown; raw?: Uint8Array }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)] ?? { status: 500 };
    const payload = answer.raw ?? JSON.stringify(answer.body ?? {});
    return new Response(payload, { status: answer.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const parcel = (overrides: Record<string, unknown> = {}) => ({
  id: 123456,
  tracking_number: "323211588764200",
  tracking_url: "https://tracking.sendcloud.sc/forward?carrier=bpost&code=323211588764200",
  external_reference: "0192a5c4-0000-7000-8000-000000000001",
  carrier: { code: "bpost" },
  status: { id: 1000, message: "Ready to send" },
  ...overrides,
});

const input = {
  externalReference: "0192a5c4-0000-7000-8000-000000000001",
  orderNumber: "IGS-2026-000123",
  name: "An Peeters",
  street: "Rue de la Victoire 12 bte 3",
  postalCode: "1060",
  city: "Saint-Gilles",
  country: "BE",
  email: "an@example.test",
  phone: "+32470000000",
  shippingMethodId: 8,
  weightGrams: 1000,
};

describe("toParcel", () => {
  it("reads a parcel strictly", () => {
    expect(toParcel(parcel())).toEqual({
      id: "123456",
      statusId: 1000,
      trackingNumber: "323211588764200",
      trackingUrl: "https://tracking.sendcloud.sc/forward?carrier=bpost&code=323211588764200",
      carrier: "bpost",
      externalReference: "0192a5c4-0000-7000-8000-000000000001",
    });
    expect(() => toParcel(parcel({ id: "x" }))).toThrow(SendcloudError);
    expect(() => toParcel(parcel({ status: null }))).toThrow(/invalid_status/);
  });

  it("an empty tracking number is none yet, and a tracking link must be https", () => {
    const read = toParcel(parcel({ tracking_number: "", tracking_url: "http://evil.example/" }));
    expect(read.trackingNumber).toBeNull();
    expect(read.trackingUrl).toBeNull();
  });

  it("weights are kilograms with three decimals", () => {
    expect([gramsToKilos(1000), gramsToKilos(250), gramsToKilos(1505)]).toEqual([
      "1.000",
      "0.250",
      "1.505",
    ]);
    expect(() => gramsToKilos(0)).toThrow();
  });
});

describe("createSendcloudClient", () => {
  it("announces a parcel with a label, our id as external reference, and no product data", async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: { parcel: parcel() } });
    const made = await createSendcloudClient("pub", "sec", impl).createParcel(input);
    expect(made.id).toBe("123456");
    const call = calls[0];
    expect(call?.url).toBe("https://panel.sendcloud.sc/api/v2/parcels");
    const headers = call?.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Basic ${Buffer.from("pub:sec").toString("base64")}`);
    const sent = JSON.parse(String(call?.init.body)) as { parcel: Record<string, unknown> };
    expect(sent.parcel).toMatchObject({
      external_reference: input.externalReference,
      order_number: "IGS-2026-000123",
      request_label: true,
      shipment: { id: 8 },
      weight: "1.000",
      country: "BE",
    });
    expect(Object.keys(sent.parcel)).not.toContain("parcel_items");
  });

  it("finds a parcel by its external reference, and only an exact match", async () => {
    const { impl, calls } = fakeFetch({
      status: 200,
      body: { parcels: [parcel({ external_reference: "other" }), parcel()] },
    });
    const found = await createSendcloudClient("pub", "sec", impl).findParcel(
      input.externalReference,
    );
    expect(found?.id).toBe("123456");
    expect(calls[0]?.url).toContain(`external_reference=${input.externalReference}`);
    const none = fakeFetch({ status: 200, body: { parcels: [] } });
    expect(await createSendcloudClient("pub", "sec", none.impl).findParcel("x")).toBeNull();
  });

  it("errors carry the status and a code, never the body", async () => {
    const { impl } = fakeFetch({ status: 400, body: { error: { message: "Rue de la Victoire" } } });
    const error = await createSendcloudClient("pub", "sec", impl)
      .createParcel(input)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SendcloudError);
    expect((error as SendcloudError).status).toBe(400);
    expect(String((error as Error).message)).not.toContain("Victoire");
    const down = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    await expect(createSendcloudClient("pub", "sec", down).getParcel("1")).rejects.toMatchObject({
      status: 0,
      code: "unreachable",
    });
  });

  it("refuses a parcel id that is not a number before calling out", async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: {} });
    await expect(createSendcloudClient("pub", "sec", impl).getParcel("../x")).rejects.toThrow(
      /invalid_id/,
    );
    expect(calls).toHaveLength(0);
  });

  it("cancels: done, queued, or already gone", async () => {
    const client = (status: number, body?: unknown) =>
      createSendcloudClient("pub", "sec", fakeFetch({ status, body }).impl);
    expect(await client(200, { status: "cancelled" }).cancelParcel("1")).toBe("cancelled");
    expect(await client(202, { status: "queued" }).cancelParcel("1")).toBe("queued");
    expect(await client(410).cancelParcel("1")).toBe("gone");
    await expect(client(400).cancelParcel("1")).rejects.toMatchObject({ status: 400 });
  });

  it("passes on a label only when it is a PDF", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 label");
    const { impl, calls } = fakeFetch({ status: 200, raw: pdf });
    const bytes = await createSendcloudClient("pub", "sec", impl).getLabelPdf("123456", "a4");
    expect(Array.from(bytes)).toEqual(Array.from(pdf));
    expect(calls[0]?.url).toBe(
      "https://panel.sendcloud.sc/api/v2/labels/normal_printer/123456?start_from=0",
    );
    const html = fakeFetch({ status: 200, raw: new TextEncoder().encode("<html>") });
    await expect(
      createSendcloudClient("pub", "sec", html.impl).getLabelPdf("1", "a6"),
    ).rejects.toThrow(/invalid_label/);
    expect(html.calls[0]?.url).toBe("https://panel.sendcloud.sc/api/v2/labels/label_printer/1");
  });
});
