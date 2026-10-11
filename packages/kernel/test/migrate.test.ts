// migrateDatabase (igs-pharma#46): the worker image's one-shot migrate entry, on an empty database.
import { fileURLToPath } from "node:url";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDatabase, migrateDatabase } from "../src";

const migrationsFolder = fileURLToPath(new URL("../../db/drizzle", import.meta.url));

let iso: IsolatedDatabase;

beforeAll(async () => {
  iso = await createIsolatedDatabase({ migrated: false });
  vi.stubEnv("DATABASE_URL", iso.url);
});
afterAll(async () => {
  await closeDatabase();
  vi.unstubAllEnvs();
  await iso?.drop();
});

describe("migrateDatabase", () => {
  it("applies the whole chain to an empty database, and a second run changes nothing", async () => {
    await migrateDatabase(migrationsFolder);
    const journal = (await import("../../db/drizzle/meta/_journal.json")).default;
    const applied = async () =>
      (await iso.sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)[0]?.n;
    expect(await applied()).toBe(journal.entries.length);
    // the RBAC seed ran: the kernel and identity tables are there
    const [row] = await iso.sql`SELECT count(*)::int AS n FROM identity.role_permissions`;
    expect(row?.n).toBeGreaterThan(0);

    await migrateDatabase(migrationsFolder);
    expect(await applied()).toBe(journal.entries.length);
  });
});
