import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://igs:igs@localhost:5432/igs_pharma",
  AUTH_SECRET: "x".repeat(32),
  AUTH_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("parses a valid environment and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.DATABASE_MAX_CONNECTIONS).toBe(10);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.NEXT_PUBLIC_FEATURE_PRESCRIPTION_RESERVATIONS).toBe(false);
  });

  it("throws listing every missing required variable", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({})).toThrow(/AUTH_SECRET/);
    expect(() => parseEnv({})).toThrow(/AUTH_URL/);
  });

  it("rejects a too-short AUTH_SECRET", () => {
    expect(() => parseEnv({ ...valid, AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET/);
  });

  it("rejects an invalid URL and an invalid enum value", () => {
    expect(() => parseEnv({ ...valid, AUTH_URL: "not-a-url" })).toThrow(/AUTH_URL/);
    expect(() => parseEnv({ ...valid, LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });

  it("coerces numeric and boolean-like values", () => {
    const env = parseEnv({
      ...valid,
      DATABASE_MAX_CONNECTIONS: "25",
      NEXT_PUBLIC_FEATURE_PRESCRIPTION_RESERVATIONS: "true",
    });
    expect(env.DATABASE_MAX_CONNECTIONS).toBe(25);
    expect(env.NEXT_PUBLIC_FEATURE_PRESCRIPTION_RESERVATIONS).toBe(true);
  });
});
