import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url().describe("PostgreSQL connection string"),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(10),

  // Auth
  AUTH_SECRET: z.string().min(32).describe("Better Auth HMAC secret (≥32 chars)"),
  AUTH_URL: z.string().url().describe("Canonical app URL for Better Auth callbacks"),

  // Application
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),

  // Crypto
  KMS_KEY_ID: z
    .string()
    .optional()
    .describe("Cloud KMS key ID for envelope encryption"),
  ENCRYPTION_KEY: z
    .string()
    .length(64)
    .optional()
    .describe("32-byte hex key for local dev (never production)"),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),

  // Feature flags
  NEXT_PUBLIC_FEATURE_PRESCRIPTION_RESERVATIONS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Call once at process startup. Throws on invalid config with a human-readable message.
 * Use the returned object everywhere — never access process.env directly.
 */
export function parseEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

// Singleton for use in Next.js apps (called in next.config.ts)
let _env: Env | undefined;
export function getEnv(): Env {
  if (!_env) _env = parseEnv();
  return _env;
}
