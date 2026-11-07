import type { MetadataRoute } from "next";

import { currentStorefrontGate } from "../launch-gate";

// read at request time: the build runs with NODE_ENV=production and would bake the gated answer in
export const dynamic = "force-dynamic";

/**
 * `/robots.txt`: disallow everything while the storefront is closed (`SITE_GATE`, igs-pharma#46, or
 * the launch check refusing to open it, #238).
 */
export default function robots(): MetadataRoute.Robots {
  const gated = currentStorefrontGate().closed;
  return { rules: gated ? { userAgent: "*", disallow: "/" } : { userAgent: "*", allow: "/" } };
}
