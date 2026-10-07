import { NextResponse } from "next/server";

import { dbHealthCheck } from "@igs/db/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await dbHealthCheck();

  const status = db.ok ? 200 : 503;
  return NextResponse.json(
    {
      status: db.ok ? "ok" : "degraded",
      version: process.env["npm_package_version"] ?? "0.0.0",
      checks: {
        database: { ok: db.ok, latencyMs: db.latencyMs },
      },
    },
    { status },
  );
}
