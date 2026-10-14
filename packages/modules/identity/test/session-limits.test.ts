// Staff session limits and the fresh passkey check (igs-pharma#95) against real Postgres: the exact
// 8-hour and 30-minute boundaries, which requests move the idle clock, separate workstations, and
// every sensitive change refused on a stale proof and applied exactly once on a fresh one.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { isDomainError } from "@igs/kernel";
import { type KernelTestHandles, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  FRESH_MFA_MS,
  STAFF_IDLE_MS,
  STAFF_SESSION_MAX_MS,
  deletePharmacist,
  deleteUser,
  enforceSessionLimits,
  grantPharmacistRole,
  grantRole,
  loadActor,
  loadRbacCatalogue,
  reactivatePharmacist,
  reactivateUser,
  registerAuditActions,
  revokePharmacistRole,
  revokeRole,
  sessionEnd,
  sessionWithinLimits,
  suspendPharmacist,
  suspendUser,
} from "../src";
import { sessions, userRoles, users } from "../src/schema";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerAuditActions(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(async () => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date());
  await iso.db.delete(sessions);
  await iso.db.delete(userRoles);
  await iso.db.delete(users);
});

const T0 = new Date("2026-10-14T08:00:00.000Z");
const plus = (ms: number, from: Date = T0) => new Date(from.getTime() + ms);

async function user(kind: "staff" | "customer" = "staff", ...roleKeys: string[]) {
  const [row] = await iso.db
    .insert(users)
    .values({ name: "Test Person", email: `${crypto.randomUUID()}@example.test`, kind })
    .returning({ id: users.id });
  if (!row) throw new Error("insert failed");
  for (const roleKey of roleKeys) {
    await iso.db.insert(userRoles).values({ userId: row.id, roleKey });
  }
  return row.id;
}

async function session(userId: string, createdAt: Date = T0) {
  const [row] = await iso.db
    .insert(sessions)
    .values({
      userId,
      token: crypto.randomUUID(),
      expiresAt: plus(STAFF_SESSION_MAX_MS, createdAt),
      createdAt,
      mfaVerifiedAt: createdAt,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error("insert failed");
  return row.id;
}

const exists = async (sessionId: string) =>
  (await iso.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId)))
    .length === 1;
