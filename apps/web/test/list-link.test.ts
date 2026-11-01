// igs-pharma#218: "Order my list", the signed link from the Android app's list to the website cart.
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LIST_LINK_MAX,
  LIST_LINK_TTL_S,
  createListToken,
  listCnks,
  verifyListToken,
} from "../src/list-link";

const SECRET = "list-link-test-secret-0123456789abcdef";
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const CNKS = ["1234567", "7654321"];

describe("listCnks", () => {
  it("takes 1 to 30 CNKs of 7 digits, in order, each once", () => {
    expect(listCnks(["1234567", "7654321", "1234567"])).toEqual(["1234567", "7654321"]);
    const thirty = Array.from({ length: LIST_LINK_MAX }, (_, i) => String(1000000 + i));
    expect(listCnks(thirty)).toHaveLength(30);
  });

  it("refuses anything else rather than trimming it", () => {
    for (const bad of [
      [],
      "1234567",
      ["123456"],
      ["12345678"],
      ["123456a"],
      [1234567],
      [...Array.from({ length: LIST_LINK_MAX + 1 }, (_, i) => String(1000000 + i))],
      null,
    ]) {
      expect(listCnks(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("the list token", () => {
  it("round-trips: the same CNKs, valid for 15 minutes", () => {
    const { token, expiresAt } = createListToken(SECRET, CNKS, NOW);
    expect(token).toMatch(/^v1\.1234567-7654321\.[0-9]+\.[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime()).toBe(NOW + LIST_LINK_TTL_S * 1000);
    expect(verifyListToken(SECRET, token, NOW + 60_000)).toEqual({
      ok: true,
      cnks: CNKS,
      expiresAt,
    });
  });

  it("is expired once its time is up", () => {
    const { token } = createListToken(SECRET, CNKS, NOW);
    expect(verifyListToken(SECRET, token, NOW + LIST_LINK_TTL_S * 1000)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("is invalid when altered, signed with another secret, or malformed", () => {
    const { token } = createListToken(SECRET, CNKS, NOW);
    const [v, cnks, exp, sig] = token.split(".") as [string, string, string, string];
    const invalid = { ok: false, reason: "invalid" };
    for (const bad of [
      `${v}.1234567-7654322.${exp}.${sig}`, // another product
      `${v}.1234567.${exp}.${sig}`, // a product removed
      `${v}.${cnks}.${Number(exp) + 60}.${sig}`, // more time
      `v2.${cnks}.${exp}.${sig}`,
      `${v}.${cnks}.${exp}`,
      `${v}.${cnks}.${exp}.${sig}x`,
      `${v}.${cnks}.${exp}.${sig}!`, // Node would skip the "!": only the exact encoding counts
      `${v}.1234567-1234567.${exp}.${sig}`, // a duplicate is never signed
      "",
      "x".repeat(700),
    ]) {
      expect(verifyListToken(SECRET, bad, NOW), bad.slice(0, 40)).toEqual(invalid);
    }
    expect(verifyListToken("another-secret-0123456789abcdef0123", token, NOW)).toEqual(invalid);
    expect(verifyListToken(null, token, NOW)).toEqual(invalid);
    expect(verifyListToken(SECRET, null, NOW)).toEqual(invalid);
  });

  it("refuses an expiry further out than the server ever grants", () => {
    const { token } = createListToken(SECRET, CNKS, NOW + 3_600_000);
    expect(verifyListToken(SECRET, token, NOW)).toEqual({ ok: false, reason: "invalid" });
  });
});

// the route reads no database; these keep the server-only code of the storefront modules out
vi.mock("@igs/module-storefront", () => ({ listStorefrontCategories: vi.fn() }));
vi.mock("../src/server/kernel", () => ({ ensureKernelConfigured: vi.fn(async () => {}) }));
vi.mock("@igs/kernel", () => ({ isDomainError: () => false }));
const flags = vi.hoisted(() => ({ cart: true }));
vi.mock("@igs/config/feature-flags", () => ({ getFeatureFlags: () => flags }));

describe("POST /api/mobile/v1/list-link", () => {
  const post = async (body: unknown, raw?: string) => {
    const { POST } = await import("../src/app/api/mobile/v1/list-link/route");
    return POST(
      new NextRequest("http://localhost:3000/api/mobile/v1/list-link", {
        method: "POST",
        body: raw ?? JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    );
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    flags.cart = true;
  });

  const configured = () => {
    vi.stubEnv("STOREFRONT_URL", "https://igs-pharma.example");
    vi.stubEnv("AUTH_SECRET", SECRET);
  };

  it("answers the link to the list page, signed, not cached", async () => {
    configured();
    const response = await post({ cnks: ["1234567", "7654321"], locale: "fr" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { url: string; expiresAt: string };
    const url = new URL(body.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://igs-pharma.example/fr/cart/from-list");
    const check = verifyListToken(SECRET, url.searchParams.get("l"), Date.now());
    expect(check).toMatchObject({ ok: true, cnks: ["1234567", "7654321"] });
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("defaults to Dutch; a bad list or locale is invalid_input", async () => {
    configured();
    const nl = (await (await post({ cnks: ["1234567"] })).json()) as { url: string };
    expect(new URL(nl.url).pathname).toBe("/nl/cart/from-list");
    for (const body of [{ cnks: [] }, { cnks: ["12"] }, { cnks: ["1234567"], locale: "xx" }, {}]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expect((await post(undefined, "not json")).status).toBe(400);
    expect((await post(undefined, "x".repeat(5000))).status).toBe(400);
    expect((await post({ cnks: ["1234567"], locale: { toString: null } })).status).toBe(400);
    expect((await post({ cnks: ["1234567"], locale: ["nl"] })).status).toBe(400);
  });

  it("refuses a large body that does not announce its length, while reading it", async () => {
    configured();
    const { POST } = await import("../src/app/api/mobile/v1/list-link/route");
    let pulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(1024));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk); // never ends by itself
      },
    });
    const response = await POST(
      new Request("http://localhost:3000/api/mobile/v1/list-link", {
        method: "POST",
        body,
        // @ts-expect-error: Node's fetch needs this for a streamed body
        duplex: "half",
      }),
    );
    expect(response.status).toBe(400);
    expect(pulled).toBeLessThan(10);
  });

  it("is unavailable while the cart is off or the storefront address is not set", async () => {
    configured();
    flags.cart = false;
    expect((await post({ cnks: ["1234567"] })).status).toBe(503);
    flags.cart = true;
    vi.stubEnv("STOREFRONT_URL", "");
    const response = await post({ cnks: ["1234567"] });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});
