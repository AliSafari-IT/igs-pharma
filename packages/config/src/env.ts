import { z } from "zod";

/** Composable per-concern schemas: each process parses only what it uses (T-005b). */
export const dbEnv = z.object({
  DATABASE_URL: z.string().url().describe("PostgreSQL connection string"),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(10),
});

export const authEnv = z.object({
  AUTH_SECRET: z.string().min(32).describe("Better Auth HMAC secret (≥32 chars)"),
  AUTH_URL: z.string().url().describe("Canonical app URL for Better Auth callbacks"),
});

export const appEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export const cryptoEnv = z.object({
  KMS_KEY_ID: z.string().optional().describe("Cloud KMS key ID for envelope encryption"),
  ENCRYPTION_KEY: z
    .string()
    .length(64)
    .optional()
    .describe("32-byte hex key for local dev (never production)"),
});

export const observabilityEnv = z.object({
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),
});

/** Audit module (T-006): keyed hash of IP / user agent. Runtime-only secret (D-023); KMS-wrapped in B-04. */
export const auditEnv = z.object({
  AUDIT_HMAC_KEY: z.string().min(32).describe("HMAC key for audit ip/ua hashes (≥32 chars)"),
});

export const featureFlagsEnv = z.object({
  NEXT_PUBLIC_FEATURE_PRESCRIPTION_RESERVATIONS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

/**
 * CSP violation reporting (T-013): `on|off`; unset → on in production only (Next's dev overlay
 * produces known violations). Resolve with `cspReportingEnabled()`.
 */
export const cspEnv = z.object({
  // empty (`CSP_REPORTING=` in .env) counts as unset
  CSP_REPORTING: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["on", "off"]).optional()),
});

/** Whether the apps send report-uri / report-to and Reporting-Endpoints. */
export function cspReportingEnabled(
  env: Pick<z.output<typeof appEnv>, "NODE_ENV"> & z.output<typeof cspEnv>,
): boolean {
  return env.CSP_REPORTING ? env.CSP_REPORTING === "on" : env.NODE_ENV === "production";
}

/** Full set used by `web` / `platform` (and `getEnv()`). */
const envSchema = z.object({
  ...dbEnv.shape,
  ...authEnv.shape,
  ...appEnv.shape,
  ...cryptoEnv.shape,
  ...observabilityEnv.shape,
  ...featureFlagsEnv.shape,
  ...cspEnv.shape,
});

/** What the worker needs: no `AUTH_*`, no feature flags. */
export const workerEnv = z.object({
  ...dbEnv.shape,
  ...appEnv.shape,
  ...cryptoEnv.shape,
  ...observabilityEnv.shape,
});

export type Env = z.infer<typeof envSchema>;

/**
 * Call once at process startup. Throws on invalid config with a human-readable message.
 * Use the returned object everywhere — never access process.env directly.
 */
export function parseEnv(input: NodeJS.ProcessEnv = process.env): Env {
  return parseEnvFor(envSchema, input);
}

/** Parses `input` against any composed schema; same readable error as `parseEnv`. */
export function parseEnvFor<S extends z.ZodType>(
  schema: S,
  input: NodeJS.ProcessEnv = process.env,
): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
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
