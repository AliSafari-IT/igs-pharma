import type { Config } from "drizzle-kit";
import { z } from "zod";

// Migrations run as the administrative role: DATABASE_MIGRATE_URL, else DATABASE_URL (development).
// No auth secret needed (not parseEnv()).
const { DATABASE_MIGRATE_URL, DATABASE_URL } = z
  .object({
    DATABASE_MIGRATE_URL: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().url().optional(),
    ),
    DATABASE_URL: z.string().url().optional(),
  })
  .parse(process.env);
const MIGRATE_URL = DATABASE_MIGRATE_URL ?? DATABASE_URL;
if (!MIGRATE_URL) throw new Error("Set DATABASE_MIGRATE_URL (or DATABASE_URL in development).");

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
