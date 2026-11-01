// igs-pharma#210: refused actions in the audit trail, against real Postgres: one
// `kernel.access.denied` entry per (person, operation, minute), written in its own transaction after
// the refusal (K1: the refused call itself does no database work), only for users and only for
// `Forbidden`, never the input, and never changing the answer when the audit write fails.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type AuditEntry,
  type AuditPort,
  KERNEL_AUDIT,
  type Origin,
  type Tx,
  command,
  forbidden,
  isDomainError,
  notFound,
  query,
} from "../src";
import {
  type KernelTestHandles,
  actors,
  configureKernelForTests,
  resetKernelForTests,
} from "../src/testing";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;

/** Writes each entry into a table inside the transaction it is given. */
class RecordingPort implements AuditPort {
  readonly entries: { entry: AuditEntry; actorId: string; origin: Origin | undefined }[] = [];
  fail = false;
  async record(
    entry: AuditEntry,
    context: { tx: Tx; actor: { id: string }; origin?: Origin },
  ): Promise<void> {
    if (this.fail) throw new Error("audit store unavailable");
    await context.tx.execute(sql`INSERT INTO denied_audit (action) VALUES (${entry.action})`);
    this.entries.push({ entry, actorId: context.actor.id, origin: context.origin });
  }
}

let port: RecordingPort;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await iso.sql`CREATE TABLE denied_audit (id serial PRIMARY KEY, action text NOT NULL)`;
  await iso.sql`CREATE TABLE denied_items (id text PRIMARY KEY)`;
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(async () => {
  await iso.sql`TRUNCATE denied_audit, denied_items, system.denied_audit_throttle`;
  port = new RecordingPort();
  kernel = configureKernelForTests({ db: iso.db, audit: port });
  kernel.clock.set(new Date("2026-11-01T10:00:10Z"));
});
afterEach(() => resetKernelForTests());

const decide = command({
  name: "test.denied.decide",
  input: z.object({ secret: z.string() }),
  permission: "orders.review.decide",
  async handler({ ctx }) {
    await ctx.tx.execute(sql`INSERT INTO denied_items (id) VALUES ('x')`);
    await ctx.audit.record({ action: "test.denied.decided" });
    return {};
  },
});

/** A handler that refuses after doing work: the work rolls back, the refusal is audited. */
const ownRequest = command({
  name: "test.denied.own",
  input: z.object({ code: z.enum(["forbidden", "not_found"]) }),
  permission: "orders.review.decide",
  async handler({ input, ctx }) {
    await ctx.tx.execute(sql`INSERT INTO denied_items (id) VALUES ('y')`);
    if (input.code === "forbidden") throw forbidden("test.own_request");
    throw notFound("test.not_found");
  },
});

const read = query({
  name: "test.denied.read",
  input: z.object({}),
  permission: "orders.review.decide",
  async handler() {
    return { ok: true };
  },
});

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

const throttleRows = async () =>
  Number(
    (await iso.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM system.denied_audit_throttle`)[0]
      ?.n,
  );
const items = async () =>
  Number((await iso.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM denied_items`)[0]?.n);

