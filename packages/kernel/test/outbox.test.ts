import { newId } from "@igs/db/ids";
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import PgBoss from "pg-boss";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  type JobQueue,
  type OutboxEnvelope,
  backoffMs,
  command,
  createOutboxRelay,
  defineEvent,
  handleOnce,
  pgBossExecutor,
  purgeExpired,
  registerEvents,
  startOutboxRelay,
} from "../src";
import {
  type KernelTestHandles,
  actors,
  configureKernelForTests,
  resetKernelForTests,
} from "../src/testing";

let iso: IsolatedDatabase;
let boss: PgBoss;
let kernel: KernelTestHandles;

const Approved = defineEvent("orders.review.approved", 1, z.object({ orderId: z.string() }));
const Unregistered = defineEvent("orders.review.rejected", 1, z.object({ orderId: z.string() }));

const q = async <T = Record<string, unknown>>(text: string): Promise<T[]> =>
  (await iso.sql.unsafe(text)) as unknown as T[];
const count = async (table: string) =>
  Number((await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0]?.n);
const jobs = (topic: string) =>
  q<{ id: string; data: OutboxEnvelope; singleton_key: string }>(
    `SELECT id, data, singleton_key FROM pgboss.job WHERE name = '${topic}'`,
  );

const approve = command({
  name: "orders.review.approve",
  input: z.object({ orderId: z.string(), fail: z.boolean().default(false) }),
  permission: "orders.review.decide",
  handler: async ({ input, ctx }) => {
    await ctx.audit.record({ action: "orders.review.approved" });
    await ctx.outbox.publish(Approved, { orderId: input.orderId });
    if (input.fail) throw new Error("boom");
    return { orderId: input.orderId };
  },
});

const pharmacist = () => actors.user({ roles: ["pharmacist"] });

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  boss = new PgBoss({ connectionString: iso.url, max: 3 });
  boss.on("error", () => {});
  await boss.start(); // dev/test: pg-boss may migrate its own schema (A6)
});

afterAll(async () => {
  await boss?.stop({ graceful: false, wait: true });
  await iso?.drop();
});

beforeEach(async () => {
  await q("TRUNCATE system.outbox, system.idempotency_keys");
  await q("DELETE FROM pgboss.job");
  kernel = configureKernelForTests({ db: iso.db });
  registerEvents(Approved);
});

afterEach(() => resetKernelForTests());

const relay = (options: Partial<Parameters<typeof startOutboxRelay>[0]> = {}) =>
  createOutboxRelay({
    queue: boss as unknown as JobQueue,
    db: iso.db,
    intervalMs: 3_600_000,
    clock: kernel.clock.now,
    ...options,
  });

describe("ctx.outbox.publish", () => {
  it("writes the event in the command's transaction", async () => {
    await approve({ orderId: "o1" }, pharmacist());
    const [row] = await q<{ topic: string; schema_version: number; payload: unknown }>(
      "SELECT topic, schema_version, payload FROM system.outbox",
    );
    expect(row).toEqual({
      topic: "orders.review.approved",
      schema_version: 1,
      payload: { orderId: "o1" },
    });
  });

  it("rolls back together with the handler and audit when the handler throws", async () => {
    await expect(approve({ orderId: "o1", fail: true }, pharmacist())).rejects.toThrow("boom");
    expect(await count("system.outbox")).toBe(0);
  });

  it("rejects unregistered events and invalid payloads without writing", async () => {
    const bad = command({
      name: "orders.review.bad",
      input: z.object({}),
      permission: "public",
      audit: "none",
      handler: async ({ ctx }) => ctx.outbox.publish(Unregistered, { orderId: "x" }),
    });
    await expect(bad({}, actors.anonymous())).rejects.toMatchObject({
      code: "kernel.event_not_registered",
    });
    const invalid = command({
      name: "orders.review.invalid",
      input: z.object({}),
      permission: "public",
      audit: "none",
      handler: async ({ ctx }) => ctx.outbox.publish(Approved, { orderId: 1 } as never),
    });
    await expect(invalid({}, actors.anonymous())).rejects.toMatchObject({
      code: "kernel.invalid_event_payload",
    });
    expect(await count("system.outbox")).toBe(0);
  });

  it("defineEvent validates topic naming and version", () => {
    expect(() => defineEvent("Bad", 1, z.object({}))).toThrow(/invalid_topic/);
    expect(() => defineEvent("a.b.c", 0, z.object({}))).toThrow(/invalid_event_version/);
  });
});

