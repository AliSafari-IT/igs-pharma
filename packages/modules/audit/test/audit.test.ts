import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { command } from "@igs/kernel";
import { actors, configureKernelForTests, resetKernelForTests } from "@igs/kernel/testing";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type AuditEvent,
  type VerifyRange,
  createAuditPort,
  record,
  registerAuditAction,
  verifyChain,
  verifyChainSnapshot,
} from "../src";
import { resetAuditActions } from "../src/actions";

const KEY = "k".repeat(32);
const options = { hmacKey: KEY };

let iso: IsolatedDatabase;

beforeEach(async () => {
  iso = await createIsolatedDatabase();
  resetAuditActions();
  registerAuditAction(
    "pharmacy.review.decided",
    z.object({ decision: z.enum(["approved", "rejected"]), orderId: z.string() }),
  );
  registerAuditAction("orders.order.created", z.object({}));
});

afterEach(async () => {
  resetKernelForTests();
  await iso.drop();
});

const actor = { type: "user", id: "user-1" } as const;
const decided = (orderId = "o-1", extra: Partial<AuditEvent> = {}): AuditEvent => ({
  at: new Date(),
  actor,
  action: "pharmacy.review.decided",
  entityType: "order",
  entityId: orderId,
  data: { decision: "approved", orderId },
  ...extra,
});
/** The documented caller pattern: one REPEATABLE READ, read-only transaction (R2). */
const verify = (range?: VerifyRange) => verifyChainSnapshot(iso.db, range);
const append = (event: AuditEvent) => iso.db.transaction((tx) => record(tx, event, options));
const rows = () =>
  iso.sql<
    {
      seq: number;
      hash: string;
      prev_hash: string;
      ip_hash: string | null;
      ua_hash: string | null;
      data: unknown;
    }[]
  >`
    SELECT seq::int, hash, prev_hash, ip_hash, ua_hash, data FROM audit.events ORDER BY seq`;
/** Bypasses the append-only trigger, like a superuser tampering with the table. */
const tamper = (statement: string) =>
  iso.sql.begin(async (sql) => {
    await sql.unsafe("SET LOCAL session_replication_role = replica");
    await sql.unsafe(statement);
  });

