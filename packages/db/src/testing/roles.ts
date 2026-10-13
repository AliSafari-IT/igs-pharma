import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { inject } from "vitest";

import { withDatabase } from "./migrate";
import type {} from "./provided-context";

const drizzleFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

const withCredentials = (url: string, user: string, password: string): string => {
  const next = new URL(url);
  next.username = user;
  next.password = password;
  return next.toString();
};

export interface RuntimeRoleDatabase {
  /** The administrative role: not a superuser, owns the database and every schema in it. */
  readonly adminUrl: string;
  /** A login role that is a member of `igs_app` only (web / platform). */
  readonly appUrl: string;
  /** A login role that is a member of `igs_app` and `igs_worker` (the worker). */
  readonly workerUrl: string;
  /** The superuser connection to this same database (setup, simulating out-of-band grants). */
  readonly superUrl: string;
  readonly adminRole: string;
  readonly appRole: string;
  readonly workerRole: string;
  /** Applies the committed migrations as the administrative role. */
  migrate(options?: { upTo?: number }): Promise<void>;
  drop(): Promise<void>;
}

/**
 * A database for the grant tests (igs-pharma#66): empty, owned by a NON-superuser administrative
 * role (`CREATEROLE`, no `CREATEDB`/superuser), with two unprivileged login roles that are members
 * of the `igs_app` / `igs_worker` group roles the migrations create. Call `migrate()` to build the
 * schema as the admin; nothing in the repo's migrations may need a superuser.
 */
export async function createRuntimeRoleDatabase(): Promise<RuntimeRoleDatabase> {
  const adminUrl0 = inject("igsTestAdminUrl");
  const id = randomUUID().replaceAll("-", "").slice(0, 8);
  const database = `${inject("igsTestPrefix")}_roles_${id}`;
  const adminRole = `igs_t66_adm_${id}`;
  const appRole = `igs_t66_app_${id}`;
  const workerRole = `igs_t66_wrk_${id}`;
  const password = randomBytes(12).toString("hex");

  const superSql = postgres(adminUrl0, { max: 1, onnotice: () => {} });
  try {
    await superSql.unsafe(`CREATE ROLE "${adminRole}" LOGIN CREATEROLE PASSWORD '${password}'`);
    await superSql.unsafe(`CREATE ROLE "${appRole}" LOGIN PASSWORD '${password}'`);
    await superSql.unsafe(`CREATE ROLE "${workerRole}" LOGIN PASSWORD '${password}'`);
    await superSql.unsafe(`CREATE DATABASE "${database}" OWNER "${adminRole}"`);
  } finally {
    await superSql.end({ timeout: 5 });
  }
  const superUrl = withDatabase(adminUrl0, database);
  const url = (role: string) => withCredentials(superUrl, role, password);

  // the group roles are created by migration 0005 / 0007; membership is granted once they exist
  let groupsGranted = false;
  const grantMemberships = async () => {
    if (groupsGranted) return;
    const sql = postgres(adminUrl0, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe(`GRANT "igs_app" TO "${appRole}", "${workerRole}"`);
      await sql.unsafe(`GRANT "igs_worker" TO "${workerRole}"`);
      groupsGranted = true;
    } finally {
      await sql.end({ timeout: 5 });
    }
  };

  async function runMigrations(upTo?: number) {
    let folder = drizzleFolder;
    let scratch: string | undefined;
    if (upTo !== undefined) {
      // a copy of the chain without the migrations after `upTo` (simulates the previous release)
      scratch = fs.mkdtempSync(path.join(os.tmpdir(), "igs-drizzle-"));
      fs.cpSync(drizzleFolder, scratch, { recursive: true });
      const journalPath = path.join(scratch, "meta", "_journal.json");
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
        entries: { idx: number; tag: string }[];
      };
      journal.entries = journal.entries.filter((entry) => entry.idx <= upTo);
      fs.writeFileSync(journalPath, JSON.stringify(journal));
      folder = scratch;
    }
    const sql = postgres(url(adminRole), { max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(sql), { migrationsFolder: folder });
    } finally {
      await sql.end({ timeout: 5 });
      if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    }
    await grantMemberships();
  }

  return {
    adminUrl: url(adminRole),
    appUrl: url(appRole),
    workerUrl: url(workerRole),
    superUrl,
    adminRole,
    appRole,
    workerRole,
    migrate: (options = {}) => runMigrations(options.upTo),
    async drop() {
      const sql = postgres(adminUrl0, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        for (const role of [workerRole, appRole, adminRole]) {
          await sql.unsafe(`DROP ROLE IF EXISTS "${role}"`);
        }
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
  };
}
