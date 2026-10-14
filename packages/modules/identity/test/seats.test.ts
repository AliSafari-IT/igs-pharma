// D-035 (#68): the pharmacist seat and the last owner, against real Postgres. Authorization of
// pharmacist targets, the "last active holder" guard and its race safety, and the bootstrap holder
// check. Every test starts from an empty identity schema so "the only owner" is the only owner.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { isDomainError } from "@igs/kernel";
import { type KernelTestHandles, actors, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  bootstrapStaff,
  deletePharmacist,
  deleteUser,
  loadActor,
  loadRbacCatalogue,
  reactivatePharmacist,
  reactivateUser,
  registerAuditActions,
  reissueEnrolment,
  revokePharmacistRole,
  revokeRole,
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
const reset = async () => {
  await iso.db.delete(sessions);
  await iso.db.delete(userRoles);
  await iso.db.delete(users);
};
beforeEach(async () => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date());
  await reset();
});

async function staffWith(...roleKeys: string[]) {
  const [user] = await iso.db
    .insert(users)
    .values({ name: "Test Person", email: `${crypto.randomUUID()}@example.test`, kind: "staff" })
    .returning({ id: users.id });
  if (!user) throw new Error("insert failed");
  for (const roleKey of roleKeys) {
    await iso.db.insert(userRoles).values({ userId: user.id, roleKey });
  }
  const resolved = await loadActor(iso.db, user.id);
  if (!resolved) throw new Error("no actor");
  return {
    type: resolved.type,
    id: resolved.id,
    roles: resolved.roles,
    kind: resolved.kind,
    mfaVerified: true,
    // #95: role and status changes need a passkey check from the last 10 minutes
    mfaVerifiedAt: new Date(),
  };
}

const statusOf = async (userId: string) =>
  (await iso.db.select({ s: users.status }).from(users).where(eq(users.id, userId)))[0]?.s;

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

const bootstrapper = () => actors.system({ id: "bootstrap-cli", roles: ["system_bootstrap"] });
const newEmail = () => `${crypto.randomUUID()}@example.test`;

describe("pharmacist access has its own command family (rule 1)", () => {
  it("suspend, reactivate and delete (staff.manage) refuse a pharmacist or the titular, for everyone", async () => {
    const owner = await staffWith("owner");
    const both = await staffWith("owner", "pharmacist_titular");
    const pharmacist = await staffWith("pharmacist");
    const titular = await staffWith("pharmacist_titular");
    const suspended = await staffWith("pharmacist");
    await suspendInDb(suspended.id);
    for (const actor of [owner, both]) {
      for (const target of [pharmacist, titular]) {
        expect(await codeOf(suspendUser({ userId: target.id }, actor))).toBe(
          "identity.pharmacist_access_requires_titular",
        );
        expect(await codeOf(deleteUser({ userId: target.id }, actor))).toBe(
          "identity.pharmacist_access_requires_titular",
        );
      }
      expect(await codeOf(reactivateUser({ userId: suspended.id }, actor))).toBe(
        "identity.pharmacist_access_requires_titular",
      );
    }
    expect(await statusOf(pharmacist.id)).toBe("active");
    expect(await statusOf(titular.id)).toBe("active");
    expect(await statusOf(suspended.id)).toBe("suspended");
  });

  it("a location-scoped pharmacist role counts too", async () => {
    const both = await staffWith("owner", "pharmacist_titular");
    const target = await staffWith();
    await iso.db
      .insert(userRoles)
      .values({ userId: target.id, roleKey: "pharmacist", locationId: crypto.randomUUID() });
    expect(await codeOf(suspendUser({ userId: target.id }, both))).toBe(
      "identity.pharmacist_access_requires_titular",
    );
    await suspendPharmacist({ userId: target.id }, both);
    expect(await statusOf(target.id)).toBe("suspended");
  });

  it("the titular alone suspends, reactivates and deletes a pharmacist, with the same audit events", async () => {
    const titular = await staffWith("pharmacist_titular");
    const pharmacist = await staffWith("pharmacist");

    await suspendPharmacist({ userId: pharmacist.id }, titular);
    expect(await statusOf(pharmacist.id)).toBe("suspended");
    await reactivatePharmacist({ userId: pharmacist.id }, titular);
    expect(await statusOf(pharmacist.id)).toBe("active");
    await deletePharmacist({ userId: pharmacist.id }, titular);
    expect(await statusOf(pharmacist.id)).toBe("deleted");

    const rows = await iso.sql<{ action: string; data: unknown }[]>`
      SELECT action, data FROM audit.events WHERE entity_id = ${pharmacist.id} ORDER BY seq`;
    expect(rows).toEqual([
      { action: "identity.user.suspended", data: { userId: pharmacist.id } },
      { action: "identity.user.reactivated", data: { userId: pharmacist.id } },
      { action: "identity.user.deleted", data: { userId: pharmacist.id } },
    ]);
  });

  it("the owner without the titular role cannot use the pharmacist family", async () => {
    const owner = await staffWith("owner");
    const pharmacist = await staffWith("pharmacist");
    const suspended = await staffWith("pharmacist");
    await suspendInDb(suspended.id);
    expect(await codeOf(suspendPharmacist({ userId: pharmacist.id }, owner))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(deletePharmacist({ userId: pharmacist.id }, owner))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(reactivatePharmacist({ userId: suspended.id }, owner))).toBe(
      "kernel.forbidden",
    );
    expect(await statusOf(pharmacist.id)).toBe("active");
    expect(await statusOf(suspended.id)).toBe("suspended");
  });

  it("the pharmacist family refuses anyone who is not a pharmacist", async () => {
    const titular = await staffWith("pharmacist_titular");
    const assistant = await staffWith("pharmacy_assistant");
    expect(await codeOf(suspendPharmacist({ userId: assistant.id }, titular))).toBe(
      "identity.not_a_pharmacist",
    );
    expect(await statusOf(assistant.id)).toBe("active");
  });

  it("the titular alone still lacks staff.manage; the owner still manages everyone else", async () => {
    const titular = await staffWith("pharmacist_titular");
    const owner = await staffWith("owner");
    const second = await staffWith("owner");
    const assistant = await staffWith("pharmacy_assistant");
    expect(await codeOf(suspendUser({ userId: assistant.id }, titular))).toBe("kernel.forbidden");
    await suspendUser({ userId: assistant.id }, owner);
    await suspendUser({ userId: second.id }, owner); // the acting owner stays active
    expect(await statusOf(assistant.id)).toBe("suspended");
    expect(await statusOf(second.id)).toBe("suspended");
  });
});

