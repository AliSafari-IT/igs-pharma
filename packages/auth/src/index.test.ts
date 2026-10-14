import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.fn(() => ({}));
vi.mock("@igs/db/client", () => ({ getDb }));

const ENV_KEYS = ["DATABASE_URL", "AUTH_SECRET", "AUTH_URL", "STOREFRONT_URL"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    Reflect.deleteProperty(process.env, key);
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
  vi.resetModules();
  getDb.mockClear();
});

/**
 * The first `import("./index")` of a worker loads the whole Better Auth graph (plugins, WebAuthn,
 * the identity schema) and transforms it. Measured on the CI runner (igs-pharma#107): 12.7 to
 * 19.3 s in the four runs where it passed and 30.4 s in the one that timed out, against 1 to 2 s on a developer
 * machine; the four imports after it, from the transform cache, stay under the reporter's 300 ms line. So the cost
 * is real and one-off, and the default 30 s left no margin. This test gets its own, wider budget;
 * the rest of the suite keeps the 30 s default, and the config runs the files one at a time.
 */
const COLD_IMPORT_TIMEOUT_MS = 90_000;

describe("@igs/auth", () => {
  it(
    "can be imported with no env vars and does not touch the database",
    async () => {
      const mod = await import("./index");

      expect(typeof mod.getAuth).toBe("function");
      expect(getDb).not.toHaveBeenCalled();
    },
    COLD_IMPORT_TIMEOUT_MS,
  );

  it("getAuth() fails fast on invalid env instead of at import time", async () => {
    const { configureAuth, getAuth } = await import("./index");
    configureAuth({ onSecurityEvent: async () => {} });
    expect(() => getAuth()).toThrow(/Invalid environment configuration/);
  });

  it("getAuth() refuses to start before configureAuth (no unaudited factor changes, 36b)", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    process.env.AUTH_SECRET = "x".repeat(32);
    process.env.AUTH_URL = "http://localhost:3001";
    const { getAuth } = await import("./index");
    expect(() => getAuth()).toThrow(/auth\.not_configured/);
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("customer instance (#114)", () => {
  const configured = () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    process.env.AUTH_SECRET = "x".repeat(32);
    process.env.AUTH_URL = "http://localhost:3001";
  };

  it("importing the module builds no customer instance and touches no database", async () => {
    const mod = await import("./index");
    expect(typeof mod.getCustomerAuth).toBe("function");
    expect(typeof mod.createStaffAuth).toBe("function");
    expect(mod.createAuth).toBe(mod.createStaffAuth); // the old name still works
    expect(getDb).not.toHaveBeenCalled();
  });

  it("getCustomerAuth() refuses to start before configureCustomerAuth, so no mail is dropped silently", async () => {
    configured();
    process.env.STOREFRONT_URL = "http://localhost:3000";
    const { getCustomerAuth } = await import("./index");
    expect(() => getCustomerAuth()).toThrow(/auth\.not_configured.*configureCustomerAuth/);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("getCustomerAuth() refuses to start without STOREFRONT_URL", async () => {
    configured();
    Reflect.deleteProperty(process.env, "STOREFRONT_URL");
    const { configureCustomerAuth, getCustomerAuth } = await import("./index");
    configureCustomerAuth({ requestMail: async () => {} });
    expect(() => getCustomerAuth()).toThrow(/STOREFRONT_URL/);
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("sessionTokenFromCookies (#95)", () => {
  it("reads the token from the signed session cookie, with or without the HTTPS prefix", async () => {
    const { sessionTokenFromCookies } = await import("./index");
    expect(sessionTokenFromCookies("a=b; better-auth.session_token=abc123.sig%2Bnature; c=d")).toBe(
      "abc123",
    );
    expect(sessionTokenFromCookies("__Secure-better-auth.session_token=tok.sig")).toBe("tok");
  });

  it("never mistakes a customer cookie (igs-c) for a staff session", async () => {
    const { sessionTokenFromCookies } = await import("./index");
    expect(sessionTokenFromCookies("igs-c.session_token=abc.sig")).toBeNull();
    expect(sessionTokenFromCookies("__Secure-igs-c.session_token=abc.sig")).toBeNull();
  });

  it("finds nothing in an unrelated or empty header", async () => {
    const { sessionTokenFromCookies } = await import("./index");
    expect(sessionTokenFromCookies(null)).toBeNull();
    expect(sessionTokenFromCookies("theme=dark")).toBeNull();
    expect(sessionTokenFromCookies("better-auth.session_token=")).toBeNull();
  });
});
