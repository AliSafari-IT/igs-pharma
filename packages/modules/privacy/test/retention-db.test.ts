// The retention purge (igs-pharma#88) on a database built like production: a non-superuser
// administrator owns the schemas, the web/platform login is a member of `igs_app` and the worker
// login of both group roles. Fixtures are inserted as the administrator with explicit timestamps.
import { randomUUID } from "node:crypto";

import { type RuntimeRoleDatabase, createRuntimeRoleDatabase } from "@igs/db/testing";
import { addBrusselsMonths } from "@igs/time";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { RETENTION_DEFAULTS, RETENTION_KEYS } from "../src";

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
  // the ledgers are append-only: clean up the way the purge does, as the owner, flag on
  await admin.begin(async (tx) => {
    await tx`SELECT set_config('privacy.purge', 'on', true)`;
    await tx`DELETE FROM privacy.consent_events`;
    await tx`DELETE FROM privacy.dsr_events`;
    await tx`DELETE FROM privacy.dsr_requests`;
  });
  await admin`UPDATE privacy.retention_policy SET months = 60 WHERE key = 'consent_after_withdrawal'`;
  await admin`UPDATE privacy.retention_policy SET months = NULL WHERE key = 'dsr_after_close'`;
});

const failure = async (promise: PromiseLike<unknown>) => {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return { code: e.code, message: e.message ?? "" };
  }
  return undefined;
};

const purge = async (sql: postgres.Sql = worker) =>
  (
    await sql<{ consent_events: number; dsr_requests: number; dsr_events: number }[]>`
      SELECT consent_events, dsr_requests, dsr_events FROM privacy.purge_expired_data()`
  )[0];

/** `years` ago (calendar, Brussels) plus an optional offset in days. */
const ago = (months: number, offsetDays = 0) =>
  new Date(addBrusselsMonths(new Date(), -months).getTime() + offsetDays * 86_400_000);

let seq = 0;
const consent = (subject: string, purpose: string, granted: boolean, at: Date) => admin`
  INSERT INTO privacy.consent_events (id, subject_ref, purpose, granted, policy_version, source, actor_type, actor_id, at)
  VALUES (${randomUUID()}, ${subject}, ${purpose}, ${granted}, 'v1', 'storefront', 'system', 'test', ${at})`;
