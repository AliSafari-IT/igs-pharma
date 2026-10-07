import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";

import { appEnv, cspEnv, cspReportingEnabled, parseEnvFor } from "@igs/config";
import { routing } from "@igs/i18n/routing";
import { CSP_REPORT_PATH, buildSecurityHeaders, generateNonce } from "@igs/security-headers";

const handleI18nRouting = createMiddleware(routing);

/** CSP_REPORTING (T-013): parsed once per process; reporting is off in `next dev` by default. */
let reporting: boolean | undefined;
function reportOptions(): { reportPath?: string } {
  reporting ??= cspReportingEnabled(parseEnvFor(appEnv.extend(cspEnv.shape)));
  return reporting ? { reportPath: CSP_REPORT_PATH } : {};
}

/**
 * Next 16 proxy: per-request CSP nonce + security headers (T-011, D-031), then next-intl locale routing.
 * Next reads the nonce from the request's Content-Security-Policy header and stamps it on its own
 * <script> tags; `x-nonce` exposes it to server components (headers()) for any script they render.
 * Security note: authorization is NEVER enforced here — only in server actions / route handlers (D-005).
 */
export default function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const headers = buildSecurityHeaders({
    nonce,
    app: "web",
    isDev: process.env.NODE_ENV === "development",
    ...reportOptions(),
  });

  // next-intl copies request.headers into the request it forwards (next/rewrite)
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", headers["content-security-policy"] ?? "");

  const response = handleI18nRouting(request);
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  // Match all paths except API routes, Next.js internals and static files. `api(?:/|$)`, not a bare
  // `api` prefix, so unprefixed slugs such as /apixaban still get the locale redirect.
  matcher: ["/((?!api(?:/|$)|_next|_vercel|.*\\..*).*)"],
};
