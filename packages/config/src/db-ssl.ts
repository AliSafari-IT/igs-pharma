import fs from "node:fs";

/**
 * The one place that decides how a database connection uses TLS (igs-pharma#77). Node-only (it reads
 * the CA file): import it from server code, never from the Edge proxy.
 *
 * | NODE_ENV    | DATABASE_SSL unset | `verify`         | `insecure-dev`     | `off`   |
 * |-------------|--------------------|------------------|--------------------|---------|
 * | production  | verify             | verify           | TLS, NOT verified  | refused |
 * | otherwise   | plain TCP          | verify           | TLS, NOT verified  | plain   |
 *
 * `verify` checks the certificate chain AND the host name against the system trust store plus the
 * optional `DATABASE_SSL_CA` (PEM text or a file path). A CA setting that is set but unreadable or
 * not a PEM certificate fails with a readable message that never contains the value or the file
 * content. Nothing here logs.
 */
export type DbSslMode = "off" | "verify" | "insecure-dev";

export interface DbSslInput {
  readonly NODE_ENV?: string | undefined;
  readonly DATABASE_SSL?: DbSslMode | undefined;
  readonly DATABASE_SSL_CA?: string | undefined;
}

/** What `postgres`, `pg` (pg-boss) and drizzle-kit accept as `ssl`. */
export type DbSslOptions = false | { rejectUnauthorized: boolean; ca?: string };

export interface DbSsl {
  readonly mode: DbSslMode;
  readonly options: DbSslOptions;
}

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

/** The CA as PEM text from `DATABASE_SSL_CA` (PEM, possibly with escaped newlines, or a file path). */
function readCa(value: string, readFile: (path: string) => string): string {
  const trimmed = value.trim();
  let pem: string;
  if (trimmed.includes("-----BEGIN")) {
    pem = trimmed.replaceAll("\\n", "\n");
  } else {
    try {
      pem = readFile(trimmed);
    } catch {
      throw new Error("DATABASE_SSL_CA is neither PEM text nor a readable file path.");
    }
  }
  if (!PEM_CERTIFICATE.test(pem)) {
    throw new Error(
      "DATABASE_SSL_CA does not contain a PEM certificate (-----BEGIN CERTIFICATE-----).",
    );
  }
  return pem;
}

export function buildDbSsl(
  input: DbSslInput,
  readFile: (path: string) => string = (path) => fs.readFileSync(path, "utf8"),
): DbSsl {
  const production = input.NODE_ENV === "production";
  const mode: DbSslMode = input.DATABASE_SSL ?? (production ? "verify" : "off");
  if (mode === "off") {
    if (production) {
      throw new Error(
        "DATABASE_SSL=off is not allowed in production: the database connection must be verified (DATABASE_SSL=verify, optionally with DATABASE_SSL_CA).",
      );
    }
    return { mode, options: false };
  }
  if (mode === "insecure-dev") return { mode, options: { rejectUnauthorized: false } };
  const ca = input.DATABASE_SSL_CA ? readCa(input.DATABASE_SSL_CA, readFile) : undefined;
  return { mode, options: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}

/** The warning to print once when a production process runs without verification; `null` otherwise. */
export function dbSslWarning(input: DbSslInput, ssl: DbSsl): string | null {
  return input.NODE_ENV === "production" && ssl.mode === "insecure-dev"
    ? "WARNING: DATABASE_SSL=insecure-dev: the database server certificate is NOT verified. Never use this on a deployment."
    : null;
}
