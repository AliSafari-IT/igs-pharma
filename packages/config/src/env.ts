import { z } from "zod";

/**
 * TLS to PostgreSQL (igs-pharma#77), read by every database connection through `buildDbSsl()`
 * (`@igs/config/db-ssl`): `verify` checks the server certificate chain and host name (the default
 * in production); `insecure-dev` encrypts but does not verify (explicit opt-in); `off` is plain
 * TCP (the default outside production, refused in production). `DATABASE_SSL_CA` adds a private CA:
 * PEM text (escaped `\n` allowed) or the path of a PEM file; it is never logged.
 */
export const dbSslEnv = z.object({
  DATABASE_SSL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["verify", "insecure-dev", "off"]).optional(),
  ),
  DATABASE_SSL_CA: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
});

/** Composable per-concern schemas: each process parses only what it uses (T-005b). */
export const dbEnv = z.object({
  DATABASE_URL: z.string().url().describe("PostgreSQL connection string"),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(10),
  ...dbSslEnv.shape,
});

/**
 * The DSN of the one-shot operator entries (igs-pharma#66): the migrate entry and the
 * `bootstrap-owner` / `seed-catalog` CLIs. It connects as the administrative role that owns the
 * schemas, whereas `DATABASE_URL` is the runtime role (`igs_app` / `igs_worker`), which can never
 * run DDL. Read it with `migrateDsn()`, never from `process.env` directly.
 */
export const migrateEnv = z.object({
  DATABASE_MIGRATE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .url()
      .optional()
      .describe("PostgreSQL DSN of the administrative (schema-owning) role"),
  ),
});

export const authEnv = z.object({
  AUTH_SECRET: z.string().min(32).describe("Better Auth HMAC secret (≥32 chars)"),
  AUTH_URL: z.string().url().describe("Canonical app URL for Better Auth callbacks"),
  /**
   * The storefront's public origin (igs-pharma#114): the customer auth instance lives there, with its
   * own cookies. Optional while customer accounts are off; required when they are switched on.
   */
  STOREFRONT_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url().optional().describe("Public origin of the storefront (customer accounts)"),
  ),
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
  // classified not-sensitive (D-023), so it must not carry a login: credentials go in headers
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .url()
    .refine((value) => {
      try {
        const { username, password } = new URL(value);
        return username === "" && password === "";
      } catch {
        return true; // not a URL at all: the url() check above reports it, readably
      }
    }, "must not contain a username or password")
    .optional(),
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
  /**
   * The EU common logo linked to the FAMHP list (igs-pharma#104). Stays `false` until the pharmacy
   * is registered: showing it earlier would be a false claim.
   */
  NEXT_PUBLIC_FEATURE_EU_COMMON_LOGO: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /**
   * Customer accounts (igs-pharma#114, D-044): sign-up, sign-in and the account area of the storefront.
   * Strictly `true` or `false`; off, the customer `/api/auth` routes answer 404 and the links are hidden.
   */
  NEXT_PUBLIC_FEATURE_CUSTOMER_ACCOUNTS: z
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

/**
 * Storefront settings (igs-pharma#103): the on-hand at or below which a product shows as `low`
 * (above 0). Parsed by the storefront's composition root and passed to the storefront module (modules
 * do not read the environment). Whole number 0–50; unset = the module default (inventory's `DEFAULT_LOW_STOCK`).
 */
export const storefrontEnv = z.object({
  STOREFRONT_LOW_STOCK_THRESHOLD: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().min(0).max(50).optional(),
  ),
});

/**
 * Component gallery at platform `/dev/ui` (T-017): `on|off`; unset → on outside production only.
 * Production images never set it; the smoke/axe run sets `on` to test the production build.
 */
export const uiGalleryEnv = z.object({
  UI_GALLERY: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["on", "off"]).optional()),
});

/** Whether platform serves `/dev/ui` (otherwise it is a 404). */
export function uiGalleryEnabled(
  env: Pick<z.output<typeof appEnv>, "NODE_ENV"> & z.output<typeof uiGalleryEnv>,
): boolean {
  return env.UI_GALLERY ? env.UI_GALLERY === "on" : env.NODE_ENV !== "production";
}

/**
 * Storefront gate (igs-pharma#46, IGS-D4): `coming-soon|off`. With `coming-soon`, `apps/web` answers
 * every page with a static "coming soon" page (noindex). Unset → `coming-soon` in production, so a
 * deployed storefront is closed until someone opens it on purpose (fail closed); `off` elsewhere.
 */
export const siteGateEnv = z.object({
  SITE_GATE: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["coming-soon", "off"]).optional(),
  ),
});

/** Whether the storefront is closed behind the "coming soon" page. */
export function siteGateEnabled(
  env: Pick<z.output<typeof appEnv>, "NODE_ENV"> & z.output<typeof siteGateEnv>,
): boolean {
  return env.SITE_GATE ? env.SITE_GATE === "coming-soon" : env.NODE_ENV === "production";
}

/**
 * Storefront preview (igs-pharma#62): a secret key that lets its holder past the site gate. Unset (or
 * empty) means no preview is possible, which is the default everywhere. Minimum 32 characters:
 * generate it with `openssl rand -hex 32`.
 */
export const previewEnv = z.object({
  IGS_PREVIEW_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(32).optional()),
});

