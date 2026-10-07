import { describe, expect, it } from "vitest";

import {
  CSP_DROPPED_EVENT,
  CSP_REPORT_MAX_BYTES,
  CSP_VIOLATION_EVENT,
  type CspReportSink,
  createFloodGuard,
  handleCspReport,
} from "./index";

function fakeSink() {
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const counts: { name: string; labels: Record<string, string>; value: number }[] = [];
  const sink: CspReportSink = {
    warn: (event, fields) => logs.push({ event, fields: { ...fields } }),
    increment: (name, labels = {}, value = 1) =>
      counts.push({ name, labels: { ...labels }, value }),
  };
  return { sink, logs, counts };
}

const post = (body: string | null, contentType: string | null, method = "POST") =>
  new Request("https://shop.example/api/csp-report", {
    method,
    body: method === "GET" ? null : body,
    headers: {
      ...(contentType ? { "content-type": contentType } : {}),
      // must never reach the logs
      "user-agent": "Mozilla/5.0 (secret-ua)",
      "x-forwarded-for": "203.0.113.7",
      cookie: "session=abc",
    },
  });

const legacy = {
  "csp-report": {
    "document-uri": "https://shop.example/nl/checkout?token=SECRET#step-2",
    referrer: "https://user:pw@ref.example/search?q=antidepressant",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "default-src 'self'; script-src 'nonce-abc'",
    disposition: "enforce",
    "blocked-uri": "https://evil.example/x.js?exfil=1",
    "line-number": 12,
    "column-number": 34,
    "source-file": "https://shop.example/_next/static/chunk.js?v=2",
    "status-code": 200,
    "script-sample": "alert(document.cookie)",
  },
};

const reportingApi = [
  {
    type: "csp-violation",
    age: 10,
    url: "https://shop.example/nl?email=a@b.c",
    user_agent: "Mozilla/5.0 (secret-ua)",
    body: {
      documentURL: "https://shop.example/nl?email=a@b.c",
      blockedURL: "inline",
      effectiveDirective: "style-src-elem",
      disposition: "enforce",
      sample: "body{background:url(//evil)}",
      originalPolicy: "…",
      statusCode: 200,
      unexpected: "dropped",
    },
  },
  { type: "deprecation", body: { id: "x" } },
];

