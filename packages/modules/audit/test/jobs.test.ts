import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import type { KernelRuntime } from "@igs/kernel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AUDIT_JOBS,
  type JobScheduler,
  MIN_FUTURE_PARTITIONS,
  record,
  registerAuditAction,
  registerAuditJobs,
  reportPartitionsFailed,
  reportVerifyFailed,
  runChainVerification,
  runPartitionMaintenance,
} from "../src";
import { resetAuditActions } from "../src/actions";

const KEY = "k".repeat(32);

let iso: IsolatedDatabase;

interface Captured {
  counters: { name: string; labels: unknown; value: number | undefined }[];
  gauges: [string, number][];
  errors: Record<string, unknown>[];
}

const runtimeFor = (db: KernelRuntime["db"], now = new Date()) => {
  const captured: Captured = { counters: [], gauges: [], errors: [] };
  const runtime: KernelRuntime = {
    db,
    now: () => now,
    metrics: {
      increment: (name, labels, value) => void captured.counters.push({ name, labels, value }),
      gauge: (name, value) => void captured.gauges.push([name, value]),
    },
    logger: { error: (obj) => void captured.errors.push(obj) },
  };
  return { runtime, captured };
};

beforeEach(async () => {
  iso = await createIsolatedDatabase();
  resetAuditActions();
  registerAuditAction("audit.test.happened", z.object({ orderId: z.string() }));
});
afterEach(async () => {
  await iso.drop();
});

const append = (orderId: string) =>
  iso.db.transaction((tx) =>
    record(
      tx,
      {
        at: new Date(),
        actor: { type: "system", id: "job" },
        action: "audit.test.happened",
        data: { orderId },
      },
      { hmacKey: KEY },
    ),
  );

