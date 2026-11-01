// igs-pharma#114 PR 3: a customer's own consents and data requests. The subject is the customer's
// e-mail, read from their account; nothing in the input names a subject, so one customer can never
// read or write another's ledger. Real Postgres, RBAC catalogue from the database, real audit port.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { isDomainError } from "@igs/kernel";
import { type KernelTestHandles, actors, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { identitySchema, loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  dsrDueAt,
  getConsents,
  getOwnConsents,
  listOwnDsr,
  recordOwnConsent,
  registerAuditActions,
  requestOwnDsr,
  transitionDsr,
} from "../src";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;
// The audit trail only has partitions for the current UTC month and the next few, so the test clock
// must follow the real month (a fixed date broke on the first day of the next month).
const today = new Date();
const NOW = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 14, 12));

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
  kernel.clock.set(NOW);
});

async function customer(status: "active" | "suspended" = "active") {
  const email = `Demo.${crypto.randomUUID().slice(0, 8)}@Example.be`;
  const [user] = await iso.db
    .insert(identitySchema.users)
    .values({ name: "Customer", email, status })
    .returning({ id: identitySchema.users.id });
  if (!user) throw new Error("insert failed");
  return {
    id: user.id,
    subjectRef: email.toLowerCase(),
    actor: actors.user({ id: user.id, roles: ["customer"], kind: "customer" }),
  };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

const staff = actors.user({ roles: ["owner"], kind: "staff" });

describe("privacy.self.consent", () => {
  it("records a consent against the customer's own e-mail, from the storefront", async () => {
    const { actor, subjectRef, id } = await customer();
    await recordOwnConsent(
      { purpose: "marketing_email", granted: true, policyVersion: "2026-10" },
      actor,
    );
    const rows = await iso.sql<{ subject_ref: string; source: string; actor_id: string }[]>`
      SELECT subject_ref, source, actor_id FROM privacy.consent_events WHERE subject_ref = ${subjectRef}`;
    expect(rows).toEqual([{ subject_ref: subjectRef, source: "storefront", actor_id: id }]);
  });

  it("shows the latest state per purpose, and only the customer's own", async () => {
    const mine = await customer();
    const other = await customer();
    const give = (granted: boolean) =>
      recordOwnConsent(
        { purpose: "marketing_email", granted, policyVersion: "2026-10" },
        mine.actor,
      );
    await give(true);
    kernel.clock.set(new Date(NOW.getTime() + 1000));
    await give(false);
    await recordOwnConsent(
      { purpose: "marketing_email", granted: true, policyVersion: "2026-10" },
      other.actor,
    );

    const own = await getOwnConsents({}, mine.actor);
    expect(own.subjectRef).toBe(mine.subjectRef);
    expect(own.purposes.find((p) => p.purpose === "marketing_email")?.current?.granted).toBe(false);
    expect(own.history).toHaveLength(2);
    // staff see the same ledger through the back-office query
    const seen = await getConsents({ subjectRef: mine.subjectRef }, staff);
    expect(seen.history).toHaveLength(2);
  });

  it("staff cannot use the self commands, a suspended customer finds nothing", async () => {
    const input = { purpose: "marketing_email", granted: true, policyVersion: "2026-10" } as const;
    expect(await codeOf(recordOwnConsent(input, staff))).toBe("kernel.forbidden");
    expect(await codeOf(getOwnConsents({}, staff))).toBe("kernel.forbidden");
    const { actor } = await customer("suspended");
    expect(await codeOf(recordOwnConsent(input, actor))).toBe("identity.user_not_found");
  });

  it("an unknown purpose is a validation error", async () => {
    const { actor } = await customer();
    expect(
      await codeOf(recordOwnConsent({ purpose: "nope", granted: true, policyVersion: "1" }, actor)),
    ).toBe("kernel.validation_failed");
  });
});

describe("privacy.self.dsr", () => {
  it("files a request on the account channel with a one-month deadline, audited without PII", async () => {
    const { actor, subjectRef } = await customer();
    const { requestId } = await requestOwnDsr({ type: "erasure" }, actor);

    const [row] = await iso.sql<
      { subject_ref: string; type: string; channel: string; status: string; due_at: string }[]
    >`SELECT subject_ref, type, channel, status, due_at FROM privacy.dsr_requests WHERE id = ${requestId}`;
    expect(row).toMatchObject({
      subject_ref: subjectRef,
      type: "erasure",
      channel: "account",
      status: "received",
    });
    expect(new Date(row?.due_at ?? 0).getTime()).toBe(dsrDueAt(NOW).getTime());

    const audit = await iso.sql<{ action: string; data: Record<string, unknown> }[]>`
      SELECT action, data FROM audit.events WHERE entity_id = ${requestId}`;
    expect(audit).toEqual([
      {
        action: "privacy.dsr.created",
        data: { requestId, type: "erasure", channel: "account" },
      },
    ]);
    expect(JSON.stringify(audit)).not.toContain(subjectRef);
  });

  it("only a copy of the data (access) or erasure can be asked for here", async () => {
    const { actor } = await customer();
    for (const type of ["rectification", "restriction", "objection", "nope"]) {
      expect(await codeOf(requestOwnDsr({ type }, actor)), type).toBe("kernel.validation_failed");
    }
    expect(await codeOf(requestOwnDsr({ type: "access" }, actor))).toBe("ok");
  });

  it("a second open request of the same type is a conflict until staff close the first", async () => {
    const { actor } = await customer();
    const { requestId } = await requestOwnDsr({ type: "erasure" }, actor);
    expect(await codeOf(requestOwnDsr({ type: "erasure" }, actor))).toBe(
      "privacy.dsr_already_open",
    );
    // another type is a separate request
    expect(await codeOf(requestOwnDsr({ type: "access" }, actor))).toBe("ok");

    await transitionDsr({ requestId, to: "rejected", note: "test" }, staff);
    expect(await codeOf(requestOwnDsr({ type: "erasure" }, actor))).toBe("ok");
  });

  it("lists only the customer's own requests, newest first", async () => {
    const mine = await customer();
    const other = await customer();
    await requestOwnDsr({ type: "access" }, mine.actor);
    kernel.clock.set(new Date(NOW.getTime() + 1000));
    await requestOwnDsr({ type: "erasure" }, mine.actor);
    await requestOwnDsr({ type: "erasure" }, other.actor);

    const own = await listOwnDsr({}, mine.actor);
    expect(own.map((r) => r.type)).toEqual(["erasure", "access"]);
    expect(own.every((r) => r.status === "received")).toBe(true);
  });

  it("is refused to staff and anonymous visitors", async () => {
    expect(await codeOf(requestOwnDsr({ type: "access" }, staff))).toBe("kernel.forbidden");
    expect(await codeOf(requestOwnDsr({ type: "access" }, actors.anonymous()))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(listOwnDsr({}, staff))).toBe("kernel.forbidden");
  });
});
