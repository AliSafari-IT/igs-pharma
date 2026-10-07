import { type NextRequest, NextResponse } from "next/server";

import { buildSecurityHeaders, generateNonce } from "@igs/security-headers";

/**
 * Next 16 proxy: per-request CSP nonce + security headers (T-011, D-031).
 * Next reads the nonce from the request's Content-Security-Policy header and stamps it on its own
 * <script> tags; `x-nonce` exposes it to server components (headers()) for any script they render.
 * Security note: authorization is NEVER enforced here — only in server actions / route handlers (D-005).
 */
export default function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const headers = buildSecurityHeaders({
    nonce,
    app: "platform",
    isDev: process.env.NODE_ENV === "development",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", headers["content-security-policy"] ?? "");

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  // Match all paths except Next.js internals and static files
  matcher: ["/((?!_next|.*\\..*).*)"],
};
