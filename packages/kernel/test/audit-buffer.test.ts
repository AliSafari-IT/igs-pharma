import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type AuditEntry,
  type AuditPort,
  type Ctx,
  type Origin,
  type Tx,
  command,
  invariant,
} from "../src";
import {
  type KernelTestHandles,
  actors,
  configureKernelForTests,
  resetKernelForTests,
} from "../src/testing";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;

/** A port that writes into a table INSIDE the command's transaction and logs every call. */
class RecordingPort implements AuditPort {
  readonly calls: { action: string; origin: Origin | undefined; during: string }[] = [];
  failOn: string | undefined;
  rejectAtValidate: string | undefined;
  phase = "idle";

  validate(entry: AuditEntry): void {
    if (entry.action === this.rejectAtValidate) throw invariant("test.invalid_audit_entry");
  }

  async record(entry: AuditEntry, context: { tx: Tx; origin?: Origin }): Promise<void> {
    if (entry.action === this.failOn) throw new Error("flush failed");
    this.calls.push({ action: entry.action, origin: context.origin, during: this.phase });
    await context.tx.execute(sql`INSERT INTO buf_audit (action) VALUES (${entry.action})`);
  }
}

let port: RecordingPort;

const count = async (table: string): Promise<number> =>
  Number((await iso.sql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table}`))[0]?.n);

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await iso.sql`CREATE TABLE buf_items (id text PRIMARY KEY)`;
  await iso.sql`CREATE TABLE buf_audit (id serial PRIMARY KEY, action text NOT NULL)`;
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(async () => {
  await iso.sql`TRUNCATE buf_items, buf_audit, system.idempotency_keys`;
  port = new RecordingPort();
  kernel = configureKernelForTests({ db: iso.db, audit: port });
});
afterEach(() => resetKernelForTests());

const pharmacist = () => actors.user({ roles: ["pharmacist"] });
const insertItem = (ctx: Ctx, id: string) =>
  ctx.tx.execute(sql`INSERT INTO buf_items (id) VALUES (${id})`);
const rec = (ctx: Ctx, action: string) => ctx.audit.record({ action });

describe("buffered audit (D-026)", () => {
  it("reaches the port only after the handler returned, in call order, inside the transaction", async () => {
    const cmd = command({
      name: "test.buf.order",
      input: z.object({}),
      permission: "orders.review.decide",
      async handler({ ctx }) {
        await rec(ctx, "test.entry.first");
        await rec(ctx, "test.entry.second");
        port.phase = "after-handler-body"; // set before the handler returns
        expect(port.calls).toEqual([]); // nothing flushed while the handler runs
        await rec(ctx, "test.entry.third");
        return {};
      },
    });
    await cmd({}, pharmacist());
    expect(port.calls.map((c) => c.action)).toEqual([
      "test.entry.first",
      "test.entry.second",
      "test.entry.third",
    ]);
    // flushed after the handler body finished
    expect(port.calls.every((c) => c.during === "after-handler-body")).toBe(true);
    expect(await count("buf_audit")).toBe(3);
  });

  it("a failing flush rolls back the handler's writes, the audit rows and the idempotency key", async () => {
    port.failOn = "test.entry.second";
    const cmd = command({
      name: "test.buf.flushfail",
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      permission: "orders.review.decide",
      async handler({ input, ctx }) {
        await insertItem(ctx, input.id);
        await rec(ctx, "test.entry.first");
        await rec(ctx, "test.entry.second");
        return { id: input.id };
      },
    });
    await expect(cmd({ id: "a" }, pharmacist(), { idempotencyKey: "k-1" })).rejects.toThrow(
      "flush failed",
    );
    expect(await count("buf_items")).toBe(0);
    expect(await count("buf_audit")).toBe(0); // the first entry was written, then rolled back
    expect(await count("system.idempotency_keys")).toBe(0);
  });

  it("the buffer is per attempt: a retried 40001 execution flushes only the successful attempt", async () => {
    let attempts = 0;
    const cmd = command({
      name: "test.buf.retry",
      input: z.object({}),
      permission: "orders.review.decide",
      async handler({ ctx }) {
        attempts++;
        await rec(ctx, "test.entry.attempt");
        if (attempts === 1) {
          throw Object.assign(new Error("serialization failure"), { code: "40001" });
        }
        return {};
      },
    });
    await cmd({}, pharmacist());
    expect(attempts).toBe(2);
    expect(port.calls.map((c) => c.action)).toEqual(["test.entry.attempt"]);
    expect(await count("buf_audit")).toBe(1);
  });

  it("nested ctx.run commands share the buffer; each still has its own audit_missing guard", async () => {
    const inner = command({
      name: "test.buf.inner",
      input: z.object({}),
      permission: "orders.review.decide",
      async handler({ ctx }) {
        await rec(ctx, "test.entry.inner");
        return {};
      },
    });
    const silentInner = command({
      name: "test.buf.silent",
      input: z.object({}),
      permission: "orders.review.decide",
      async handler() {
        return {};
      },
    });
    const outer = command({
      name: "test.buf.outer",
      input: z.object({ silent: z.boolean().default(false) }),
      permission: "orders.review.decide",
      async handler({ input, ctx }) {
        await rec(ctx, "test.entry.outer-1");
        if (input.silent) await ctx.run(silentInner, {});
        else await ctx.run(inner, {});
        await rec(ctx, "test.entry.outer-2");
        return {};
      },
    });
    await outer({}, pharmacist());
    expect(port.calls.map((c) => c.action)).toEqual([
      "test.entry.outer-1",
      "test.entry.inner",
      "test.entry.outer-2",
    ]);

    port.calls.length = 0;
    await iso.sql`TRUNCATE buf_audit`;
    await expect(outer({ silent: true }, pharmacist())).rejects.toMatchObject({
      code: "kernel.audit_missing", // the inner command recorded nothing, whatever the outer did
    });
    expect(port.calls).toEqual([]); // nothing flushed, nothing persisted
    expect(await count("buf_audit")).toBe(0);
  });

  it("audit_missing semantics are unchanged: the counter increments on record", async () => {
    const silent = command({
      name: "test.buf.missing",
      input: z.object({}),
      permission: "orders.review.decide",
      async handler() {
        return {};
      },
    });
    await expect(silent({}, pharmacist())).rejects.toMatchObject({ code: "kernel.audit_missing" });
    expect(port.calls).toEqual([]);
  });
});

describe("AuditPort.validate (Q1)", () => {
  it("fails in the handler's stack at record time, before anything is flushed", async () => {
    port.rejectAtValidate = "test.entry.bad";
    let reachedAfterRecord = false;
    const cmd = command({
      name: "test.buf.validate",
      input: z.object({}),
      permission: "orders.review.decide",
      async handler({ ctx }) {
        await rec(ctx, "test.entry.good");
        await rec(ctx, "test.entry.bad"); // throws here
        reachedAfterRecord = true;
        return {};
      },
    });
    await expect(cmd({}, pharmacist())).rejects.toMatchObject({
      code: "test.invalid_audit_entry",
    });
    expect(reachedAfterRecord).toBe(false);
    expect(port.calls).toEqual([]);
  });

  it("ports without validate keep working", async () => {
    const plain: AuditPort = {
      async record(entry, { tx }) {
        await tx.execute(sql`INSERT INTO buf_audit (action) VALUES (${entry.action})`);
      },
    };
    configureKernelForTests({ db: iso.db, audit: plain });
    const cmd = command({
      name: "test.buf.plain",
      input: z.object({}),
      permission: "orders.review.decide",
      async handler({ ctx }) {
        await rec(ctx, "test.entry.plain");
        return {};
      },
    });
    await cmd({}, pharmacist());
    expect(await count("buf_audit")).toBe(1);
  });
});

describe("CallOptions.origin (D-028)", () => {
  const origin = { ip: "203.0.113.7", userAgent: "UA/9.9" };

  it("reaches the port, but never the handler, spans, logs or the idempotency request hash", async () => {
    let ctxJson = "";
    const cmd = command({
      name: "test.buf.origin",
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      permission: "orders.review.decide",
      async handler({ input, ctx }) {
        ctxJson = JSON.stringify({ ...ctx, tx: undefined });
        await rec(ctx, "test.entry.origin");
        return { id: input.id };
      },
    });
    const actor = pharmacist();
    await cmd({ id: "a" }, actor, { idempotencyKey: "k-origin", origin });
    expect(port.calls[0]?.origin).toEqual(origin);

    expect(ctxJson).not.toContain("203.0.113.7");
    expect(ctxJson).not.toContain("UA/9.9");
    expect(Object.keys(JSON.parse(ctxJson))).not.toContain("origin");
    const everything = JSON.stringify({
      spans: kernel.spans,
      metrics: kernel.metrics,
      logs: kernel.errors,
    });
    expect(everything).not.toContain("203.0.113.7");
    expect(everything).not.toContain("UA/9.9");

    // a different origin with the same key and input still replays (origin is not part of the hash)
    const again = await cmd({ id: "a" }, actor, {
      idempotencyKey: "k-origin",
      origin: { ip: "198.51.100.1" },
    });
    expect(again).toEqual({ id: "a" });
    expect(port.calls.length).toBe(1); // replayed: handler and audit did not run again
  });

  it("is omitted from the port context when the call has none", async () => {
    const cmd = command({
      name: "test.buf.noorigin",
      input: z.object({}),
      permission: "orders.review.decide",
      async handler({ ctx }) {
        await rec(ctx, "test.entry.none");
        return {};
      },
    });
    await cmd({}, pharmacist());
    expect(port.calls[0]?.origin).toBeUndefined();
  });

  it("the testing InMemoryAudit captures origin", async () => {
    const handles = configureKernelForTests({ db: iso.db });
    const cmd = command({
      name: "test.buf.memory",
      input: z.object({}),
      permission: "orders.review.decide",
      async handler({ ctx }) {
        await rec(ctx, "test.entry.memory");
        return {};
      },
    });
    await cmd({}, pharmacist(), { origin });
    expect(handles.inMemoryAudit.entries[0]?.origin).toEqual(origin);
  });
});
