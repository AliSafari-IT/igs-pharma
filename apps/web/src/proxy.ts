import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";

import { routing } from "@igs/i18n/routing";
import { buildSecurityHeaders, generateNonce } from "@igs/security-headers";

const handleI18nRouting = createMiddleware(routing);

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
  });

  // next-intl copies request.headers into the request it forwards (next/rewrite)
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", headers["content-security-policy"] ?? "");

  const response = handleI18nRouting(request);
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  // Match all paths except Next.js internals and static files
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
