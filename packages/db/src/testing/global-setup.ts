import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import type { GlobalSetupContext } from "vitest/node";

import { applyMigrations, withDatabase } from "./migrate";
import type {} from "./provided-context";

/** Same major as docker-compose.yml and production (architect, T-004). */
export const POSTGRES_IMAGE = "postgres:17-alpine";

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Drops `igs_test_*` databases that a killed or crashed earlier run left behind: older than six
 * hours by the timestamp in their name, and with no connection. Best effort; never fails a run.
 */
async function sweepStaleDatabases(admin: postgres.Sql): Promise<void> {
  try {
    const rows = await admin<{ datname: string }[]>`
      SELECT d.datname FROM pg_database d
      WHERE d.datname LIKE 'igs\_test\_%'
        AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)`;
    for (const { datname } of rows) {
      const stamp = /^igs_test_([0-9a-z]+)x[0-9a-f]{4}_/.exec(datname)?.[1];
      const created = stamp ? Number.parseInt(stamp, 36) : Number.NaN;
      if (!Number.isFinite(created) || Date.now() - created < STALE_AFTER_MS) continue;
      await admin.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`).catch(() => {});
    }
  } catch {
    // a sweep must never fail the run
  }
}

/**
 * Vitest global setup — one Postgres per test run, shared by every test file.
 *
 * - default: start `postgres:17-alpine` with Testcontainers (needs Docker);
 * - `TEST_DATABASE_URL`: use that superuser connection instead (no Docker, e.g. a local
 *   Postgres). It only ever creates/drops databases prefixed `igs_test_`. `DATABASE_URL` is
 *   deliberately never used so tests cannot touch a dev/prod database by accident.
 *
 * Migrates a template database once; per-file databases are cheap `CREATE DATABASE … TEMPLATE`.
 */
export default async function setup({ provide }: GlobalSetupContext) {
  const external = process.env["TEST_DATABASE_URL"];
  // the creation time is part of the name, so a later run can sweep what a killed run left behind
  const prefix = `igs_test_${Date.now().toString(36)}x${randomUUID().replaceAll("-", "").slice(0, 4)}`;
  let container: StartedPostgreSqlContainer | undefined;
  let admin: postgres.Sql | undefined;

  // Used for teardown AND when setup itself fails: never leak the container, the admin
  // connection or half-created databases (a leaked handle keeps Vitest from exiting).
  const cleanup = async () => {
    try {
      if (admin && !container) {
        // external server: remove everything this run created (a container is simply stopped)
        const rows = await admin<{ datname: string }[]>`
          SELECT datname FROM pg_database WHERE datname LIKE ${`${prefix}\\_%`}`;
        for (const { datname } of rows) {
          // one failing drop must not leave the rest behind
          await admin.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`).catch(() => {});
        }
      }
    } finally {
      try {
        await admin?.end({ timeout: 5 });
      } finally {
        await container?.stop();
      }
    }
  };

  try {
    let adminUrl: string;
    if (external) {
      adminUrl = external;
    } else {
      container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      adminUrl = container.getConnectionUri();
    }

    const template = `${prefix}_template`;
    const shared = `${prefix}_shared`;

    admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
    await sweepStaleDatabases(admin);
    await admin.unsafe(`CREATE DATABASE "${template}"`);
    await applyMigrations(withDatabase(adminUrl, template));
    await admin.unsafe(`CREATE DATABASE "${shared}" TEMPLATE "${template}"`);

    provide("igsTestAdminUrl", adminUrl);
    provide("igsTestTemplateDb", template);
    provide("igsTestSharedDb", shared);
    provide("igsTestPrefix", prefix);
  } catch (error) {
    // best effort: the original error is the one worth reporting
    await cleanup().catch(() => {});
    throw error;
  }

  return cleanup;
}
