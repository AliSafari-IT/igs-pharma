import type { MetadataRoute } from "next";

import { appEnv, parseEnvFor, siteGateEnabled, siteGateEnv } from "@igs/config";

// read at request time: the build runs with NODE_ENV=production and would bake the gated answer in
export const dynamic = "force-dynamic";

/** `/robots.txt`: disallow everything while the storefront is closed (`SITE_GATE`, igs-pharma#46). */
export default function robots(): MetadataRoute.Robots {
  const gated = siteGateEnabled(parseEnvFor(appEnv.extend(siteGateEnv.shape)));
  return { rules: gated ? { userAgent: "*", disallow: "/" } : { userAgent: "*", allow: "/" } };
}
