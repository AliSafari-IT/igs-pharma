// The application and the worker as the RUNTIME roles (igs-pharma#66): a database migrated by a
// non-superuser administrator, pg-boss installed by the migrate entry's steps, then the composition
// roots' startup work and representative real commands run as members of `igs_app` / `igs_worker`.
// If the grant manifest were too tight for a real code path, this is where it would show.
import { randomUUID } from "node:crypto";

import { type RuntimeRoleDatabase, createRuntimeRoleDatabase } from "@igs/db/testing";
import {
  type Actor,
  PURGE_QUEUE,
  assertQueuesExist,
  command,
  createOutboxRelay,
  defineEvent,
  grantPgBossRuntime,
  purgeExpired,
  query,
  registerEvents,
} from "@igs/kernel";
import { configureKernelForTests } from "@igs/kernel/testing";
import {
  AUDIT_JOBS,
  type JobScheduler,
  createAuditPort,
  registerAuditAction,
  registerAuditJobs,
} from "@igs/module-audit";
import {
  createCategory,
  createProductRegulated,
  getStorefrontProductDetail,
  registerAuditActions as registerCatalogAudit,
  searchStorefrontCandidates,
  setProductCategories,
  setProductStatusRegulated,
  storefrontCategoryIndex,
  storefrontTopCategories,
} from "@igs/module-catalog";
import {
  ensureRbacCatalogue,
  registerAuditActions as registerIdentityAudit,
} from "@igs/module-identity";
import {
  adjustStock,
  confirmReservation,
  consumeReservation,
  getStock,
  getStockSummary,
  registerAuditActions as registerInventoryAudit,
  registerInventoryJobs,
  reserveStock,
  storefrontAvailability,
} from "@igs/module-inventory";
import { registerOrdersJobs } from "@igs/module-orders";
import {
  registerAuditActions as registerPricingAudit,
  setPrice,
  storefrontPriceCards,
} from "@igs/module-pricing";
import {
  PRIVACY_JOBS,
  createDsr,
  recordConsent,
  registerAuditActions as registerPrivacyAudit,
  registerPrivacyJobs,
} from "@igs/module-privacy";
import { drizzle } from "drizzle-orm/postgres-js";
import PgBoss from "pg-boss";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { type InstallableBoss, installPgBossQueuesAndGrants } from "../src/pgboss-install";

const Pinged = defineEvent("runtime.roles.pinged", 1, z.object({ n: z.number() }));
const ping = command({
  name: "runtime.roles.ping",
  input: z.object({ n: z.number() }),
  output: z.object({ n: z.number() }),
  permission: "catalog.products.manage",
  audit: "none",
  handler: async ({ input, ctx }) => {
    await ctx.outbox.publish(Pinged, { n: input.n });
    return { n: input.n };
  },
});

/**
 * The table reads of the storefront read model (`@igs/module-storefront`, igs-pharma#103), in one
 * query under the storefront's permission, the way the read model composes them. The worker does not
 * depend on the read model; what this test checks is that the runtime role's grants cover those reads.
 */
const storefrontReads = query({
  name: "runtime.roles.storefront_reads",
  input: z.object({ cnk: z.string(), productId: z.uuid() }),
  permission: "catalog.storefront.read",
  handler: async ({ input, ctx }) => {
    const set = await searchStorefrontCandidates(ctx.tx, { locale: "nl" });
    const detail = await getStorefrontProductDetail(ctx.tx, input.cnk, "nl");
    const index = await storefrontCategoryIndex(ctx.tx, "nl");
    const prices = await storefrontPriceCards(ctx.tx, [input.productId], ctx.now);
    const statuses = await storefrontAvailability(ctx.tx, [input.productId], ctx.now);
    const tops = await storefrontTopCategories(ctx.tx, [input.productId], "nl");
    return {
      candidates: set.candidates.length,
      name: detail?.name ?? null,
      categories: index.categories.length,
      priced: prices.size,
      statuses: statuses.size,
      tops: tops.size,
    };
  },
});

// audit actions are registered once per process (the apps do it in their composition roots)
registerIdentityAudit(registerAuditAction);
registerCatalogAudit(registerAuditAction);
registerInventoryAudit(registerAuditAction);
registerPricingAudit(registerAuditAction);
registerPrivacyAudit(registerAuditAction);

