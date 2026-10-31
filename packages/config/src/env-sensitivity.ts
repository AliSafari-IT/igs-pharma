/**
 * Which environment variables are secrets (igs-pharma#96, D-023). The ONE place that says so, next
 * to the schema in `env.ts`: every variable the schema declares is listed here, either `sensitive`
 * (a credential, a key, or a connection string that can carry one) or `not-sensitive`.
 *
 * `tools/ci/check-image-secrets.sh` checks every `sensitive` name against a final image's history
 * and ENV. `env-sensitivity.test.ts` fails when a variable is added to `env.ts` without being
 * classified here, and when a `sensitive` name is missing from the script. Names only: nothing in
 * this file or its test may hold a real value.
 */
export const ENV_SENSITIVITY = {
  // database
  DATABASE_URL: "sensitive", // carries the runtime login's password
  DATABASE_MIGRATE_URL: "sensitive", // carries the migrator login's password
  DATABASE_MAX_CONNECTIONS: "not-sensitive",
  DATABASE_SSL: "not-sensitive",
  DATABASE_SSL_CA: "not-sensitive", // a public CA certificate
  // authentication and audit
  AUTH_SECRET: "sensitive",
  AUTH_URL: "not-sensitive", // the public address of the app
  AUDIT_HMAC_KEY: "sensitive",
  // outgoing mail (igs-pharma#114)
  SMTP_URL: "sensitive", // can carry the mail server password
  MOLLIE_API_KEY: "sensitive", // can create payments and refunds
  MOLLIE_WEBHOOK_BASE_URL: "not-sensitive",
  MAIL_FROM: "not-sensitive",
  EARLY_ACCESS_NOTIFY_TO: "not-sensitive", // staff addresses for the early-access notice (#199)
  // crypto
  ENCRYPTION_KEY: "sensitive",
  KMS_KEY_ID: "sensitive", // names the key that wraps the data keys
  // observability
  SENTRY_DSN: "sensitive", // lets anyone send events to the project
  OTEL_EXPORTER_OTLP_ENDPOINT: "not-sensitive",
  LOG_LEVEL: "not-sensitive",
  // behaviour switches
  NODE_ENV: "not-sensitive",
  NEXT_PUBLIC_FEATURE_PRESCRIPTION_RESERVATIONS: "not-sensitive",
  NEXT_PUBLIC_FEATURE_EU_COMMON_LOGO: "not-sensitive",
  NEXT_PUBLIC_FEATURE_CUSTOMER_ACCOUNTS: "not-sensitive",
  NEXT_PUBLIC_FEATURE_CART: "not-sensitive",
  STOREFRONT_URL: "not-sensitive",
  CSP_REPORTING: "not-sensitive",
  UI_GALLERY: "not-sensitive",
  DEPLOY_STAGE: "not-sensitive", // staging | production: the back-office badge
  SITE_GATE: "not-sensitive",
  STOREFRONT_LOW_STOCK_THRESHOLD: "not-sensitive",
  IGS_ALLOW_SYNTHETIC_SEED: "not-sensitive",
} as const satisfies Record<string, "sensitive" | "not-sensitive">;

export type EnvName = keyof typeof ENV_SENSITIVITY;

/** The names of the `sensitive` variables. */
export const SENSITIVE_ENV_NAMES: readonly EnvName[] = (
  Object.keys(ENV_SENSITIVITY) as EnvName[]
).filter((name) => ENV_SENSITIVITY[name] === "sensitive");
