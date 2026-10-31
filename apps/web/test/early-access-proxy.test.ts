// The early-access pass through the real proxy (igs-pharma#199): who gets past the closed storefront,
// what stays reachable to ask for access, and that no redirect is built from the request's address.
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  Object.assign(globalThis, { AsyncLocalStorage });
});

import {
  EARLY_ACCESS_HEADER,
  GATE_HEADER,
  PASS_COOKIE,
  PASS_PATH,
  PASS_TTL_S,
  RETURN_HEADER,
  createPass,
} from "../src/early-access";
import proxy, { COMING_SOON_PATH } from "../src/proxy";

// what the container sees behind the edge: never the public address
const BASE = "http://0.0.0.0:3000";
const SECRET = "s".repeat(40);
const USER = "0192f3a4-5b6c-7d8e-9f01-23456789abcd";
const SESSION = "token123.signature456";
const SESSION_COOKIE = "__Secure-igs-c.session_token";

interface Init {
  readonly pass?: string;
  readonly session?: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
}

function call(path: string, init: Init = {}) {
  const headers = new Headers(init.headers);
  const cookies: string[] = [];
  if (init.pass) cookies.push(`${PASS_COOKIE}=${init.pass}`);
  if (init.session) cookies.push(`${SESSION_COOKIE}=${init.session}`);
  if (cookies.length > 0) headers.set("cookie", cookies.join("; "));
  return proxy(new NextRequest(`${BASE}${path}`, { headers, method: init.method ?? "GET" }));
}
const closed = (res: Response) =>
  res.headers.get("x-middleware-rewrite") === `${BASE}${COMING_SOON_PATH}`;
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);
const fresh = () => createPass(SECRET, USER, SESSION, Date.now(), Date.now() + 86_400_000);
const stale = () =>
  createPass(SECRET, USER, SESSION, Date.now() - (PASS_TTL_S + 60) * 1000, Date.now() + 86_400_000);

function configure(env: Record<string, string> = {}) {
  vi.stubEnv("SITE_GATE", "coming-soon");
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_FEATURE_CUSTOMER_ACCOUNTS", "true");
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the shared preview key is gone (igs-pharma#199, part 4)", () => {
  it("/preview and /preview/end are just closed URLs: coming-soon in place, no cookie, no form", () => {
    // even with the old variable still set on a server: nothing reads it any more
    configure({ IGS_PREVIEW_KEY: "k".repeat(40) });
    for (const [path, method] of [
      ["/preview", "GET"],
      ["/preview", "POST"],
      [`/preview?key=${"k".repeat(40)}`, "GET"],
      ["/preview/end", "GET"],
    ] as const) {
      const res = call(path, { method });
      expect(closed(res), `${method} ${path}`).toBe(true);
      expect(res.headers.get("set-cookie"), `${method} ${path}`).toBeNull();
      expect(res.headers.get("location"), `${method} ${path}`).toBeNull();
    }
  });
});

describe("a valid pass", () => {
  it("opens the shop for its session, still noindex and uncached, with the banner marker", () => {
    configure();
    const res = call("/nl/c/pijn", { pass: fresh(), session: SESSION });
    expect(closed(res)).toBe(false);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(forwarded(res, EARLY_ACCESS_HEADER)).toBe("1");
    expect(forwarded(res, GATE_HEADER)).toBeNull();
  });

  it("does nothing for another session, without a session, or with a forged pass", () => {
    configure();
    for (const init of [
      { pass: fresh(), session: "token999.other" },
      { pass: fresh() },
      { pass: "v1.x.1.y", session: SESSION },
    ]) {
      const res = call("/nl", init);
      expect(closed(res), JSON.stringify(init)).toBe(true);
      expect(res.headers.get("location")).toBeNull();
      expect(forwarded(res, EARLY_ACCESS_HEADER)).toBeNull();
    }
  });

  it("does not open the Android app's API (decision 1): still 503 coming_soon", async () => {
    configure();
    const res = call("/api/mobile/v1/products", { pass: fresh(), session: SESSION });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "coming_soon" });
  });

  it("is ignored when the gate is off, and nobody can send the markers themselves", () => {
    configure({ SITE_GATE: "off" });
    const open = call("/nl", { pass: fresh(), session: SESSION });
    expect(forwarded(open, EARLY_ACCESS_HEADER)).toBeNull();

    configure();
    const spoofed = call("/nl", {
      headers: { [EARLY_ACCESS_HEADER]: "1", [GATE_HEADER]: "open", [RETURN_HEADER]: "/x" },
    });
    expect(closed(spoofed)).toBe(true);
    expect(forwarded(spoofed, EARLY_ACCESS_HEADER)).toBeNull();
    expect(forwarded(spoofed, RETURN_HEADER)).toBeNull();
  });
});

