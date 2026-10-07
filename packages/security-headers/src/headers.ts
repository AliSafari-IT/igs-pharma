/**
 * Security headers for the Next.js apps (T-011, D-031; security-architecture.md §5).
 * Pure: no Next import, no in-repo import, no runtime dependency. Both apps' proxy.ts call it once
 * per request with a fresh nonce.
 */

export type SecurityHeadersApp = "web" | "platform";

export interface SecurityHeadersOptions {
  /** Per-request nonce from generateNonce(); embedded in script-src and style-src. */
  nonce: string;
  app: SecurityHeadersApp;
  /** `next dev`: allows what the dev server needs, drops HSTS and upgrade-insecure-requests. */
  isDev: boolean;
}

/** base64 alphabet only: the nonce is interpolated into a header and into HTML attributes. */
const NONCE_PATTERN = /^[A-Za-z0-9+/]{16,}={0,2}$/;

/** 128-bit random nonce, base64 (Web Crypto: works in the proxy runtime and in Node). */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function buildContentSecurityPolicy({ nonce, isDev }: SecurityHeadersOptions): string {
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