describe("record", () => {
  it("appends a hash-chained, gap-free sequence starting at genesis", async () => {
    const a = await append(decided("o-1"));
    const b = await append(decided("o-2"));
    expect([a.seq, b.seq]).toEqual([1, 2]);
    const stored = await rows();
    expect(stored[0]?.prev_hash).toBe("0".repeat(64));
    expect(stored[1]?.prev_hash).toBe(stored[0]?.hash);
    expect(stored[1]?.hash).toBe(b.hash);
    expect(await verify()).toMatchObject({ ok: true, checked: 2, headSeq: 2 });
  });

  it("rolls back with the transaction (event and chain head together)", async () => {
    await append(decided("o-1"));
    await expect(
      iso.db.transaction(async (tx) => {
        await record(tx, decided("o-2"), options);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await rows()).length).toBe(1);
    expect(await verify()).toMatchObject({ ok: true, checked: 1, headSeq: 1 });
  });

  it("50 parallel records produce a valid, gap-free chain", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => append(decided(`o-${i}`))),
    );
    expect(new Set(results.map((r) => r.seq)).size).toBe(50);
    const stored = await rows();
    expect(stored.map((r) => r.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(await verify()).toMatchObject({ ok: true, checked: 50, headSeq: 50 });
  });

  it("hashes IP and user agent with the keyed hash (v1:<hex>) and never stores raw values", async () => {
    await append(decided("o-1", { origin: { ip: "203.0.113.7", userAgent: "UA/1.0" } }));
    await append(decided("o-2"));
    const [first, second] = await rows();
    expect(first?.ip_hash).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(first?.ua_hash).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(second?.ip_hash).toBeNull();
    const dump = JSON.stringify(await iso.sql`SELECT * FROM audit.events`);
    expect(dump).not.toContain("203.0.113.7");
    expect(dump).not.toContain("UA/1.0");
    // a different key yields a different hash; same key the same one
    await iso.db.transaction((tx) =>
      record(tx, decided("o-3", { origin: { ip: "203.0.113.7" } }), { hmacKey: "z".repeat(32) }),
    );
    await append(decided("o-4", { origin: { ip: "203.0.113.7" } }));
    const stored = await rows();
    expect(stored[2]?.ip_hash).not.toBe(first?.ip_hash);
    expect(stored[3]?.ip_hash).toBe(first?.ip_hash);
  });

  it("rejects unknown actions, bad names, extra keys, bad values and a short key — writing nothing", async () => {
    const bad: [Partial<AuditEvent>, string][] = [
      [{ action: "orders.order.deleted" }, "audit.unknown_action"],
      [{ action: "BadAction" }, "audit.invalid_action"],
      [{ data: { decision: "approved", orderId: "o", extra: "x" } }, "audit.invalid_data"],
      [{ data: { decision: "maybe", orderId: "o" } }, "audit.invalid_data"],
      [{ actor: { type: "user", id: "" } }, "audit.invalid_actor"],
    ];
    for (const [change, code] of bad) {
      await expect(append(decided("o-1", change))).rejects.toMatchObject({ code });
    }
    await expect(
      iso.db.transaction((tx) => record(tx, decided(), { hmacKey: "short" })),
    ).rejects.toMatchObject({ code: "audit.hmac_key_too_short" });
    registerAuditAction("orders.order.priced", z.object({ total: z.number() }));
    await expect(
      append({ ...decided(), action: "orders.order.priced", data: { total: 1.5 } }),
    ).rejects.toMatchObject({ code: "audit.invalid_data" });
    expect((await rows()).length).toBe(0);
  });

  it("fails closed when no partition covers the event time (no DEFAULT partition)", async () => {
    await expect(
      append(decided("o-1", { at: new Date("2100-01-01T00:00:00Z") })),
    ).rejects.toThrow();
    expect((await rows()).length).toBe(0);
    expect(await verify()).toMatchObject({ ok: true, checked: 0 });
  });
});

describe("verifyChain detects tampering (privileged connection)", () => {
  beforeEach(async () => {
    for (let i = 1; i <= 5; i++) await append(decided(`o-${i}`));
  });

  it("an altered row", async () => {
    await tamper(
      `UPDATE audit.events SET data = '{"decision":"rejected","orderId":"o-3"}' WHERE seq = 3`,
    );
    expect(await verify()).toMatchObject({
      ok: false,
      firstBadSeq: 3,
      reason: "hash_mismatch",
    });
  });

  it("an altered row whose hash was recomputed is caught by the next link", async () => {
    await tamper(`UPDATE audit.events SET hash = repeat('a', 64) WHERE seq = 2`);
    expect(await verify()).toMatchObject({
      ok: false,
      firstBadSeq: 2,
      reason: "hash_mismatch",
    });
    await tamper(`UPDATE audit.events SET prev_hash = repeat('b', 64) WHERE seq = 4`);
    expect(await verify()).toMatchObject({ ok: false });
  });

  it("a deleted row in the middle (gap)", async () => {
    await tamper("DELETE FROM audit.events WHERE seq = 3");
    expect(await verify()).toMatchObject({
      ok: false,
      firstBadSeq: 3,
      reason: "seq_gap",
    });
  });

  it("deleted newest rows (head no longer matches)", async () => {
    await tamper("DELETE FROM audit.events WHERE seq = 5");
    expect(await verify()).toMatchObject({
      ok: false,
      firstBadSeq: 5,
      reason: "head_mismatch",
    });
  });

  it("a rewritten head", async () => {
    await tamper("UPDATE audit.chain_head SET hash = repeat('c', 64)");
    expect(await verify()).toMatchObject({ ok: false, reason: "head_mismatch" });
  });

  it("a rewritten genesis link", async () => {
    await tamper("UPDATE audit.events SET prev_hash = repeat('d', 64) WHERE seq = 1");
    expect(await verify()).toMatchObject({
      ok: false,
      firstBadSeq: 1,
      reason: "prev_hash_mismatch",
    });
  });
});