describe("runPartitionMaintenance", () => {
  it("creates missing months, reports the horizon as a gauge and stays silent when healthy", async () => {
    const { runtime, captured } = runtimeFor(iso.db);
    expect(await runPartitionMaintenance(runtime)).toEqual({ created: 0, future: 3 });

    // the two furthest future months disappear (e.g. an operator mistake): the daily job heals the horizon
    const future = await iso.sql<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'audit' AND c.relkind = 'r' AND c.relname ~ '^events_y[0-9]{4}m[0-9]{2}$'
      ORDER BY c.relname DESC LIMIT 2`;
    for (const { relname } of future) await iso.sql.unsafe(`DROP TABLE audit."${relname}"`);
    const fresh = runtimeFor(iso.db);
    const result = await runPartitionMaintenance(fresh.runtime);
    expect(result).toEqual({ created: 2, future: 3 });
    expect(captured.gauges).toContainEqual(["audit.partitions.future", 3]);
    expect(captured.errors).toEqual([]);
    expect(captured.counters).toEqual([]);
  });

  it("alarms (error log AND counter) when fewer than 2 future months exist", async () => {
    // a database whose ensure_partitions could not extend the horizon
    let call = 0;
    const fakeDb = {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ execute: async () => [{ n: call++ === 0 ? 0 : 1 }] }),
    } as unknown as KernelRuntime["db"];
    const { runtime, captured } = runtimeFor(fakeDb);
    const result = await runPartitionMaintenance(runtime);
    expect(result).toEqual({ created: 0, future: 1 });
    expect(MIN_FUTURE_PARTITIONS).toBe(2);
    expect(captured.counters).toEqual([
      { name: "audit.partitions.low", labels: undefined, value: undefined },
    ]);
    expect(captured.errors).toEqual([{ alarm: "audit.partitions.low", future: 1 }]);
    expect(captured.gauges).toEqual([["audit.partitions.future", 1]]);
  });
});

describe("runChainVerification", () => {
  it("is ok and silent on a valid chain, also while records commit concurrently", async () => {
    for (let i = 0; i < 10; i++) await append(`o-${i}`);
    const { runtime, captured } = runtimeFor(iso.db);
    const writers = Array.from({ length: 10 }, (_, i) => append(`w-${i}`));
    const result = await runChainVerification(runtime);
    await Promise.all(writers);
    expect(result.ok).toBe(true);
    expect(captured.errors).toEqual([]);
    expect(captured.counters).toEqual([]);
    expect(captured.gauges.map((g) => g[0])).toEqual(["audit.chain.checked"]);
  });

  it("alarms immediately on a mismatch: error log with seq + reason only, plus the counter", async () => {
    for (let i = 0; i < 5; i++) await append(`o-${i}`);
    await iso.sql.begin(async (sql) => {
      await sql.unsafe("SET LOCAL session_replication_role = replica");
      await sql.unsafe(`UPDATE audit.events SET data = '{"orderId":"SECRET-ORDER"}' WHERE seq = 3`);
    });
    const { runtime, captured } = runtimeFor(iso.db);
    const result = await runChainVerification(runtime);
    expect(result.ok).toBe(false);
    expect(captured.counters).toEqual([
      { name: "audit.chain.mismatch", labels: { reason: "hash_mismatch" }, value: undefined },
    ]);
    expect(captured.errors).toEqual([
      { alarm: "audit.chain.mismatch", seq: 3, reason: "hash_mismatch" },
    ]);
    expect(JSON.stringify(captured.errors)).not.toContain("SECRET-ORDER"); // never event data
  });

  it("only looks at the last 48 hours", async () => {
    await append("o-1");
    // the only event is older than the window, so nothing is checked (and nothing fails)
    const future = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const { runtime } = runtimeFor(iso.db, future);
    expect(await runChainVerification(runtime)).toEqual({ ok: true, checked: 0 });
  });

  it("lets thrown errors propagate (pg-boss retries them)", async () => {
    const broken = {
      transaction: async () => {
        throw new Error("connection lost");
      },
    } as unknown as KernelRuntime["db"];
    const { runtime, captured } = runtimeFor(broken);
    await expect(runChainVerification(runtime)).rejects.toThrow("connection lost");
    expect(captured.errors).toEqual([]); // alarmed only after the dead-letter handler runs
  });
});

describe("dead-letter alarms", () => {
  it("a verifier or partition job that never runs is an alarm: error log AND counter", () => {
    const { runtime, captured } = runtimeFor({} as KernelRuntime["db"]);
    reportVerifyFailed(runtime);
    reportPartitionsFailed(runtime);
    expect(captured.counters.map((c) => c.name)).toEqual([
      "audit.chain.verify_failed",
      "audit.partitions.ensure_failed",
    ]);
    expect(captured.errors.map((e) => e["alarm"])).toEqual([
      "audit.chain.verify_failed",
      "audit.partitions.ensure_failed",
    ]);
  });
});

describe("registerAuditJobs", () => {
  const fakeBoss = () => {
    const log = {
      queues: [] as { name: string; options: unknown }[],
      schedules: [] as { name: string; cron: string; tz: string | undefined }[],
      workers: new Map<string, () => Promise<void>>(),
    };
    const boss: JobScheduler = {
      createQueue: async (name, options) => void log.queues.push({ name, options }),
      schedule: async (name, cron, _data, options) =>
        void log.schedules.push({ name, cron, tz: options?.tz }),
      work: async (name, handler) => void log.workers.set(name, handler),
    };
    return { boss, log };
  };

  it("creates dead-letter queues first, retried queues, schedules and four workers", async () => {
    const { boss, log } = fakeBoss();
    const { runtime } = runtimeFor(iso.db);
    await registerAuditJobs(boss, runtime);

    const names = log.queues.map((q) => q.name);
    expect(names.indexOf("audit.partitions.ensure.failed")).toBeLessThan(
      names.indexOf("audit.partitions.ensure"),
    );
    expect(names.indexOf("audit.chain.verify.failed")).toBeLessThan(
      names.indexOf("audit.chain.verify"),
    );
    expect(log.queues.find((q) => q.name === "audit.chain.verify")?.options).toEqual({
      retryLimit: 2,
      retryDelay: 60,
      deadLetter: "audit.chain.verify.failed",
    });
    expect(log.queues.find((q) => q.name === "audit.partitions.ensure")?.options).toEqual({
      retryLimit: 2,
      retryDelay: 60,
      deadLetter: "audit.partitions.ensure.failed",
    });
    expect(log.schedules).toEqual([
      { name: "audit.partitions.ensure", cron: "47 4 * * *", tz: "Europe/Brussels" },
      { name: "audit.chain.verify", cron: "37 3 * * *", tz: "Europe/Brussels" },
    ]);
    expect([...log.workers.keys()].sort()).toEqual([
      "audit.chain.verify",
      "audit.chain.verify.failed",
      "audit.partitions.ensure",
      "audit.partitions.ensure.failed",
    ]);
  });

  it("the registered handlers run the jobs and the dead-letter alarms", async () => {
    const { boss, log } = fakeBoss();
    const { runtime, captured } = runtimeFor(iso.db);
    await registerAuditJobs(boss, runtime);
    await log.workers.get("audit.partitions.ensure")?.();
    await log.workers.get("audit.chain.verify")?.();
    expect(captured.gauges.map((g) => g[0])).toEqual([
      "audit.partitions.future",
      "audit.chain.checked",
    ]);
    await log.workers.get("audit.chain.verify.failed")?.();
    expect(captured.errors.map((e) => e["alarm"])).toEqual(["audit.chain.verify_failed"]);
  });

  it("no schedule falls into the 02:00–02:59 Europe/Brussels DST hour", () => {
    for (const cron of [AUDIT_JOBS.partitions.cron, AUDIT_JOBS.verify.cron]) {
      const hour = cron.split(" ")[1];
      expect(hour, cron).not.toBe("2");
      expect(hour, cron).not.toMatch(/^\*|,|-|\//); // a single fixed hour
    }
    expect(AUDIT_JOBS.partitions.cron).toBe("47 4 * * *");
  });
});
