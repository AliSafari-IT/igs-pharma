// igs-pharma#114 PR 3: a customer's own account. Every command acts on the actor and takes no user id,
// so one customer can never read or change another's row. Real Postgres, RBAC catalogue from the database.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { isDomainError } from "@igs/kernel";
import { type KernelTestHandles, actors, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getOwnAccount, loadRbacCatalogue, registerAuditActions, updateOwnProfile } from "../src";
import { users } from "../src/schema";

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
beforeEach(() => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date());
});

async function customer(name = "Ann Janssens", status: "active" | "suspended" = "active") {
  const [user] = await iso.db
    .insert(users)
    .values({ name, email: `${crypto.randomUUID()}@example.test`, status })
    .returning({ id: users.id });
  if (!user) throw new Error("insert failed");
  return {
    id: user.id,
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

describe("identity.self.account.get", () => {
  it("returns the signed-in customer's own profile", async () => {
    const { actor } = await customer("Ann Janssens");
    const account = await getOwnAccount({}, actor);
    expect(account).toMatchObject({ name: "Ann Janssens", locale: "nl", emailVerified: false });
    expect(account.email).toMatch(/@example\.test$/);
  });

  it("is refused to anyone without the customer permission (staff, anonymous)", async () => {
    expect(await codeOf(getOwnAccount({}, actors.user({ roles: ["owner"], kind: "staff" })))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(getOwnAccount({}, actors.anonymous()))).toBe("kernel.forbidden");
  });

  it("a suspended account is not found", async () => {
    const { actor } = await customer("Gone", "suspended");
    expect(await codeOf(getOwnAccount({}, actor))).toBe("identity.user_not_found");
  });
});

describe("identity.self.profile.update", () => {
  it("changes the name and the language of the actor's own row only", async () => {
    const mine = await customer("Ann");
    const other = await customer("Bob");
    await updateOwnProfile({ name: "  Anna Janssens ", locale: "fr" }, mine.actor);

    const [row] = await iso.db.select().from(users).where(eq(users.id, mine.id));
    expect(row).toMatchObject({ name: "Anna Janssens", locale: "fr" });
    const [untouched] = await iso.db.select().from(users).where(eq(users.id, other.id));
    expect(untouched).toMatchObject({ name: "Bob", locale: "nl" });
  });

  it("a partial update leaves the other field alone; an empty one is invalid", async () => {
    const { id, actor } = await customer("Ann");
    await updateOwnProfile({ locale: "de" }, actor);
    const [row] = await iso.db.select().from(users).where(eq(users.id, id));
    expect(row).toMatchObject({ name: "Ann", locale: "de" });
    expect(await codeOf(updateOwnProfile({}, actor))).toBe("kernel.validation_failed");
    expect(await codeOf(updateOwnProfile({ name: "   " }, actor))).toBe("kernel.validation_failed");
    expect(await codeOf(updateOwnProfile({ locale: "xx" }, actor))).toBe(
      "kernel.validation_failed",
    );
  });

  it("audits which fields changed, never the new name", async () => {
    const { id, actor } = await customer("Ann");
    await updateOwnProfile({ name: "Secret New Name" }, actor);
    const rows = await iso.sql<{ action: string; data: Record<string, unknown> }[]>`
      SELECT action, data FROM audit.events WHERE entity_id = ${id} ORDER BY seq`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "identity.profile.updated",
      data: { userId: id, nameChanged: true, localeChanged: false },
    });
    expect(JSON.stringify(rows)).not.toContain("Secret New Name");
  });

  it("is refused to staff and a suspended customer cannot change anything", async () => {
    expect(
      await codeOf(
        updateOwnProfile({ name: "X" }, actors.user({ roles: ["owner"], kind: "staff" })),
      ),
    ).toBe("kernel.forbidden");
    const { actor } = await customer("Gone", "suspended");
    expect(await codeOf(updateOwnProfile({ name: "X" }, actor))).toBe("identity.user_not_found");
  });
});
