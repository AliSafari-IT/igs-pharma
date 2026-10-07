import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import type { GlobalSetupContext } from "vitest/node";

import { applyMigrations, withDatabase } from "./migrate";

/** Same major as docker-compose.yml and production (architect, T-004). */
export const POSTGRES_IMAGE = "postgres:17-alpine";

declare module "vitest" {
  export interface ProvidedContext {
    /** Connection URL (superuser) to the throw-away Postgres server for this test run. */
    igsTestAdminUrl: string;
    /** Name of the migrated template database (per-file databases are cloned from it). */
    igsTestTemplateDb: string;
    /** Name of the shared, migrated database used by `withTestTx()`. */
    igsTestSharedDb: string;
    /** Prefix of every database created in this run (used for cleanup). */
    igsTestPrefix: string;
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
  const prefix = `igs_test_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
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
          await admin.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
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
