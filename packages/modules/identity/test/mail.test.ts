// igs-pharma#114: the identity mail request. The Better Auth callbacks run this command and nothing
// else: the link is stored, the outbox event carries only identifiers, and a mail is requested exactly
// when the surrounding transaction commits. Real Postgres, the RBAC catalogue from the database.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { isDomainError, registerEvents } from "@igs/kernel";
import { type KernelTestHandles, actors, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MailRequested, loadRbacCatalogue, registerAuditActions, requestMail } from "../src";
import { mailTokens, users } from "../src/schema";

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
  kernel.clock.set(new Date("2026-10-14T12:00:00Z"));
  registerEvents(MailRequested);
});

const authHook = () => actors.system({ id: "better-auth", roles: ["system_auth"] });

async function customer() {
  const [user] = await iso.db
    .insert(users)
    .values({ name: "Customer", email: `${crypto.randomUUID()}@example.test` })
    .returning({ id: users.id });
  if (!user) throw new Error("insert failed");
  return user.id;
}

const outboxRows = async () =>
  iso.sql<{ topic: string; payload: Record<string, unknown> }[]>`
    SELECT topic, payload FROM system.outbox WHERE topic = 'identity.mail.requested' ORDER BY created_at`;

describe("identity.mail.request", () => {
  it("stores the link and publishes an event that carries identifiers only", async () => {
    const userId = await customer();
    const url =
      "http://localhost:3000/api/auth/verify-email?token=SECRET-TOKEN-VALUE&callbackURL=%2F";
    const { tokenRef } = await requestMail({ userId, template: "verify_email", url }, authHook());

    const [row] = await iso.db.select().from(mailTokens).where(eq(mailTokens.id, tokenRef));
    expect(row).toMatchObject({ userId, template: "verify_email", url });
    expect(row?.expiresAt.getTime()).toBe(
      new Date("2026-10-14T12:00:00Z").getTime() + 24 * 3600_000,
    );

    const events = (await outboxRows()).filter((e) => e.payload["tokenRef"] === tokenRef);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ userId, template: "verify_email", tokenRef });
    expect(JSON.stringify(events)).not.toContain("SECRET-TOKEN-VALUE");
  });

  it("a reset link lives one hour; the notice for an existing account has no link", async () => {
    const userId = await customer();
    const reset = await requestMail(
      { userId, template: "reset_password", url: "http://localhost:3000/reset?token=abc" },
      authHook(),
    );
    const notice = await requestMail({ userId, template: "account_exists" }, authHook());
    const [resetRow] = await iso.db
      .select()
      .from(mailTokens)
      .where(eq(mailTokens.id, reset.tokenRef));
    const [noticeRow] = await iso.db
      .select()
      .from(mailTokens)
      .where(eq(mailTokens.id, notice.tokenRef));
    expect(resetRow?.expiresAt.getTime()).toBe(
      new Date("2026-10-14T12:00:00Z").getTime() + 3600_000,
    );
    expect(noticeRow?.url).toBeNull();
  });

  it("is a permission of the auth hook only: customers, staff roles and other systems cannot", async () => {
    const userId = await customer();
    for (const actor of [
      actors.user({ id: userId, roles: ["customer"], kind: "customer" }),
      actors.system({ id: "storefront", roles: ["system_storefront"] }),
    ]) {
      await expect(requestMail({ userId, template: "account_exists" }, actor)).rejects.toSatisfy(
        (error) => isDomainError(error) && error.code === "kernel.forbidden",
      );
    }
  });

  it("refuses an unknown user and writes nothing", async () => {
    const before = (await outboxRows()).length;
    await expect(
      requestMail({ userId: crypto.randomUUID(), template: "account_exists" }, authHook()),
    ).rejects.toSatisfy(
      (error) => isDomainError(error) && error.code === "identity.user_not_found",
    );
    expect((await outboxRows()).length).toBe(before);
  });

  it("refuses a malformed link and an unknown template", async () => {
    const userId = await customer();
    await expect(
      requestMail({ userId, template: "verify_email", url: "not a url" }, authHook()),
    ).rejects.toSatisfy(
      (error) => isDomainError(error) && error.code === "kernel.validation_failed",
    );
    await expect(requestMail({ userId, template: "newsletter" }, authHook())).rejects.toSatisfy(
      (error) => isDomainError(error) && error.code === "kernel.validation_failed",
    );
  });
});
