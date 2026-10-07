import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { type AuditPort, type Ctx, DomainError, command, isDomainError, query } from "../src";
import {
  type KernelTestHandles,
  actors,
  configureKernelForTests,
  resetKernelForTests,
} from "../src/testing";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;
let transactionCalls = 0;

/** The isolated DB, counting how many transactions the kernel opens. */
const countingDb = () => ({
  transaction: ((...args: Parameters<IsolatedDatabase["db"]["transaction"]>) => {
    transactionCalls++;
    return iso.db.transaction(...args);
  }) as IsolatedDatabase["db"]["transaction"],
});

const count = async (table: string): Promise<number> => {
  const [row] = await iso.sql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table}`);
  return row?.n ?? 0;
};

const insertItem = (ctx: Ctx, id: string) =>
  ctx.tx.execute(sql`INSERT INTO kernel_items (id) VALUES (${id})`);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const pharmacist = () => actors.user({ roles: ["pharmacist"] });
const record = (ctx: Ctx, action = "test.item.created") => ctx.audit.record({ action });

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await iso.sql`CREATE TABLE kernel_items (id text PRIMARY KEY)`;
  await iso.sql`CREATE TABLE kernel_audit (id serial PRIMARY KEY, action text NOT NULL, actor_type text NOT NULL)`;
});

afterAll(async () => {
  await iso?.drop();
});

beforeEach(async () => {
  transactionCalls = 0;
  await iso.sql`TRUNCATE kernel_items, kernel_audit, system.idempotency_keys`;
  kernel = configureKernelForTests({ db: countingDb() });
});

afterEach(() => resetKernelForTests());

// A command that creates one item and audits it.
const createItem = command({
  name: "test.item.create",
  input: z.object({ id: z.string().min(1) }),
  output: z.object({ id: z.string() }),
  permission: "orders.review.decide",
  async handler({ input, ctx }) {
    await insertItem(ctx, input.id);
    await record(ctx);
    return { id: input.id };
  },
});

describe("execution", () => {
  it("runs handler + audit in one transaction and returns the (parsed) output", async () => {
    const result = await createItem({ id: "a" }, pharmacist());
    expect(result).toEqual({ id: "a" });
    expect(await count("kernel_items")).toBe(1);
    expect(kernel.inMemoryAudit.entries).toHaveLength(1);
    expect(kernel.inMemoryAudit.entries[0]).toMatchObject({
      action: "test.item.created",
      actor: { type: "user" },
    });
    expect(transactionCalls).toBe(1);
  });

  it("rolls back handler writes AND the audit entry together when the handler fails", async () => {
    // an audit port that writes inside the command's transaction, like module-audit will
    const dbAudit: AuditPort = {
      async record(entry, { actor, tx }) {
        await tx.execute(
          sql`INSERT INTO kernel_audit (action, actor_type) VALUES (${entry.action}, ${actor.type})`,
        );
      },
    };
    configureKernelForTests({ db: countingDb(), audit: dbAudit });

    const failing = command({
      name: "test.item.fail_after_audit",
      input: z.object({ id: z.string() }),
      permission: "orders.review.decide",
      async handler({ input, ctx }) {
        await insertItem(ctx, input.id);
        await record(ctx);
        throw new DomainError("Conflict", "test.conflict");
      },
    });

    await expect(failing({ id: "x" }, pharmacist())).rejects.toMatchObject({
      kind: "Conflict",
      code: "test.conflict",
    });
    expect(await count("kernel_items")).toBe(0);
    expect(await count("kernel_audit")).toBe(0);

    // control: the same writes DO persist when the handler succeeds
    const ok = command({
      name: "test.item.ok",
      input: z.object({ id: z.string() }),
      permission: "orders.review.decide",
      async handler({ input, ctx }) {
        await insertItem(ctx, input.id);
        await record(ctx);
      },
    });
    await ok({ id: "y" }, pharmacist());
    expect(await count("kernel_items")).toBe(1);
    expect(await count("kernel_audit")).toBe(1);
  });

  it("rejects a handler that records no audit entry (kernel.audit_missing) and rolls it back", async () => {
    const silent = command({
      name: "test.item.silent",
      input: z.object({ id: z.string() }),
      permission: "orders.review.decide",
      async handler({ input, ctx }) {
        await insertItem(ctx, input.id);
      },
    });
    await expect(silent({ id: "s" }, pharmacist())).rejects.toMatchObject({
      kind: "InvariantViolation",
      code: "kernel.audit_missing",
    });
    expect(await count("kernel_items")).toBe(0);

    const optOut = command({
      name: "test.item.silent_ok",
      input: z.object({ id: z.string() }),
      permission: "orders.review.decide",
      audit: "none",
      async handler({ input, ctx }) {
        await insertItem(ctx, input.id);
      },
    });
    await optOut({ id: "s2" }, pharmacist());
    expect(await count("kernel_items")).toBe(1);
  });

  it("throws before the kernel is configured", async () => {
    resetKernelForTests();
    await expect(createItem({ id: "a" }, pharmacist())).rejects.toThrow(/kernel\.not_configured/);
  });
});

describe("authorization and validation happen before any database work", () => {
  it("unauthorised actor → Forbidden, no transaction, no writes", async () => {
    const customer = actors.user({ roles: ["customer"] });
    await expect(createItem({ id: "a" }, customer)).rejects.toMatchObject({
      kind: "Forbidden",
      code: "kernel.forbidden",
    });
    expect(transactionCalls).toBe(0);
    expect(await count("kernel_items")).toBe(0);
  });

  it("K1: an unauthorised actor with INVALID input gets Forbidden, not ValidationFailed", async () => {
    const customer = actors.user({ roles: ["customer"] });
    const error = await createItem({ id: 42 }, customer).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "Forbidden", code: "kernel.forbidden" });
    expect((error as DomainError).fields).toBeUndefined(); // no schema paths leak
    const read = query({
      name: "test.item.list",
      input: z.object({ page: z.number() }),
      permission: "orders.read",
      handler: async () => [],
    });
    await expect(read({ page: "x" }, customer)).rejects.toMatchObject({ kind: "Forbidden" });
    expect(transactionCalls).toBe(0);
  });

  it("anonymous actors can never run non-public commands, whatever roles are passed", async () => {
    const sneaky = { ...actors.anonymous(), roles: ["owner"] };
    await expect(createItem({ id: "a" }, sneaky)).rejects.toMatchObject({ kind: "Forbidden" });
    expect(transactionCalls).toBe(0);
  });

  it("invalid input → ValidationFailed with {path, code} only (never values), no transaction", async () => {
    const marker = "SENSITIVE-VALUE-123";
    const strict = command({
      name: "test.item.strict",
      input: z.object({ email: z.string().email(), qty: z.number().int().min(1) }),
      permission: "orders.review.decide",
      audit: "none",
      async handler() {},
    });
    const error = await strict({ email: marker, qty: 0 }, pharmacist()).catch((e: unknown) => e);
    expect(isDomainError(error)).toBe(true);
    expect(error).toMatchObject({ kind: "ValidationFailed", code: "kernel.validation_failed" });
    const fields = (error as DomainError).fields;
    expect(fields?.map((f) => f.path).sort()).toEqual(["email", "qty"]);
    expect(JSON.stringify(error)).not.toContain(marker);
    expect(String((error as DomainError).message)).not.toContain(marker);
    expect(transactionCalls).toBe(0);
  });
});

describe("public operations and anonymous actors (A1)", () => {
  const addToGuestCart = command({
    name: "cart.guest.add_item",
    input: z.object({ id: z.string() }),
    output: z.object({ id: z.string() }),
    permission: "public",
    async handler({ input, ctx }) {
      await insertItem(ctx, input.id);
      await ctx.audit.record({ action: "cart.item.added" });
      return { id: input.id };
    },
  });

  it("works for an anonymous actor and audits with actor_type = anonymous", async () => {
    const guest = actors.anonymous("anon-42");
    expect(await addToGuestCart({ id: "i-1" }, guest)).toEqual({ id: "i-1" });
    expect(kernel.inMemoryAudit.entries).toHaveLength(1);
    expect(kernel.inMemoryAudit.entries[0]?.actor).toMatchObject({
      type: "anonymous",
      id: "anon-42",
    });
  });
});

describe("idempotency", () => {
  let runs = 0;
  const once = command({
    name: "test.item.once",
    input: z.object({ id: z.string() }),
    output: z.object({ id: z.string(), run: z.number() }),
    permission: "orders.review.decide",
    audit: "none",
    async handler({ input, ctx }) {
      runs++;
      await sleep(120); // widen the race window for the concurrent case
      await insertItem(ctx, `${input.id}-${runs}`);
      return { id: input.id, run: runs };
    },
  });

  beforeEach(() => {
    runs = 0;
  });

  it("K4: the same key with DIFFERENT input is a Conflict and does not run the handler", async () => {
    const actor = pharmacist();
    await once({ id: "a" }, actor, { idempotencyKey: "k-hash" });
    await expect(once({ id: "b" }, actor, { idempotencyKey: "k-hash" })).rejects.toMatchObject({
      kind: "Conflict",
      code: "kernel.idempotency_key_reused",
    });
    expect(runs).toBe(1);
    // same input (key order irrelevant) still replays
    const again = await once({ id: "a" }, actor, { idempotencyKey: "k-hash" });
    expect(again.run).toBe(1);
    const [row] = await iso.sql<{ request_hash: string }[]>`
      SELECT request_hash FROM system.idempotency_keys WHERE key LIKE 'test.item.once:%:k-hash'`;
    expect(row?.request_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("K4: an idempotent command whose output serialises to undefined is rejected and rolled back", async () => {
    const nothing = command({
      name: "test.item.nothing",
      input: z.object({ id: z.string() }),
      output: z.undefined(),
      permission: "orders.review.decide",
      audit: "none",
      async handler({ input, ctx }) {
        await insertItem(ctx, input.id);
      },
    });
    await expect(
      nothing({ id: "n" }, pharmacist(), { idempotencyKey: "k-undef" }),
    ).rejects.toMatchObject({ code: "kernel.idempotent_output_undefined" });
    expect(await count("kernel_items")).toBe(0);
    expect(await count("system.idempotency_keys")).toBe(0);
  });

  it("replays the stored response for the same key without running the handler again", async () => {
    const actor = pharmacist();
    const first = await once({ id: "a" }, actor, { idempotencyKey: "k-1" });
    const second = await once({ id: "a" }, actor, { idempotencyKey: "k-1" });
    expect(second).toEqual(first);
    expect(runs).toBe(1);
    expect(await count("kernel_items")).toBe(1);
  });

  it("concurrent duplicates run the handler exactly once and both get the same response", async () => {
    const actor = pharmacist();
    const [a, b] = await Promise.all([
      once({ id: "c" }, actor, { idempotencyKey: "k-race" }),
      once({ id: "c" }, actor, { idempotencyKey: "k-race" }),
    ]);
    expect(runs).toBe(1);
    expect(a).toEqual(b);
    expect(await count("kernel_items")).toBe(1);
  });

  it("keys are scoped per command and per actor", async () => {
    await once({ id: "a" }, pharmacist(), { idempotencyKey: "same" });
    await once({ id: "a" }, pharmacist(), { idempotencyKey: "same" }); // different actor id
    expect(runs).toBe(2);
  });

  it("a failed (rolled back) execution does not consume the key", async () => {
    let attempts = 0;
    const flaky = command({
      name: "test.item.flaky",
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      permission: "orders.review.decide",
      audit: "none",
      async handler() {
        attempts++;
        if (attempts === 1) throw new DomainError("Conflict", "test.try_again");
        return { ok: true };
      },
    });
    const actor = pharmacist();
    await expect(flaky({}, actor, { idempotencyKey: "k" })).rejects.toMatchObject({
      code: "test.try_again",
    });
    await expect(flaky({}, actor, { idempotencyKey: "k" })).resolves.toEqual({ ok: true });
  });

  it("an expired key is reclaimed and the command runs again", async () => {
    const actor = pharmacist();
    await once({ id: "e" }, actor, { idempotencyKey: "k-exp" });
    kernel.clock.advance(25 * 60 * 60 * 1000); // past the 24 h TTL
    await once({ id: "e" }, actor, { idempotencyKey: "k-exp" });
    expect(runs).toBe(2);
  });

  it("stores identifiers/status only: the output schema strips anything else (A4)", async () => {
    const leaky = command({
      name: "test.item.leaky",
      input: z.object({}),
      output: z.object({ id: z.string(), status: z.string() }),
      permission: "orders.review.decide",
      audit: "none",
      async handler() {
        const result = { id: "o-1", status: "approved", patientName: "Jane Doe" };
        return result;
      },
    });
    const returned = await leaky({}, pharmacist(), { idempotencyKey: "k-pii" });
    expect(returned).toEqual({ id: "o-1", status: "approved" });
    const [row] = await iso.sql<{ response: string }[]>`
      SELECT response FROM system.idempotency_keys WHERE key LIKE 'test.item.leaky:%'`;
    expect(row?.response).toBe(JSON.stringify({ id: "o-1", status: "approved" }));
    expect(row?.response).not.toContain("Jane");
  });

  it("requires an output schema for idempotent commands and a sane key", async () => {
    const noOutput = command({
      name: "test.item.no_output",
      input: z.object({}),
      permission: "orders.review.decide",
      audit: "none",
      async handler() {},
    });
    await expect(noOutput({}, pharmacist(), { idempotencyKey: "k" })).rejects.toMatchObject({
      code: "kernel.output_schema_required",
    });
    await expect(once({ id: "a" }, pharmacist(), { idempotencyKey: "" })).rejects.toMatchObject({
      kind: "ValidationFailed",
      code: "kernel.invalid_idempotency_key",
    });
    await expect(
      once({ id: "a" }, pharmacist(), { idempotencyKey: "x".repeat(201) }),
    ).rejects.toMatchObject({ code: "kernel.invalid_idempotency_key" });
  });
});

describe("retries on serialization failure / deadlock (A3)", () => {
  const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });

  const makeRetrying = (failures: number, code = "40001") => {
    let attempts = 0;
    const cmd = command({
      name: "test.item.retrying",
      input: z.object({ id: z.string() }),
      output: z.object({ attempts: z.number() }),
      permission: "orders.review.decide",
      audit: "none",
      async handler({ input, ctx }) {
        attempts++;
        await insertItem(ctx, `${input.id}-attempt-${attempts}`);
        if (attempts <= failures) throw pgError(code);
        return { attempts };
      },
    });
    return { cmd, attempts: () => attempts };
  };

  it("retries the WHOLE execution, keeps only the successful attempt's writes, and records a metric", async () => {
    const { cmd, attempts } = makeRetrying(2);
    await expect(cmd({ id: "r" }, pharmacist())).resolves.toEqual({ attempts: 3 });
    expect(attempts()).toBe(3);
    expect(await count("kernel_items")).toBe(1); // failed attempts rolled back
    expect(kernel.metrics.filter((m) => m.name === "kernel.tx.retry")).toHaveLength(2);
    expect(kernel.metrics[0]?.attributes).toMatchObject({ code: "40001" });
  });

  it("also retries deadlocks (40P01)", async () => {
    const { cmd } = makeRetrying(1, "40P01");
    await expect(cmd({ id: "d" }, pharmacist())).resolves.toEqual({ attempts: 2 });
  });

  it("gives up after maxRetries and rethrows the database error", async () => {
    configureKernelForTests({ db: countingDb(), maxRetries: 2 });
    const { cmd, attempts } = makeRetrying(99);
    await expect(cmd({ id: "g" }, pharmacist())).rejects.toMatchObject({ code: "40001" });
    expect(attempts()).toBe(3); // first attempt + 2 retries
    expect(await count("kernel_items")).toBe(0);
  });

  it("does not retry other errors or domain errors", async () => {
    const { cmd, attempts } = makeRetrying(5, "23505"); // unique violation
    await expect(cmd({ id: "u" }, pharmacist())).rejects.toMatchObject({ code: "23505" });
    expect(attempts()).toBe(1);
  });
});

describe("nested commands (Q7)", () => {
  const inner = command({
    name: "test.inner.create",
    input: z.object({ id: z.string() }),
    permission: "orders.review.decide",
    async handler({ input, ctx }) {
      await insertItem(ctx, input.id);
      await record(ctx, "test.inner.created");
    },
  });

  it("calling another command's function directly inside a handler is rejected", async () => {
    const outer = command({
      name: "test.outer.direct",
      input: z.object({}),
      permission: "orders.review.decide",
      audit: "none",
      async handler({ ctx }) {
        await inner({ id: "n" }, ctx.actor);
      },
    });
    await expect(outer({}, pharmacist())).rejects.toMatchObject({
      kind: "InvariantViolation",
      code: "kernel.nested_command",
    });
    expect(await count("kernel_items")).toBe(0);
  });

  it("ctx.run joins the caller's transaction: commits together…", async () => {
    const outer = command({
      name: "test.outer.run",
      input: z.object({}),
      permission: "orders.review.decide",
      async handler({ ctx }) {
        await insertItem(ctx, "outer");
        await ctx.run(inner, { id: "inner" });
        await record(ctx);
      },
    });
    await outer({}, pharmacist());
    expect(await count("kernel_items")).toBe(2);
    expect(transactionCalls).toBe(1);
    expect(kernel.inMemoryAudit.entries.map((e) => e.action)).toEqual([
      "test.inner.created",
      "test.item.created",
    ]);
  });

  it("…and rolls back together when the outer command fails afterwards", async () => {
    const outer = command({
      name: "test.outer.run_then_fail",
      input: z.object({}),
      permission: "orders.review.decide",
      audit: "none",
      async handler({ ctx }) {
        await ctx.run(inner, { id: "inner" });
        throw new DomainError("Conflict", "test.later_failure");
      },
    });
    await expect(outer({}, pharmacist())).rejects.toMatchObject({ code: "test.later_failure" });
    expect(await count("kernel_items")).toBe(0);
  });

  it("enforces the inner command's authorization and audit rules", async () => {
    const needsOwner = command({
      name: "test.inner.owner_only",
      input: z.object({}),
      permission: "staff.manage",
      async handler({ ctx }) {
        await record(ctx);
      },
    });
    const outer = command({
      name: "test.outer.forbidden_inner",
      input: z.object({}),
      permission: "orders.review.decide",
      audit: "none",
      async handler({ ctx }) {
        await ctx.run(needsOwner, {});
      },
    });
    await expect(outer({}, pharmacist())).rejects.toMatchObject({ code: "kernel.forbidden" });
  });
});

describe("spans (no PII)", () => {
  it("one span per execution with command name, actor type and outcome — never input values or actor id", async () => {
    const marker = "VERY-SECRET-INPUT-VALUE";
    const actor = actors.user({ id: "user-with-id-777", roles: ["pharmacist"] });
    await createItem({ id: marker }, actor);

    expect(kernel.spans).toHaveLength(1);
    const span = kernel.spans[0];
    expect(span).toMatchObject({
      name: "test.item.create",
      ended: true,
      attributes: { "command.name": "test.item.create", "actor.type": "user", outcome: "ok" },
    });
    const serialised = JSON.stringify(kernel.spans);
    expect(serialised).not.toContain(marker);
    expect(serialised).not.toContain("user-with-id-777");
  });

  it("records outcome and error code for domain errors and unknown errors", async () => {
    await createItem({ id: "" }, pharmacist()).catch(() => {});
    expect(kernel.spans[0]?.attributes).toMatchObject({
      outcome: "domain_error",
      "error.code": "kernel.validation_failed",
    });

    const boom = command({
      name: "test.item.boom",
      input: z.object({}),
      permission: "orders.review.decide",
      audit: "none",
      async handler() {
        throw new Error("secret detail");
      },
    });
    await boom({}, pharmacist()).catch(() => {});
    const attributes = kernel.spans[1]?.attributes;
    expect(attributes).toMatchObject({ outcome: "error", "error.code": "kernel.internal" });
    expect(JSON.stringify(attributes)).not.toContain("secret detail");
  });
});

describe("query()", () => {
  const getItemCount = query({
    name: "test.item.count",
    input: z.object({}),
    permission: "orders.read",
    async handler({ ctx }) {
      const rows = await ctx.tx.execute(sql`SELECT count(*)::int AS n FROM kernel_items`);
      return { n: Number(rows[0]?.["n"] ?? 0) };
    },
  });

  it("runs authorised reads", async () => {
    await createItem({ id: "q" }, pharmacist());
    await expect(getItemCount({}, actors.user({ roles: ["customer_service"] }))).resolves.toEqual({
      n: 1,
    });
  });

  it("rejects unauthorised actors without opening a transaction", async () => {
    transactionCalls = 0;
    await expect(getItemCount({}, actors.anonymous())).rejects.toMatchObject({ kind: "Forbidden" });
    expect(transactionCalls).toBe(0);
  });

  it("runs in a READ ONLY transaction", async () => {
    const sneakyWrite = query({
      name: "test.item.sneaky_write",
      input: z.object({}),
      permission: "orders.read",
      async handler({ ctx }) {
        await ctx.tx.execute(sql`INSERT INTO kernel_items (id) VALUES ('nope')`);
      },
    });
    await expect(sneakyWrite({}, pharmacist())).rejects.toThrow(/read-only/i);
    expect(await count("kernel_items")).toBe(0);
  });

  it("reserves auditRead: passing true throws at definition time", () => {
    expect(() =>
      query({
        name: "test.item.audited_read",
        input: z.object({}),
        permission: "orders.read",
        // @ts-expect-error `auditRead` only accepts `false` until it is implemented
        auditRead: true,
        async handler() {},
      }),
    ).toThrow(/audit_read_not_implemented/);
  });

  it("queries cannot be called from inside a handler either", async () => {
    const outer = command({
      name: "test.outer.query_inside",
      input: z.object({}),
      permission: "orders.review.decide",
      audit: "none",
      async handler({ ctx }) {
        await getItemCount({}, ctx.actor);
      },
    });
    await expect(outer({}, pharmacist())).rejects.toMatchObject({ code: "kernel.nested_command" });
  });
});

describe("ctx.can", () => {
  it("answers resource-level permission questions for the actor", async () => {
    const seen: boolean[] = [];
    const probe = command({
      name: "test.item.probe",
      input: z.object({}),
      permission: "orders.review.decide",
      audit: "none",
      async handler({ ctx }) {
        seen.push(ctx.can("orders.review.decide"), ctx.can("staff.manage"));
      },
    });
    await probe({}, pharmacist());
    expect(seen).toEqual([true, false]);
  });
});

vi.setConfig({ testTimeout: 30_000 });