describe("a pass that ran out", () => {
  it("hands a page view to the pass route for a re-check, query kept; never a redirect", () => {
    configure();
    const res = call("/fr/search?q=aspirine&page=2", { pass: stale(), session: SESSION });
    // a rewrite: the proxy cannot send a relative Location, and an absolute one would carry the
    // container's address (`0.0.0.0:3000`); the pass route answers with a relative 303 instead
    expect(res.headers.get("location")).toBeNull();
    expect(new URL(res.headers.get("x-middleware-rewrite") ?? "").pathname).toBe(PASS_PATH);
    // a rewritten request keeps the URL asked for: the page to return to travels in a header
    expect(forwarded(res, RETURN_HEADER)).toBe("/fr/search?q=aspirine&page=2");
  });

  it("anything that is not a page view just gets the coming-soon page", () => {
    configure();
    expect(closed(call("/nl", { pass: stale(), session: SESSION, method: "POST" }))).toBe(true);
    const mobile = call("/api/mobile/v1/products", { pass: stale(), session: SESSION });
    expect(mobile.status).toBe(503);
  });
});

describe("the way in while the shop is closed", () => {
  const WAY_IN = [
    "/nl/early-access",
    "/early-access",
    "/fr/account/sign-in",
    "/de/account/sign-up",
    "/en/account/verify-email",
    "/nl/account/forgot-password",
    "/nl/account/reset-password",
  ];

  it("the early-access and sign-in pages are reachable, marked for the closed frame", () => {
    configure();
    for (const path of WAY_IN) {
      const res = call(path);
      expect(closed(res), path).toBe(false);
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
      if (path === "/early-access") {
        // no locale yet: next-intl's usual redirect to the visitor's language comes first
        expect(res.headers.get("location"), path).toMatch(/\/nl\/early-access$/);
      } else {
        // every page renders in the frame that shows nothing of the shop
        expect(forwarded(res, GATE_HEADER), path).toBe("closed");
      }
    }
  });

  it("the customer sign-in API and the pass route are reachable too", () => {
    configure();
    for (const path of ["/api/auth/sign-in/email", PASS_PATH]) {
      const res = call(path, { method: path === PASS_PATH ? "GET" : "POST" });
      expect(closed(res), path).toBe(false);
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("nothing else of the account area, and a signed-in visitor without a pass is not redirected", () => {
    configure();
    for (const path of ["/nl/account", "/nl/account/orders", "/nl/cart", "/nl/early-access/x"]) {
      const res = call(path, { session: SESSION });
      expect(closed(res), path).toBe(true);
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("with customer accounts off, the way in is closed like everything else", () => {
    configure({ NEXT_PUBLIC_FEATURE_CUSTOMER_ACCOUNTS: "false" });
    for (const path of [...WAY_IN, "/api/auth/sign-in/email", PASS_PATH]) {
      expect(closed(call(path)), path).toBe(true);
    }
    // nobody can hold a pass without accounts: an old one opens nothing and is never re-checked
    for (const pass of [fresh(), stale()]) {
      const res = call("/nl", { pass, session: SESSION });
      expect(closed(res)).toBe(true);
      expect(forwarded(res, EARLY_ACCESS_HEADER)).toBeNull();
    }
  });
});
