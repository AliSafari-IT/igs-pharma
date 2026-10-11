import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";

import {
  appEnv,
  cspEnv,
  cspReportingEnabled,
  parseEnvFor,
  siteGateEnabled,
  siteGateEnv,
} from "@igs/config";
import { routing } from "@igs/i18n/routing";
import { CSP_REPORT_PATH, buildSecurityHeaders, generateNonce } from "@igs/security-headers";

const handleI18nRouting = createMiddleware(routing);

/** CSP_REPORTING (T-013): parsed once per process; reporting is off in `next dev` by default. */
let reporting: boolean | undefined;
function reportOptions(): { reportPath?: string } {
  reporting ??= cspReportingEnabled(parseEnvFor(appEnv.extend(cspEnv.shape)));
  return reporting ? { reportPath: CSP_REPORT_PATH } : {};
}

const gateEnv = appEnv.extend(siteGateEnv.shape);

/** The internal route of the "coming soon" page (`src/app/coming-soon`); reachable only by rewrite. */
export const COMING_SOON_PATH = "/coming-soon";

/**
 * What stays reachable while the storefront is closed (igs-pharma#46, IGS-D4): health checks, the
 * ASafariM OS manifest and CSP reports. `/robots.txt` is outside the matcher and answers
 * "disallow everything" itself while the gate is on (`src/app/robots.ts`).
 */
function passesGate(pathname: string): boolean {
  return (
    pathname === "/api/health" ||
    pathname.startsWith("/api/health/") ||
    pathname === "/api/csp-report" ||
    pathname === "/.well-known/asafarim-app.json"
  );
}

/**
 * Next 16 proxy: per-request CSP nonce + security headers (T-011, D-031), then next-intl locale routing.
 * Next reads the nonce from the request's Content-Security-Policy header and stamps it on its own
 * <script> tags; `x-nonce` exposes it to server components (headers()) for any script they render.
 * Security note: authorization is NEVER enforced here — only in server actions / route handlers (D-005).
 * The site gate is not authorization either: it keeps an unfinished storefront out of view and out of
 * search indexes (`SITE_GATE`, on by default in production).
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

  const { pathname } = request.nextUrl;
  const gated = siteGateEnabled(parseEnvFor(gateEnv));
  let response: NextResponse;
  if (gated && !passesGate(pathname)) {
    // every other URL renders the static page in place (no redirect: nothing to follow or index)
    response = NextResponse.rewrite(new URL(COMING_SOON_PATH, request.url), { request });
  } else if (
    pathname.startsWith("/.well-known/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/")
  ) {
    // locale-free: never redirected to /nl/…
    response = NextResponse.next({ request });
  } else {
    response = handleI18nRouting(request);
  }
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  if (gated) {
    response.headers.set("x-robots-tag", "noindex, nofollow");
    // the gate is switched by configuration: a cache must not keep serving either state
    if (!passesGate(pathname)) response.headers.set("cache-control", "no-store");
  }
  return response;
}

export const config = {
  // Every path except Next.js internals and the two root files that answer for themselves: robots.txt
  // (`src/app/robots.ts`, gate-aware) and favicon.ico. Dotted paths are NOT excluded wholesale, so a
  // URL such as /nl/x.html still gets the security headers and the site gate. A file added to
  // `public/` must be listed here, or the gate answers it with the coming-soon page.
  matcher: ["/((?!_next/|_vercel/|robots\\.txt$|favicon\\.ico$).*)"],
};