/** What the preview pass needs to sign and check its cookie. */
export interface PreviewSecrets {
  /** `IGS_PREVIEW_KEY`: what a visitor presents at `/preview?key=…`. */
  readonly key: string;
  /** `AUTH_SECRET`: signs the cookie, so the cookie never contains the key. */
  readonly secret: string;
}

/**
 * The preview key and the cookie signing secret, or `null` when the preview is off. Fails CLOSED:
 * an unset, empty or too short key, or a missing or short `AUTH_SECRET`, means no preview, and never
 * an error (a mistyped key must not take the closed storefront down).
 */
export function previewSecrets(
  env: Readonly<Record<string, string | undefined>>,
): PreviewSecrets | null {
  const parsed = previewEnv
    .extend({ AUTH_SECRET: authEnv.shape.AUTH_SECRET })
    .safeParse({ IGS_PREVIEW_KEY: env["IGS_PREVIEW_KEY"], AUTH_SECRET: env["AUTH_SECRET"] });
  if (!parsed.success || !parsed.data.IGS_PREVIEW_KEY) return null;
  return { key: parsed.data.IGS_PREVIEW_KEY, secret: parsed.data.AUTH_SECRET };
}

/**
 * Synthetic catalogue seed (igs-pharma#50): `node dist/seed-catalog.js` loads fake products. It runs
 * only when `NODE_ENV=development` is set explicitly, or with `IGS_ALLOW_SYNTHETIC_SEED=1` (staging
 * runs the production image, so the operator opts in there on purpose; never on the live shop). A
 * missing `NODE_ENV` refuses: unlike `appEnv`, this schema has no development default.
 */
export const syntheticSeedEnv = z.object({
  NODE_ENV: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["development", "test", "production"]).optional(),
  ),
  IGS_ALLOW_SYNTHETIC_SEED: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["1"]).optional(),
  ),
});

/** Whether the synthetic seed may run in this environment. */
export function syntheticSeedAllowed(env: z.output<typeof syntheticSeedEnv>): boolean {
  return env.NODE_ENV === "development" || env.IGS_ALLOW_SYNTHETIC_SEED === "1";
}

/** Whether two connection strings log in as the same database user (query strings and the like do not count). */
function sameLogin(a: string, b: string): boolean {
  try {
    return decodeURIComponent(new URL(a).username) === decodeURIComponent(new URL(b).username);
  } catch {
    return a === b;
  }
}

/**
 * The connection string an operator entry (migrate, bootstrap-owner, seed-catalog) must use. In
 * production `DATABASE_MIGRATE_URL` is required and must log in as a different user than `DATABASE_URL`
 * (the runtime DSN), so these entries can never silently run under the runtime role or the other way round.
 * Elsewhere it falls back to `DATABASE_URL`, so a single local database keeps working.
 */
export function migrateDsn(input: NodeJS.ProcessEnv = process.env): string {
  const env = parseEnvFor(
    appEnv.extend(migrateEnv.shape).extend({ DATABASE_URL: z.string().url().optional() }),
    input,
  );
  const migrate = env.DATABASE_MIGRATE_URL;
  if (env.NODE_ENV === "production") {
    if (!migrate) {
      throw new Error(
        "DATABASE_MIGRATE_URL is not set: this entry needs the administrative database role, not the runtime DATABASE_URL.",
      );
    }
    if (env.DATABASE_URL && sameLogin(migrate, env.DATABASE_URL)) {
      throw new Error(
        "DATABASE_MIGRATE_URL must use a different database user than DATABASE_URL: the runtime role must never run migrations.",
      );
    }
    return migrate;
  }
  const dsn = migrate ?? env.DATABASE_URL;
  if (!dsn) throw new Error("DATABASE_MIGRATE_URL (or DATABASE_URL in development) is not set.");
  return dsn;
}

/**
 * Makes the rest of the process (the kernel's database client, pg-boss) use the migrate DSN: the
 * operator entries call it first. `DATABASE_URL` is overwritten for this process only.
 */
export function adoptMigrateDsn(input: NodeJS.ProcessEnv = process.env): void {
  input["DATABASE_URL"] = migrateDsn(input);
}

/** Full set used by `web` / `platform` (and `getEnv()`). */
export const envSchema = z.object({
  ...dbEnv.shape,
  ...authEnv.shape,
  ...appEnv.shape,
  ...cryptoEnv.shape,
  ...observabilityEnv.shape,
  ...featureFlagsEnv.shape,
  ...cspEnv.shape,
  ...uiGalleryEnv.shape,
  ...siteGateEnv.shape,
});

/**
 * Outgoing account mail (igs-pharma#114): read by the WORKER only, the one process that talks to a mail
 * server (D-019). Optional at boot: a missing value makes the mail job fail and retry
 * (`mail.not_configured`) instead of stopping the worker's other jobs.
 */
export const mailEnv = z.object({
  /** `smtp://host:port` or `smtps://user:password@host:port`; it can carry a password. */
  SMTP_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  /** The From header, e.g. `IGS-Pharma <no-reply@example.be>`. */
  MAIL_FROM: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(3).max(200).optional()),
});

/** What the worker needs: no `AUTH_*`, no feature flags. */
export const workerEnv = z.object({
  ...mailEnv.shape,
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
