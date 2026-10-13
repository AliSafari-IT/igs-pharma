// The art. 12(3) GDPR extension of a data-subject request's deadline (igs-pharma#88 C9) against real
// Postgres, with the RBAC catalogue from the database and the real audit port.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { type KernelTestHandles, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { loadRbacCatalogue } from "@igs/module-identity";
import { addBrusselsMonths } from "@igs/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createDsr,
  dsrDueAt,
  extendDsr,
  getDsr,
  listDsr,
  recordDsrExtensionNotice,
  registerAuditActions,
  transitionDsr,
} from "../src";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;
let clockNow: Date;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerAuditActions(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  clockNow = new Date();
  kernel.clock.set(clockNow);
});

const staff = (...roles: string[]): Actor => ({
  type: "user",
  id: randomUUID(),
  roles,
  kind: "staff",
  mfaVerified: true,
});
const owner = staff("owner");
const DAY = 86_400_000;

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

/** A request received `daysAgo` days before the test clock. */
const newRequest = async (daysAgo = 0) =>
  (
    await createDsr(
      {
        subjectRef: `ext.${randomUUID().slice(0, 8)}@example.be`,
        type: "access",
        channel: "email",
        receivedAt: new Date(clockNow.getTime() - daysAgo * DAY - 1000).toISOString(),
      },
      owner,
    )
  ).requestId;

const auditFor = (entityId: string) =>
  iso.sql<{ action: string; data: Record<string, unknown> }[]>`
    SELECT action, data FROM audit.events WHERE entity_id = ${entityId} ORDER BY seq`;

describe("privacy.dsr.extend (art. 12(3))", () => {
  it("moves the deadline by 1 or 2 calendar months, keeps the original, logs and audits a reason code", async () => {
    for (const months of [1, 2] as const) {
      const id = await newRequest(10);
      const original = (await getDsr({ requestId: id }, owner)).dueAt;
      const { dueAt } = await extendDsr({ requestId: id, months, reason: "complex" }, owner);
      expect(dueAt).toEqual(addBrusselsMonths(original, months));

      const view = await getDsr({ requestId: id }, owner);
      expect(view.dueAt).toEqual(dueAt);
      expect(view.extension).toEqual({
        originalDueAt: original,
        extendedAt: clockNow,
        months,
        reason: "complex",
        noticeAt: null,
        noticeInTime: false,
      });
      expect(view.canExtend).toBe(false);
      expect(view.status).toBe("received"); // the status does not change
      expect(view.events.map((e) => [e.kind, e.fromStatus, e.toStatus])).toEqual([
        ["status", null, "received"],
        ["extended", "received", "received"],
      ]);
      expect(await auditFor(id)).toEqual([
        expect.objectContaining({ action: "privacy.dsr.created" }),
        { action: "privacy.dsr.extended", data: { requestId: id, months, reason: "complex" } },
      ]);
    }
  });

  it("an extended request is overdue only after the NEW deadline", async () => {
    const id = await newRequest(20);
    await extendDsr({ requestId: id, months: 1, reason: "numerous" }, owner);
    // 15 days later: past the original deadline, before the extended one
    kernel.clock.set(new Date(clockNow.getTime() + 15 * DAY));
    const view = await getDsr({ requestId: id }, owner);
    expect(view.overdue).toBe(false);
    expect(view.daysLeft).toBeGreaterThan(0);
    const { overdueTotal } = await listDsr({ page: 1, pageSize: 100 }, owner);
    kernel.clock.set(new Date(clockNow.getTime() + 60 * DAY));
    expect((await getDsr({ requestId: id }, owner)).overdue).toBe(true);
    expect((await listDsr({ page: 1, pageSize: 100 }, owner)).overdueTotal).toBeGreaterThan(
      overdueTotal,
    );
  });

  it("only once, only while open, only before the original deadline", async () => {
    const once = await newRequest(1);
    await extendDsr({ requestId: once, months: 1, reason: "complex" }, owner);
    expect(await codeOf(extendDsr({ requestId: once, months: 1, reason: "complex" }, owner))).toBe(
      "privacy.dsr_already_extended",
    );

    const late = await newRequest(40); // its one-month deadline has passed
    expect(await codeOf(extendDsr({ requestId: late, months: 2, reason: "complex" }, owner))).toBe(
      "privacy.dsr_extension_too_late",
    );

    const closed = await newRequest(1);
    await transitionDsr({ requestId: closed, to: "rejected", note: "Not our customer" }, owner);
    expect(
      await codeOf(extendDsr({ requestId: closed, months: 1, reason: "complex" }, owner)),
    ).toBe("privacy.dsr_closed");

    expect(
      await codeOf(extendDsr({ requestId: randomUUID(), months: 1, reason: "complex" }, owner)),
    ).toBe("privacy.dsr_not_found");
    for (const input of [
      { requestId: once, months: 3, reason: "complex" },
      { requestId: once, months: 0, reason: "complex" },
      { requestId: once, months: 1, reason: "because I said so" },
    ]) {
      expect(await codeOf(extendDsr(input, owner))).toBe("kernel.validation_failed");
    }
    // none of the refusals wrote anything
    expect((await auditFor(late)).map((r) => r.action)).toEqual(["privacy.dsr.created"]);
  });

  it("the database refuses an inconsistent extension", async () => {
    const id = await newRequest(1);
    const dueDate = dsrDueAt(new Date(clockNow.getTime() - DAY - 1000));
    const due = dueDate.toISOString();
    const plus = (days: number) => new Date(dueDate.getTime() + days * DAY).toISOString();
    await expect(
      iso.sql`UPDATE privacy.dsr_requests SET extended_at = now() WHERE id = ${id}`,
    ).rejects.toThrow(/dsr_requests_extension_check/);
    await expect(
      iso.sql`UPDATE privacy.dsr_requests
        SET original_due_at = ${due}::timestamptz, extended_at = now(), extension_months = 3,
            extension_reason = 'complex', due_at = ${plus(90)}::timestamptz
        WHERE id = ${id}`,
    ).rejects.toThrow(/dsr_requests_extension_check/);
    await expect(
      iso.sql`UPDATE privacy.dsr_requests
        SET original_due_at = ${due}::timestamptz, extended_at = now(), extension_months = 1,
            extension_reason = 'other', due_at = ${plus(30)}::timestamptz
        WHERE id = ${id}`,
    ).rejects.toThrow(/dsr_requests_extension_reason_check/);
  });

  it("closing an extended request in time shows as answered in time", async () => {
    const id = await newRequest(5);
    await extendDsr({ requestId: id, months: 2, reason: "complex" }, owner);
    kernel.clock.set(new Date(clockNow.getTime() + 45 * DAY));
    await transitionDsr({ requestId: id, to: "in_progress" }, owner);
    await transitionDsr({ requestId: id, to: "completed" }, owner);
    expect((await getDsr({ requestId: id }, owner)).answeredInTime).toBe(true);

    const slow = await newRequest(40);
    await transitionDsr({ requestId: slow, to: "rejected", note: "Late" }, owner);
    expect((await getDsr({ requestId: slow }, owner)).answeredInTime).toBe(false);
    expect((await getDsr({ requestId: await newRequest(1) }, owner)).answeredInTime).toBeNull();
  });
});

