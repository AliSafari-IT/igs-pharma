// Privacy commands and queries (igs-pharma#58) against real Postgres, with the RBAC catalogue
// loaded from the database and the real audit port, so permissions and audit shapes are exercised.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { type KernelTestHandles, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  type DsrStatus,
  createDsr,
  dsrDueAt,
  getConsents,
  getDsr,
  listDsr,
  recordConsent,
  registerAuditActions,
  transitionDsr,
} from "../src";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;
/** The kernel's clock for the current test: requests are "received" relative to it, not to the wall clock. */
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
  kernel.clock.set(clockNow); // audit partitions exist around "now"
});

const staff = (...roles: string[]): Actor => ({
  type: "user",
  id: randomUUID(),
  roles,
  kind: "staff",
  mfaVerified: true,
});

const owner = staff("owner");

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

const subject = () => `Demo.${randomUUID().slice(0, 8)}@Example.be`;
const DAY = 86_400_000;

const newRequest = async (overrides: Record<string, unknown> = {}) =>
  (
    await createDsr(
      {
        subjectRef: subject(),
        type: "erasure",
        channel: "email",
        // a second before the test clock, however long the test has run on the wall clock
        receivedAt: new Date(clockNow.getTime() - 1000).toISOString(),
        ...overrides,
      },
      owner,
    )
  ).requestId;

const auditFor = (entityId: string) =>
  iso.sql<{ action: string; data: Record<string, unknown> }[]>`
    SELECT action, data FROM audit.events WHERE entity_id = ${entityId} ORDER BY seq`;

describe("privacy.consent", () => {
  it("the current consent per purpose is the latest event; history keeps every event", async () => {
    const ref = subject();
    const record = (granted: boolean, purpose = "marketing_email") =>
      recordConsent(
        { subjectRef: ref, purpose, granted, policyVersion: "2026-10", source: "in_store" },
        owner,
      );
    await record(true);
    kernel.clock.set(new Date(Date.now() + 1000));
    await record(false);
    kernel.clock.set(new Date(Date.now() + 2000));
    await record(true, "analytics_cookies");

    // the e-mail address is matched case-insensitively
    const consents = await getConsents({ subjectRef: ref.toUpperCase() }, owner);
    expect(consents.subjectRef).toBe(ref.toLowerCase());
    expect(consents.purposes.map((p) => [p.purpose, p.current?.granted])).toEqual([
      ["marketing_email", false],
      ["analytics_cookies", true],
    ]);
    expect(consents.history.map((e) => [e.purpose, e.granted])).toEqual([
      ["analytics_cookies", true],
      ["marketing_email", false],
      ["marketing_email", true],
    ]);
    const empty = await getConsents({ subjectRef: subject() }, owner);
    expect(empty.purposes.every((p) => p.current === null)).toBe(true);
  });

  it("audits identifiers only, never the e-mail address", async () => {
    const ref = subject();
    const { consentEventId } = await recordConsent(
      {
        subjectRef: ref,
        purpose: "marketing_email",
        granted: true,
        policyVersion: "2026-10",
        source: "phone",
      },
      owner,
    );
    const [event] = await auditFor(consentEventId);
    expect(event).toEqual({
      action: "privacy.consent.recorded",
      data: { consentEventId, purpose: "marketing_email", granted: true, source: "phone" },
    });
    expect(JSON.stringify(event)).not.toContain(ref.toLowerCase().split("@")[0]);
  });

  it("refuses an invalid subject reference", async () => {
    expect(
      await codeOf(
        recordConsent(
          {
            subjectRef: "not-an-email",
            purpose: "marketing_email",
            granted: true,
            policyVersion: "2026-10",
            source: "phone",
          },
          owner,
        ),
      ),
    ).toBe("privacy.subject_ref_invalid");
    expect(await codeOf(getConsents({ subjectRef: "nope" }, owner))).toBe(
      "privacy.subject_ref_invalid",
    );
  });
});

