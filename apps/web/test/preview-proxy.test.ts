// The preview pass through the real proxy (igs-pharma#62): who gets past the closed storefront.
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// the proxy needs the global `next start` installs before any Next module loads
await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  Object.assign(globalThis, { AsyncLocalStorage });
});

import { POST as postPreview } from "../src/app/preview/route";
import { PREVIEW_COOKIE, PREVIEW_HEADER, createPreviewCookie } from "../src/preview";
import proxy, { COMING_SOON_PATH, PREVIEW_FORM_PATH } from "../src/proxy";

const BASE = "http://localhost:3000";
const KEY = "k".repeat(40);
const SECRET = "s".repeat(40);
const secrets = { key: KEY, secret: SECRET };

const call = (path: string, init: { cookie?: string; header?: string } = {}) => {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", `${PREVIEW_COOKIE}=${init.cookie}`);
  if (init.header) headers.set(PREVIEW_HEADER, init.header);
  return proxy(new NextRequest(`${BASE}${path}`, { headers }));
};
const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite");
const closed = (res: Response) => rewrittenTo(res) === `${BASE}${COMING_SOON_PATH}`;
const setCookie = (res: Response) => res.headers.get("set-cookie") ?? "";

function configure(env: Record<string, string>) {
  vi.stubEnv("SITE_GATE", "coming-soon");
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("IGS_PREVIEW_KEY", "");
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/preview (igs-pharma#91: the key is POSTed, never in a URL)", () => {
  const post = (path = "/preview") => proxy(new NextRequest(`${BASE}${path}`, { method: "POST" }));

  it("GET /preview shows the key form, noindex and uncached", () => {
    configure({ IGS_PREVIEW_KEY: KEY });
    const res = call("/preview");
    expect(rewrittenTo(res)).toBe(`${BASE}${PREVIEW_FORM_PATH}`);
    expect(setCookie(res)).toBe("");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a key in the URL no longer works: coming-soon and no cookie, even the right key", () => {
    configure({ IGS_PREVIEW_KEY: KEY });
    for (const path of [
      `/preview?key=${KEY}`,
      "/preview?key=",
      "/preview?key=wrong",
      `/preview/?key=${KEY}`,
      `/Preview?key=${KEY}`,
      `/nl/preview?key=${KEY}`,
    ]) {
      const res = call(path);
      expect(closed(res), path).toBe(true);
      expect(setCookie(res), path).toBe("");
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("POST /preview reaches the route handler; the proxy itself sets no cookie", () => {
    configure({ IGS_PREVIEW_KEY: KEY });
    const res = post();
    expect(closed(res)).toBe(false);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(setCookie(res)).toBe("");
  });

  it("with no (or a too short) IGS_PREVIEW_KEY, /preview is just another closed URL", () => {
    for (const key of ["", "short"]) {
      configure({ IGS_PREVIEW_KEY: key });
      for (const res of [call("/preview"), post(), call(`/preview?key=${key}`)]) {
        expect(closed(res), key).toBe(true);
        expect(setCookie(res), key).toBe("");
      }
    }
  });
});

describe("POST /preview (the route handler)", () => {
  const submit = (body: BodyInit | null, type = "application/x-www-form-urlencoded") =>
    postPreview(
      new Request(`${BASE}/preview`, {
        method: "POST",
        headers: { "content-type": type },
        ...(body === null ? {} : { body }),
      }),
    );
  const form = (key: string) => new URLSearchParams({ key }).toString();

  it("the right key: a signed, HttpOnly, Secure cookie for 8 hours and a 303 to /nl", async () => {
    configure({ IGS_PREVIEW_KEY: KEY });
    const res = await submit(form(KEY));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${BASE}/nl`);
    const cookie = setCookie(res);
    expect(cookie).toContain(`${PREVIEW_COOKIE}=v1.`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain("Max-Age=28800");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain(KEY);
  });

  it("anything else: a 303 to / (coming-soon), no cookie, no hint", async () => {
    configure({ IGS_PREVIEW_KEY: KEY });
    for (const body of [
      form(""),
      form("wrong"),
      form(`${KEY}x`),
      form(KEY.slice(1)),
      form(KEY.repeat(20)),
      "",
      null,
    ]) {
      const res = await submit(body);
      expect(res.status, String(body)).toBe(303);
      expect(res.headers.get("location"), String(body)).toBe(`${BASE}/`);
      expect(setCookie(res), String(body)).toBe("");
    }
    const json = await submit(JSON.stringify({ key: KEY }), "application/json");
    expect(setCookie(json)).toBe("");
  });

  it("with no IGS_PREVIEW_KEY configured, no key works", async () => {
    configure({});
    const res = await submit(form(KEY));
    expect(res.headers.get("location")).toBe(`${BASE}/`);
    expect(setCookie(res)).toBe("");
  });
});

describe("the preview cookie", () => {
  const fresh = () => createPreviewCookie(secrets, Date.now());

  it("lets a request past the gate, still noindex and uncached, and marks it as preview", () => {
    configure({ IGS_PREVIEW_KEY: KEY });
    const res = call("/nl", { cookie: fresh() });
    expect(closed(res)).toBe(false);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    // the marker the pages read to show the banner travels on the forwarded request
    expect(res.headers.get(`x-middleware-request-${PREVIEW_HEADER}`)).toBe("1");
  });

  it("keeps the public on coming-soon: no cookie, an expired, forged or wrong-key cookie", () => {
    configure({ IGS_PREVIEW_KEY: KEY });
    const expired = createPreviewCookie(secrets, Date.now() - 9 * 3_600_000);
    const otherKey = createPreviewCookie({ ...secrets, key: "j".repeat(40) }, Date.now());
    for (const cookie of [undefined, expired, otherKey, "v1.9999999999.AAAA", "x"]) {
      const res = call("/nl", cookie ? { cookie } : {});
      expect(closed(res), String(cookie)).toBe(true);
      expect(res.headers.get(`x-middleware-request-${PREVIEW_HEADER}`)).toBeNull();
    }
  });

  it("is worth nothing once the key is removed from the configuration", () => {
    const cookie = fresh();
    configure({});
    expect(closed(call("/nl", { cookie }))).toBe(true);
  });

  it("is ignored when the gate is off, and a client cannot set the preview marker itself", () => {
    configure({ IGS_PREVIEW_KEY: KEY, SITE_GATE: "off" });
    const res = call("/nl", { cookie: fresh(), header: "1" });
    expect(closed(res)).toBe(false);
    expect(res.headers.get(`x-middleware-request-${PREVIEW_HEADER}`)).toBeNull();

    configure({ IGS_PREVIEW_KEY: KEY });
    const spoofed = call("/nl", { header: "1" });
    expect(closed(spoofed)).toBe(true);
    expect(spoofed.headers.get(`x-middleware-request-${PREVIEW_HEADER}`)).toBeNull();
  });
});

describe("/preview/end", () => {
  it("clears the cookie and sends the visitor to the public face", () => {
    configure({ IGS_PREVIEW_KEY: KEY });
    const res = call("/preview/end", {
      cookie: createPreviewCookie(secrets, Date.now()),
    });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${BASE}/`);
    expect(setCookie(res)).toContain(`${PREVIEW_COOKIE}=;`);
    expect(setCookie(res)).toContain("Max-Age=0");
  });

  it("with no key configured, reveals nothing: coming-soon, no cookie change (#91)", () => {
    configure({});
    const res = call("/preview/end");
    expect(closed(res)).toBe(true);
    expect(setCookie(res)).toBe("");
  });
});
