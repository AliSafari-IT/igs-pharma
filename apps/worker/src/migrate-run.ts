import { buildDbSsl } from "@igs/config/db-ssl";
import type { parseEnvFor, workerEnv } from "@igs/config/env";
import { closeDatabase, migrateDatabase, withMigrateLock } from "@igs/kernel";
import PgBoss from "pg-boss";

import { registerWorkerEvents } from "./events";
import { type InstallableBoss, installPgBossQueuesAndGrants } from "./pgboss-install";

export interface MigrateLogger {
  info(obj: object | string, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/**
 * The body of the migrate entry (see `migrate.ts`), under a session-level advisory lock so that two
 * concurrent starts (a rolling deploy) serialise instead of racing (igs-pharma#77): Drizzle
 * migrations, pg-boss install, queue creation and the pg-boss grants all happen while the lock is
 * held. Released in `finally`, or by Postgres when the process dies.
 */
export async function runMigrate(options: {
  readonly folder: string;
  readonly env: ReturnType<typeof parseEnvFor<typeof workerEnv>>;
  readonly logger: MigrateLogger;
  readonly lockWaitSeconds?: number;
}): Promise<void> {
  const { folder, env, logger } = options;
  await withMigrateLock(
    async () => {
      try {
        logger.info({ folder }, "Applying database migrations");
        await migrateDatabase(folder);
        logger.info("Database migrations applied");
      } finally {
        await closeDatabase();
      }

      // same connection settings as the worker (src/index.ts), but allowed to migrate its schema
      const boss = new PgBoss({
        connectionString: env.DATABASE_URL,
        max: 1,
        migrate: true,
        supervise: false,
        schedule: false,
        ssl: buildDbSsl(env).options,
      });
      boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
      await boss.start();
      try {
        // the same events as the worker: one queue per topic (see ./events)
        registerWorkerEvents();
        // getDb() is public in pg-boss 10 but missing from its typings
        await installPgBossQueuesAndGrants(boss as unknown as InstallableBoss);
        logger.info("pg-boss queues and runtime grants up to date");
      } finally {
        await boss.stop({ graceful: false, wait: true });
      }
      logger.info("pg-boss schema up to date");
    },
    {
      ...(options.lockWaitSeconds ? { waitSeconds: options.lockWaitSeconds } : {}),
      onWait: () => logger.info("Another migrate run holds the database lock; waiting for it"),
    },
  );
}
