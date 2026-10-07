/**
 * Security headers for the Next.js apps (T-011, D-031; security-architecture.md §5).
 * No Next import, no in-repo import. Both apps' proxy.ts call it once per request with a fresh nonce.
 */

export type SecurityHeadersApp = "web" | "platform";

export interface SecurityHeadersOptions {
  /** Per-request nonce from generateNonce(); embedded in script-src and style-src. */
  nonce: string;
  app: SecurityHeadersApp;
  /** `next dev`: allows what the dev server needs, drops HSTS and upgrade-insecure-requests. */
  isDev: boolean;
  /**
   * Same-origin path of the violation sink (usually CSP_REPORT_PATH). Set → `report-uri` (Firefox),
   * `report-to csp` (Chromium) and `Reporting-Endpoints`; omitted → no reporting (T-013).
   */
  reportPath?: string;
}

/** Route both apps serve the CSP violation sink on (`app/api/csp-report/route.ts`). */
export const CSP_REPORT_PATH = "/api/csp-report";

/** Reporting API endpoint name used by `report-to` and `Reporting-Endpoints`. */
const REPORT_GROUP = "csp";

/** The path ends up in two headers: a plain same-origin path only. */
const REPORT_PATH_PATTERN = /^\/[A-Za-z0-9/_-]*$/;

/** base64 alphabet only: the nonce is interpolated into a header and into HTML attributes. */
const NONCE_PATTERN = /^[A-Za-z0-9+/]{16,}={0,2}$/;

/** 128-bit random nonce, base64 (Web Crypto: works in the proxy runtime and in Node). */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function buildContentSecurityPolicy({
  nonce,
  isDev,
  reportPath,
}: SecurityHeadersOptions): string {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error("security-headers: nonce must be base64 from generateNonce()");
  }
  // Dev only: React's dev build and the HMR runtime evaluate code, and HMR uses a websocket.
  const devScript = isDev ? ["'unsafe-eval'"] : [];
  const devConnect = isDev ? ["ws:", "wss:"] : [];
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...devScript],
    ["style-src", "'self'", `'nonce-${nonce}'`],
    ["img-src", "'self'", "data:", "blob:"],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...devConnect],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  if (!isDev) directives.push(["upgrade-insecure-requests"]);
  if (reportPath !== undefined) {
    if (!REPORT_PATH_PATTERN.test(reportPath)) {
      throw new Error("security-headers: reportPath must be a plain same-origin path");
    }
    directives.push(["report-uri", reportPath], ["report-to", REPORT_GROUP]);
  }
  return directives.map((d) => d.join(" ")).join("; ");
}

const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  // a payment PSP iframe can be allowed here later
  "payment=()",
  "usb=()",
  "interest-cohort=()",
].join(", ");

/** Response headers for an HTML response of `app`. Header names are lower-case. */
export function buildSecurityHeaders(options: SecurityHeadersOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "content-security-policy": buildContentSecurityPolicy(options),
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": PERMISSIONS_POLICY,
    "cross-origin-opener-policy": "same-origin",
    // legacy, alongside frame-ancestors 'none'
    "x-frame-options": "DENY",
  };
  if (options.reportPath !== undefined) {
    headers["reporting-endpoints"] = `${REPORT_GROUP}="${options.reportPath}"`;
  }
  if (!options.isDev) {
    headers["strict-transport-security"] = "max-age=63072000; includeSubDomains; preload";
  }
  if (options.app === "platform") {
    // staff-only back-office: never indexed, never cached
    headers["x-robots-tag"] = "noindex, nofollow";
    headers["cache-control"] = "no-store";
  }
  return headers;
}
