import { NextResponse } from "next/server";

import { dbHealthCheck } from "@igs/db/health";
import { logger } from "@igs/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness (igs-pharma#96): `200 "ok"` while the database answers, `503 "degraded"` when it does
 * not. The PUBLIC answer carries only that; the app version and the database latency go to the log,
 * with a short error class on failure (never the driver's message, a URL or a credential).
 */
export async function GET() {
  const db = await dbHealthCheck();
  const log = {
    event: "health.check",
    version: process.env["npm_package_version"] ?? "0.0.0",
    databaseOk: db.ok,
    latencyMs: db.latencyMs,
    ...(db.errorClass ? { errorClass: db.errorClass } : {}),
  };
  if (db.ok) logger.debug(log, "health.check");
  else logger.warn(log, "health.degraded");

  return NextResponse.json(
    { status: db.ok ? "ok" : "degraded", checks: { database: { ok: db.ok } } },
    { status: db.ok ? 200 : 503 },
  );
}
