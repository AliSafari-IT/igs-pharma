/**
 * Integration-test harness for real-Postgres tests (`@igs/db/testing`).
 *
 * TEST-ONLY: never import from app or module runtime code (it pulls in vitest/testcontainers).
 * Wire it up with `globalSetup` in the package's vitest config:
 *
 *   globalSetup: ["@igs/db/testing/global-setup"]
 *
 * Then in tests:
 *   - `withTestTx(async (tx) => …)`   — runs in a transaction that is always rolled back;
 *   - `createIsolatedDatabase()`      — a fresh, migrated database for tests that need DDL/grants;
 *   - `createIsolatedDatabase({ migrated: false })` — an empty one (migration tests).
 */
import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inject } from "vitest";

import * as schema from "../schema/index";
import { withDatabase } from "./migrate";

export { applyMigrations } from "./migrate";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

const ROLLBACK = Symbol("igs-test-rollback");

type Handle = { url: string; sql: postgres.Sql; db: TestDb };

function connect(url: string): Handle {
  const sql = postgres(url, { max: 5, onnotice: () => {} });
  return { url, sql, db: drizzle(sql, { schema }) };
}

let shared: Handle | undefined;

/** Shared migrated database (one per test run, one connection pool per worker). */
export function getTestDatabase(): Handle {
  if (!shared) shared = connect(withDatabase(inject("igsTestAdminUrl"), inject("igsTestSharedDb")));
  return shared;
}

/**
 * Runs `fn` inside a transaction on the shared database and ALWAYS rolls it back, so tests
 * cannot leak rows into each other. Resolves with whatever `fn` returns.
 */
export async function withTestTx<T>(
  fn: (tx: Parameters<Parameters<TestDb["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  try {
    await getTestDatabase().db.transaction(async (tx) => {
      result = await fn(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return result as T;
}

export type IsolatedDatabase = Handle & { drop(): Promise<void> };

/** A brand-new database: cloned from the migrated template, or empty with `migrated: false`. */
export async function createIsolatedDatabase(
  options: { migrated?: boolean } = {},
): Promise<IsolatedDatabase> {
  const { migrated = true } = options;
  const adminUrl = inject("igsTestAdminUrl");
  const name = `${inject("igsTestPrefix")}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    const template = migrated ? ` TEMPLATE "${inject("igsTestTemplateDb")}"` : "";
    await admin.unsafe(`CREATE DATABASE "${name}"${template}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const handle = connect(withDatabase(adminUrl, name));
  return {
    ...handle,
    async drop() {
      await handle.sql.end({ timeout: 5 });
      const cleanup = postgres(adminUrl, { max: 1, onnotice: () => {} });
      try {
        await cleanup.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleanup.end({ timeout: 5 });
      }
    },
  };
}
