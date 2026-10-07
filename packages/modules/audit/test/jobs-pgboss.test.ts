import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import type { KernelRuntime } from "@igs/kernel";
import PgBoss from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUDIT_JOBS, type JobScheduler, registerAuditJobs } from "../src";

let iso: IsolatedDatabase;
const bosses: PgBoss[] = [];

const captured = {
  gauges: [] as string[],
  counters: [] as string[],
  errors: [] as Record<string, unknown>[],
};

const runtime = (): KernelRuntime => ({
  db: iso.db,
  now: () => new Date(),
  metrics: {
    increment: (name) => void captured.counters.push(name),
    gauge: (name) => void captured.gauges.push(name),
  },
  logger: { error: (obj) => void captured.errors.push(obj) },
});

/** A fresh pg-boss instance, like a worker process booting. */
async function boot(): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: iso.url, max: 3 });
  boss.on("error", () => {});
  await boss.start();
  bosses.push(boss);
  return boss;
}

beforeEach(async () => {
  iso = await createIsolatedDatabase();
  captured.gauges.length = 0;
  captured.counters.length = 0;
  captured.errors.length = 0;
});

afterEach(async () => {
  for (const boss of bosses.splice(0)) await boss.stop({ graceful: false, wait: true });
  await iso.drop();
});

const queues = () =>
  iso.sql<
    {
      name: string;
      retry_limit: number | null;
      retry_delay: number | null;
      dead_letter: string | null;
    }[]
  >`
    SELECT name, retry_limit, retry_delay, dead_letter FROM pgboss.queue WHERE name LIKE 'audit.%' ORDER BY name`;
const schedules = () =>
  iso.sql<{ name: string; cron: string; timezone: string }[]>`
    SELECT name, cron, timezone FROM pgboss.schedule WHERE name LIKE 'audit.%' ORDER BY name`;

const EXPECTED_QUEUES = [
  {
    name: "audit.chain.verify",
    retry_limit: 2,
    retry_delay: 60,
    dead_letter: "audit.chain.verify.failed",
  },
  { name: "audit.chain.verify.failed", retry_limit: null, retry_delay: null, dead_letter: null },
  {
    name: "audit.partitions.ensure",
    retry_limit: 2,
    retry_delay: 60,
    dead_letter: "audit.partitions.ensure.failed",
  },
  {
    name: "audit.partitions.ensure.failed",
    retry_limit: null,
    retry_delay: null,
    dead_letter: null,
  },
];
const EXPECTED_SCHEDULES = [
  { name: "audit.chain.verify", cron: "37 3 * * *", timezone: "Europe/Brussels" },
  { name: "audit.partitions.ensure", cron: "47 4 * * *", timezone: "Europe/Brussels" },
];

describe("registerAuditJobs against a real pg-boss (R2: a worker restart must not crash-loop)", () => {
  it("registers the queues with retry and dead-letter options and the two daily schedules", async () => {
    const boss = await boot();
    await registerAuditJobs(boss as unknown as JobScheduler, runtime());
    expect(await queues()).toEqual(EXPECTED_QUEUES);
    expect(await schedules()).toEqual(EXPECTED_SCHEDULES);
  });

  it("running it again on the same instance, and on a new instance after a restart, neither throws nor changes anything", async () => {
    const first = await boot();
    await registerAuditJobs(first as unknown as JobScheduler, runtime());
    await registerAuditJobs(first as unknown as JobScheduler, runtime());
    await first.stop({ graceful: false, wait: true });

    // the worker restarts: a brand-new process registers again
    const second = await boot();
    await expect(
      registerAuditJobs(second as unknown as JobScheduler, runtime()),
    ).resolves.toBeUndefined();

    expect(await queues()).toEqual(EXPECTED_QUEUES); // retryLimit, retryDelay, deadLetter kept
    expect(await schedules()).toEqual(EXPECTED_SCHEDULES); // still exactly one row per job
  });

  it("jobs run through pg-boss: the partitions job executes, the dead-letter queue raises the alarm", async () => {
    const boss = await boot();
    await registerAuditJobs(boss as unknown as JobScheduler, runtime());

    await boss.send(AUDIT_JOBS.partitions.queue, {});
    await boss.send(AUDIT_JOBS.verify.queue, {});
    await vi.waitFor(
      () => {
        expect(captured.gauges).toEqual(
          expect.arrayContaining(["audit.partitions.future", "audit.chain.checked"]),
        );
      },
      { timeout: 15_000, interval: 250 },
    );

    // a job that exhausted its retries lands in the dead-letter queue → error log + counter
    await boss.send(AUDIT_JOBS.verify.deadLetterQueue, {});
    await vi.waitFor(
      () => {
        expect(captured.counters).toContain("audit.chain.verify_failed");
        expect(captured.errors.map((e) => e["alarm"])).toContain("audit.chain.verify_failed");
      },
      { timeout: 15_000, interval: 250 },
    );
  });
});