describe("handleCspReport", () => {
  it("legacy application/csp-report → 204, sanitised log + directive metric", async () => {
    const { sink, logs, counts } = fakeSink();
    const res = await handleCspReport(
      post(JSON.stringify(legacy), "application/csp-report"),
      sink,
      createFloodGuard(),
    );
    expect(res.status).toBe(204);
    expect(logs).toEqual([
      {
        event: CSP_VIOLATION_EVENT,
        fields: {
          directive: "script-src-elem",
          disposition: "enforce",
          documentUri: "https://shop.example/nl/checkout",
          blockedUri: "https://evil.example/x.js",
          sourceFile: "https://shop.example/_next/static/chunk.js",
          referrer: "https://ref.example/search",
          statusCode: 200,
          lineNumber: 12,
          columnNumber: 34,
        },
      },
    ]);
    expect(counts).toEqual([
      { name: CSP_VIOLATION_EVENT, labels: { directive: "script-src-elem" }, value: 1 },
    ]);
  });

  it("Reporting API application/reports+json → 204, keyword kept, other report types ignored", async () => {
    const { sink, logs } = fakeSink();
    const res = await handleCspReport(
      post(JSON.stringify(reportingApi), "application/reports+json"),
      sink,
      createFloodGuard(),
    );
    expect(res.status).toBe(204);
    expect(logs.map((l) => l.fields)).toEqual([
      {
        directive: "style-src-elem",
        disposition: "enforce",
        documentUri: "https://shop.example/nl",
        blockedUri: "inline",
        statusCode: 200,
      },
    ]);
  });

  it("never logs query strings, fragments, credentials, samples, policies, IP, UA or cookies", async () => {
    const { sink, logs } = fakeSink();
    await handleCspReport(
      post(JSON.stringify(legacy), "application/csp-report"),
      sink,
      createFloodGuard(),
    );
    await handleCspReport(
      post(JSON.stringify(reportingApi), "application/reports+json"),
      sink,
      createFloodGuard(),
    );
    const logged = JSON.stringify(logs);
    for (const secret of [
      "SECRET",
      "step-2",
      "exfil",
      "antidepressant",
      "user:pw",
      "a@b.c",
      "alert(",
      "evil)",
      "nonce-abc",
      "secret-ua",
      "203.0.113.7",
      "session=abc",
      "unexpected",
      "sample",
      "original",
    ]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("reduces non-http URLs to their scheme and unknown directives to 'other'", async () => {
    const { sink, logs, counts } = fakeSink();
    const report = {
      "csp-report": {
        "violated-directive": "made-up-directive-1234",
        "blocked-uri": "data:text/html;base64,PHNjcmlwdD4=",
        "document-uri": "not a url",
      },
    };
    await handleCspReport(
      post(JSON.stringify(report), "application/csp-report"),
      sink,
      createFloodGuard(),
    );
    expect(logs[0]?.fields).toEqual({
      directive: "other",
      blockedUri: "data",
      documentUri: "[unparseable]",
    });
    expect(counts[0]?.labels).toEqual({ directive: "other" });
  });

  it("accepts a media type with parameters", async () => {
    const { sink } = fakeSink();
    const res = await handleCspReport(
      post(JSON.stringify(legacy), "application/csp-report; charset=utf-8"),
      sink,
      createFloodGuard(),
    );
    expect(res.status).toBe(204);
  });

  it.each([["application/json"], ["text/plain"], [null]])(
    "415 for content-type %j",
    async (type) => {
      const { sink, logs } = fakeSink();
      const res = await handleCspReport(
        post(JSON.stringify(legacy), type),
        sink,
        createFloodGuard(),
      );
      expect(res.status).toBe(415);
      expect(logs).toEqual([]);
    },
  );

  it("405 for anything but POST", async () => {
    const { sink } = fakeSink();
    const res = await handleCspReport(
      post(null, "application/csp-report", "GET"),
      sink,
      createFloodGuard(),
    );
    expect(res.status).toBe(405);
  });

  it.each([
    ["not json", "application/csp-report", "{"],
    ["wrong shape (legacy)", "application/csp-report", JSON.stringify({ report: {} })],
    [
      "wrong shape (Reporting API)",
      "application/reports+json",
      JSON.stringify({ type: "csp-violation" }),
    ],
    [
      "wrong field type",
      "application/csp-report",
      JSON.stringify({ "csp-report": { "line-number": "12" } }),
    ],
    ["empty body", "application/csp-report", ""],
  ])("400 for %s", async (_name, type, body) => {
    const { sink, logs } = fakeSink();
    const res = await handleCspReport(post(body, type), sink, createFloodGuard());
    expect(res.status).toBe(400);
    expect(logs).toEqual([]);
  });

  it("413 over the cap, enforced on the stream even with a lying content-length", async () => {
    const { sink, logs } = fakeSink();
    const big = JSON.stringify({ "csp-report": { referrer: "x".repeat(CSP_REPORT_MAX_BYTES) } });
    const chunks = [big.slice(0, 1000), big.slice(1000)];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    const request = new Request("https://shop.example/api/csp-report", {
      method: "POST",
      body: stream,
      headers: { "content-type": "application/csp-report", "content-length": "100" },
      duplex: "half",
    } as RequestInit);
    const res = await handleCspReport(request, sink, createFloodGuard());
    expect(res.status).toBe(413);
    expect(logs).toEqual([]);
  });

  it("accepts a body exactly at the cap", async () => {
    const { sink } = fakeSink();
    const shell = (pad: string) =>
      JSON.stringify({ "csp-report": { "violated-directive": "img-src", x: pad } });
    const body = shell("y".repeat(CSP_REPORT_MAX_BYTES - shell("").length));
    expect(new TextEncoder().encode(body).byteLength).toBe(CSP_REPORT_MAX_BYTES);
    const res = await handleCspReport(
      post(body, "application/csp-report"),
      sink,
      createFloodGuard(),
    );
    expect(res.status).toBe(204);
  });
});

describe("createFloodGuard", () => {
  it("logs N reports per minute, drops the N+1st and reports the drops once per minute", async () => {
    let t = 0;
    const guard = createFloodGuard({ perMinute: 3, now: () => t });
    const { sink, logs, counts } = fakeSink();
    const send = () =>
      handleCspReport(post(JSON.stringify(legacy), "application/csp-report"), sink, guard);

    for (let i = 0; i < 5; i++) expect((await send()).status).toBe(204);
    expect(logs).toHaveLength(3); // 4th and 5th dropped from the logs…
    expect(counts.filter((c) => c.name === CSP_VIOLATION_EVENT)).toHaveLength(5); // …but counted
    expect(counts.some((c) => c.name === CSP_DROPPED_EVENT)).toBe(false); // not before the minute ends

    t = 60_000;
    await send();
    expect(counts.filter((c) => c.name === CSP_DROPPED_EVENT)).toEqual([
      { name: CSP_DROPPED_EVENT, labels: {}, value: 2 },
    ]);
    // the summary is also logged (metrics are a no-op until OTel), once
    expect(logs.filter((l) => l.event === CSP_DROPPED_EVENT)).toEqual([
      { event: CSP_DROPPED_EVENT, fields: { dropped: 2 } },
    ]);
    expect(logs.filter((l) => l.event === CSP_VIOLATION_EVENT)).toHaveLength(4); // the bucket refilled

    t = 120_000;
    await send();
    expect(counts.filter((c) => c.name === CSP_DROPPED_EVENT)).toHaveLength(1); // nothing new dropped
    expect(logs.filter((l) => l.event === CSP_DROPPED_EVENT)).toHaveLength(1);
  });

  it("refills continuously", () => {
    let t = 0;
    const guard = createFloodGuard({ perMinute: 60, now: () => t });
    const { sink } = fakeSink();
    for (let i = 0; i < 60; i++) expect(guard.take(sink)).toBe(true);
    expect(guard.take(sink)).toBe(false);
    t = 1_000; // one token per second
    expect(guard.take(sink)).toBe(true);
    expect(guard.take(sink)).toBe(false);
  });
});
