import { sql } from "drizzle-orm";

import { getDb } from "./client.js";

export async function dbHealthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await getDb().execute(sql`SELECT 1`);
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}