describe("verifyChain ranges", () => {
  it("toSeq, sinceAt and fromCheckpoint verify a window of a valid chain", async () => {
    const t0 = Date.now();
    const hashes: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const at = new Date(t0 - (7 - i) * 60_000); // one minute apart, oldest first
      hashes.push((await append(decided(`o-${i}`, { at }))).hash);
    }
    expect(await verify({ toSeq: 3 })).toMatchObject({ ok: true, checked: 3 });
    expect(await verify({ sinceAt: new Date(t0 - 3.5 * 60_000) })).toMatchObject({
      ok: true,
      checked: 3,
    });
    expect(await verify({ sinceAt: new Date(t0 + 60_000) })).toMatchObject({
      ok: true,
      checked: 0,
    });
    expect(await verify({ fromCheckpoint: { seq: 4, hash: hashes[3] as string } })).toMatchObject({
      ok: true,
      checked: 2,
    });
    expect(await verify({ fromCheckpoint: { seq: 4, hash: "e".repeat(64) } })).toMatchObject({
      ok: false,
      firstBadSeq: 5,
      reason: "prev_hash_mismatch",
    });
    // tampering outside the window is not seen by a windowed verification, inside it is
    await tamper("UPDATE audit.events SET data = '{}'::jsonb WHERE seq = 2");
    expect(await verify({ fromCheckpoint: { seq: 4, hash: hashes[3] as string } })).toMatchObject({
      ok: true,
    });
    expect(await verify({ toSeq: 3 })).toMatchObject({ ok: false, firstBadSeq: 2 });
  });

  it("an empty chain verifies", async () => {
    expect(await verify()).toMatchObject({ ok: true, checked: 0, headSeq: 0 });
  });
});

