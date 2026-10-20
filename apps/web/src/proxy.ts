import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";

import {
  appEnv,
  cspEnv,
  cspReportingEnabled,
  parseEnvFor,
  previewSecrets,
  siteGateEnabled,
  siteGateEnv,
} from "@igs/config";
import { routing } from "@igs/i18n/routing";
import { CSP_REPORT_PATH, buildSecurityHeaders, generateNonce } from "@igs/security-headers";

import {
  PREVIEW_COOKIE,
  PREVIEW_COOKIE_OPTIONS,
  PREVIEW_HEADER,
  verifyPreviewCookie,
} from "./preview";

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

/** The entry and the exit of the storefront preview pass (igs-pharma#62). */
export const PREVIEW_PATH = "/preview";
export const PREVIEW_END_PATH = "/preview/end";
/** The internal route of the preview key form (`src/app/preview-key`); reachable only by rewrite. */
export const PREVIEW_FORM_PATH = "/preview-key";

/**
 * What stays reachable while the storefront is closed (igs-pharma#46, IGS-D4): health checks, the
 * ASafariM OS manifest and CSP reports. `/robots.txt` is outside the matcher and answers
 * "disallow everything" itself while the gate is on (`src/app/robots.ts`).
 */
function isOpenPath(pathname: string): boolean {
  return (
    pathname === "/api/health" ||
    pathname.startsWith("/api/health/") ||
    pathname === "/api/csp-report" ||
    // Mollie's server calls it, never with a preview cookie (igs-pharma#116)
    pathname === "/api/webhooks/mollie" ||
    pathname === "/.well-known/asafarim-app.json"
  );
}

/**
 * The one place that decides whether a request gets past the closed storefront: the few open paths,
 * or a request holding a valid preview cookie (igs-pharma#62). `preview` is only ever true after the
 * cookie's signature and expiry were checked.
 */
function passesGate(pathname: string, preview: boolean): boolean {
  return preview || isOpenPath(pathname);
}

/**
 * The preview entry (igs-pharma#91: the key never travels in a URL). Only while the gate is on AND a
 * key is configured:
 * - `GET /preview` with no query string shows the key form;
 * - `POST /preview` goes to the route handler (`src/app/preview/route.ts`), which checks the key in
 *   constant time, sets the signed cookie and redirects.
 * Anything else, `GET /preview?key=…` included, returns `null`: it falls through to the gate and
 * gets the coming-soon page, with no hint that a preview exists.
 */
function previewEntry(
  request: NextRequest,
  secrets: ReturnType<typeof previewSecrets>,
): NextResponse | null {
  if (!secrets || request.nextUrl.pathname !== PREVIEW_PATH) return null;
  if (request.method === "POST") return NextResponse.next({ request });
  if (request.method === "GET" && request.nextUrl.search === "") {
    return NextResponse.rewrite(new URL(PREVIEW_FORM_PATH, request.url), { request });
  }
  return null;
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
    isDev: parseEnvFor(appEnv).NODE_ENV === "development",
    ...reportOptions(),
  });

  // next-intl copies request.headers into the request it forwards (next/rewrite)
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", headers["content-security-policy"] ?? "");

  // a client never sets this: it is added below, and only for a verified preview cookie
  request.headers.delete(PREVIEW_HEADER);

  const { pathname } = request.nextUrl;
  const gated = siteGateEnabled(parseEnvFor(gateEnv));
  // fails closed: no key configured (the default) means no preview, whatever a request carries
  const secrets = previewSecrets(process.env);
  const now = Date.now();

  let response: NextResponse;
  const entry = gated ? previewEntry(request, secrets) : null;
  const preview =
    gated && verifyPreviewCookie(secrets, request.cookies.get(PREVIEW_COOKIE)?.value, now);
  if (entry) {
    response = entry;
  } else if (gated && secrets && pathname === PREVIEW_END_PATH) {
    // leaving the preview: drop the cookie and land on whatever the public sees. With no key
    // configured this path is just another closed URL (no hint that a preview exists, #91)
    response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set({ name: PREVIEW_COOKIE, value: "", ...PREVIEW_COOKIE_OPTIONS, maxAge: 0 });
  } else if (gated && !passesGate(pathname, preview)) {
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
    if (preview) request.headers.set(PREVIEW_HEADER, "1");
    response = handleI18nRouting(request);
  }
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  if (gated) {
    response.headers.set("x-robots-tag", "noindex, nofollow");
    // the gate is switched by configuration: a cache must not keep serving either state
    if (!isOpenPath(pathname)) response.headers.set("cache-control", "no-store");
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
