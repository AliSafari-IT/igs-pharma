/**
 * Environment of the production-build smoke run (playwright.smoke.config.ts). Fake values: the env
 * schema only needs valid-looking ones, and these pages read no data. With `SMOKE_DATABASE_URL` (a
 * migrated database, `pnpm db:migrate`) the apps use it and the signed-in /account test runs. A
 * production build connects with `ssl: "require"`, so that Postgres must accept TLS connections.
 */
export const smokeDatabaseUrl = process.env["SMOKE_DATABASE_URL"];

export const smokeEnv = {
  DATABASE_URL: smokeDatabaseUrl ?? "postgresql://smoke:smoke@localhost:5432/smoke",
  AUTH_SECRET: "smoke-only-placeholder-not-a-secret-000",
  AUTH_URL: "http://localhost:3000",
  // the composition roots configure the audit port (and, through it, Better Auth) on first use
  AUDIT_HMAC_KEY: "smoke-only-placeholder-audit-hmac-key-0000",
};
