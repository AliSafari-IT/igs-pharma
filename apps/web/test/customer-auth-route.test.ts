// The customer auth routes (igs-pharma#114): 404 while NEXT_PUBLIC_FEATURE_CUSTOMER_ACCOUNTS is off,
// with nothing configured or opened for the refused request; the Better Auth handler when it is on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handler = vi.fn(async () => new Response("handled", { status: 200 }));
const getCustomerAuth = vi.fn(() => ({ handler }));
const ensureAuthConfigured = vi.fn();
vi.mock("@igs/auth", () => ({ getCustomerAuth }));
vi.mock("../src/server/kernel", () => ({ ensureAuthConfigured }));

const KEY = "NEXT_PUBLIC_FEATURE_CUSTOMER_ACCOUNTS";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[KEY];
  handler.mockClear();
  getCustomerAuth.mockClear();
  ensureAuthConfigured.mockClear();
});
afterEach(() => {
  if (saved === undefined) Reflect.deleteProperty(process.env, KEY);
  else process.env[KEY] = saved;
});

const request = (method: "GET" | "POST") =>
  new Request("http://localhost:3000/api/auth/sign-up/email", { method });

describe("/api/auth/[...all] on the storefront", () => {
  it("answers 404 and does nothing else while the flag is off or unset", async () => {
    const { GET, POST } = await import("../src/app/api/auth/[...all]/route");
    for (const value of [undefined, "false", "", "yes", "TRUE"]) {
      if (value === undefined) Reflect.deleteProperty(process.env, KEY);
      else process.env[KEY] = value;
      expect((await GET(request("GET"))).status, String(value)).toBe(404);
      expect((await POST(request("POST"))).status, String(value)).toBe(404);
    }
    expect(ensureAuthConfigured).not.toHaveBeenCalled();
    expect(getCustomerAuth).not.toHaveBeenCalled();
  });

  it("hands the request to the customer instance, after the composition root, when the flag is on", async () => {
    process.env[KEY] = "true";
    const { POST } = await import("../src/app/api/auth/[...all]/route");
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("handled");
    expect(ensureAuthConfigured).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
