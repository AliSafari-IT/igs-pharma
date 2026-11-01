// The storefront cart (igs-pharma#116): the cookie, the form parsing and the `?result=` keys, and the
// cart page's flag gate (404 for every flag value but "true", and for an unknown locale).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CART_COOKIE,
  CART_RESULTS,
  cartCookieOptions,
  isCartToken,
  isSuccessResult,
  productIdOf,
  quantityOf,
  resultMessageKey,
  resultOf,
  resultOfCode,
} from "../src/lib/cart-area";

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("../src/server/customer", () => ({ currentCustomer: async () => null }));
vi.mock("../src/server/kernel", () => ({ ensureKernelConfigured: async () => {} }));
vi.mock("@igs/module-orders", () => ({ attachCart: async () => ({}) }));
vi.mock("../src/server/storefront", () => ({
  localeOf: (value: string) => (["nl", "fr", "de", "en"].includes(value) ? value : null),
}));

const KEY = "NEXT_PUBLIC_FEATURE_CART";
let saved: string | undefined;
beforeEach(() => {
  saved = process.env[KEY];
});
afterEach(() => {
  if (saved === undefined) Reflect.deleteProperty(process.env, KEY);
  else process.env[KEY] = saved;
});

describe("the cart cookie", () => {
  it("is a __Host- cookie: Secure, path /, no Domain, HttpOnly, SameSite=Lax, 30 days", () => {
    expect(CART_COOKIE.startsWith("__Host-")).toBe(true);
    expect(cartCookieOptions).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 86_400,
    });
    expect("domain" in cartCookieOptions).toBe(false);
  });

  it("accepts only a 22-character base64url value", () => {
    expect(isCartToken("AbCdEfGhIjKlMnOpQrSt_-")).toBe(true);
    for (const bad of [
      undefined,
      "",
      "short",
      "AbCdEfGhIjKlMnOpQrSt_-x",
      "AbCdEfGhIjKlMnOpQrSt+/",
    ]) {
      expect(isCartToken(bad), String(bad)).toBe(false);
    }
  });
});

describe("the cart forms", () => {
  it("take a whole quantity from 0 to 100 and a UUID product id", () => {
    expect([quantityOf("0"), quantityOf("7"), quantityOf("100")]).toEqual([0, 7, 100]);
    for (const bad of [null, "", "-1", "101", "1.5", "2e1", " 3"]) {
      expect(quantityOf(bad), String(bad)).toBeNull();
    }
    expect(productIdOf("0192f000-0000-7000-8000-000000000001")).toBe(
      "0192f000-0000-7000-8000-000000000001",
    );
    expect(productIdOf("../etc")).toBeNull();
  });

  it("map refusals to results, and results to messages", () => {
    expect(resultOfCode("orders.cart_quantity_limit")).toBe("limit");
    expect(resultOfCode("orders.cart_full")).toBe("full");
    expect(resultOfCode("catalog.product_not_sellable")).toBe("unavailable");
    expect(resultOfCode("kernel.anything")).toBe("failed");
    expect(resultOf({ result: "added" })).toBe("added");
    expect(resultOf({ result: "<script>" })).toBeNull();
    expect(CART_RESULTS.filter(isSuccessResult)).toEqual([
      "added",
      "updated",
      "removed",
      "listAdded",
      "listPartly",
      "listFull",
    ]);
    expect(resultMessageKey("full")).toBe("resultFull");
  });

  it("every result has a message in every locale", async () => {
    for (const locale of ["nl", "fr", "de", "en"]) {
      const messages = (await import(`../../../packages/i18n/messages/${locale}.json`)).default;
      for (const result of CART_RESULTS) {
        expect(messages.cart[resultMessageKey(result)], `${locale} ${result}`).toBeTruthy();
      }
      expect(messages.storefront.headerCart, locale).toBeTruthy();
    }
  });
});

describe("the cart page", () => {
  it("is a 404 while the flag is off or unset, and for an unknown locale", async () => {
    const { cartLocale } = await import("../src/server/cart");
    for (const value of [undefined, "false", "", "yes", "TRUE", "1"]) {
      if (value === undefined) Reflect.deleteProperty(process.env, KEY);
      else process.env[KEY] = value;
      expect(() => cartLocale("nl"), String(value)).toThrow(NOT_FOUND);
    }
    process.env[KEY] = "true";
    for (const locale of ["nl", "fr", "de", "en"]) expect(cartLocale(locale)).toBe(locale);
    expect(() => cartLocale("es")).toThrow(NOT_FOUND);
  });

  it("a guest works as an anonymous actor whose id is never the cookie", async () => {
    const { cartActor, GUEST_ACTOR } = await import("../src/server/cart");
    expect(GUEST_ACTOR).toEqual({ type: "anonymous", id: "storefront-guest", roles: [] });
    expect(await cartActor()).toEqual({ actor: GUEST_ACTOR, token: undefined });
  });
});