const subject = () => `person${seq++}@example.test`;
const consentCount = async (ref: string) =>
  (
    await admin<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM privacy.consent_events WHERE subject_ref = ${ref}`
  )[0]?.n;

async function dsr(status: string, closedAt: Date | null, ref = subject()) {
  const id = randomUUID();
  const received = new Date(Date.UTC(2020, 0, 5));
  await admin`
    INSERT INTO privacy.dsr_requests (id, subject_ref, type, channel, received_at, due_at, status, note, created_by, closed_at, closed_reason)
    VALUES (${id}, ${ref}, 'access', 'email', ${received}, ${new Date(Date.UTC(2020, 1, 5))}, ${status}, 'staff note', 'test', ${closedAt}, ${closedAt ? "done" : null})`;
  await admin`
    INSERT INTO privacy.dsr_events (id, request_id, from_status, to_status, note, actor_type, actor_id)
    VALUES (${randomUUID()}, ${id}, NULL, 'received', 'free text', 'user', 'staff-1'),
           (${randomUUID()}, ${id}, 'received', ${status}, NULL, 'user', 'staff-1')`;
  return id;
}
const dsrCount = async () =>
  (
    await admin<{ r: number; e: number }[]>`
    SELECT (SELECT count(*) FROM privacy.dsr_requests)::int AS r, (SELECT count(*) FROM privacy.dsr_events)::int AS e`
  )[0];

describe("the policy", () => {
  it("is seeded with the documented placeholders, all awaiting the adviser", async () => {
    await admin`UPDATE privacy.retention_policy SET months = 60 WHERE key = 'consent_after_withdrawal'`;
    const rows = await app<{ key: string; months: number | null; awaits_adviser: boolean }[]>`
      SELECT key, months, awaits_adviser FROM privacy.retention_policy ORDER BY key`;
    expect(rows.map((r) => r.key)).toEqual([...RETENTION_KEYS].sort());
    for (const row of rows) {
      const wanted = RETENTION_DEFAULTS[row.key as keyof typeof RETENTION_DEFAULTS];
      expect(row.months).toBe(wanted.months);
      expect(row.awaits_adviser).toBe(wanted.awaitsPrivacyAdviser);
    }
  });

  it("is readable by the application and writable by nobody at runtime", async () => {
    for (const sql of [app, worker]) {
      expect(await failure(sql`UPDATE privacy.retention_policy SET months = 0`)).toMatchObject({
        code: "42501",
      });
      expect(await failure(sql`DELETE FROM privacy.retention_policy`)).toMatchObject({
        code: "42501",
      });
      expect(
        await failure(
          sql`INSERT INTO privacy.retention_policy (key, months, awaits_adviser) VALUES ('x', 1, true)`,
        ),
      ).toMatchObject({ code: "42501" });
    }
  });
});

describe("who may purge", () => {
  it("the worker login can; the web/platform login cannot call the functions or delete anything", async () => {
    expect(await purge(worker)).toEqual({ consent_events: 0, dsr_requests: 0, dsr_events: 0 });
    expect(await failure(purge(app))).toMatchObject({ code: "42501" });
    expect(await failure(app`SELECT inventory.purge_expired_import_plans()`)).toMatchObject({
      code: "42501",
    });
    for (const sql of [app, worker]) {
      for (const table of ["consent_events", "dsr_events", "dsr_requests"]) {
        expect(await failure(sql.unsafe(`DELETE FROM privacy.${table}`)), table).toMatchObject({
          code: "42501",
        });
      }
    }
  });
});

describe("the consent ledger", () => {
  it("deletes a withdrawn chain past the period entirely, and only that", async () => {
    const withdrawnLongAgo = subject();
    await consent(withdrawnLongAgo, "marketing_email", true, ago(80));
    await consent(withdrawnLongAgo, "marketing_email", false, ago(70));
    const withdrawnRecently = subject();
    await consent(withdrawnRecently, "marketing_email", true, ago(30));
    await consent(withdrawnRecently, "marketing_email", false, ago(12));
    const grantedLongAgo = subject();
    await consent(grantedLongAgo, "marketing_email", true, ago(120));
    const regranted = subject();
    await consent(regranted, "marketing_email", false, ago(90));
    await consent(regranted, "marketing_email", true, ago(80));
    // one subject, two purposes: the withdrawn old purpose goes, the active one stays
    const mixed = subject();
    await consent(mixed, "marketing_email", false, ago(70));
    await consent(mixed, "analytics_cookies", true, ago(70));

    expect(await purge()).toEqual({ consent_events: 3, dsr_requests: 0, dsr_events: 0 });
    expect(await consentCount(withdrawnLongAgo)).toBe(0);
    expect(await consentCount(withdrawnRecently)).toBe(2);
    expect(await consentCount(grantedLongAgo)).toBe(1);
    expect(await consentCount(regranted)).toBe(2);
    expect(await consentCount(mixed)).toBe(1);
    const left = await admin<
      { purpose: string }[]
    >`SELECT purpose FROM privacy.consent_events WHERE subject_ref = ${mixed}`;
    expect(left).toEqual([{ purpose: "analytics_cookies" }]);
  });

  it("is idempotent: a second run purges nothing", async () => {
    await consent(subject(), "marketing_email", false, ago(70));
    expect((await purge())?.consent_events).toBe(1);
    expect(await purge()).toEqual({ consent_events: 0, dsr_requests: 0, dsr_events: 0 });
  });

  it("cuts exactly at the calendar month boundary (Brussels)", async () => {
    const before = subject();
    const after = subject();
    // the boundary is `now − 60 calendar months`; two minutes either side
    await consent(before, "marketing_email", false, new Date(ago(60).getTime() - 2 * 60_000));
    await consent(after, "marketing_email", false, new Date(ago(60).getTime() + 2 * 60_000));
    await purge();
    expect(await consentCount(before)).toBe(0);
    expect(await consentCount(after)).toBe(1);
  });

  it("follows the policy row: months = 0 purges every withdrawn chain, NULL keeps everything", async () => {
    const ref = subject();
    await consent(ref, "marketing_email", false, new Date(Date.now() - 60_000));
    await admin`UPDATE privacy.retention_policy SET months = NULL WHERE key = 'consent_after_withdrawal'`;
    expect((await purge())?.consent_events).toBe(0);
    await admin`UPDATE privacy.retention_policy SET months = 0 WHERE key = 'consent_after_withdrawal'`;
    expect((await purge())?.consent_events).toBe(1);
    expect(await consentCount(ref)).toBe(0);
  });
});

describe("data-subject requests (switched off until the adviser decides)", () => {
  it("keeps everything while the policy says keep (NULL), however old", async () => {
    await dsr("completed", ago(100));
    await dsr("rejected", ago(100));
    expect(await purge()).toEqual({ consent_events: 0, dsr_requests: 0, dsr_events: 0 });
    expect(await dsrCount()).toEqual({ r: 2, e: 4 });
  });

  it("when a value is set: closed past the period go with their events; recent and open stay", async () => {
    await admin`UPDATE privacy.retention_policy SET months = 36 WHERE key = 'dsr_after_close'`;
    const old = await dsr("completed", ago(40));
    const oldRejected = await dsr("rejected", ago(37));
    const recent = await dsr("completed", ago(12));
    const open = await dsr("in_progress", null);
    expect(await purge()).toEqual({ consent_events: 0, dsr_requests: 2, dsr_events: 4 });
    const left = await admin<{ id: string }[]>`SELECT id FROM privacy.dsr_requests ORDER BY id`;
    expect(left.map((r) => r.id).sort()).toEqual([recent, open].sort());
    expect(old).not.toBe(oldRejected);
    expect(await dsrCount()).toEqual({ r: 2, e: 4 });
    expect(await purge()).toEqual({ consent_events: 0, dsr_requests: 0, dsr_events: 0 });
  });
});

describe("the append-only guarantee holds for everything else", () => {
  it("UPDATE, TRUNCATE and an ordinary DELETE are refused for the owner too", async () => {
    const ref = subject();
    await consent(ref, "marketing_email", false, ago(70));
    const id = await dsr("completed", ago(1));
    for (const statement of [
      admin`UPDATE privacy.consent_events SET granted = true WHERE subject_ref = ${ref}`,
      admin`DELETE FROM privacy.consent_events WHERE subject_ref = ${ref}`,
      admin`TRUNCATE privacy.consent_events`,
      admin`UPDATE privacy.dsr_events SET note = 'x' WHERE request_id = ${id}`,
      admin`DELETE FROM privacy.dsr_events WHERE request_id = ${id}`,
      admin`TRUNCATE privacy.dsr_events`,
    ]) {
      expect(await failure(statement)).toMatchObject({
        code: "42501",
        message: expect.stringMatching(/append-only/),
      });
    }
    expect(await consentCount(ref)).toBe(1);
  });

  it("even with the flag on, UPDATE and TRUNCATE stay refused", async () => {
    const ref = subject();
    await consent(ref, "marketing_email", false, ago(70));
    const attempt = (statement: string) =>
      failure(
        admin.begin(async (tx) => {
          await tx`SELECT set_config('privacy.purge', 'on', true)`;
          await tx.unsafe(statement);
        }),
      );
    expect(await attempt("UPDATE privacy.consent_events SET granted = true")).toMatchObject({
      code: "42501",
    });
    expect(await attempt("TRUNCATE privacy.consent_events")).toMatchObject({ code: "42501" });
    expect(await consentCount(ref)).toBe(1);
  });

  it("a role that is not the table owner cannot use the flag, even holding DELETE", async () => {
    const ref = subject();
    await consent(ref, "marketing_email", false, ago(70));
    const role = `tmp_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    await admin.unsafe(`CREATE ROLE ${role} LOGIN PASSWORD 'x'`);
    await admin.unsafe(`GRANT USAGE ON SCHEMA privacy TO ${role}`);
    await admin.unsafe(`GRANT SELECT, DELETE ON privacy.consent_events TO ${role}`);
    try {
      const url = new URL(db.adminUrl);
      url.username = role;
      url.password = "x";
      const tmp = postgres(url.toString(), { max: 1, onnotice: () => {} });
      try {
        const outcome = await failure(
          tmp.begin(async (tx) => {
            await tx`SELECT set_config('privacy.purge', 'on', true)`;
            await tx`DELETE FROM privacy.consent_events WHERE subject_ref = ${ref}`;
          }),
        );
        expect(outcome).toMatchObject({
          code: "42501",
          message: expect.stringMatching(/append-only/),
        });
      } finally {
        await tmp.end({ timeout: 5 });
      }
    } finally {
      await admin.unsafe(`REVOKE SELECT, DELETE ON privacy.consent_events FROM ${role}`);
      await admin.unsafe(`REVOKE USAGE ON SCHEMA privacy FROM ${role}`);
      await admin.unsafe(`DROP ROLE ${role}`);
    }
    expect(await consentCount(ref)).toBe(1);
  });

  it("the flag is off again when the function returns", async () => {
    await consent(subject(), "marketing_email", false, ago(70));
    const flag = await worker.begin(async (tx) => {
      await tx`SELECT * FROM privacy.purge_expired_data()`;
      return (await tx<{ v: string }[]>`SELECT current_setting('privacy.purge', true) AS v`)[0]?.v;
    });
    expect(flag).toBe("off");
  });
});

describe("Postgres' calendar months equal @igs/time's", () => {
  // the function adds calendar months with TimeZone pinned to Europe/Brussels; this keeps it in step
  // with the shared helper, including month-end clamps and daylight-saving changes
  it.each([
    ["2024-01-31T12:00:00+01:00", 1],
    ["2023-08-31T12:00:00+02:00", 6],
    ["2024-02-29T12:00:00+01:00", 12],
    ["2026-02-28T10:00:00+01:00", 1], // across the March change
    ["2026-09-30T10:00:00+02:00", 1], // across the October change
    ["2020-10-13T23:30:00+02:00", 60],
    ["2021-03-31T08:15:30+02:00", 11],
  ])("%s + %i months", async (iso, months) => {
    const [row] = await admin<{ at: Date }[]>`
      SELECT (set_config('TimeZone', 'Europe/Brussels', true), ${new Date(iso)}::timestamptz + make_interval(months => ${months}::int)) AS x, ${new Date(iso)}::timestamptz + make_interval(months => ${months}::int) AS at`;
    expect(row?.at.toISOString()).toBe(addBrusselsMonths(new Date(iso), months).toISOString());
  });
});
