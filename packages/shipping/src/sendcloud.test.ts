import { describe, expect, it } from "vitest";

import { SendcloudError, createSendcloudClient, gramsToKilos, toParcel } from "./index";

function fakeFetch(...answers: { status: number; body?: unknown; raw?: Uint8Array }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)] ?? { status: 500 };
    const payload = [204, 205, 304].includes(answer.status)
      ? null
      : (answer.raw ?? JSON.stringify(answer.body === undefined ? {} : answer.body));
    return new Response(payload, { status: answer.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function streamedLabel(
  chunks: Uint8Array[],
  options: {
    status?: number;
    headers?: Record<string, string>;
    failure?: Error;
    cancelFails?: boolean;
  } = {},
) {
  const state = { reads: 0, cancellations: 0 };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[state.reads++];
        if (chunk) controller.enqueue(chunk);
        else if (options.failure) controller.error(options.failure);
        else controller.close();
      },
      cancel() {
        state.cancellations++;
        if (options.cancelFails) throw new Error("private cleanup failure");
      },
    },
    { highWaterMark: 0 },
  );
  const response = new Response(body, {
    status: options.status ?? 200,
    headers: options.headers ?? {},
  });
  const impl = (async () => response) as unknown as typeof fetch;
  return { impl, response, state };
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

  it.each([
    { raw: new Uint8Array(), label: "empty" },
    { raw: new TextEncoder().encode("<html>upstream error</html>"), label: "non-JSON" },
    { body: { status: "cancelled" }, label: "contradictory" },
  ])("keeps HTTP 202 queued with a $label body", async ({ raw, body }) => {
    const { impl, calls } = fakeFetch({ status: 202, ...(raw ? { raw } : { body }) });
    await expect(createSendcloudClient("pub", "sec", impl).cancelParcel("1")).resolves.toBe(
      "queued",
    );
    expect(calls).toHaveLength(1);
  });

  it.each([
    { body: {} },
    { body: { status: "pending" } },
    { body: { status: true } },
    { body: [] },
    { body: null },
  ])("never treats an unknown HTTP 200 acknowledgement as cancelled: %j", async ({ body }) => {
    const { impl } = fakeFetch({ status: 200, body });
    await expect(createSendcloudClient("pub", "sec", impl).cancelParcel("1")).rejects.toMatchObject(
      { status: 200, code: "invalid_cancellation" },
    );
  });

  it("does not complete on malformed JSON, body-read errors or an unrecognised success code", async () => {
    const address = "Private address in provider response";
    const malformed = fakeFetch({ status: 200, raw: new TextEncoder().encode(address) });
    const error = await createSendcloudClient("pub", "sec", malformed.impl)
      .cancelParcel("1")
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ status: 200, code: "invalid_body" });
    expect(String(error)).not.toContain(address);
    const broken = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error(address));
          },
        }),
        { status: 200 },
      )) as typeof fetch;
    await expect(
      createSendcloudClient("pub", "sec", broken).cancelParcel("1"),
    ).rejects.toMatchObject({ status: 200, code: "invalid_body" });
    await expect(
      createSendcloudClient("pub", "sec", fakeFetch({ status: 204 }).impl).cancelParcel("1"),
    ).rejects.toMatchObject({ status: 204, code: "invalid_cancellation" });
  });

  it("retains a queued acknowledgement on HTTP 200 for compatibility", async () => {
    const { impl } = fakeFetch({ status: 200, body: { status: "queued" } });
    await expect(createSendcloudClient("pub", "sec", impl).cancelParcel("1")).resolves.toBe(
      "queued",
    );
  });

  it("confirms the exact parcel after a refusal instead of trusting the refusal body", async () => {
    const { impl, calls } = fakeFetch(
      { status: 400, body: { message: "Private provider message" } },
      { status: 200, body: { parcel: parcel({ id: 1, status: { id: 2000 } }) } },
    );
    await expect(createSendcloudClient("pub", "sec", impl).cancelParcel("1")).resolves.toBe(
      "cancelled",
    );
    expect(calls.map(({ url, init }) => [init.method, url])).toEqual([
      ["POST", "https://panel.sendcloud.sc/api/v2/parcels/1/cancel"],
      ["GET", "https://panel.sendcloud.sc/api/v2/parcels/1"],
    ]);
    const wrong = fakeFetch(
      { status: 400 },
      { status: 200, body: { parcel: parcel({ status: { id: 2000 } }) } },
    );
    await expect(
      createSendcloudClient("pub", "sec", wrong.impl).cancelParcel("1"),
    ).rejects.toMatchObject({ code: "parcel_mismatch" });
  });

  it.each([404, 410])("a missing parcel (%i) after a refusal is gone", async (status) => {
    const { impl } = fakeFetch({ status: 400 }, { status });
    await expect(createSendcloudClient("pub", "sec", impl).cancelParcel("1")).resolves.toBe("gone");
  });

  it("does not accept an active parcel or a failed confirmation lookup as cancellation", async () => {
    const active = fakeFetch({ status: 400 }, { status: 200, body: { parcel: parcel({ id: 1 }) } });
    await expect(
      createSendcloudClient("pub", "sec", active.impl).cancelParcel("1"),
    ).rejects.toMatchObject({ status: 400, code: "refused" });
    const failed = fakeFetch({ status: 400 }, { status: 503 });
    await expect(
      createSendcloudClient("pub", "sec", failed.impl).cancelParcel("1"),
    ).rejects.toMatchObject({ status: 503, code: "refused" });
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

  it("assembles a PDF whose signature spans chunks, including empty chunks", async () => {
    const encode = (s: string) => new TextEncoder().encode(s);
    const stream = streamedLabel([
      encode("%"),
      new Uint8Array(),
      encode("PD"),
      encode("F-1.4 label"),
    ]);
    const bytes = await createSendcloudClient("pub", "sec", stream.impl).getLabelPdf("1", "a6");
    expect(new TextDecoder().decode(bytes)).toBe("%PDF-1.4 label");
    expect(stream.state.cancellations).toBe(0);
    expect(stream.response.body?.locked).toBe(false);
  });

  it("accepts a PDF at the existing 5,000,000-byte limit", async () => {
    const signature = new TextEncoder().encode("%PDF");
    const rest = new Uint8Array(5_000_000 - signature.length).fill(42);
    const stream = streamedLabel([signature, rest]);
    const bytes = await createSendcloudClient("pub", "sec", stream.impl).getLabelPdf("1", "a4");
    expect(bytes.length).toBe(5_000_000);
    expect(bytes.subarray(0, 4)).toEqual(signature);
    expect(bytes[bytes.length - 1]).toBe(42);
    expect(stream.state.cancellations).toBe(0);
  });

  it("preserves the bytes when many small chunks grow the bounded buffer", async () => {
    const chunks = [
      new TextEncoder().encode("%PDF"),
      ...Array.from({ length: 1024 }, (_, i) => new Uint8Array(32).fill(i % 256)),
    ];
    const stream = streamedLabel(chunks);
    const bytes = await createSendcloudClient("pub", "sec", stream.impl).getLabelPdf("1", "a6");
    expect(bytes.length).toBe(4 + 32 * 1024);
    for (let i = 0; i < 1024; i++) {
      expect(bytes.subarray(4 + i * 32, 4 + (i + 1) * 32)).toEqual(chunks[i + 1]);
    }
  });

  it.each([{}, { "content-length": "4" }])(
    "stops an oversized stream without trusting Content-Length (%j)",
    async (headers) => {
      const stream = streamedLabel(
        [new TextEncoder().encode("%PDF"), new Uint8Array(5_000_000 - 3), new Uint8Array([1])],
        { headers },
      );
      await expect(
        createSendcloudClient("pub", "sec", stream.impl).getLabelPdf("1", "a4"),
      ).rejects.toMatchObject({ status: 0, code: "invalid_label" });
      expect(stream.state).toEqual({ reads: 2, cancellations: 1 });
      expect(stream.response.body?.locked).toBe(false);
    },
  );

  it("cancels immediately when a split PDF signature is invalid", async () => {
    const stream = streamedLabel(
      [
        new TextEncoder().encode("%P"),
        new TextEncoder().encode("DX private provider data"),
        new Uint8Array(100),
      ],
      { cancelFails: true },
    );
    await expect(
      createSendcloudClient("pub", "sec", stream.impl).getLabelPdf("1", "a4"),
    ).rejects.toMatchObject({ message: "sendcloud.invalid_label (0)" });
    expect(stream.state).toEqual({ reads: 2, cancellations: 1 });
    expect(stream.response.body?.locked).toBe(false);
  });

  it.each(["", "%PD"])("rejects an empty or truncated label (%j)", async (content) => {
    const stream = streamedLabel([new TextEncoder().encode(content)]);
    await expect(
      createSendcloudClient("pub", "sec", stream.impl).getLabelPdf("1", "a4"),
    ).rejects.toMatchObject({ status: 0, code: "invalid_label" });
    expect(stream.response.body?.locked).toBe(false);
  });

  it("sanitises a stream failure after a valid prefix and releases the reader", async () => {
    const stream = streamedLabel([new TextEncoder().encode("%PDF")], {
      failure: new Error("private address and provider details"),
    });
    await expect(
      createSendcloudClient("pub", "sec", stream.impl).getLabelPdf("1", "a4"),
    ).rejects.toMatchObject({ name: "SendcloudError", message: "sendcloud.invalid_body (200)" });
    expect(stream.response.body?.locked).toBe(false);
  });

  it.each([404, 503])(
    "discards a refused HTTP %i label without reading its body",
    async (status) => {
      const stream = streamedLabel([new TextEncoder().encode("private provider refusal")], {
        status,
      });
      await expect(
        createSendcloudClient("pub", "sec", stream.impl).getLabelPdf("1", "a6"),
      ).rejects.toMatchObject({ status, code: status === 404 ? "not_found" : "refused" });
      expect(stream.state).toEqual({ reads: 0, cancellations: 1 });
    },
  );

  it("rejects a successful response without a body", async () => {
    const empty = fakeFetch({ status: 204 });
    await expect(
      createSendcloudClient("pub", "sec", empty.impl).getLabelPdf("1", "a4"),
    ).rejects.toMatchObject({ status: 0, code: "invalid_label" });
  });
});
