import { migrateDsn } from "@igs/config/env";
import type { Config } from "drizzle-kit";

// Migrations run as the administrative role, through the same rule as the migrate entry: production
// needs DATABASE_MIGRATE_URL (a different user than DATABASE_URL); development falls back to
// DATABASE_URL. No auth secret needed (not parseEnv()).
const MIGRATE_URL = migrateDsn();

export default {
  // Aggregated by path glob only — packages/db never imports modules (D-001).
  // packages/db owns no tables (D-017): module tables + the kernel's `system` schema.
  schema: ["../modules/*/src/schema.ts", "../kernel/src/schema.ts"],
  // DRIZZLE_OUT lets the drift check generate into a scratch copy (tools/db/check-drift.mjs)
  out: process.env["DRIZZLE_OUT"] ?? "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: MIGRATE_URL,
  },
  verbose: true,
  strict: true,
} satisfies Config;
