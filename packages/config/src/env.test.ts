import { describe, expect, it } from "vitest";

import {
  appEnv,
  auditEnv,
  authEnv,
  cspEnv,
  cspReportingEnabled,
  parseEnv,
  parseEnvFor,
  workerEnv,
} from "./env";

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

describe("parseEnvFor (per-process schemas)", () => {
  const dbOnly = { DATABASE_URL: valid.DATABASE_URL };

  it("worker schema starts without AUTH_*", () => {
    const env = parseEnvFor(workerEnv, dbOnly);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.NODE_ENV).toBe("development");
    expect("AUTH_SECRET" in env).toBe(false);
  });

  it("worker schema still fails readably without DATABASE_URL", () => {
    expect(() => parseEnvFor(workerEnv, {})).toThrow(/Invalid environment configuration/);
    expect(() => parseEnvFor(workerEnv, {})).toThrow(/DATABASE_URL/);
    expect(() => parseEnvFor(workerEnv, {})).not.toThrow(/AUTH_/);
  });

  it("the full schema (parseEnv) still requires AUTH_*", () => {
    expect(() => parseEnv(dbOnly)).toThrow(/AUTH_SECRET/);
  });

  it("composes arbitrary schemas", () => {
    expect(() => parseEnvFor(authEnv, {})).toThrow(/AUTH_URL/);
  });
});

describe("CSP_REPORTING (T-013)", () => {
  const schema = appEnv.extend(cspEnv.shape);
  const enabled = (env: NodeJS.ProcessEnv) => cspReportingEnabled(parseEnvFor(schema, env));

  it("defaults to on in production and off elsewhere", () => {
    expect(enabled({ NODE_ENV: "production" })).toBe(true);
    expect(enabled({ NODE_ENV: "development" })).toBe(false);
    expect(enabled({ NODE_ENV: "test" })).toBe(false);
    expect(enabled({})).toBe(false);
    expect(enabled({ NODE_ENV: "production", CSP_REPORTING: "" })).toBe(true); // empty = unset
  });

  it("an explicit on/off wins", () => {
    expect(enabled({ NODE_ENV: "production", CSP_REPORTING: "off" })).toBe(false);
    expect(enabled({ NODE_ENV: "development", CSP_REPORTING: "on" })).toBe(true);
  });

  it("rejects anything but on/off", () => {
    expect(() => enabled({ CSP_REPORTING: "yes" })).toThrow(/CSP_REPORTING/);
  });
});

describe("auditEnv", () => {
  it("requires AUDIT_HMAC_KEY of at least 32 chars", () => {
    expect(() => parseEnvFor(auditEnv, {})).toThrow(/AUDIT_HMAC_KEY/);
    expect(() => parseEnvFor(auditEnv, { AUDIT_HMAC_KEY: "short" })).toThrow(/AUDIT_HMAC_KEY/);
    expect(parseEnvFor(auditEnv, { AUDIT_HMAC_KEY: "k".repeat(32) }).AUDIT_HMAC_KEY).toHaveLength(
      32,
    );
  });
});
