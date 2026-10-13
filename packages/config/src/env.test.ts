import { describe, expect, it } from "vitest";

import {
  adoptMigrateDsn,
  appEnv,
  auditEnv,
  authEnv,
  cspEnv,
  cspReportingEnabled,
  migrateDsn,
  parseEnv,
  parseEnvFor,
  previewSecrets,
  siteGateEnabled,
  siteGateEnv,
  syntheticSeedAllowed,
  syntheticSeedEnv,
  uiGalleryEnabled,
  uiGalleryEnv,
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

describe("UI_GALLERY (T-017)", () => {
  const schema = appEnv.extend(uiGalleryEnv.shape);
  const enabled = (env: NodeJS.ProcessEnv) => uiGalleryEnabled(parseEnvFor(schema, env));

  it("defaults to off in production and on elsewhere", () => {
    expect(enabled({ NODE_ENV: "production" })).toBe(false);
    expect(enabled({ NODE_ENV: "production", UI_GALLERY: "" })).toBe(false); // empty = unset
    expect(enabled({ NODE_ENV: "development" })).toBe(true);
    expect(enabled({})).toBe(true);
  });

  it("an explicit on/off wins", () => {
    expect(enabled({ NODE_ENV: "production", UI_GALLERY: "on" })).toBe(true);
    expect(enabled({ NODE_ENV: "development", UI_GALLERY: "off" })).toBe(false);
  });

  it("rejects anything but on/off", () => {
    expect(() => enabled({ UI_GALLERY: "true" })).toThrow(/UI_GALLERY/);
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

describe("siteGateEnabled (igs-pharma#46)", () => {
  const schema = appEnv.extend(siteGateEnv.shape);
  const enabled = (env: NodeJS.ProcessEnv) => siteGateEnabled(parseEnvFor(schema, env));

  it("fails closed: unset means closed in production, open elsewhere", () => {
    expect(enabled({ NODE_ENV: "production" })).toBe(true);
    expect(enabled({ NODE_ENV: "production", SITE_GATE: "" })).toBe(true); // empty = unset
    expect(enabled({ NODE_ENV: "development" })).toBe(false);
    expect(enabled({})).toBe(false);
  });

  it("an explicit value wins", () => {
    expect(enabled({ NODE_ENV: "production", SITE_GATE: "off" })).toBe(false);
    expect(enabled({ NODE_ENV: "development", SITE_GATE: "coming-soon" })).toBe(true);
  });

  it("rejects anything else", () => {
    expect(() => enabled({ NODE_ENV: "production", SITE_GATE: "open" })).toThrow();
  });
});

describe("syntheticSeedAllowed (igs-pharma#50)", () => {
  const schema = appEnv.extend(syntheticSeedEnv.shape);
  const allowed = (env: NodeJS.ProcessEnv) => syntheticSeedAllowed(parseEnvFor(schema, env));

  it("refuses in production unless opted in with IGS_ALLOW_SYNTHETIC_SEED=1", () => {
    expect(allowed({ NODE_ENV: "production" })).toBe(false);
    expect(allowed({ NODE_ENV: "production", IGS_ALLOW_SYNTHETIC_SEED: "" })).toBe(false);
    expect(allowed({ NODE_ENV: "production", IGS_ALLOW_SYNTHETIC_SEED: "1" })).toBe(true);
    expect(allowed({ NODE_ENV: "development" })).toBe(true);
  });

  it("refuses without an explicit NODE_ENV=development, even though appEnv defaults to it", () => {
    expect(parseEnvFor(appEnv, {}).NODE_ENV).toBe("development");
    expect(allowed({})).toBe(false);
    expect(allowed({ NODE_ENV: "" })).toBe(false);
    expect(allowed({ NODE_ENV: "test" })).toBe(false);
    expect(allowed({ IGS_ALLOW_SYNTHETIC_SEED: "1" })).toBe(true);
  });

  it("accepts only 1", () => {
    expect(() => allowed({ NODE_ENV: "production", IGS_ALLOW_SYNTHETIC_SEED: "true" })).toThrow();
  });
});

describe("previewSecrets (igs-pharma#62)", () => {
  const KEY = "k".repeat(32);
  const SECRET = "s".repeat(32);

  it("returns the key and the signing secret when both are set", () => {
    expect(previewSecrets({ IGS_PREVIEW_KEY: KEY, AUTH_SECRET: SECRET })).toEqual({
      key: KEY,
      secret: SECRET,
    });
  });

  it("is off, never an error, when the key is unset, empty or too short", () => {
    for (const IGS_PREVIEW_KEY of [undefined, "", "short", "k".repeat(31)]) {
      expect(
        previewSecrets({ IGS_PREVIEW_KEY, AUTH_SECRET: SECRET }),
        String(IGS_PREVIEW_KEY),
      ).toBe(null);
    }
  });

  it("is off without a usable AUTH_SECRET: nothing could sign the cookie", () => {
    for (const AUTH_SECRET of [undefined, "", "short"]) {
      expect(previewSecrets({ IGS_PREVIEW_KEY: KEY, AUTH_SECRET }), String(AUTH_SECRET)).toBe(null);
    }
  });
});

describe("migrateDsn (igs-pharma#66)", () => {
  const runtime = "postgresql://igs_app:pw@db:5432/igs";
  const admin = "postgresql://igs_admin:pw@db:5432/igs";

  it("in production requires DATABASE_MIGRATE_URL, and a different one from DATABASE_URL", () => {
    const production = { NODE_ENV: "production", DATABASE_URL: runtime };
    expect(() => migrateDsn(production)).toThrow(/DATABASE_MIGRATE_URL is not set/);
    expect(() => migrateDsn({ ...production, DATABASE_MIGRATE_URL: "" })).toThrow(/not set/);
    expect(() => migrateDsn({ ...production, DATABASE_MIGRATE_URL: runtime })).toThrow(
      /different database user/,
    );
    // the same user behind a query string, another host or database is still the runtime role
    expect(() =>
      migrateDsn({ ...production, DATABASE_MIGRATE_URL: `${runtime}?sslmode=require` }),
    ).toThrow(/different database user/);
    expect(() =>
      migrateDsn({ ...production, DATABASE_MIGRATE_URL: "postgresql://igs_app:other@db2:5432/x" }),
    ).toThrow(/different database user/);
    expect(migrateDsn({ ...production, DATABASE_MIGRATE_URL: admin })).toBe(admin);
    // the operator may pass only the migrate DSN
    expect(migrateDsn({ NODE_ENV: "production", DATABASE_MIGRATE_URL: admin })).toBe(admin);
  });

  it("outside production falls back to DATABASE_URL", () => {
    expect(migrateDsn({ NODE_ENV: "development", DATABASE_URL: runtime })).toBe(runtime);
    expect(migrateDsn({ DATABASE_URL: runtime, DATABASE_MIGRATE_URL: admin })).toBe(admin);
    expect(() => migrateDsn({ NODE_ENV: "development" })).toThrow(/is not set/);
  });

  it("adoptMigrateDsn points DATABASE_URL at it for this process", () => {
    const input: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      DATABASE_URL: runtime,
      DATABASE_MIGRATE_URL: admin,
    };
    adoptMigrateDsn(input);
    expect(input["DATABASE_URL"]).toBe(admin);
  });
});
