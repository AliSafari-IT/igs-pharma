import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getEnv } from "@igs/config/env";

import * as schema from "./schema/index";

let _sql: postgres.Sql | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Returns the singleton Drizzle client.
 * Call once per process; the connection pool is managed by postgres.js.
 */
export function getDb() {
  if (!_db) {
    const env = getEnv();
    _sql = postgres(env.DATABASE_URL, {
      max: env.DATABASE_MAX_CONNECTIONS,
      idle_timeout: 30,
      connect_timeout: 10,
      ssl: env.NODE_ENV === "production" ? "require" : false,
    });
    _db = drizzle(_sql, { schema, logger: env.NODE_ENV === "development" });
  }
  return _db;
}

/** Closes the connection pool (graceful shutdown). A later `getDb()` opens a new one. */
export async function closeDb(): Promise<void> {
  const sql = _sql;
  _sql = undefined;
  _db = undefined;
  await sql?.end({ timeout: 5 });
}

export type Db = ReturnType<typeof getDb>;