describe("verifyChain needs one snapshot (R2)", () => {
  it("throws under READ COMMITTED (statements would see different snapshots)", async () => {
    await expect(verifyChain(iso.db)).rejects.toMatchObject({
      code: "audit.verify_requires_snapshot",
    });
    await expect(
      iso.db.transaction((tx) => verifyChain(tx), { isolationLevel: "read committed" }),
    ).rejects.toMatchObject({ code: "audit.verify_requires_snapshot" });
  });

  it("accepts REPEATABLE READ and SERIALIZABLE", async () => {
    await append(decided("o-1"));
    for (const isolationLevel of ["repeatable read", "serializable"] as const) {
      await expect(
        iso.db.transaction((tx) => verifyChain(tx), { isolationLevel, accessMode: "read only" }),
      ).resolves.toMatchObject({ ok: true, checked: 1 });
    }
  });

  it("records committing after the snapshot do not cause a false head_mismatch", async () => {
    for (let i = 1; i <= 5; i++) await append(decided(`o-${i}`));
    const result = await iso.db.transaction(
      async (tx) => {
        await tx.execute(sql`SELECT 1`); // the snapshot is taken here
        for (let i = 6; i <= 10; i++) await append(decided(`o-${i}`)); // commit on other connections
        return verifyChain(tx);
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    expect(result).toMatchObject({ ok: true, checked: 5, headSeq: 5 });
    expect(await verify()).toMatchObject({ ok: true, checked: 10, headSeq: 10 });
  });

  it("verifying while 20 records commit concurrently stays ok", async () => {
    for (let i = 1; i <= 30; i++) await append(decided(`o-${i}`));
    const writers = Array.from({ length: 20 }, (_, i) => append(decided(`w-${i}`)));
    const verifications = await Promise.all([verify(), verify(), verify()]);
    await Promise.all(writers);
    for (const v of verifications) expect(v).toMatchObject({ ok: true });
    expect(await verify()).toMatchObject({ ok: true, checked: 50, headSeq: 50 });
  });
});

describe("append-only in the database (D-027)", () => {
  beforeEach(async () => {
    await append(decided("o-1"));
  });

  it("the table owner / superuser is stopped by the triggers", async () => {
    await expect(iso.sql`UPDATE audit.events SET data = '{}'::jsonb`).rejects.toThrow(
      /append-only/,
    );
    await expect(iso.sql`DELETE FROM audit.events`).rejects.toThrow(/append-only/);
    await expect(iso.sql`TRUNCATE audit.events`).rejects.toThrow(/append-only/);
    await expect(iso.sql`DELETE FROM audit.chain_head`).rejects.toThrow(/append-only/);
    const [partition] = await iso.sql<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'audit' AND c.relname LIKE 'events\_y%' AND c.relkind = 'r' LIMIT 1`;
    await expect(iso.sql.unsafe(`TRUNCATE audit."${partition?.relname}"`)).rejects.toThrow(
      /append-only/,
    );
    expect((await rows()).length).toBe(1);
  });

  it("the app role can record and verify, but cannot UPDATE, DELETE, TRUNCATE or run DDL", async () => {
    // a separate connection that runs as the app role from the start (startup parameter `role`)
    const conn = postgres(iso.url, { max: 1, onnotice: () => {}, connection: { role: "igs_app" } });
    try {
      const db = drizzle(conn);
      await db.transaction((tx) => record(tx, decided("o-2"), options));
      expect(
        await db.transaction((tx) => verifyChain(tx), {
          isolationLevel: "repeatable read",
          accessMode: "read only",
        }),
      ).toMatchObject({ ok: true, checked: 2 });

      const denied = async (statement: string, code = "42501") => {
        const error = await conn.unsafe(statement).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(error, statement).toMatchObject({ code }); // 42501 = insufficient_privilege
      };
      await denied("UPDATE audit.events SET data = '{}'::jsonb");
      await denied("DELETE FROM audit.events");
      await denied("TRUNCATE audit.events");
      // UPDATE on the head row is granted (it advances the chain) but the singleton check holds
      await denied("UPDATE audit.chain_head SET id = 2", "23514");
      await denied("INSERT INTO audit.chain_head VALUES (2, 0, 'x')");
      await denied("DELETE FROM audit.chain_head");
      await denied("SELECT audit.ensure_partitions(1)");
      await denied("CREATE TABLE audit.evil (x int)");
      await denied("SELECT * FROM system.outbox");
      expect(await conn.unsafe("SELECT audit.future_partitions() AS n")).toMatchObject([{ n: 3 }]);
    } finally {
      await conn.end({ timeout: 5 });
    }
  });
});

describe("partitions (D-029)", () => {
  it("ensure_partitions is idempotent and extends the horizon; future_partitions counts it", async () => {
    const future = async () =>
      Number((await iso.sql<{ n: number }[]>`SELECT audit.future_partitions() AS n`)[0]?.n);
    expect(await future()).toBe(3); // migration: current month + 3 ahead
    expect((await iso.sql<{ n: number }[]>`SELECT audit.ensure_partitions(3) AS n`)[0]?.n).toBe(0);
    expect((await iso.sql<{ n: number }[]>`SELECT audit.ensure_partitions(5) AS n`)[0]?.n).toBe(2);
    expect(await future()).toBe(5);
    await expect(iso.sql`SELECT audit.ensure_partitions(99)`).rejects.toThrow(/between 0 and 24/);
  });

  // R1: month arithmetic must not depend on the session TimeZone (Europe/Brussels is our D-003 zone)
  it("bounds are exact UTC month starts and later runs never overlap, under a Brussels session", async () => {
    const bounds = async () =>
      iso.sql.begin(async (sql) => {
        await sql.unsafe("SET LOCAL TimeZone = 'UTC'"); // render bounds in UTC
        return sql<{ name: string; bound: string }[]>`
          SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'audit' AND c.relkind = 'r' AND c.relname ~ '^events_y20(40|41)m' ORDER BY c.relname`;
      });
    await iso.sql.begin(async (sql) => {
      await sql.unsafe("SET LOCAL TimeZone = 'Europe/Brussels'");
      // two daily-job runs in consecutive months (the `from_month` seam simulates the clock)
      await sql`SELECT audit.ensure_partitions(3, '2040-10-15 12:00+00')`;
      await sql`SELECT audit.ensure_partitions(3, '2040-11-15 12:00+00')`; // overlapped before the fix
    });
    const stored = await bounds();
    expect(stored.map((r) => r.name)).toEqual([
      "events_y2040m10",
      "events_y2040m11",
      "events_y2040m12",
      "events_y2041m01",
      "events_y2041m02",
    ]);
    expect(stored.map((r) => r.bound)).toEqual([
      "FOR VALUES FROM ('2040-10-01 00:00:00+00') TO ('2040-11-01 00:00:00+00')",
      "FOR VALUES FROM ('2040-11-01 00:00:00+00') TO ('2040-12-01 00:00:00+00')",
      "FOR VALUES FROM ('2040-12-01 00:00:00+00') TO ('2041-01-01 00:00:00+00')",
      "FOR VALUES FROM ('2041-01-01 00:00:00+00') TO ('2041-02-01 00:00:00+00')",
      "FOR VALUES FROM ('2041-02-01 00:00:00+00') TO ('2041-03-01 00:00:00+00')",
    ]);
  });

  it("future_partitions is independent of the session TimeZone", async () => {
    const [utc, brussels] = await iso.sql.begin(async (sql) => {
      const a = await sql<{ n: number }[]>`SELECT audit.future_partitions() AS n`;
      await sql.unsafe("SET LOCAL TimeZone = 'Europe/Brussels'");
      const b = await sql<{ n: number }[]>`SELECT audit.future_partitions() AS n`;
      return [a[0]?.n, b[0]?.n];
    });
    expect(brussels).toBe(utc);
  });
});

describe("kernel integration (AuditPort)", () => {
  it("a command's audit entry lands in the chain and rolls back with the handler", async () => {
    const kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort(options) });
    kernel.clock.set(new Date()); // the default fake clock (2026-01-01) is outside the live partitions
    const decide = command({
      name: "pharmacy.review.decide",
      input: z.object({ orderId: z.string(), fail: z.boolean().default(false) }),
      permission: "orders.review.decide",
      async handler({ input, ctx }) {
        await ctx.audit.record({
          action: "pharmacy.review.decided",
          entityType: "order",
          entityId: input.orderId,
          data: { decision: "approved", orderId: input.orderId },
        });
        if (input.fail) throw new Error("boom");
        return { orderId: input.orderId };
      },
    });
    const pharmacist = actors.user({ roles: ["pharmacist"] });
    await decide({ orderId: "o-1" }, pharmacist);
    await expect(decide({ orderId: "o-2", fail: true }, pharmacist)).rejects.toThrow("boom");
    const stored = await iso.sql<{ actor_type: string; actor_id: string; entity_id: string }[]>`
      SELECT actor_type, actor_id, entity_id FROM audit.events`;
    expect(stored).toEqual([{ actor_type: "user", actor_id: pharmacist.id, entity_id: "o-1" }]);
    expect(await verify()).toMatchObject({ ok: true, checked: 1 });
  });

  it("an anonymous actor is audited with actor_type = anonymous", async () => {
    const kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort(options) });
    kernel.clock.set(new Date());
    const create = command({
      name: "orders.order.create",
      input: z.object({}),
      permission: "public",
      async handler({ ctx }) {
        await ctx.audit.record({ action: "orders.order.created" });
        return {};
      },
    });
    const guest = actors.anonymous("guest-1");
    await create({}, guest);
    const [row] = await iso.sql<{ actor_type: string; actor_id: string }[]>`
      SELECT actor_type, actor_id FROM audit.events`;
    expect(row).toEqual({ actor_type: "anonymous", actor_id: "guest-1" });
  });
});
