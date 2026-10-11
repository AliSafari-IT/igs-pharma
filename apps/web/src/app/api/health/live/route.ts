import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness: the process is up and serving. Touches nothing else (no DB), so a database outage
 * makes `/api/health` (readiness) fail without the OS restarting a healthy container.
 */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
