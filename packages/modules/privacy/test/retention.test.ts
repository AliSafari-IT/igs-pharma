// The retention purge COMMAND (igs-pharma#88) against real Postgres with the real audit port: who may
// run it, what it records (counts only) and that the job entry point logs counts only.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, type KernelRuntime, isDomainError } from "@igs/kernel";
import { configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  MAINTENANCE_ACTOR,
  PRIVACY_JOBS,
  PRIVACY_QUEUES,
  RETENTION_DEFAULTS,
  getRetentionPolicy,
  purgeExpiredPrivacyData,
  registerAuditActions,
  reportRetentionPurgeFailed,
  runRetentionPurge,
} from "../src";

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

const staff = (...roles: string[]): Actor => ({
  type: "user",
  id: randomUUID(),
  roles,
  kind: "staff",
  mfaVerified: true,
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

const seedWithdrawn = async (ref: string) => {
  const old = new Date(Date.now() - 70 * 31 * 86_400_000);
  await iso.sql`
    INSERT INTO privacy.consent_events (id, subject_ref, purpose, granted, policy_version, source, actor_type, actor_id, at)
    VALUES (${randomUUID()}, ${ref}, 'marketing_email', true, 'v1', 'storefront', 'system', 't', ${new Date(old.getTime() - 86_400_000).toISOString()}::timestamptz),
           (${randomUUID()}, ${ref}, 'marketing_email', false, 'v1', 'storefront', 'system', 't', ${old.toISOString()}::timestamptz)`;
};

describe("privacy.retention.purge", () => {
  it("runs as the maintenance actor, deletes what is due and audits COUNTS only", async () => {
    const email = `withdrawn-${randomUUID()}@example.test`;
    await seedWithdrawn(email);
    const result = await purgeExpiredPrivacyData({}, MAINTENANCE_ACTOR);
    expect(result).toEqual({ consentEvents: 2, dsrRequests: 0, dsrEvents: 0 });

    const events = await iso.sql<
      { action: string; data: Record<string, unknown>; actor_id: string }[]
    >`
      SELECT action, data, actor_id FROM audit.events WHERE action = 'privacy.retention.purged'`;
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toEqual({ consentEvents: 2, dsrRequests: 0, dsrEvents: 0 });
    expect(events[0]?.actor_id).toBe(MAINTENANCE_ACTOR.id);
    // no e-mail address anywhere in the audit trail
    const leaked = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit.events WHERE data::text LIKE ${`%${email}%`} OR data::text LIKE '%@%'`;
    expect(leaked[0]?.n).toBe(0);
  });

  it("nobody else can run it: not the owner, not another system role", async () => {
    expect(await codeOf(purgeExpiredPrivacyData({}, staff("owner")))).toBe("kernel.forbidden");
    expect(await codeOf(purgeExpiredPrivacyData({}, staff("pharmacist")))).toBe("kernel.forbidden");
    expect(
      await codeOf(
        purgeExpiredPrivacyData({}, { type: "system", id: "x", roles: ["system_seed"] }),
      ),
    ).toBe("kernel.forbidden");
    expect(await codeOf(purgeExpiredPrivacyData({}, MAINTENANCE_ACTOR))).toBe("ok");
  });

  it("the maintenance role can do nothing else", async () => {
    const out = await codeOf(
      getRetentionPolicy({}, { type: "system", id: "m", roles: ["system_maintenance"] }),
    );
    expect(out).toBe("kernel.forbidden");
  });
});

describe("the job entry point", () => {
  const runtime = (logs: { level: string; obj: Record<string, unknown> }[]): KernelRuntime => ({
    db: iso.db,
    now: () => new Date(),
    metrics: { increment: () => {} },
    logger: {
      error: (obj) => void logs.push({ level: "error", obj }),
      info: (obj) => void logs.push({ level: "info", obj }),
      warn: (obj) => void logs.push({ level: "warn", obj }),
    },
  });

  it("logs the three counts and nothing else", async () => {
    const email = `job-${randomUUID()}@example.test`;
    await seedWithdrawn(email);
    const logs: { level: string; obj: Record<string, unknown> }[] = [];
    const result = await runRetentionPurge(runtime(logs));
    expect(result.consentEvents).toBeGreaterThanOrEqual(2);
    expect(logs).toEqual([
      { level: "info", obj: { consentEvents: result.consentEvents, dsrRequests: 0, dsrEvents: 0 } },
    ]);
    expect(JSON.stringify(logs)).not.toContain("@");
  });

  it("warns, without data, when the job failed after all its retries", () => {
    const logs: { level: string; obj: Record<string, unknown> }[] = [];
    reportRetentionPurgeFailed(runtime(logs));
    expect(logs).toEqual([{ level: "warn", obj: { alarm: "privacy.retention.purge_failed" } }]);
  });

  it("is scheduled outside the Brussels hour that DST skips or repeats, and its queues are named once", () => {
    const hour = Number(PRIVACY_JOBS.purge.cron.split(" ")[1]);
    expect(hour).not.toBe(2);
    expect(PRIVACY_JOBS.timezone).toBe("Europe/Brussels");
    expect(PRIVACY_QUEUES).toEqual([PRIVACY_JOBS.purge.deadLetterQueue, PRIVACY_JOBS.purge.queue]);
  });
});

describe("the policy query", () => {
  it("returns the seeded policy, equal to the documented defaults", async () => {
    const rows = await getRetentionPolicy({}, staff("owner"));
    expect(rows.map((r) => [r.key, r.months, r.awaitsAdviser])).toEqual(
      Object.entries(RETENTION_DEFAULTS)
        .map(([key, d]) => [key, d.months, d.awaitsPrivacyAdviser])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  });
});
