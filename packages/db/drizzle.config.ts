import type { Config } from "drizzle-kit";
import { z } from "zod";

// Only DATABASE_URL: migrations must run in jobs that have no auth secret (not parseEnv()).
const { DATABASE_URL } = z.object({ DATABASE_URL: z.string().url() }).parse(process.env);

export default {
  // Aggregated by path glob only — packages/db never imports modules (D-001).
  schema: ["./src/schema/shared.ts", "../modules/*/src/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: DATABASE_URL,
  },
  verbose: true,
  strict: true,
} satisfies Config;