describe("append-only ledgers", () => {
  it("refuses to change or remove a consent event or a request event", async () => {
    const ref = subject().toLowerCase();
    await recordConsent(
      {
        subjectRef: ref,
        purpose: "marketing_email",
        granted: true,
        policyVersion: "2026-10",
        source: "back_office",
      },
      owner,
    );
    await expect(
      iso.sql`UPDATE privacy.consent_events SET granted = false WHERE subject_ref = ${ref}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      iso.sql`DELETE FROM privacy.consent_events WHERE subject_ref = ${ref}`,
    ).rejects.toThrow(/append-only/);
    await expect(iso.sql`TRUNCATE privacy.consent_events`).rejects.toThrow(/append-only/);

    const requestId = await newRequest();
    await expect(
      iso.sql`UPDATE privacy.dsr_events SET note = 'x' WHERE request_id = ${requestId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      iso.sql`DELETE FROM privacy.dsr_events WHERE request_id = ${requestId}`,
    ).rejects.toThrow(/append-only/);
  });
});

describe("privacy.dsr.create", () => {
  it("stores the end of February for a request received on 31 January (clamped, Brussels time)", async () => {
    const { requestId } = await createDsr(
      {
        subjectRef: subject(),
        type: "access",
        channel: "post",
        receivedAt: "2026-01-31T09:00:00Z", // 10:00 in Brussels
      },
      owner,
    );
    const request = await getDsr({ requestId }, owner);
    expect(request.dueAt.toISOString()).toBe("2026-02-28T09:00:00.000Z");
  });

  it("is due one calendar month after receipt, starts as received, and audits identifiers only", async () => {
    // one clock for the command and the query, so the days left are exact
    const now = new Date();
    kernel.clock.set(now);
    const receivedAt = new Date(now.getTime() - 3 * DAY);
    const ref = subject();
    const { requestId } = await createDsr(
      {
        subjectRef: ref,
        type: "access",
        channel: "post",
        receivedAt: receivedAt.toISOString(),
        note: "Letter dated 9 October",
      },
      owner,
    );
    const request = await getDsr({ requestId }, owner);
    expect(request).toMatchObject({
      subjectRef: ref.toLowerCase(),
      type: "access",
      channel: "post",
      status: "received",
      overdue: false,
      daysLeft: Math.ceil((dsrDueAt(receivedAt).getTime() - now.getTime()) / DAY),
      nextStatuses: ["in_progress", "rejected"],
    });
    expect(request.dueAt).toEqual(dsrDueAt(receivedAt));
    expect(request.events.map((e) => [e.fromStatus, e.toStatus])).toEqual([[null, "received"]]);
    expect(await auditFor(requestId)).toEqual([
      {
        action: "privacy.dsr.created",
        data: { requestId, type: "access", channel: "post" },
      },
    ]);
  });

  it("refuses a receipt date in the future and an invalid subject", async () => {
    expect(
      await codeOf(newRequest({ receivedAt: new Date(Date.now() + 2 * DAY).toISOString() })),
    ).toBe("privacy.received_at_invalid");
    expect(await codeOf(newRequest({ subjectRef: "jan" }))).toBe("privacy.subject_ref_invalid");
  });
});

describe("privacy.dsr.transition", () => {
  it("received → in_progress → completed, with the timeline and audit rows", async () => {
    const requestId = await newRequest();
    await transitionDsr({ requestId, to: "in_progress" }, owner);
    await transitionDsr({ requestId, to: "completed", note: "Data erased" }, owner);
    const request = await getDsr({ requestId }, owner);
    expect(request).toMatchObject({
      status: "completed",
      closedReason: "Data erased",
      daysLeft: null,
      nextStatuses: [],
    });
    expect(request.closedAt).toBeInstanceOf(Date);
    expect(request.events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      [null, "received"],
      ["received", "in_progress"],
      ["in_progress", "completed"],
    ]);
    expect((await auditFor(requestId)).map((e) => [e.action, e.data["to"] ?? null])).toEqual([
      ["privacy.dsr.created", null],
      ["privacy.dsr.transitioned", "in_progress"],
      ["privacy.dsr.transitioned", "completed"],
    ]);
  });

  it("refuses every move outside the allowed ones", async () => {
    const at = async (status: DsrStatus) => {
      const requestId = await newRequest();
      if (status === "in_progress" || status === "completed") {
        await transitionDsr({ requestId, to: "in_progress" }, owner);
      }
      if (status === "completed") await transitionDsr({ requestId, to: "completed" }, owner);
      if (status === "rejected") {
        await transitionDsr({ requestId, to: "rejected", note: "Not our customer" }, owner);
      }
      return requestId;
    };
    const refused: [DsrStatus, DsrStatus][] = [
      ["received", "received"],
      ["received", "completed"],
      ["in_progress", "received"],
      ["in_progress", "in_progress"],
      ["completed", "received"],
      ["completed", "in_progress"],
      ["completed", "rejected"],
      ["rejected", "received"],
      ["rejected", "in_progress"],
      ["rejected", "completed"],
    ];
    for (const [from, to] of refused) {
      const requestId = await at(from);
      expect(
        await codeOf(transitionDsr({ requestId, to, note: "reason" }, owner)),
        `${from} → ${to}`,
      ).toBe("privacy.dsr_invalid_transition");
    }
  });

  it("rejecting needs a reason; from received and from in_progress", async () => {
    const fromReceived = await newRequest();
    expect(await codeOf(transitionDsr({ requestId: fromReceived, to: "rejected" }, owner))).toBe(
      "privacy.dsr_reason_required",
    );
    expect(
      await codeOf(transitionDsr({ requestId: fromReceived, to: "rejected", note: "  " }, owner)),
    ).toBe("privacy.dsr_reason_required");
    await transitionDsr(
      { requestId: fromReceived, to: "rejected", note: "Identity not proven" },
      owner,
    );
    expect(await getDsr({ requestId: fromReceived }, owner)).toMatchObject({
      status: "rejected",
      closedReason: "Identity not proven",
    });

    const fromInProgress = await newRequest();
    await transitionDsr({ requestId: fromInProgress, to: "in_progress" }, owner);
    await transitionDsr(
      { requestId: fromInProgress, to: "rejected", note: "Manifestly unfounded" },
      owner,
    );
    expect((await getDsr({ requestId: fromInProgress }, owner)).status).toBe("rejected");
  });

  it("an unknown request is not found", async () => {
    expect(await codeOf(transitionDsr({ requestId: randomUUID(), to: "in_progress" }, owner))).toBe(
      "privacy.dsr_not_found",
    );
  });
});

