/**
 * Environment of the production-build smoke run (playwright.smoke.config.ts). Fake values: the env
 * schema only needs valid-looking ones, and these pages read no data. With `SMOKE_DATABASE_URL` (a
 * migrated database, `pnpm db:migrate`) the apps use it and the signed-in /account test runs. A
 * production build connects over TLS, so that Postgres must accept TLS connections; the CI server uses
 * a self-signed certificate, hence `DATABASE_SSL=insecure-dev` (igs-pharma#77; never set on a deployment).
 */
export const smokeDatabaseUrl = process.env["SMOKE_DATABASE_URL"];

export const smokeEnv = {
  DATABASE_URL: smokeDatabaseUrl ?? "postgresql://smoke:smoke@localhost:5432/smoke",
  AUTH_SECRET: "smoke-only-placeholder-not-a-secret-000",
  AUTH_URL: "http://localhost:3000",
  // a production build verifies the database certificate by default; the CI Postgres is self-signed
  DATABASE_SSL: "insecure-dev",
  // the composition roots configure the audit port (and, through it, Better Auth) on first use
  AUDIT_HMAC_KEY: "smoke-only-placeholder-audit-hmac-key-0000",
};
