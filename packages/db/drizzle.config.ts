import { buildDbSsl } from "@igs/config/db-ssl";
import { appEnv, dbSslEnv, migrateDsn, parseEnvFor } from "@igs/config/env";
import type { Config } from "drizzle-kit";

// Migrations run as the administrative role, through the same rule as the migrate entry: production
// needs DATABASE_MIGRATE_URL (a different user than DATABASE_URL); development falls back to
// DATABASE_URL. No auth secret needed (not parseEnv()).
const MIGRATE_URL = migrateDsn();

// TLS by the same rule as every other connection (igs-pharma#77): verified in production. A URL
// cannot carry the CA, so with TLS the credentials are passed field by field.
const ssl = buildDbSsl(parseEnvFor(appEnv.extend(dbSslEnv.shape)));
const target = new URL(MIGRATE_URL);
const dbCredentials =
  ssl.options === false
    ? { url: MIGRATE_URL }
    : {
        host: target.hostname,
        port: target.port ? Number(target.port) : 5432,
        user: decodeURIComponent(target.username),
        password: decodeURIComponent(target.password),
        database: decodeURIComponent(target.pathname.slice(1)),
        ssl: ssl.options,
      };

export default {
  // Aggregated by path glob only — packages/db never imports modules (D-001).
  // packages/db owns no tables (D-017): module tables + the kernel's `system` schema.
  schema: ["../modules/*/src/schema.ts", "../kernel/src/schema.ts"],
  // DRIZZLE_OUT lets the drift check generate into a scratch copy (tools/db/check-drift.mjs)
  out: process.env["DRIZZLE_OUT"] ?? "./drizzle",
  dialect: "postgresql",
  dbCredentials,
  verbose: true,
  strict: true,
} satisfies Config;