const activityOf = async (sessionId: string) =>
  (
    await iso.db
      .select({ at: sessions.lastActivityAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
  )[0]?.at ?? null;

const check = (userId: string, sessionId: string, now: Date, touch: boolean) =>
  enforceSessionLimits(iso.db, { userId, sessionId, now, touch });

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

describe("sessionEnd (pure)", () => {
  const signedIn = { createdAt: T0, lastActivityAt: null };

  it("accepts a session 1 ms before each limit and ends it exactly at the limit", () => {
    expect(sessionEnd(signedIn, plus(STAFF_IDLE_MS - 1))).toBeNull();
    expect(sessionEnd(signedIn, plus(STAFF_IDLE_MS))).toBe("idle");
    const busy = (now: Date) => ({ createdAt: T0, lastActivityAt: plus(-1, now) });
    const nearEight = plus(STAFF_SESSION_MAX_MS - 1);
    expect(sessionEnd(busy(nearEight), nearEight)).toBeNull();
    const atEight = plus(STAFF_SESSION_MAX_MS);
    expect(sessionEnd(busy(atEight), atEight)).toBe("expired");
  });

  it("counts idle time from the last activity, not from the sign-in", () => {
    const active = { createdAt: T0, lastActivityAt: plus(60 * 60 * 1000) };
    expect(sessionEnd(active, plus(60 * 60 * 1000 + STAFF_IDLE_MS - 1))).toBeNull();
    expect(sessionEnd(active, plus(60 * 60 * 1000 + STAFF_IDLE_MS))).toBe("idle");
  });

  it("reports the 8-hour limit when both apply", () => {
    expect(sessionEnd(signedIn, plus(STAFF_SESSION_MAX_MS + 1))).toBe("expired");
  });
});

describe("staff session limits in the database", () => {
  it("8 h − 1 ms is accepted (when active) and 8 h is refused and the session deleted", async () => {
    const userId = await user();
    const id = await session(userId);
    // keep it active the whole time, so only the absolute limit can apply
    const nearEight = plus(STAFF_SESSION_MAX_MS - 1);
    await iso.db
      .update(sessions)
      .set({ lastActivityAt: plus(-1000, nearEight) })
      .where(eq(sessions.id, id));
    expect(await check(userId, id, nearEight, false)).toBeNull();
    expect(await exists(id)).toBe(true);
    expect(await check(userId, id, plus(STAFF_SESSION_MAX_MS), false)).toBe("expired");
    expect(await exists(id)).toBe(false);
  });

  it("30 min − 1 ms of idleness is accepted and 30 min is refused", async () => {
    const userId = await user();
    const accepted = await session(userId);
    expect(await check(userId, accepted, plus(STAFF_IDLE_MS - 1), false)).toBeNull();
    const refused = await session(userId);
    expect(await check(userId, refused, plus(STAFF_IDLE_MS), false)).toBe("idle");
    expect(await exists(refused)).toBe(false);
  });

  it("an interactive request moves the idle clock; a background one does not", async () => {
    const userId = await user();
    const id = await session(userId);
    const t1 = plus(20 * 60 * 1000);
    // background: nothing is written, so the clock still runs from the sign-in
    expect(await check(userId, id, t1, false)).toBeNull();
    expect(await activityOf(id)).toBeNull();
    expect(await check(userId, id, plus(STAFF_IDLE_MS), false)).toBe("idle");

    const kept = await session(userId);
    expect(await check(userId, kept, t1, true)).toBeNull();
    expect((await activityOf(kept))?.toISOString()).toBe(t1.toISOString());
    // 20 min after sign-in an interactive request restarted the clock: 40 min is still fine
    expect(await check(userId, kept, plus(40 * 60 * 1000 - 1), false)).toBeNull();
    expect(await check(userId, kept, plus(50 * 60 * 1000), false)).toBe("idle");
  });

  it("repeated background checks never keep a session alive", async () => {
    const userId = await user();
    const id = await session(userId);
    for (let minute = 1; minute < 30; minute += 1) {
      expect(await check(userId, id, plus(minute * 60 * 1000), false)).toBeNull();
    }
    expect(await activityOf(id)).toBeNull();
    expect(await check(userId, id, plus(STAFF_IDLE_MS), false)).toBe("idle");
  });

  it("activity never extends the 8-hour clock", async () => {
    const userId = await user();
    const id = await session(userId);
    // an interactive request every 20 minutes for 8 hours
    let now = T0;
    let ended: string | null = null;
    while (ended === null && now.getTime() - T0.getTime() < STAFF_SESSION_MAX_MS + 3600_000) {
      now = plus(20 * 60 * 1000, now);
      ended = await check(userId, id, now, true);
    }
    expect(ended).toBe("expired");
    expect(now.getTime() - T0.getTime()).toBe(STAFF_SESSION_MAX_MS);
  });

  it("each session has its own idle clock: another workstation's activity does not help", async () => {
    const userId = await user();
    const counter = await session(userId);
    const office = await session(userId);
    const busyAt = plus(25 * 60 * 1000);
    expect(await check(userId, office, busyAt, true)).toBeNull();
    // 31 minutes after sign-in: the counter PC (never active) is over, the office PC is fine
    const t = plus(31 * 60 * 1000);
    expect(await check(userId, counter, t, false)).toBe("idle");
    expect(await check(userId, office, t, true)).toBeNull();
    expect(await exists(office)).toBe(true);
  });

  it("a customer session is not limited here (Phase 1b)", async () => {
    const userId = await user("customer", "customer");
    const id = await session(userId);
    expect(await check(userId, id, plus(STAFF_SESSION_MAX_MS * 2), true)).toBeNull();
    expect(await exists(id)).toBe(true);
  });

  it("another user's session id is not touched", async () => {
    const owner = await user();
    const stranger = await user();
    const id = await session(owner);
    expect(await check(stranger, id, plus(STAFF_SESSION_MAX_MS), true)).toBeNull();
    expect(await exists(id)).toBe(true);
  });

  it("sessionWithinLimits only looks, and a deleted session is not within limits", async () => {
    const userId = await user();
    const id = await session(userId);
    expect(await sessionWithinLimits(iso.db, { userId, sessionId: id, now: plus(1000) })).toBe(
      true,
    );
    expect(
      await sessionWithinLimits(iso.db, { userId, sessionId: id, now: plus(STAFF_IDLE_MS) }),
    ).toBe(false);
    expect(await exists(id)).toBe(true); // a peek deletes nothing
    await iso.db.delete(sessions).where(eq(sessions.id, id));
    expect(await sessionWithinLimits(iso.db, { userId, sessionId: id, now: T0 })).toBe(false);
  });

  it("a passkey check marks the session verified but leaves the 8-hour clock where it was", async () => {
    const userId = await user();
    const id = await session(userId);
    const later = plus(2 * 60 * 60 * 1000);
    await iso.db
      .update(sessions)
      .set({ mfaVerifiedAt: later, lastActivityAt: later })
      .where(eq(sessions.id, id));
    const [row] = await iso.db.select().from(sessions).where(eq(sessions.id, id));
    expect(row?.createdAt.toISOString()).toBe(T0.toISOString());
    expect(await check(userId, id, plus(STAFF_SESSION_MAX_MS), false)).toBe("expired");
  });
});

// ── the fresh passkey check ───────────────────────────────────────────────────────────────────

/** An acting staff user whose last passkey check was `proofAgeMs` ago (`null`: never). */
async function acting(roles: string[], proofAgeMs: number | null) {
  const id = await user("staff", ...roles);
  const resolved = await loadActor(iso.db, id);
  if (!resolved) throw new Error("no actor");
  return {
    type: resolved.type,
    id,
    roles: resolved.roles,
    kind: resolved.kind,
    mfaVerified: true,
    mfaVerifiedAt: proofAgeMs === null ? null : new Date(kernel.clock.now().getTime() - proofAgeMs),
  };
}

const auditCount = async (action: string, entityId: string) => {
  const rows = await iso.sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM audit.events WHERE action = ${action} AND entity_id = ${entityId}`;
  return rows[0]?.n ?? 0;
};
const rolesOf = async (userId: string) =>
  (
    await iso.db
      .select({ r: userRoles.roleKey })
      .from(userRoles)
      .where(eq(userRoles.userId, userId))
  )
    .map((row) => row.r)
    .sort();
const statusOf = async (userId: string) =>
  (await iso.db.select({ s: users.status }).from(users).where(eq(users.id, userId)))[0]?.s;

describe("sensitive changes need a fresh passkey check (#95)", () => {
  // each case: the command, who runs it, and how to build and read its target
  const cases: {
    name: string;
    actorRoles: string[];
    targetRoles: string[];
    run: (
      target: string,
      actor: Awaited<ReturnType<typeof acting>>,
      key?: string,
    ) => Promise<unknown>;
    changed: (target: string) => Promise<boolean>;
  }[] = [
    {
      name: "grant a role",
      actorRoles: ["owner"],
      targetRoles: [],
      run: (t, a, key) =>
        grantRole({ userId: t, roleKey: "content_editor" }, a, key ? { idempotencyKey: key } : {}),
      changed: async (t) => (await rolesOf(t)).includes("content_editor"),
    },
    {
      name: "revoke a role",
      actorRoles: ["owner"],
      targetRoles: ["content_editor"],
      run: (t, a, key) =>
        revokeRole({ userId: t, roleKey: "content_editor" }, a, key ? { idempotencyKey: key } : {}),
      changed: async (t) => !(await rolesOf(t)).includes("content_editor"),
    },
    {
      name: "grant a pharmacist role",
      actorRoles: ["pharmacist_titular"],
      targetRoles: [],
      run: (t, a, key) =>
        grantPharmacistRole(
          { userId: t, roleKey: "pharmacist" },
          a,
          key ? { idempotencyKey: key } : {},
        ),
      changed: async (t) => (await rolesOf(t)).includes("pharmacist"),
    },
    {
      name: "revoke a pharmacist role",
      actorRoles: ["pharmacist_titular"],
      targetRoles: ["pharmacist"],
      run: (t, a, key) =>
        revokePharmacistRole(
          { userId: t, roleKey: "pharmacist" },
          a,
          key ? { idempotencyKey: key } : {},
        ),
      changed: async (t) => !(await rolesOf(t)).includes("pharmacist"),
    },
    {
      name: "suspend a user",
      actorRoles: ["owner"],
      targetRoles: ["content_editor"],
      run: (t, a, key) => suspendUser({ userId: t }, a, key ? { idempotencyKey: key } : {}),
      changed: async (t) => (await statusOf(t)) === "suspended",
    },
    {
      name: "delete a user",
      actorRoles: ["owner"],
      targetRoles: ["content_editor"],
      run: (t, a, key) => deleteUser({ userId: t }, a, key ? { idempotencyKey: key } : {}),
      changed: async (t) => (await statusOf(t)) === "deleted",
    },
    {
      name: "suspend a pharmacist",
      actorRoles: ["pharmacist_titular"],
      targetRoles: ["pharmacist"],
      run: (t, a, key) => suspendPharmacist({ userId: t }, a, key ? { idempotencyKey: key } : {}),
      changed: async (t) => (await statusOf(t)) === "suspended",
    },
    {
      name: "delete a pharmacist",
      actorRoles: ["pharmacist_titular"],
      targetRoles: ["pharmacist"],
      run: (t, a, key) => deletePharmacist({ userId: t }, a, key ? { idempotencyKey: key } : {}),
      changed: async (t) => (await statusOf(t)) === "deleted",
    },
  ];

  for (const c of cases) {
    it(`${c.name}: refused without a proof, with a stale one, and changes nothing`, async () => {
      const target = await user("staff", ...c.targetRoles);
      for (const age of [null, FRESH_MFA_MS + 1]) {
        const actor = await acting(c.actorRoles, age);
        expect(await codeOf(c.run(target, actor))).toBe("identity.fresh_mfa_required");
      }
      expect(await c.changed(target)).toBe(false);
    });

    it(`${c.name}: passes with a proof exactly at the limit, once`, async () => {
      const target = await user("staff", ...c.targetRoles);
      const actor = await acting(c.actorRoles, FRESH_MFA_MS);
      expect(await codeOf(c.run(target, actor))).toBe("ok");
      expect(await c.changed(target)).toBe(true);
    });
  }

  it("reactivate (both families) needs the proof too", async () => {
    const staffTarget = await user("staff", "content_editor");
    const pharmacistTarget = await user("staff", "pharmacist");
    await iso.db.update(users).set({ status: "suspended" }).where(eq(users.id, staffTarget));
    await iso.db.update(users).set({ status: "suspended" }).where(eq(users.id, pharmacistTarget));
    const owner = await acting(["owner"], null);
    const titular = await acting(["pharmacist_titular"], null);
    expect(await codeOf(reactivateUser({ userId: staffTarget }, owner))).toBe(
      "identity.fresh_mfa_required",
    );
    expect(await codeOf(reactivatePharmacist({ userId: pharmacistTarget }, titular))).toBe(
      "identity.fresh_mfa_required",
    );
    const freshOwner = await acting(["owner"], 0);
    const freshTitular = await acting(["pharmacist_titular"], 0);
    expect(await codeOf(reactivateUser({ userId: staffTarget }, freshOwner))).toBe("ok");
    expect(await codeOf(reactivatePharmacist({ userId: pharmacistTarget }, freshTitular))).toBe(
      "ok",
    );
  });

  it("a fresh check grants nothing: permissions and pharmacist protections are unchanged", async () => {
    const target = await user("staff");
    // an editor has no staff.manage, however fresh the proof
    const editor = await acting(["content_editor"], 0);
    expect(await codeOf(grantRole({ userId: target, roleKey: "content_editor" }, editor))).toBe(
      "kernel.forbidden",
    );
    // the owner cannot hand out a pharmacist role (D-030) or touch a pharmacist (D-035)
    const owner = await acting(["owner"], 0);
    expect(await codeOf(grantRole({ userId: target, roleKey: "pharmacist" }, owner))).toBe(
      "identity.pharmacist_role_requires_titular",
    );
    expect(
      await codeOf(grantPharmacistRole({ userId: target, roleKey: "pharmacist" }, owner)),
    ).toBe("kernel.forbidden");
    const pharmacist = await user("staff", "pharmacist");
    expect(await codeOf(suspendUser({ userId: pharmacist }, owner))).toBe(
      "identity.pharmacist_access_requires_titular",
    );
    expect(await statusOf(pharmacist)).toBe("active");
  });

  it("a refused attempt leaves the idempotency key free: the retry changes the target once, with one audit entry", async () => {
    const target = await user("staff");
    const key = crypto.randomUUID();
    const stale = await acting(["owner"], FRESH_MFA_MS + 60_000);
    expect(
      await codeOf(
        grantRole({ userId: target, roleKey: "content_editor" }, stale, { idempotencyKey: key }),
      ),
    ).toBe("identity.fresh_mfa_required");
    expect(await rolesOf(target)).toEqual([]);

    // the passkey check happened: the SAME request, with the same key, now goes through
    const fresh = { ...stale, mfaVerifiedAt: kernel.clock.now() };
    const options = { idempotencyKey: key };
    expect(await grantRole({ userId: target, roleKey: "content_editor" }, fresh, options)).toEqual({
      ok: true,
    });
    // a double submit replays the stored answer and applies nothing again
    expect(await grantRole({ userId: target, roleKey: "content_editor" }, fresh, options)).toEqual({
      ok: true,
    });
    expect(await rolesOf(target)).toEqual(["content_editor"]);
    expect(await auditCount("identity.role.granted", target)).toBe(1);
  });
});