const suspendInDb = (userId: string) =>
  iso.db.update(users).set({ status: "suspended" }).where(eq(users.id, userId));

/**
 * `actor` can remove `target` and both hold the role under test: owners use the staff commands,
 * titulars the pharmacist family (so the actor needs only the titular role).
 */
async function pair(role: "owner" | "pharmacist_titular") {
  const actor = await staffWith(role);
  const target = await staffWith(role);
  return { actor, target };
}

type Actor = Awaited<ReturnType<typeof staffWith>>;
const REMOVALS = {
  revoke: (role: string, userId: string, by: Actor) =>
    role === "owner"
      ? revokeRole({ userId, roleKey: "owner" }, by)
      : revokePharmacistRole({ userId, roleKey: "pharmacist_titular" }, by),
  suspend: (role: string, userId: string, by: Actor) =>
    role === "owner" ? suspendUser({ userId }, by) : suspendPharmacist({ userId }, by),
  delete: (role: string, userId: string, by: Actor) =>
    role === "owner" ? deleteUser({ userId }, by) : deletePharmacist({ userId }, by),
};

describe("the last active owner / titular cannot be removed (rule 2)", () => {
  for (const role of ["owner", "pharmacist_titular"] as const) {
    for (const [name, remove] of Object.entries(REMOVALS)) {
      it(`${name} of a ${role}: allowed while another active holder exists, refused for the last one`, async () => {
        // the acting user is the other active holder, so removing the target is fine
        const ok = await pair(role);
        await remove(role, ok.target.id, ok.actor);

        await reset();
        // a suspended second holder does not count: the same removal now empties the seat. (The
        // actor object is stale on purpose: it models a removal that overlaps the actor's own.)
        const last = await pair(role);
        await createSessionFor(last.target.id);
        await suspendInDb(last.actor.id);
        expect(await codeOf(remove(role, last.target.id, last.actor))).toBe(
          "identity.last_holder_protected",
        );
        // nothing changed: still active, role kept, sessions kept
        expect(await statusOf(last.target.id)).toBe("active");
        const held = await iso.db
          .select({ roleKey: userRoles.roleKey })
          .from(userRoles)
          .where(eq(userRoles.userId, last.target.id));
        expect(held.map((r) => r.roleKey)).toContain(role);
        expect(
          await iso.db.select().from(sessions).where(eq(sessions.userId, last.target.id)),
        ).toHaveLength(1);
      });
    }
  }

  it("a seat already empty (deleted before this guard) does not block removing other users", async () => {
    const actor = await staffWith("owner");
    const stale = await staffWith("pharmacist_titular");
    await iso.db.update(users).set({ status: "deleted" }).where(eq(users.id, stale.id));
    const other = await staffWith("pharmacy_assistant");
    await suspendUser({ userId: other.id }, actor);
    expect(await statusOf(other.id)).toBe("suspended");
  });

  it("rejected attempts are not audited; successful ones keep their events", async () => {
    const { actor, target } = await pair("owner");
    await suspendInDb(actor.id);
    await codeOf(suspendUser({ userId: target.id }, actor));
    const events = await iso.sql`SELECT 1 FROM audit.events WHERE entity_id = ${target.id}`;
    expect(events).toHaveLength(0);
  });
});

