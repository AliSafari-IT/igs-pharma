import { NextResponse } from "next/server";

import manifest from "../../../../platform.app.json";

export const dynamic = "force-dynamic";

/**
 * ASafariM OS app manifest (IGS-Pharma ADR 0001, option B): the OS reads it to install, route and
 * monitor the storefront. Served from `platform.app.json` itself, bundled at build time.
 * proxy.ts lets this path through without locale routing and adds the security headers.
 */
export function GET() {
  return NextResponse.json(manifest, { headers: { "cache-control": "no-store" } });
}