describe("kernel.access.denied (igs-pharma#210)", () => {
  it("a person without the permission is refused AND audited: ids and codes only, never the input", async () => {
    const titular = actors.user({ roles: ["customer_service"], kind: "staff", mfaVerified: true });
    const origin = { ip: "203.0.113.7", userAgent: "test" };
    expect(await codeOf(decide({ secret: "do not log me" }, titular, { origin }))).toBe(
      "kernel.forbidden",
    );
    expect(port.entries).toEqual([
      {
        entry: {
          action: KERNEL_AUDIT.accessDenied,
          entityType: "operation",
          entityId: "test.denied.decide",
          data: {
            operation: "test.denied.decide",
            permission: "orders.review.decide",
            code: "kernel.forbidden",
          },
        },
        actorId: titular.id,
        origin,
      },
    ]);
    expect(JSON.stringify(port.entries)).not.toContain("do not log me");
    // K1: the refused call did no work of its own
    expect(await items()).toBe(0);
  });

  it("staff without a second factor: kernel.mfa_required, audited with that code", async () => {
    const owner = actors.user({ roles: ["owner"], kind: "staff", mfaVerified: false });
    expect(await codeOf(decide({ secret: "s" }, owner))).toBe("kernel.mfa_required");
    expect(port.entries.map((e) => e.entry.data?.["code"])).toEqual(["kernel.mfa_required"]);
  });

  it("a handler's own refusal is audited; its work rolls back; not-found stays unaudited", async () => {
    const pharmacist = actors.user({ roles: ["pharmacist"], kind: "staff", mfaVerified: true });
    expect(await codeOf(ownRequest({ code: "forbidden" }, pharmacist))).toBe("test.own_request");
    expect(port.entries.map((e) => e.entry.data)).toEqual([
      {
        operation: "test.denied.own",
        permission: "orders.review.decide",
        code: "test.own_request",
      },
    ]);
    expect(await items()).toBe(0);
    expect(await codeOf(ownRequest({ code: "not_found" }, pharmacist))).toBe("test.not_found");
    expect(port.entries).toHaveLength(1);
  });

  it("anonymous callers and system actors leave no entry; an allowed call leaves none either", async () => {
    expect(await codeOf(decide({ secret: "s" }, actors.anonymous()))).toBe("kernel.forbidden");
    expect(await codeOf(decide({ secret: "s" }, actors.system({ roles: [] })))).toBe(
      "kernel.forbidden",
    );
    const pharmacist = actors.user({ roles: ["pharmacist"], kind: "staff", mfaVerified: true });
    expect(await codeOf(decide({ secret: "s" }, pharmacist))).toBe("ok");
    expect(port.entries.map((e) => e.entry.action)).toEqual(["test.denied.decided"]);
    expect(await throttleRows()).toBe(0);
  });

  it("50 refusals in a minute leave one entry per (person, operation); the next minute one more", async () => {
    const a = actors.user({ roles: ["customer_service"], kind: "staff", mfaVerified: true });
    const b = actors.user({ roles: ["customer_service"], kind: "staff", mfaVerified: true });
    await Promise.all(Array.from({ length: 50 }, () => codeOf(decide({ secret: "s" }, a))));
    await codeOf(decide({ secret: "s" }, b));
    await codeOf(read({}, a));
    expect(port.entries.map((e) => [e.actorId === a.id ? "a" : "b", e.entry.entityId])).toEqual(
      expect.arrayContaining([
        ["a", "test.denied.decide"],
        ["b", "test.denied.decide"],
        ["a", "test.denied.read"],
      ]),
    );
    expect(port.entries).toHaveLength(3);
    kernel.clock.set(new Date("2026-11-01T10:01:05Z"));
    await codeOf(decide({ secret: "s" }, a));
    expect(port.entries).toHaveLength(4);
    // an hour later the old throttle rows are gone, removed by the next denied write
    kernel.clock.set(new Date("2026-11-01T11:30:00Z"));
    await codeOf(decide({ secret: "s" }, b));
    expect(await throttleRows()).toBe(1);
  });

  it("when the audit store fails, the refusal still stands and an alarm is logged", async () => {
    port.fail = true;
    const a = actors.user({ roles: ["customer_service"], kind: "staff", mfaVerified: true });
    expect(await codeOf(decide({ secret: "s" }, a))).toBe("kernel.forbidden");
    expect(kernel.errors).toEqual([
      expect.objectContaining({
        alarm: "kernel.denied_audit_failed",
        operation: "test.denied.decide",
        code: "kernel.forbidden",
      }),
    ]);
    // the failed write rolled back with its throttle row: the next refusal tries again
    expect(await throttleRows()).toBe(0);
  });
});