async function createSessionFor(userId: string) {
  await iso.db.insert(sessions).values({
    userId,
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
}

async function activeCount(roleKey: string) {
  const rows = await iso.sql<{ n: number }[]>`
    SELECT count(DISTINCT ur.user_id)::int AS n FROM identity.user_roles ur
    JOIN identity.users u ON u.id = ur.user_id
    WHERE ur.role_key = ${roleKey} AND u.status = 'active'`;
  return rows[0]?.n ?? 0;
}

describe("two removals at once leave exactly one holder (rule 2, race)", () => {
  const ROUNDS = 8;
  const races: Record<
    string,
    { role: "owner" | "pharmacist_titular"; run: (a: Actor, b: Actor) => Promise<unknown>[] }
  > = {
    "two owners suspend each other": {
      role: "owner",
      run: (a, b) => [suspendUser({ userId: b.id }, a), suspendUser({ userId: a.id }, b)],
    },
    "two owners revoke each other's owner role": {
      role: "owner",
      run: (a, b) => [
        revokeRole({ userId: b.id, roleKey: "owner" }, a),
        revokeRole({ userId: a.id, roleKey: "owner" }, b),
      ],
    },
    "two titulars delete each other": {
      role: "pharmacist_titular",
      run: (a, b) => [deletePharmacist({ userId: b.id }, a), deletePharmacist({ userId: a.id }, b)],
    },
    "two titulars revoke each other's titular role": {
      role: "pharmacist_titular",
      run: (a, b) => [
        revokePharmacistRole({ userId: b.id, roleKey: "pharmacist_titular" }, a),
        revokePharmacistRole({ userId: a.id, roleKey: "pharmacist_titular" }, b),
      ],
    },
  };

  for (const [name, { role, run }] of Object.entries(races)) {
    it(`${name}: exactly one succeeds`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await reset();
        const a = await staffWith(role);
        const b = await staffWith(role);
        const results = await Promise.all(run(a, b).map(codeOf));
        expect(results.sort()).toEqual(["identity.last_holder_protected", "ok"]);
        expect(await activeCount(role)).toBe(1);
      }
    });
  }
});

describe("bootstrap counts only active holders (rule 4)", () => {
  it("refuses while an ACTIVE holder exists, for both bootstrap roles", async () => {
    await staffWith("owner", "pharmacist_titular");
    for (const roleKey of ["owner", "pharmacist_titular"] as const) {
      expect(
        await codeOf(bootstrapStaff({ email: newEmail(), name: "New", roleKey }, bootstrapper())),
      ).toBe("identity.role_already_held");
    }
  });

  it("a deleted titular no longer blocks the seat, and the new holder can be re-enrolled", async () => {
    const gone = await staffWith("pharmacist_titular");
    await iso.db.update(users).set({ status: "deleted" }).where(eq(users.id, gone.id));

    const email = newEmail();
    const { userId } = await bootstrapStaff(
      { email, name: "New Titular", roleKey: "pharmacist_titular" },
      bootstrapper(),
    );
    expect(userId).not.toBe(gone.id);
    const reissued = await reissueEnrolment({ email }, bootstrapper());
    expect(reissued.userId).toBe(userId);
    // the deleted one is still not a person reissue can reach
    const [old] = await iso.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, gone.id));
    expect(await codeOf(reissueEnrolment({ email: old?.email ?? "" }, bootstrapper()))).toBe(
      "identity.user_not_found",
    );
    // and now the seat is held again
    expect(
      await codeOf(
        bootstrapStaff(
          { email: newEmail(), name: "Third", roleKey: "pharmacist_titular" },
          bootstrapper(),
        ),
      ),
    ).toBe("identity.role_already_held");
  });

  it("a suspended owner no longer blocks the seat either", async () => {
    const away = await staffWith("owner");
    await suspendInDb(away.id);
    await bootstrapStaff({ email: newEmail(), name: "Owner", roleKey: "owner" }, bootstrapper());
  });
});
