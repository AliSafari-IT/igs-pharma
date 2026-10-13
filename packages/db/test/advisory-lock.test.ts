// The migrate entry's advisory lock (igs-pharma#77) against real Postgres: concurrent holders
// serialise, the lock is released in `finally` (also on error), and a waiter gives up readably.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IsolatedDatabase, createIsolatedDatabase } from "../src/testing";

import { closeDb, withAdvisoryLock } from "../src/client";

let iso: IsolatedDatabase;
const saved = {
  url: process.env["DATABASE_URL"],
  env: process.env["NODE_ENV"],
  ssl: process.env["DATABASE_SSL"],
};

beforeAll(async () => {
  iso = await createIsolatedDatabase({ migrated: false });
  process.env["DATABASE_URL"] = iso.url;
  process.env["NODE_ENV"] = "test";
  process.env["DATABASE_SSL"] = "off";
});

afterAll(async () => {
  await closeDb();
  for (const [key, value] of [
    ["DATABASE_URL", saved.url],
    ["NODE_ENV", saved.env],
    ["DATABASE_SSL", saved.ssl],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await iso?.drop();
});

// below 2^32, so Postgres stores it as objid with classid 0
const KEY = 4_242_424_242;
const lockHolders = async () =>
  (
    await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted AND objid = ${KEY}`
  )[0]?.n;

/** A promise and its resolver: the barrier the tests use instead of sleeping. */
function gate() {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

describe("withAdvisoryLock", () => {
  it("serialises concurrent holders: the second starts only after the first finished", async () => {
    const order: string[] = [];
    const firstHolds = gate();
    const secondQueued = gate();
    const releaseFirst = gate();
    const first = withAdvisoryLock(KEY, async () => {
      order.push("first:start");
      firstHolds.open();
      await releaseFirst.opened;
      order.push("first:end");
    });
    await firstHolds.opened; // the first one holds it now (no sleeping: it told us so)
    const second = withAdvisoryLock(
      KEY,
      async () => {
        order.push("second:start");
        order.push("second:end");
      },
      { onWait: secondQueued.open },
    );
    await secondQueued.opened; // the second found the lock taken and queues behind it
    expect(order).toEqual(["first:start"]);
    releaseFirst.open();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    expect(await lockHolders()).toBe(0);
  });

  it("releases the lock when the work throws, and passes the error on", async () => {
    await expect(
      withAdvisoryLock(KEY, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await lockHolders()).toBe(0);
    await expect(withAdvisoryLock(KEY, async () => "again")).resolves.toBe("again");
  });

  it("a waiter gives up with a readable message instead of hanging", async () => {
    const holds = gate();
    const release = gate();
    const holder = withAdvisoryLock(KEY, async () => {
      holds.open();
      await release.opened;
    });
    await holds.opened;
    // the 1-second lock_timeout is the only clock here; the holder lets go only after the waiter failed
    await expect(withAdvisoryLock(KEY, async () => "never", { waitSeconds: 1 })).rejects.toThrow(
      /Another migrate run holds the database lock/,
    );
    release.open();
    await holder;
    expect(await lockHolders()).toBe(0);
  });
});
