// The demo privacy data of the synthetic seed (igs-pharma#58) against real Postgres, through the
// kernel as the seed CLI's system actor, with the RBAC catalogue loaded from the database.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { loadRbacCatalogue } from "@igs/module-identity";
import { getConsents, listDsr, registerAuditActions } from "@igs/module-privacy";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SEED_ACTOR } from "../src/synthetic-catalog";
import { DEMO_REQUESTS, seedSyntheticPrivacy } from "../src/synthetic-privacy";

let iso: IsolatedDatabase;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerAuditActions(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  const kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date()); // audit partitions exist around "now"
});

describe("seedSyntheticPrivacy", () => {
  it("loads three demo requests, one overdue, and the demo consents", async () => {
    expect(await seedSyntheticPrivacy()).toEqual({ requests: 3, consents: 4, skipped: 0 });
    const page = await listDsr({ pageSize: 100 }, SEED_ACTOR);
    expect(page.total).toBe(DEMO_REQUESTS.length);
    expect(page.overdueTotal).toBe(1);
    expect(page.items[0]).toMatchObject({
      subjectRef: "demo.erasure@example.invalid",
      type: "erasure",
      status: "in_progress",
      overdue: true,
    });
    const objection = await getConsents(
      { subjectRef: "demo.objection@example.invalid" },
      SEED_ACTOR,
    );
    expect(objection.purposes.map((p) => [p.purpose, p.current?.granted])).toEqual([
      ["marketing_email", false],
      ["analytics_cookies", true],
    ]);
  });

  it("changes nothing on a second run", async () => {
    expect(await seedSyntheticPrivacy()).toEqual({ requests: 0, consents: 0, skipped: 5 });
    expect((await listDsr({}, SEED_ACTOR)).total).toBe(DEMO_REQUESTS.length);
  });
});
