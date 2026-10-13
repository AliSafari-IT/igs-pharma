import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { buildDbSsl, dbSslWarning } from "@igs/config/db-ssl";
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
    // verified TLS in production (igs-pharma#77); a bad CA setting fails here, at first use
    const ssl = buildDbSsl(env);
    const warning = dbSslWarning(env, ssl);
    if (warning) process.stderr.write(`${warning}\n`);
    _sql = postgres(env.DATABASE_URL, {
      max: env.DATABASE_MAX_CONNECTIONS,
      idle_timeout: 30,
      connect_timeout: 10,
      ssl: ssl.options,
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

/** Application key of the migrate entry's advisory lock (any fixed 64-bit number; documented here once). */
export const MIGRATE_LOCK_KEY = 7_361_204_815_902;

/**
 * Runs `fn` while holding a SESSION-level advisory lock (igs-pharma#77), so two concurrent migrate
 * entries (a rolling deploy) serialise instead of racing. The lock lives on its own dedicated
 * connection, outside the pool `fn` uses, and is released in `finally`; if the process dies the
 * connection closes and Postgres drops the lock. Waits at most `waitSeconds` (default 10 minutes)
 * and then fails with a readable message instead of hanging a deploy forever.
 */
export async function withAdvisoryLock<T>(
  key: number,
  fn: () => Promise<T>,
  options: { waitSeconds?: number; onWait?: () => void } = {},
): Promise<T> {
  const env = parseEnvFor(clientEnv);
  const ssl = buildDbSsl(env);
  const lock = postgres(env.DATABASE_URL, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 10,
    ssl: ssl.options,
    onnotice: () => {},
  });
  try {
    const wait = options.waitSeconds ?? 600;
    // a free lock is taken immediately; otherwise tell the caller we are queueing, then wait
    const [first] = await lock<
      { ok: boolean }[]
    >`SELECT pg_try_advisory_lock(${String(key)}::bigint) AS ok`;
    if (!first?.ok) {
      options.onWait?.();
      await lock.unsafe(`SET lock_timeout = '${Math.max(1, Math.floor(wait))}s'`);
      try {
        await lock`SELECT pg_advisory_lock(${String(key)}::bigint)`;
      } catch (error) {
        if ((error as { code?: string }).code === "55P03") {
          throw new Error(
            `Another migrate run holds the database lock and did not finish within ${wait} seconds.`,
          );
        }
        throw error;
      }
    }
    try {
      return await fn();
    } finally {
      await lock`SELECT pg_advisory_unlock(${String(key)}::bigint)`.catch(() => {});
    }
  } finally {
    await lock.end({ timeout: 5 });
  }
}
