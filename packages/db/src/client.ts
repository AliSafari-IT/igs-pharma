import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { appEnv, dbEnv, parseEnvFor } from "@igs/config/env";

// Only what the database needs: processes without AUTH_* (the worker) can open a pool.
const clientEnv = dbEnv.extend(appEnv.shape);

let _sql: postgres.Sql | undefined;
let _db: ReturnType<typeof drizzle> | undefined;

/**
 * Returns the singleton Drizzle client.
 * Call once per process; the connection pool is managed by postgres.js.
 */
export function getDb() {
  if (!_db) {
    const env = parseEnvFor(clientEnv);
    _sql = postgres(env.DATABASE_URL, {
      max: env.DATABASE_MAX_CONNECTIONS,
      idle_timeout: 30,
      connect_timeout: 10,
      ssl: env.NODE_ENV === "production" ? "require" : false,
    });
    _db = drizzle(_sql, {
      logger: env.NODE_ENV === "development" && ["debug", "trace"].includes(env.LOG_LEVEL),
    });
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
