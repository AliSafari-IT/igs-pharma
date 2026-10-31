// The cart count of the header and the phone tab bar (igs-pharma#193): the sum of the quantities,
// a guest cart attached first for a signed-in customer, nothing at all while the cart is off.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  customer: null as null | { actor: { type: string; id: string; roles: string[] } },
  lines: [] as { quantity: number }[],
  attached: [] as string[],
  fail: false,
}));

vi.mock("next/navigation", () => ({ notFound: () => undefined }));
vi.mock("@igs/observability/logger", () => ({ logger: { error: () => undefined } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (state.cookie ? { value: state.cookie } : undefined),
  }),
}));
vi.mock("../src/server/customer", () => ({ currentCustomer: async () => state.customer }));
vi.mock("../src/server/kernel", () => ({ ensureKernelConfigured: async () => {} }));
vi.mock("../src/server/storefront", () => ({ localeOf: (value: string) => value }));
vi.mock("@igs/module-orders", () => ({
  attachCart: async (input: { cartToken: string }) => {
    state.attached.push(input.cartToken);
    return {};
  },
  getCart: async () => {
    if (state.fail) throw new Error("db down");
    return { cartId: "c", lines: state.lines, maxLines: 30, totalCents: 0 };
  },
}));

const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-";
const FLAGS = ["NEXT_PUBLIC_FEATURE_CART", "NEXT_PUBLIC_FEATURE_CUSTOMER_ACCOUNTS"] as const;
let saved: (string | undefined)[] = [];
beforeEach(() => {
  saved = FLAGS.map((key) => process.env[key]);
  process.env["NEXT_PUBLIC_FEATURE_CART"] = "true";
  Object.assign(state, { cookie: undefined, customer: null, lines: [], attached: [], fail: false });
});
afterEach(() => {
  FLAGS.forEach((key, i) => {
    const value = saved[i];
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  });
});

const count = async () => (await import("../src/server/cart")).cartItemCount("nl");

describe("cartItemCount", () => {
  it("is the sum of the quantities, 0 without a cart cookie", async () => {
    expect(await count()).toBe(0);
    state.cookie = TOKEN;
    state.lines = [{ quantity: 2 }, { quantity: 1 }];
    expect(await count()).toBe(3);
  });

  it("attaches a signed-in customer's guest cart before counting", async () => {
    process.env["NEXT_PUBLIC_FEATURE_CUSTOMER_ACCOUNTS"] = "true";
    state.cookie = TOKEN;
    state.customer = { actor: { type: "user", id: "u1", roles: ["customer"] } };
    state.lines = [{ quantity: 4 }];
    expect(await count()).toBe(4);
    expect(state.attached).toEqual([TOKEN]);
  });

  it("is null while the cart is off, and when the cart cannot be read", async () => {
    process.env["NEXT_PUBLIC_FEATURE_CART"] = "false";
    expect(await count()).toBeNull();
    process.env["NEXT_PUBLIC_FEATURE_CART"] = "true";
    state.cookie = TOKEN;
    state.fail = true;
    expect(await count()).toBeNull();
  });
});