describe("privacy.dsr.list", () => {
  it("puts overdue requests first, then open ones by deadline, then closed ones", async () => {
    const overdue = await newRequest({
      receivedAt: new Date(Date.now() - 35 * DAY).toISOString(),
    });
    const soon = await newRequest({ receivedAt: new Date(Date.now() - 20 * DAY).toISOString() });
    const closed = await newRequest({
      receivedAt: new Date(Date.now() - 40 * DAY).toISOString(),
    });
    await transitionDsr({ requestId: closed, to: "rejected", note: "Duplicate" }, owner);

    const page = await listDsr({ pageSize: 100 }, owner);
    const ids = page.items.map((i) => i.id);
    expect(ids.indexOf(overdue)).toBeLessThan(ids.indexOf(soon));
    expect(ids.indexOf(soon)).toBeLessThan(ids.indexOf(closed));
    const first = page.items.find((i) => i.id === overdue);
    expect(first?.overdue).toBe(true);
    // 5 days past the deadline, less the milliseconds between the test clock and the request
    expect(first?.daysLeft).toBeGreaterThanOrEqual(-5);
    expect(first?.daysLeft).toBeLessThanOrEqual(-4);
    expect(page.items.find((i) => i.id === closed)).toMatchObject({
      overdue: false,
      daysLeft: null,
    });
    expect(page.overdueTotal).toBeGreaterThanOrEqual(1);

    const rejected = await listDsr({ status: "rejected", pageSize: 100 }, owner);
    expect(rejected.items.every((i) => i.status === "rejected")).toBe(true);
    expect(rejected.items.map((i) => i.id)).toContain(closed);
    const ref = subject();
    const mine = await newRequest({ subjectRef: ref });
    const byPerson = await listDsr({ subjectRef: ` ${ref.toUpperCase()} ` }, owner);
    expect(byPerson.items.map((i) => i.id)).toEqual([mine]);
    expect(await codeOf(listDsr({ subjectRef: "nope" }, owner))).toBe(
      "privacy.subject_ref_invalid",
    );
    const access = await listDsr({ type: "access", pageSize: 100 }, owner);
    expect(access.items.every((i) => i.type === "access")).toBe(true);
  });
});

describe("permissions", () => {
  it("only the owner (and the seed CLI) can read or manage the privacy register", async () => {
    const requestId = await newRequest();
    const seed: Actor = { type: "system", id: "seed-catalog", roles: ["system_seed"] };
    await expect(listDsr({}, seed)).resolves.toBeDefined();
    for (const role of [
      "pharmacist_titular",
      "pharmacist",
      "pharmacy_assistant",
      "customer_service",
      "content_editor",
    ]) {
      const actor = staff(role);
      expect(await codeOf(listDsr({}, actor)), role).toBe("kernel.forbidden");
      expect(await codeOf(getDsr({ requestId }, actor)), role).toBe("kernel.forbidden");
      expect(await codeOf(transitionDsr({ requestId, to: "in_progress" }, actor)), role).toBe(
        "kernel.forbidden",
      );
      expect(await codeOf(getConsents({ subjectRef: subject() }, actor)), role).toBe(
        "kernel.forbidden",
      );
      expect(
        await codeOf(
          recordConsent(
            {
              subjectRef: subject(),
              purpose: "marketing_email",
              granted: true,
              policyVersion: "2026-10",
              source: "phone",
            },
            actor,
          ),
        ),
        role,
      ).toBe("kernel.forbidden");
    }
    const noMfa: Actor = { ...owner, mfaVerified: false } as Actor;
    expect(await codeOf(listDsr({}, noMfa))).toBe("kernel.mfa_required");
  });
});
