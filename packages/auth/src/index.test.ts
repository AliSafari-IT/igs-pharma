import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.fn(() => ({}));
vi.mock("@igs/db/client", () => ({ getDb }));

const ENV_KEYS = ["DATABASE_URL", "AUTH_SECRET", "AUTH_URL"] as const;
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

describe("@igs/auth", () => {
  it("can be imported with no env vars and does not touch the database", async () => {
    const mod = await import("./index");

    expect(typeof mod.getAuth).toBe("function");
    expect(getDb).not.toHaveBeenCalled();
  });

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
