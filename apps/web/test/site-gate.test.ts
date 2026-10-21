// The storefront gate (igs-pharma#46, IGS-D4) in both modes, through the real proxy and robots route.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// next/experimental/testing/server needs the global `next start` installs before any Next module loads
await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  Object.assign(globalThis, { AsyncLocalStorage });
});

import robots from "../src/app/robots";
import proxy, { COMING_SOON_PATH, config } from "../src/proxy";

const BASE = "http://localhost:3000";
const call = (path: string) => proxy(new NextRequest(`${BASE}${path}`));
const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite");

const PAGES = [
  "/",
  "/nl",
  "/fr/producten/x",
  "/de",
  "/en",
  "/apixaban",
  "/coming-soon",
  "/nl/x.html",
  "/index.php",
];
const OPEN = [
  "/api/health",
  "/api/health/live",
  "/api/csp-report",
  "/api/webhooks/mollie",
  "/.well-known/asafarim-app.json",
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy matcher", () => {
  // Next's own matcher logic, the code `next start` runs to decide whether the proxy is invoked
  const matches = (path: string) => unstable_doesMiddlewareMatch({ config, url: `${BASE}${path}` });

  it("runs the proxy for every page, dotted paths included, and for API and well-known routes", () => {
    for (const path of [...PAGES, ...OPEN, "/api", "/api/orders", "/.well-known/security.txt"]) {
      expect(matches(path), path).toBe(true);
    }
  });

  it("skips only Next.js internals and the root files that answer for themselves", () => {
    for (const path of [
      "/_next/static/chunks/a.js",
      "/_vercel/insights",
      "/robots.txt",
      "/favicon.ico",
    ]) {
      expect(matches(path), path).toBe(false);
    }
  });
});

describe("SITE_GATE=coming-soon", () => {
  it("answers every page with the coming-soon page in place, noindex and uncached", () => {
    vi.stubEnv("SITE_GATE", "coming-soon");
    for (const path of PAGES) {
      const res = call(path);
      expect(rewrittenTo(res), path).toBe(`${BASE}${COMING_SOON_PATH}`);
      expect(res.headers.get("location"), path).toBeNull(); // no redirect to follow
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
      expect(res.headers.get("cache-control"), path).toBe("no-store");
      expect(res.headers.get("content-security-policy"), path).toContain("default-src 'self'");
    }
  });

  it("closes API routes it does not list (fail closed for routes added later)", () => {
    vi.stubEnv("SITE_GATE", "coming-soon");
    expect(rewrittenTo(call("/api/orders"))).toBe(`${BASE}${COMING_SOON_PATH}`);
    expect(rewrittenTo(call("/api/healthz"))).toBe(`${BASE}${COMING_SOON_PATH}`);
  });

  it("keeps health, the OS manifest and CSP reports reachable, still noindex", () => {
    vi.stubEnv("SITE_GATE", "coming-soon");
    for (const path of OPEN) {
      const res = call(path);
      expect(rewrittenTo(res), path).toBeNull();
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
    }
  });

  it("robots.txt disallows everything", () => {
    vi.stubEnv("SITE_GATE", "coming-soon");
    expect(robots().rules).toEqual({ userAgent: "*", disallow: "/" });
  });

  it("is the default in production when SITE_GATE is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_GATE", "");
    expect(rewrittenTo(call("/nl"))).toBe(`${BASE}${COMING_SOON_PATH}`);
    expect(robots().rules).toEqual({ userAgent: "*", disallow: "/" });
  });
});

describe("SITE_GATE=off", () => {
  it("serves the storefront as before: locale routing, no noindex", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_GATE", "off");
    const root = call("/");
    expect(rewrittenTo(root) ?? "").not.toContain(COMING_SOON_PATH);
    expect(root.headers.get("location")).toBe(`${BASE}/nl`);
    expect(root.headers.get("x-robots-tag")).toBeNull();
    // /coming-soon is not a storefront page: it gets a locale like any other unknown path
    expect(call("/coming-soon").headers.get("location")).toBe(`${BASE}/nl/coming-soon`);
    expect(call("/api/health/live").headers.get("x-middleware-next")).toBe("1");
    expect(robots().rules).toEqual({ userAgent: "*", allow: "/" });
  });
});