const owner: Actor = {
  type: "user",
  id: randomUUID(),
  roles: ["owner"],
  kind: "staff",
  mfaVerified: true,
};
/** Regulated products are created and activated by a pharmacist (D-034, #79). */
const pharmacist: Actor = {
  type: "user",
  id: randomUUID(),
  roles: ["pharmacist"],
  kind: "staff",
  mfaVerified: true,
};
const storefront: Actor = { type: "system", id: "storefront", roles: ["system_storefront"] };
/** The future checkout, and the expiry job's role (igs-pharma#99). */
const checkout: Actor = { type: "system", id: "checkout", roles: ["system_reservations"] };
const worker: Actor = { type: "system", id: "worker", roles: ["system_seed"] };

/** What the migrate entry does under the administrative role, pg-boss part included. */
async function runMigrateEntry(db: RuntimeRoleDatabase, options: { queues: boolean }) {
  await db.migrate();
  const boss = new PgBoss({
    connectionString: db.adminUrl,
    max: 2,
    migrate: true,
    supervise: false,
    schedule: false,
  });
  boss.on("error", () => {});
  await boss.start();
  try {
    registerEvents(Pinged);
    if (options.queues) {
      await installPgBossQueuesAndGrants(boss as unknown as InstallableBoss);
    } else {
      // an interrupted migrate entry: the grants are there, the queues are not
      await grantPgBossRuntime((boss as unknown as InstallableBoss).getDb());
    }
  } finally {
    await boss.stop({ graceful: false, wait: true });
  }
}

const connect = (url: string) => {
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  return { sql, db: drizzle(sql) };
};

