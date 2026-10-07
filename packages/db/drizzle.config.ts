import type { Config } from "drizzle-kit";

import { parseEnv } from "@igs/config/env";

const env = parseEnv();

export default {
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
} satisfies Config;
