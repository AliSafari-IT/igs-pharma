// The purge of expired import plans (igs-pharma#88) on a database built like production: the
// runtime roles have no DELETE on `import_plans`; only the worker login may call the definer function.
import { randomUUID } from "node:crypto";

import { type RuntimeRoleDatabase, createRuntimeRoleDatabase } from "@igs/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  IMPORT_PLAN_GRACE_HOURS,
  INVENTORY_JOBS,
  INVENTORY_QUEUES,
  reportImportPlanPurgeFailed,
} from "../src";

let db: RuntimeRoleDatabase;
let admin: postgres.Sql;
let app: postgres.Sql;
let worker: postgres.Sql;

beforeAll(async () => {
  db = await createRuntimeRoleDatabase();
  await db.migrate();
  admin = postgres(db.adminUrl, { max: 2, onnotice: () => {} });
  app = postgres(db.appUrl, { max: 2, onnotice: () => {} });
  worker = postgres(db.workerUrl, { max: 2, onnotice: () => {} });
}, 180_000);
afterAll(async () => {
  await Promise.all([
    admin?.end({ timeout: 5 }),
    app?.end({ timeout: 5 }),
    worker?.end({ timeout: 5 }),
  ]);
  await db?.drop();
});
beforeEach(async () => {
  await admin`DELETE FROM inventory.import_plans`;
});

const failure = async (promise: PromiseLike<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
};

/** A plan that expired `hoursAgo` hours ago (negative: expires in the future). */
async function plan(hoursAgo: number): Promise<string> {
  const id = randomUUID();
  await admin`
    INSERT INTO inventory.import_plans (id, actor_id, rows, created_at, expires_at)
    VALUES (${id}, 'staff-1', '[]'::jsonb, now() - interval '1 hour' - make_interval(secs => ${Math.round(hoursAgo * 3600)}),
            now() - make_interval(secs => ${Math.round(hoursAgo * 3600)}))`;
  return id;
}
const remaining = async () =>
  (await admin<{ id: string }[]>`SELECT id FROM inventory.import_plans ORDER BY id`).map(
    (r) => r.id,
  );
const purge = async (sql: postgres.Sql = worker) =>
  (await sql<{ n: number }[]>`SELECT inventory.purge_expired_import_plans() AS n`)[0]?.n;

describe("inventory.purge_expired_import_plans()", () => {
  it("deletes only plans that expired more than the grace ago, and returns how many", async () => {
    const gone1 = await plan(IMPORT_PLAN_GRACE_HOURS + 1);
    const gone2 = await plan(IMPORT_PLAN_GRACE_HOURS + 100);
    const justInsideGrace = await plan(IMPORT_PLAN_GRACE_HOURS - 1);
    const expiredRecently = await plan(2);
    const live = await plan(-1);
    expect(await purge()).toBe(2);
    expect(await remaining()).toEqual([justInsideGrace, expiredRecently, live].sort());
    expect(await remaining()).not.toContain(gone1);
    expect(await remaining()).not.toContain(gone2);
  });

  it("cuts at the documented grace (the constant mirrors the SQL)", async () => {
    // one minute either side of expires_at + IMPORT_PLAN_GRACE_HOURS
    const keep = await plan(IMPORT_PLAN_GRACE_HOURS - 1 / 60);
    const drop = await plan(IMPORT_PLAN_GRACE_HOURS + 1 / 60);
    expect(await purge()).toBe(1);
    expect(await remaining()).toEqual([keep]);
    expect(await remaining()).not.toContain(drop);
  });

  it("is idempotent", async () => {
    await plan(IMPORT_PLAN_GRACE_HOURS + 5);
    expect(await purge()).toBe(1);
    expect(await purge()).toBe(0);
  });

  it("only the worker login may call it; the app login and the tables are closed", async () => {
    await plan(IMPORT_PLAN_GRACE_HOURS + 5);
    expect(await failure(purge(app))).toBe("42501");
    for (const sql of [app, worker]) {
      expect(await failure(sql`DELETE FROM inventory.import_plans`)).toBe("42501");
      expect(await failure(sql`UPDATE inventory.import_plans SET actor_id = 'x'`)).toBe("42501");
    }
    expect(await remaining()).toHaveLength(1);
    expect(await purge()).toBe(1);
  });
});

describe("the job", () => {
  it("is scheduled outside the Brussels hour that DST skips or repeats", () => {
    expect(Number(INVENTORY_JOBS.purgePlans.cron.split(" ")[1])).not.toBe(2);
    expect(INVENTORY_JOBS.timezone).toBe("Europe/Brussels");
    // the reservation expiry runs every minute, so the skipped or repeated hour changes nothing: it is
    // idempotent (igs-pharma#99)
    expect(INVENTORY_JOBS.expireReservations.cron).toBe("* * * * *");
    expect(INVENTORY_QUEUES).toEqual([
      INVENTORY_JOBS.purgePlans.deadLetterQueue,
      INVENTORY_JOBS.purgePlans.queue,
      INVENTORY_JOBS.expireReservations.deadLetterQueue,
      INVENTORY_JOBS.expireReservations.queue,
    ]);
  });

  it("warns, without data, when it failed after all its retries", () => {
    const logs: { level: string; obj: Record<string, unknown> }[] = [];
    reportImportPlanPurgeFailed({
      db: {} as never,
      now: () => new Date(),
      metrics: { increment: () => {} },
      logger: {
        error: (obj) => void logs.push({ level: "error", obj }),
        warn: (obj) => void logs.push({ level: "warn", obj }),
      },
    });
    expect(logs).toEqual([{ level: "warn", obj: { alarm: "inventory.plans.purge_failed" } }]);
  });
});
