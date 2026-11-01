// igs-pharma#220: reading the audit trail in the back-office, against real Postgres: filters, order,
// paging, the window and its cap, and who may read it.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { isDomainError } from "@igs/kernel";
import { actors, configureKernelForTests, resetKernelForTests } from "@igs/kernel/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AUDIT_MAX_WINDOW_DAYS,
  type AuditEvent,
  DENIED_ACTION,
  listAuditEvents,
  record,
  registerAuditAction,
} from "../src";
import { resetAuditActions } from "../src/actions";

let iso: IsolatedDatabase;
const DAY = 24 * 60 * 60 * 1000;
// the trail has partitions from the current UTC month on: the test clock follows the real month
const month = new Date();
const at = (day: number, hour = 12) =>
  new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day, hour));

const owner = actors.user({ id: "owner-1", roles: ["owner"], kind: "staff" });

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  resetAuditActions();
  registerAuditAction("identity.early_access.approved", z.object({ requestId: z.string() }));
  registerAuditAction("identity.early_access.rejected", z.object({ requestId: z.string() }));
  registerAuditAction("pricing.price.set", z.object({ productId: z.string() }));
  registerAuditAction(
    DENIED_ACTION,
    z.object({ operation: z.string(), permission: z.string(), code: z.string() }),
  );
  const append = (event: AuditEvent) =>
    iso.db.transaction((tx) => record(tx, event, { hmacKey: "k".repeat(32) }));
  const alice = { type: "user", id: "alice" } as const;
  const bob = { type: "user", id: "bob" } as const;
  await append({
    at: at(2),
    actor: alice,
    action: "identity.early_access.approved",
    entityType: "early_access_request",
    entityId: "r-1",
    data: { requestId: "r-1" },
  });
  await append({
    at: at(3),
    actor: bob,
    action: "identity.early_access.rejected",
    entityType: "early_access_request",
    entityId: "r-2",
    data: { requestId: "r-2" },
    origin: { ip: "203.0.113.9", userAgent: "test" },
  });
  await append({
    at: at(4),
    actor: alice,
    action: "pricing.price.set",
    entityType: "product",
    entityId: "p-1",
    data: { productId: "p-1" },
  });
  await append({
    at: at(5),
    actor: bob,
    action: DENIED_ACTION,
    entityType: "operation",
    entityId: "identity.early_access.approve",
    data: {
      operation: "identity.early_access.approve",
      permission: "storefront.early_access.manage",
      code: "kernel.forbidden",
    },
  });
});
afterAll(async () => {
  resetKernelForTests();
  await iso?.drop();
});
beforeEach(() => {
  configureKernelForTests({ db: iso.db });
});

const window = { from: at(1, 0), to: at(10, 0) };
const actions = (page: { items: readonly { action: string }[] }) => page.items.map((i) => i.action);
const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

describe("listAuditEvents (igs-pharma#220)", () => {
  it("lists the window newest first, with the data and whether an origin was stored", async () => {
    const page = await listAuditEvents(window, owner);
    expect(actions(page)).toEqual([
      DENIED_ACTION,
      "pricing.price.set",
      "identity.early_access.rejected",
      "identity.early_access.approved",
    ]);
    expect(page.hasMore).toBe(false);
    const rejected = page.items.find((i) => i.action === "identity.early_access.rejected");
    expect(rejected).toMatchObject({
      actorType: "user",
      actorId: "bob",
      entityType: "early_access_request",
      entityId: "r-2",
      data: { requestId: "r-2" },
      hasOrigin: true,
    });
    expect(page.items.find((i) => i.action === "pricing.price.set")?.hasOrigin).toBe(false);
  });

  it("filters by exact action, action prefix, who and entity", async () => {
    expect(actions(await listAuditEvents({ ...window, action: DENIED_ACTION }, owner))).toEqual([
      DENIED_ACTION,
    ]);
    expect(
      actions(await listAuditEvents({ ...window, action: "identity.early_access." }, owner)),
    ).toEqual(["identity.early_access.rejected", "identity.early_access.approved"]);
    // "identity.early_access" without the dot is an exact action: none is called that
    expect(
      actions(await listAuditEvents({ ...window, action: "identity.early_access" }, owner)),
    ).toEqual([]);
    expect(actions(await listAuditEvents({ ...window, actorId: "alice" }, owner))).toEqual([
      "pricing.price.set",
      "identity.early_access.approved",
    ]);
    expect(actions(await listAuditEvents({ ...window, entityId: "r-2" }, owner))).toEqual([
      "identity.early_access.rejected",
    ]);
  });

  it("keeps to the window: the end is excluded", async () => {
    expect(actions(await listAuditEvents({ from: at(3, 0), to: at(5, 0) }, owner))).toEqual([
      "pricing.price.set",
      "identity.early_access.rejected",
    ]);
  });

  it("pages: hasMore says whether an older page exists", async () => {
    const first = await listAuditEvents({ ...window, pageSize: 3 }, owner);
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const second = await listAuditEvents({ ...window, pageSize: 3, page: 2 }, owner);
    expect(actions(second)).toEqual(["identity.early_access.approved"]);
    expect(second.hasMore).toBe(false);
  });

  it("refuses a window over a year, a reversed one, a bad action and a page too big", async () => {
    const wide = {
      from: at(1, 0),
      to: new Date(at(1, 0).getTime() + (AUDIT_MAX_WINDOW_DAYS + 1) * DAY),
    };
    expect(await codeOf(listAuditEvents(wide, owner))).toBe("kernel.validation_failed");
    expect(await codeOf(listAuditEvents({ from: at(5), to: at(4) }, owner))).toBe(
      "kernel.validation_failed",
    );
    expect(await codeOf(listAuditEvents({ ...window, action: "x%' OR 1=1" }, owner))).toBe(
      "kernel.validation_failed",
    );
    expect(await codeOf(listAuditEvents({ ...window, pageSize: 101 }, owner))).toBe(
      "kernel.validation_failed",
    );
  });

  it("only the owner reads the trail", async () => {
    for (const actor of [
      actors.user({ roles: ["pharmacist_titular"], kind: "staff" }),
      actors.user({ roles: ["customer_service"], kind: "staff" }),
      actors.user({ roles: ["customer"], kind: "customer" }),
      actors.anonymous(),
    ]) {
      expect(await codeOf(listAuditEvents(window, actor))).toBe("kernel.forbidden");
    }
  });
});