describe("the application as igs_app", () => {
  let db: RuntimeRoleDatabase;
  let app: ReturnType<typeof connect>;

  beforeAll(async () => {
    db = await createRuntimeRoleDatabase();
    await runMigrateEntry(db, { queues: true });
    app = connect(db.appUrl);
  }, 180_000);
  afterAll(async () => {
    await app?.sql.end({ timeout: 5 });
    await db?.drop();
  });

  it("starts: the RBAC catalogue loads and the audit port and kernel configure", async () => {
    configureKernelForTests({ db: app.db, audit: createAuditPort() });
    await ensureRbacCatalogue(app.db);
  });

  it("runs real commands and queries across every module, with audit and idempotency", async () => {
    const kernel = configureKernelForTests({ db: app.db, audit: createAuditPort() });
    kernel.clock.set(new Date());
    await ensureRbacCatalogue(app.db);

    const { categoryId } = await createCategory(
      {
        parentId: null,
        slug: `roles-${randomUUID().slice(0, 8)}`,
        nameNl: "Rollen",
        nameFr: "Rôles",
      },
      owner,
    );
    const { productId } = await createProductRegulated(
      {
        cnk: "9900123",
        productType: "otc_medicine",
        legalStatus: "otc",
        vatClass: "BE_6",
        approveContent: true, // a medicine is storefront-visible only with approved text (#103)
        content: [
          { locale: "nl", name: "Rollen product" },
          { locale: "fr", name: "Produit rôles" },
        ],
      },
      pharmacist,
    );
    await setProductCategories({ productId, categoryIds: [categoryId] }, owner);
    await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
    await setPrice({ productId, amountCents: 599, reason: "launch" }, owner);
    await adjustStock({ productId, delta: 5, reason: "adjustment", note: "found" }, owner);
    // reservations as the runtime role: the stock-level lock function, the lifecycle triggers, and a
    // consume writing its sale movement (igs-pharma#99)
    const holderRef = "order:00000000-0000-7000-8000-000000000001";
    await reserveStock({ productId, quantity: 2, holderRef }, checkout);
    await confirmReservation({ holderRef, items: [{ productId, quantity: 2 }] }, checkout);
    await consumeReservation({ holderRef }, checkout);
    expect((await getStock({ productId }, owner)).onHand).toBe(3);
    // the dashboard's one-statement summary reads the ledger and the reservations as igs_app (#115)
    const summary = await getStockSummary({}, owner);
    expect(summary.activeReservations).toBe(0);
    expect(summary.low).toBeGreaterThanOrEqual(1);
    await recordConsent(
      {
        subjectRef: "roles@example.be",
        purpose: "marketing_email",
        granted: true,
        policyVersion: "2026-10",
        source: "in_store",
      },
      owner,
    );
    await createDsr(
      {
        subjectRef: "roles@example.be",
        type: "access",
        channel: "email",
        receivedAt: new Date(Date.now() - 60_000),
      },
      owner,
    );

    // the storefront reads (and prices) as the same runtime role
    const reads = await storefrontReads({ cnk: "9900123", productId }, storefront);
    expect(reads.candidates).toBeGreaterThan(0);
    expect(reads.name).toBe("Rollen product");
    expect(reads.categories).toBeGreaterThan(0);
    expect([reads.priced, reads.statuses, reads.tops]).toEqual([1, 1, 1]);

    // an idempotent command publishing an outbox event: idempotency_keys INSERT/UPDATE, outbox INSERT
    registerEvents(Pinged);
    const first = await ping({ n: 1 }, owner, { idempotencyKey: "roles-ping-1" });
    const replay = await ping({ n: 1 }, owner, { idempotencyKey: "roles-ping-1" });
    expect([first.n, replay.n]).toEqual([1, 1]);

    // the audit chain was written (INSERT events, UPDATE chain_head)
    const [events] = await app.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit.events`;
    expect(events?.n).toBeGreaterThan(5);
  });

  it("can NOT purge: the retention jobs are the worker's", async () => {
    await expect(purgeExpired({ db: app.db })).rejects.toThrow();
  });
});

describe("the worker as igs_worker (member of igs_app and igs_worker)", () => {
  let db: RuntimeRoleDatabase;
  let runtimeWorker: ReturnType<typeof connect>;
  let boss: PgBoss | undefined;

  beforeAll(async () => {
    db = await createRuntimeRoleDatabase();
    await runMigrateEntry(db, { queues: true });
    runtimeWorker = connect(db.workerUrl);
  }, 180_000);
  afterAll(async () => {
    await boss?.stop({ graceful: false, wait: true });
    await runtimeWorker?.sql.end({ timeout: 5 });
    await db?.drop();
  });

  it("boots: RBAC catalogue, pg-boss WITHOUT migrating, queues present, jobs scheduled and run, relay and purge work", async () => {
    const errors: unknown[] = [];
    const gauges: string[] = [];
    const kernel = configureKernelForTests({ db: runtimeWorker.db, audit: createAuditPort() });
    kernel.clock.set(new Date());
    registerEvents(Pinged);
    await ensureRbacCatalogue(runtimeWorker.db);

    // like src/index.ts: migrate:false, the supervisor and the scheduler on
    boss = new PgBoss({
      connectionString: db.workerUrl,
      max: 4,
      migrate: false,
      maintenanceIntervalSeconds: 1,
      monitorStateIntervalSeconds: 1,
    });
    boss.on("error", (err) => errors.push(err));
    await boss.start();
    await assertQueuesExist(boss, [PURGE_QUEUE, Pinged.topic]);

    const runtime = {
      db: runtimeWorker.db,
      now: () => new Date(),
      metrics: { increment: () => {}, gauge: (name: string) => void gauges.push(name) },
      logger: { error: (obj: unknown) => void errors.push(obj) },
    };
    await registerAuditJobs(boss as unknown as JobScheduler, runtime);
    await boss.schedule(PURGE_QUEUE, "17 3 * * *", undefined, { tz: "Europe/Brussels" });
    await boss.send(AUDIT_JOBS.partitions.queue, {}); // audit.maintain_partitions() as the worker
    await boss.send(AUDIT_JOBS.verify.queue, {});
    await vi.waitFor(
      () =>
        expect(gauges).toEqual(
          expect.arrayContaining(["audit.partitions.future", "audit.chain.checked"]),
        ),
      {
        timeout: 20_000,
        interval: 250,
      },
    );

    // the outbox relay: an event written by the application role is delivered by the worker role
    const appDb = connect(db.appUrl);
    try {
      configureKernelForTests({ db: appDb.db, audit: createAuditPort() });
      registerEvents(Pinged);
      await ping({ n: 7 }, owner);
    } finally {
      await appDb.sql.end({ timeout: 5 });
    }
    configureKernelForTests({ db: runtimeWorker.db, audit: createAuditPort() });
    const relay = createOutboxRelay({ queue: boss as never, db: runtimeWorker.db });
    expect((await relay.runOnce()).published).toBe(1);

    // retention: delete the published event and expired keys
    const purged = await purgeExpired({
      db: runtimeWorker.db,
      now: new Date(Date.now() + 30 * 86_400_000),
    });
    expect(purged.outbox).toBe(1);

    // least privilege on pg-boss: DML on the queue tables; the one-row version table can be updated
    // (the supervisor stamps it) but not replaced
    const [version] = await runtimeWorker.sql<{ read: boolean; write: boolean }[]>`
      SELECT has_table_privilege('pgboss.version', 'UPDATE') AS read,
             has_table_privilege('pgboss.version', 'INSERT') OR has_table_privilege('pgboss.version', 'DELETE') AS write`;
    expect(version).toEqual({ read: true, write: false });

    // give the supervisor a few maintenance rounds; a missing right would surface as an 'error' event
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    expect(errors.map(String), "pg-boss or job errors under the runtime role").toEqual([]);
    void worker;
  }, 60_000);
});

describe("the retention jobs as igs_worker (igs-pharma#88)", () => {
  let db: RuntimeRoleDatabase;
  let runtimeWorker: ReturnType<typeof connect>;
  let admin: postgres.Sql;
  let boss: PgBoss | undefined;

  beforeAll(async () => {
    db = await createRuntimeRoleDatabase();
    await runMigrateEntry(db, { queues: true });
    runtimeWorker = connect(db.workerUrl);
    admin = postgres(db.adminUrl, { max: 2, onnotice: () => {} });
  }, 180_000);
  afterAll(async () => {
    await boss?.stop({ graceful: false, wait: true });
    await admin?.end({ timeout: 5 });
    await runtimeWorker?.sql.end({ timeout: 5 });
    await db?.drop();
  });

  it("purge expired plans and withdrawn consent through the real queues, audit counts only, log counts only", async () => {
    const kernel = configureKernelForTests({ db: runtimeWorker.db, audit: createAuditPort() });
    kernel.clock.set(new Date());
    await ensureRbacCatalogue(runtimeWorker.db);

    // fixtures, written by the administrator: a plan expired two days ago, a withdrawn chain from 7 years ago
    const email = `retention-${randomUUID()}@example.test`;
    const old = new Date(Date.now() - 7 * 365 * 86_400_000).toISOString();
    await admin`
      INSERT INTO inventory.import_plans (id, actor_id, rows, created_at, expires_at)
      VALUES (${randomUUID()}, 'staff-1', '[]'::jsonb, now() - interval '51 hours', now() - interval '50 hours')`;
    await admin`
      INSERT INTO privacy.consent_events (id, subject_ref, purpose, granted, policy_version, source, actor_type, actor_id, at)
      VALUES (${randomUUID()}, ${email}, 'marketing_email', false, 'v1', 'storefront', 'system', 't', ${old}::timestamptz)`;

    boss = new PgBoss({
      connectionString: db.workerUrl,
      max: 4,
      migrate: false,
      supervise: false,
      schedule: false,
    });
    const errors: unknown[] = [];
    boss.on("error", (err) => errors.push(err));
    await boss.start();
    const logs: { obj: Record<string, unknown>; msg?: string }[] = [];
    const runtime = {
      db: runtimeWorker.db,
      now: () => new Date(),
      metrics: { increment: () => {} },
      logger: {
        error: (obj: Record<string, unknown>) => void errors.push(obj),
        info: (obj: Record<string, unknown>, msg?: string) =>
          void logs.push({ obj, ...(msg ? { msg } : {}) }),
        warn: (obj: Record<string, unknown>) => void errors.push(obj),
      },
    };
    // an expired hold, written by the administrator (igs-pharma#99)
    await admin`
      INSERT INTO inventory.reservations
        (id, product_id, location_id, quantity, kind, holder_ref, status, expires_at,
         created_by_type, created_by_id, updated_by_type, updated_by_id)
      VALUES (${randomUUID()}, ${randomUUID()}, '0192f000-0000-7000-8000-000000000001', 2, 'hold',
        'checkout:00000000-0000-7000-8000-0000000000a1', 'active', now() - interval '5 minutes', 'system', 'checkout', 'system', 'checkout')`;
    // an expired guest cart and a month-old checkout (igs-pharma#116)
    await admin`
      INSERT INTO orders.carts (id, token_hash, created_at, updated_at, expires_at)
      VALUES (${randomUUID()}, ${"a".repeat(64)}, now() - interval '40 days', now() - interval '40 days', now() - interval '10 days')`;
    await admin`
      INSERT INTO orders.checkouts (id, token_hash, locale, status, needs_review, total_cents, vat_cents, expires_at, created_at, updated_at)
      VALUES (${randomUUID()}, ${"b".repeat(64)}, 'nl', 'cancelled', false, 0, 0, now() - interval '31 days', now() - interval '31 days', now() - interval '31 days')`;
    await registerInventoryJobs(boss as never, runtime);
    await registerOrdersJobs(boss as never, runtime);
    await boss.send("orders.carts.purge", {});
    await boss.send("inventory.reservations.expire", {});
    await registerPrivacyJobs(boss as never, runtime);
    await boss.send("inventory.plans.purge", {});
    await boss.send(PRIVACY_JOBS.purge.queue, {});
    await vi.waitFor(
      () =>
        expect(logs.map((l) => l.msg)).toEqual(
          expect.arrayContaining([
            "inventory.plans.purged",
            "privacy.retention.purged",
            "inventory.reservations.expired",
            "orders.carts.purged",
          ]),
        ),
      { timeout: 20_000, interval: 250 },
    );

    expect(logs.find((l) => l.msg === "inventory.plans.purged")?.obj).toEqual({ purged: 1 });
    expect(logs.find((l) => l.msg === "orders.carts.purged")?.obj).toEqual({ purged: 2 });
    expect(logs.find((l) => l.msg === "privacy.retention.purged")?.obj).toMatchObject({
      consentEvents: 1,
    });
    expect(logs.find((l) => l.msg === "inventory.reservations.expired")?.obj).toEqual({
      expired: 1,
    });
    const [lapsed] = await admin<{ status: string }[]>`
      SELECT status FROM inventory.reservations WHERE holder_ref = 'checkout:00000000-0000-7000-8000-0000000000a1'`;
    expect(lapsed?.status).toBe("expired");
    expect(JSON.stringify(logs)).not.toContain("@");
    const [plans] = await admin<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM inventory.import_plans`;
    const [consents] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM privacy.consent_events WHERE subject_ref = ${email}`;
    expect([plans?.n, consents?.n]).toEqual([0, 0]);
    // the audit entry written under the worker role: counts, no personal data
    const events = await admin<{ data: Record<string, unknown> }[]>`
      SELECT data FROM audit.events WHERE action = 'privacy.retention.purged'`;
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ consentEvents: 1, dsrRequests: 0, dsrEvents: 0 });
    expect(JSON.stringify(events)).not.toContain(email);
    expect(errors, "errors under the runtime role").toEqual([]);
  }, 60_000);
});

describe("a worker started before the migrate entry has run", () => {
  let db: RuntimeRoleDatabase;
  let boss: PgBoss | undefined;

  beforeAll(async () => {
    db = await createRuntimeRoleDatabase();
    // schema + pg-boss installed, but no queues: the migrate entry did not complete
    await runMigrateEntry(db, { queues: false });
  }, 180_000);
  afterAll(async () => {
    await boss?.stop({ graceful: false, wait: true });
    await db?.drop();
  });

  it("refuses with a readable message instead of trying to create queues", async () => {
    const { db: workerDb, sql } = connect(db.workerUrl);
    try {
      configureKernelForTests({ db: workerDb, audit: createAuditPort() });
      boss = new PgBoss({
        connectionString: db.workerUrl,
        max: 2,
        migrate: false,
        supervise: false,
      });
      boss.on("error", () => {});
      await boss.start();
      await expect(
        registerAuditJobs(boss as unknown as JobScheduler, {
          db: workerDb,
          now: () => new Date(),
          metrics: { increment: () => {} },
          logger: { error: () => {} },
        }),
      ).rejects.toThrow(/kernel\.queue_missing.*migrate entry/s);
      // the retention jobs (igs-pharma#88) refuse the same way
      const runtime = {
        db: workerDb,
        now: () => new Date(),
        metrics: { increment: () => {} },
        logger: { error: () => {} },
      };
      await expect(registerInventoryJobs(boss as never, runtime)).rejects.toThrow(
        /kernel\.queue_missing.*inventory\.plans\.purge/s,
      );
      await expect(registerPrivacyJobs(boss as never, runtime)).rejects.toThrow(
        /kernel\.queue_missing.*privacy\.retention\.purge/s,
      );
      await expect(registerOrdersJobs(boss as never, runtime)).rejects.toThrow(
        /kernel\.queue_missing.*orders\.carts\.purge/s,
      );
      // and the runtime role could not have created them anyway
      await expect(boss.createQueue("runtime.roles.rogue")).rejects.toThrow();
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