describe("privacy.dsr.extension_notice.record", () => {
  it("records when the person was told, in time when by the original deadline; logged and audited", async () => {
    const id = await newRequest(3);
    await extendDsr({ requestId: id, months: 1, reason: "numerous" }, owner);
    const sentAt = new Date(clockNow.getTime() - 60_000);
    await recordDsrExtensionNotice({ requestId: id, sentAt: sentAt.toISOString() }, owner);

    const view = await getDsr({ requestId: id }, owner);
    expect(view.extension?.noticeAt).toEqual(sentAt);
    expect(view.extension?.noticeInTime).toBe(true);
    expect(view.events.at(-1)?.kind).toBe("notice_sent");
    expect((await auditFor(id)).at(-1)).toEqual({
      action: "privacy.dsr.extension_notice_recorded",
      data: { requestId: id },
    });
  });

  it("a notice recorded after the original deadline is not in time", async () => {
    const id = await newRequest(25);
    await extendDsr({ requestId: id, months: 2, reason: "complex" }, owner);
    kernel.clock.set(new Date(clockNow.getTime() + 20 * DAY));
    await recordDsrExtensionNotice(
      { requestId: id, sentAt: new Date(clockNow.getTime() + 19 * DAY).toISOString() },
      owner,
    );
    expect((await getDsr({ requestId: id }, owner)).extension?.noticeInTime).toBe(false);
  });

  it("only for an extended request, once, with a date between receipt and now", async () => {
    const plain = await newRequest(2);
    const now = clockNow.toISOString();
    expect(await codeOf(recordDsrExtensionNotice({ requestId: plain, sentAt: now }, owner))).toBe(
      "privacy.dsr_not_extended",
    );
    const id = await newRequest(2);
    await extendDsr({ requestId: id, months: 1, reason: "complex" }, owner);
    for (const sentAt of [
      new Date(clockNow.getTime() + DAY).toISOString(), // the future
      new Date(clockNow.getTime() - 10 * DAY).toISOString(), // before the request arrived
    ]) {
      expect(await codeOf(recordDsrExtensionNotice({ requestId: id, sentAt }, owner))).toBe(
        "privacy.dsr_notice_date_invalid",
      );
    }
    await recordDsrExtensionNotice({ requestId: id, sentAt: now }, owner);
    expect(await codeOf(recordDsrExtensionNotice({ requestId: id, sentAt: now }, owner))).toBe(
      "privacy.dsr_notice_already_recorded",
    );
  });
});

describe("permissions", () => {
  it("only privacy.dsr.manage may extend or record a notice", async () => {
    const id = await newRequest(1);
    const assistant = staff("pharmacy_assistant");
    expect(
      await codeOf(extendDsr({ requestId: id, months: 1, reason: "complex" }, assistant)),
    ).toBe("kernel.forbidden");
    expect(
      await codeOf(
        recordDsrExtensionNotice({ requestId: id, sentAt: clockNow.toISOString() }, assistant),
      ),
    ).toBe("kernel.forbidden");
  });
});
