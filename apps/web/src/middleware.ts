import createMiddleware from "next-intl/middleware";

import { routing } from "@igs/i18n/routing";

/**
 * next-intl locale middleware.
 * Phase 1: extend with CSP nonce generation, rate limiting headers.
 * Security note: authorization is NEVER enforced here — only in server actions / route handlers.
 */
export default createMiddleware(routing);

export const config = {
  // Match all paths except Next.js internals and static files
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
