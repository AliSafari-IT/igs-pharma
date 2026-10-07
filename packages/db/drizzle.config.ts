import type { Config } from "drizzle-kit";

import { parseEnv } from "@igs/config/env";

const env = parseEnv();

export default {
  // Aggregated by path glob only — packages/db never imports modules (D-001).
  schema: ["./src/schema/shared.ts", "../modules/*/src/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
} satisfies Config;
