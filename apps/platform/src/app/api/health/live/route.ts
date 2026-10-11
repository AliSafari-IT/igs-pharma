import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness: the process is up and serving. Touches nothing else (no DB, no auth), so a database
 * outage makes `/api/health` (readiness) fail without the container health check restarting a
 * healthy platform (igs-pharma#48; the compose health check calls this route).
 */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
