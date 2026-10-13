// The migrate entry under its advisory lock (igs-pharma#77), against real Postgres: two concurrent
// starts (a rolling deploy) serialise and the second finds nothing left to do.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { parseEnvFor, workerEnv } from "@igs/config/env";
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { closeDatabase, withMigrateLock } from "@igs/kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrate } from "../src/migrate-run";

const folder = fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url));
/** Every journal entry ends up applied exactly once, however many migrations there are. */
const JOURNAL_ENTRIES = (
  JSON.parse(fs.readFileSync(`${folder}/meta/_journal.json`, "utf8")) as { entries: unknown[] }
).entries.length;
let iso: IsolatedDatabase;
const saved = { url: process.env["DATABASE_URL"], env: process.env["NODE_ENV"] };

beforeAll(async () => {
  iso = await createIsolatedDatabase({ migrated: false });
  process.env["DATABASE_URL"] = iso.url;
  process.env["NODE_ENV"] = "test";
});
afterAll(async () => {
  await closeDatabase();
  for (const [key, value] of [
    ["DATABASE_URL", saved.url],
    ["NODE_ENV", saved.env],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await iso?.drop();
});

const logs: string[] = [];
const logger = {
  info: (obj: object | string) =>
    void logs.push(typeof obj === "string" ? obj : JSON.stringify(obj)),
  error: (obj: object) => void logs.push(`ERROR ${JSON.stringify(obj)}`),
};
const env = () => parseEnvFor(workerEnv, { DATABASE_URL: iso.url, NODE_ENV: "test" });
const journalRows = async () =>
  (await iso.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)[0]
    ?.n;

describe("runMigrate", () => {
  it("waits while another run holds the lock, and starts only when it is released", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding: () => void = () => {};
    const acquired = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const holder = withMigrateLock(async () => {
      holding();
      await held;
    });
    await acquired;

    let finished = false;
    const run = runMigrate({ folder, env: env(), logger }).then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(finished).toBe(false);
    const [schema] = await iso.sql<{ present: boolean }[]>`
      SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`;
    expect(schema?.present, "nothing ran while the lock was held").toBe(false);
    expect(logs).toContain("Another migrate run holds the database lock; waiting for it");

    release();
    await holder;
    await run;
    expect(finished).toBe(true);
    expect(await journalRows()).toBe(JOURNAL_ENTRIES);
  }, 120_000);

  it("two concurrent runs both succeed, apply each migration once and create the queues once", async () => {
    await Promise.all([
      runMigrate({ folder, env: env(), logger }),
      runMigrate({ folder, env: env(), logger }),
    ]);
    expect(await journalRows()).toBe(JOURNAL_ENTRIES);
    const queues = await iso.sql<{ name: string }[]>`SELECT name FROM pgboss.queue ORDER BY name`;
    expect(queues.map((q) => q.name)).toEqual(
      expect.arrayContaining([
        "audit.chain.verify",
        "audit.partitions.ensure",
        "kernel.maintenance.purge",
      ]),
    );
    expect(logs.filter((l) => l.startsWith("ERROR"))).toEqual([]);
  }, 120_000);
});