describe("outbox relay", () => {
  it("enqueues into pg-boss and marks published (singletonKey = outbox.id)", async () => {
    await approve({ orderId: "o1" }, pharmacist());
    const stats = await relay().runOnce();
    expect(stats).toEqual({ published: 1, failed: 0, dead: 0 });

    const [row] = await q<{ id: string; published_at: Date | null }>(
      "SELECT id, published_at FROM system.outbox",
    );
    expect(row?.published_at).not.toBeNull();
    const [job] = await jobs("orders.review.approved");
    expect(job?.singleton_key).toBe(row?.id);
    expect(job?.data).toEqual({
      eventId: row?.id,
      topic: "orders.review.approved",
      schemaVersion: 1,
      payload: { orderId: "o1" },
    });
    // nothing left to do
    expect(await relay().runOnce()).toEqual({ published: 0, failed: 0, dead: 0 });
    expect((await jobs("orders.review.approved")).length).toBe(1);
  });

  it("Q6: enqueue + published_at commit or roll back together", async () => {
    await approve({ orderId: "o1" }, pharmacist());
    await boss.createQueue("orders.review.approved");
    const [row] = await q<{ id: string }>("SELECT id FROM system.outbox");

    // rolled back → neither the job nor published_at exist
    await expect(
      iso.db.transaction(async (tx) => {
        await boss.send("orders.review.approved", { eventId: row?.id }, {
          singletonKey: row?.id as string,
          db: pgBossExecutor(tx),
        } as never);
        await tx.execute(
          (await import("drizzle-orm")).sql`UPDATE system.outbox SET published_at = now()`,
        );
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect((await jobs("orders.review.approved")).length).toBe(0);
    expect(await count("system.outbox WHERE published_at IS NOT NULL")).toBe(0);

    // committed → both exist
    await relay().runOnce();
    expect((await jobs("orders.review.approved")).length).toBe(1);
    expect(await count("system.outbox WHERE published_at IS NOT NULL")).toBe(1);
  });

  it("a send failure rolls back that row's enqueue and records the attempt with backoff", async () => {
    await approve({ orderId: "o1" }, pharmacist());
    const failing: JobQueue = {
      createQueue: async () => {},
      send: async () => {
        throw new Error("secret-looking message that must not be stored");
      },
    };
    const stats = await relay({ queue: failing, baseDelayMs: 1000, random: () => 0 }).runOnce();
    expect(stats).toEqual({ published: 0, failed: 1, dead: 0 });
    const [row] = await q<{
      attempts: number;
      last_error: string;
      next_attempt_at: Date;
      dead_at: Date | null;
      published_at: Date | null;
    }>("SELECT attempts, last_error, next_attempt_at, dead_at, published_at FROM system.outbox");
    expect(row?.attempts).toBe(1);
    expect(row?.last_error).toBe("Error");
    expect(row?.published_at).toBeNull();
    expect(row?.dead_at).toBeNull();
    expect(new Date(row?.next_attempt_at as Date).getTime()).toBe(
      kernel.clock.now().getTime() + 1000,
    );

    // not due yet → skipped; due after the backoff → retried and delivered
    expect(await relay().runOnce()).toEqual({ published: 0, failed: 0, dead: 0 });
    kernel.clock.advance(1001);
    expect(await relay().runOnce()).toEqual({ published: 1, failed: 0, dead: 0 });
  });

  it("dead-letters after maxAttempts and logs it", async () => {
    await approve({ orderId: "o1" }, pharmacist());
    const failing: JobQueue = {
      createQueue: async () => {},
      send: async () => {
        throw new Error("down");
      },
    };
    const r = relay({ queue: failing, maxAttempts: 3, baseDelayMs: 10, random: () => 0 });
    expect(await r.runOnce()).toMatchObject({ failed: 1, dead: 0 });
    kernel.clock.advance(60_000);
    expect(await r.runOnce()).toMatchObject({ failed: 1, dead: 0 });
    kernel.clock.advance(60_000);
    expect(await r.runOnce()).toMatchObject({ failed: 1, dead: 1 });
    const [row] = await q<{ attempts: number; dead_at: Date | null }>(
      "SELECT attempts, dead_at FROM system.outbox",
    );
    expect(row?.attempts).toBe(3);
    expect(row?.dead_at).not.toBeNull();
    expect(kernel.errors.some((e) => "attempts" in e)).toBe(true);

    kernel.clock.advance(60_000);
    expect(await r.runOnce()).toEqual({ published: 0, failed: 0, dead: 0 });
  });

  it("two relays never process the same row (SKIP LOCKED)", async () => {
    for (let i = 0; i < 20; i++) {
      await iso.sql`INSERT INTO system.outbox (id, topic, schema_version, payload, next_attempt_at)
        VALUES (${newId()}, 'orders.review.approved', 1, ${JSON.stringify({ orderId: `o${i}` })}::jsonb, ${kernel.clock.now().toISOString()}::timestamptz)`;
    }
    const sent: string[] = [];
    const slowQueue: JobQueue = {
      createQueue: async () => {},
      send: async (_name, data) => {
        sent.push((data as OutboxEnvelope).eventId);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return "ok";
      },
    };
    const a = relay({ queue: slowQueue, batchSize: 20 });
    const b = relay({ queue: slowQueue, batchSize: 20 });
    // both start while the other still holds its row locks
    const [ra, rb] = await Promise.all([a.runOnce(), b.runOnce()]);
    expect(ra.published + rb.published).toBe(20);
    expect(new Set(sent).size).toBe(sent.length); // no duplicates
    expect(sent.length).toBe(20);
    expect(Math.min(ra.published, rb.published)).toBe(0); // the second found everything locked
  });

  it("reports outbox lag as a gauge", async () => {
    const gauges: [string, number][] = [];
    await approve({ orderId: "o1" }, pharmacist());
    kernel.clock.advance(30_000);
    const failing: JobQueue = {
      createQueue: async () => {},
      send: async () => {
        throw new Error("down");
      },
    };
    await relay({
      queue: failing,
      metrics: { increment: () => {}, gauge: (n, v) => void gauges.push([n, v]) },
    }).runOnce();
    expect(gauges).toEqual([["kernel.outbox.lag_seconds", 30]]);
  });

  it("start/stop: the timer delivers events", async () => {
    await approve({ orderId: "o1" }, pharmacist());
    const r = startOutboxRelay({
      queue: boss as unknown as JobQueue,
      db: iso.db,
      intervalMs: 20,
      clock: kernel.clock.now,
    });
    await vi.waitFor(async () => {
      expect(await count("system.outbox WHERE published_at IS NOT NULL")).toBe(1);
    });
    await r.stop();
  });
});

describe("backoffMs", () => {
  it("grows exponentially, is capped, and adds bounded jitter", () => {
    expect(backoffMs(1, 1000, 60_000, () => 0)).toBe(1000);
    expect(backoffMs(2, 1000, 60_000, () => 0)).toBe(2000);
    expect(backoffMs(4, 1000, 60_000, () => 0)).toBe(8000);
    expect(backoffMs(20, 1000, 60_000, () => 0)).toBe(60_000);
    expect(backoffMs(1, 1000, 60_000, () => 1)).toBe(1200);
  });
});

describe("handleOnce", () => {
  it("runs the subscriber once per (event, subscriber), atomically with its writes", async () => {
    await q("CREATE TABLE IF NOT EXISTS handled (n int)");
    const id = newId();
    const run = (subscriber: string) =>
      handleOnce(id, subscriber, async (tx) => {
        await tx.execute((await import("drizzle-orm")).sql`INSERT INTO handled VALUES (1)`);
        return "done";
      });
    expect(await run("mail")).toBe("done");
    expect(await run("mail")).toBeUndefined();
    expect(await run("search")).toBe("done"); // other subscriber still runs
    expect(await count("handled")).toBe(2);
  });

  it("a failing subscriber releases the claim so the retry runs", async () => {
    const id = newId();
    await expect(
      handleOnce(id, "mail", async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(await handleOnce(id, "mail", async () => "ok")).toBe("ok");
  });

  it("concurrent duplicates run the subscriber once", async () => {
    const id = newId();
    let runs = 0;
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        handleOnce(id, "mail", async () => {
          runs++;
          await new Promise((resolve) => setTimeout(resolve, 30));
          return "ok";
        }),
      ),
    );
    expect(runs).toBe(1);
    expect(results.filter((r) => r === "ok").length).toBe(1);
  });
});

describe("K5: metrics by value and housekeeping", () => {
  it("relay counters carry the count as the value, not as a label", async () => {
    await approve({ orderId: "o1" }, pharmacist());
    await approve({ orderId: "o2" }, pharmacist());
    const seen: { name: string; attributes: unknown; value: number | undefined }[] = [];
    await relay({
      metrics: {
        increment: (name, attributes, value) => void seen.push({ name, attributes, value }),
      },
    }).runOnce();
    expect(seen).toEqual([{ name: "kernel.outbox.published", attributes: {}, value: 2 }]);
  });

  it("purgeExpired removes old published outbox rows and expired keys only", async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = kernel.clock.now();
    const iso8601 = (ms: number) => new Date(now.getTime() + ms).toISOString();
    const row = (id: string, publishedMs: number | null, deadMs: number | null = null) =>
      iso.sql`INSERT INTO system.outbox (id, topic, schema_version, payload, created_at, published_at, dead_at)
        VALUES (${id}, 'orders.review.approved', 1, '{}'::jsonb, ${iso8601(-30 * day)}::timestamptz,
          ${publishedMs === null ? null : iso8601(publishedMs)}::timestamptz,
          ${deadMs === null ? null : iso8601(deadMs)}::timestamptz)`;
    await row(newId(), -8 * day); // published 8 days ago → purged
    await row(newId(), -6 * day); // published 6 days ago → kept
    await row(newId(), null); // unpublished → kept
    await row(newId(), null, -20 * day); // dead-lettered → kept for inspection
    await iso.sql`INSERT INTO system.idempotency_keys (key, expires_at) VALUES
      ('old', ${iso8601(-1000)}::timestamptz), ('live', ${iso8601(day)}::timestamptz)`;

    const result = await purgeExpired({ db: iso.db, now });
    expect(result).toEqual({ outbox: 1, idempotencyKeys: 1 });
    expect(await count("system.outbox")).toBe(3);
    expect(
      (await q<{ key: string }>("SELECT key FROM system.idempotency_keys")).map((r) => r.key),
    ).toEqual(["live"]);
    // idempotent
    expect(await purgeExpired({ db: iso.db, now })).toEqual({ outbox: 0, idempotencyKeys: 0 });
  });
});
