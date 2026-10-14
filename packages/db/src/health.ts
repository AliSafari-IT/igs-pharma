import { sql } from "drizzle-orm";

import { getDb } from "./client";

export interface DbHealth {
  readonly ok: boolean;
  readonly latencyMs: number;
  /**
   * Why the check failed, as a short class or code (`ECONNREFUSED`, `28P01`, `Error`). Never the
   * driver's message: that can carry the statement, a host or part of a connection string.
   */
  readonly errorClass?: string;
}

/** A short, log-safe name for a failure: a driver code when it looks like one, else the error's class. */
export function errorClassOf(error: unknown): string {
  const candidates = [error instanceof Error ? error.cause : undefined, error];
  for (const candidate of candidates) {
    const code =
      typeof candidate === "object" && candidate !== null && "code" in candidate
        ? (candidate as { code: unknown }).code
        : undefined;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code)) return code;
  }
  const name = error instanceof Error ? error.constructor.name : typeof error;
  return /^[A-Za-z0-9_]{1,40}$/.test(name) ? name : "Error";
}

export async function dbHealthCheck(): Promise<DbHealth> {
  const start = Date.now();
  try {
    await getDb().execute(sql`SELECT 1`);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - start, errorClass: errorClassOf(error) };
  }
}
