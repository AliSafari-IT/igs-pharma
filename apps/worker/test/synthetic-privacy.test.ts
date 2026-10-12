// The demo privacy data of the synthetic seed (igs-pharma#58) against real Postgres, through the
// kernel as the seed CLI's system actor, with the RBAC catalogue loaded from the database. Each test
// gets its own database, so they pass in any order or alone.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import type { Actor } from "@igs/kernel";
import { configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { loadRbacCatalogue } from "@igs/module-identity";
import {
  createDsr,
  getConsents,
  getDsr,
  listDsr,
  recordConsent,
  registerAuditActions,
  transitionDsr,
} from "@igs/module-privacy";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SEED_ACTOR } from "../src/synthetic-catalog";
import { DEMO_CONSENTS, DEMO_REQUESTS, seedSyntheticPrivacy } from "../src/synthetic-privacy";

let iso: IsolatedDatabase;

beforeAll(async () => {
  registerAuditActions(registerAuditAction);
  // the catalogue is installed once per process; every migrated database holds the same rows
  const first = await createIsolatedDatabase();
  await loadRbacCatalogue(first.db);
  await first.drop();
});
beforeEach(async () => {
  iso = await createIsolatedDatabase();
  const kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date()); // audit partitions exist around "now"
});
afterEach(async () => {
  await iso?.drop();
});

const owner: Actor = {
  type: "user",
  id: randomUUID(),
  roles: ["owner"],
  kind: "staff",
  mfaVerified: true,
};

const erasure = DEMO_REQUESTS.find((r) => r.type === "erasure");
const objection = "demo.objection@example.invalid";
const DAY = 86_400_000;

describe("seedSyntheticPrivacy", () => {
  it("loads three demo requests, one overdue, and the demo consents; a second run changes nothing", async () => {
    expect(await seedSyntheticPrivacy()).toEqual({
      requests: 3,
      consents: 4,
      resumed: 0,
      skipped: 0,
    });
    const page = await listDsr({ pageSize: 100 }, SEED_ACTOR);
    expect(page.total).toBe(DEMO_REQUESTS.length);
    expect(page.overdueTotal).toBe(1);
    expect(page.items[0]).toMatchObject({
      subjectRef: "demo.erasure@example.invalid",
      type: "erasure",
      status: "in_progress",
      overdue: true,
    });
    const consents = await getConsents({ subjectRef: objection }, SEED_ACTOR);
    expect(consents.purposes.map((p) => [p.purpose, p.current?.granted])).toEqual([
      ["marketing_email", false],
      ["analytics_cookies", true],
    ]);

    expect(await seedSyntheticPrivacy()).toEqual({
      requests: 0,
      consents: 0,
      resumed: 0,
      skipped: 5,
    });
    expect((await listDsr({}, SEED_ACTOR)).total).toBe(DEMO_REQUESTS.length);
  });

  it("finishes what an interrupted run left undone", async () => {
    // a run that stopped after creating the erasure request and the first consent event
    if (!erasure) throw new Error("no erasure demo request");
    await createDsr(
      {
        subjectRef: erasure.subjectRef,
        type: erasure.type,
        channel: erasure.channel,
        receivedAt: new Date(Date.now() - erasure.daysAgo * DAY).toISOString(),
        note: erasure.note,
      },
      SEED_ACTOR,
    );
    const [first] = DEMO_CONSENTS.filter((c) => c.subjectRef === objection);
    if (!first) throw new Error("no demo consent");
    await recordConsent({ ...first, policyVersion: "2026-10" }, SEED_ACTOR);

    expect(await seedSyntheticPrivacy()).toEqual({
      requests: 2,
      consents: 3,
      resumed: 2,
      skipped: 0,
    });
    const [request] = (await listDsr({ subjectRef: erasure.subjectRef }, SEED_ACTOR)).items;
    expect(request).toMatchObject({ status: "in_progress", overdue: true });
    const consents = await getConsents({ subjectRef: objection }, SEED_ACTOR);
    expect(consents.history).toHaveLength(3);
    expect(consents.purposes.map((p) => [p.purpose, p.current?.granted])).toEqual([
      ["marketing_email", false],
      ["analytics_cookies", true],
    ]);
  });

  it("leaves demo records that staff changed alone", async () => {
    await seedSyntheticPrivacy();
    // staff close the overdue request and record a consent for a demo person
    const [request] = (await listDsr({ subjectRef: "demo.erasure@example.invalid" }, owner)).items;
    if (!request) throw new Error("no demo request");
    await transitionDsr({ requestId: request.id, to: "completed", note: "Done" }, owner);
    await recordConsent(
      {
        subjectRef: objection,
        purpose: "analytics_cookies",
        granted: false,
        policyVersion: "2026-10",
        source: "phone",
      },
      owner,
    );

    expect(await seedSyntheticPrivacy()).toMatchObject({ requests: 0, consents: 0, resumed: 0 });
    expect((await getDsr({ requestId: request.id }, owner)).status).toBe("completed");
    const consents = await getConsents({ subjectRef: objection }, owner);
    expect(consents.history).toHaveLength(4);
    expect(consents.purposes.find((p) => p.purpose === "analytics_cookies")?.current?.granted).toBe(
      false,
    );
  });
});
