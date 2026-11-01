// igs-pharma#114: the worker side of the identity mails against real Postgres. The mail_tokens row is
// the idempotency token: sent once, deleted after the send, expired rows never sent and purged.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { registerEvents } from "@igs/kernel";
import { type KernelTestHandles, actors, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IDENTITY_QUEUES,
  MailRequested,
  type MailToSend,
  deliverMail,
  handleMailJobs,
  loadRbacCatalogue,
  registerAuditActions,
  registerIdentityJobs,
  requestMail,
  runMailPurge,
} from "../src";
import { mailTokens, users } from "../src/schema";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;
// The audit trail only has partitions for the current UTC month onward, so the test clock follows
// the real month (a fixed date broke on the first day of the next month).
const month = new Date();
const inThisMonth = (day: number, hour: number) =>
  new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day, hour));
const NOW = inThisMonth(14, 12);

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
  registerEvents(MailRequested);
});

const hook = () => actors.system({ id: "better-auth", roles: ["system_auth"] });
const LINK = "http://localhost:3000/api/auth/verify-email?token=SECRET-LINK-TOKEN";

async function customer(locale: "nl" | "fr" | "de" | "en" = "nl") {
  const [user] = await iso.db
    .insert(users)
    .values({ name: "An Peeters", email: `${crypto.randomUUID()}@example.test`, locale })
    .returning();
  if (!user) throw new Error("insert failed");
  return user;
}

const rowCount = async (id: string) =>
  (await iso.db.select().from(mailTokens).where(eq(mailTokens.id, id))).length;

function recorder() {
  const sent: MailToSend[] = [];
  return { sent, send: async (mail: MailToSend) => void sent.push(mail) };
}

describe("deliverMail", () => {
  it("sends the mail in the person's language to their address, then deletes the row", async () => {
    const user = await customer("fr");
    const { tokenRef } = await requestMail(
      { userId: user.id, template: "verify_email", url: LINK },
      hook(),
    );
    const { sent, send } = recorder();
    expect(await deliverMail(tokenRef, send)).toBe("sent");
    expect(sent).toEqual([
      {
        to: user.email,
        name: "An Peeters",
        locale: "fr",
        template: "verify_email",
        url: LINK,
      },
    ]);
    expect(await rowCount(tokenRef)).toBe(0);
  });

  it("a redelivered event sends nothing: the row is gone", async () => {
    const user = await customer();
    const { tokenRef } = await requestMail({ userId: user.id, template: "account_exists" }, hook());
    const { sent, send } = recorder();
    expect(await deliverMail(tokenRef, send)).toBe("sent");
    expect(await deliverMail(tokenRef, send)).toBe("skipped");
    expect(sent).toHaveLength(1);
  });

  it("a failed send throws and keeps the row, so the retry sends the mail", async () => {
    const user = await customer();
    const { tokenRef } = await requestMail(
      { userId: user.id, template: "reset_password", url: LINK },
      hook(),
    );
    await expect(
      deliverMail(tokenRef, async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
    expect(await rowCount(tokenRef)).toBe(1);
    const { sent, send } = recorder();
    expect(await deliverMail(tokenRef, send)).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("an expired link is never sent, and its row is removed", async () => {
    const user = await customer();
    const { tokenRef } = await requestMail(
      { userId: user.id, template: "reset_password", url: LINK },
      hook(),
    );
    kernel.clock.set(new Date(NOW.getTime() + 2 * 3600_000)); // the reset link lives one hour
    const { sent, send } = recorder();
    expect(await deliverMail(tokenRef, send)).toBe("skipped");
    expect(sent).toEqual([]);
    expect(await rowCount(tokenRef)).toBe(0);
  });

  it("a person who is no longer active gets nothing", async () => {
    const user = await customer();
    const { tokenRef } = await requestMail(
      { userId: user.id, template: "verify_email", url: LINK },
      hook(),
    );
    await iso.db.update(users).set({ status: "suspended" }).where(eq(users.id, user.id));
    const { sent, send } = recorder();
    expect(await deliverMail(tokenRef, send)).toBe("skipped");
    expect(sent).toEqual([]);
    expect(await rowCount(tokenRef)).toBe(0);
  });

  it("an unknown reference is skipped", async () => {
    const { sent, send } = recorder();
    expect(await deliverMail(crypto.randomUUID(), send)).toBe("skipped");
    expect(sent).toEqual([]);
  });
});

describe("handleMailJobs", () => {
  it("handles the outbox envelope the relay delivers and logs no address and no link", async () => {
    const user = await customer();
    const { tokenRef } = await requestMail(
      { userId: user.id, template: "verify_email", url: LINK },
      hook(),
    );
    const [event] = await iso.sql<{ id: string; payload: unknown }[]>`
      SELECT id, payload FROM system.outbox WHERE payload->>'tokenRef' = ${tokenRef}`;
    const info = vi.fn();
    const warn = vi.fn();
    const { sent, send } = recorder();
    await handleMailJobs(
      [
        {
          data: {
            eventId: event?.id,
            topic: MailRequested.topic,
            schemaVersion: 1,
            payload: event?.payload,
          },
        },
      ],
      send,
      { db: iso.db, metrics: kernel.metrics, logger: { info, warn }, now: () => NOW } as never,
    );
    expect(sent).toHaveLength(1);
    const logged = JSON.stringify([info.mock.calls, warn.mock.calls]);
    expect(logged).not.toContain("SECRET-LINK-TOKEN");
    expect(logged).not.toContain(user.email);
    expect(logged).toContain("identity.mail.handled");
  });

  it("drops a payload that cannot be read, without throwing and without logging its content", async () => {
    const warn = vi.fn();
    const { sent, send } = recorder();
    await handleMailJobs(
      [
        { data: { eventId: "e1", payload: { tokenRef: "not-a-uuid", secret: "S3CR3T" } } },
        { data: null },
      ],
      send,
      {
        db: iso.db,
        metrics: kernel.metrics,
        logger: { info: vi.fn(), warn },
        now: () => NOW,
      } as never,
    );
    expect(sent).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("S3CR3T");
  });
});

describe("runMailPurge", () => {
  it("removes expired rows only", async () => {
    const user = await customer();
    const fresh = await requestMail({ userId: user.id, template: "account_exists" }, hook());
    const stale = await requestMail(
      { userId: user.id, template: "reset_password", url: LINK },
      hook(),
    );
    kernel.clock.set(new Date(NOW.getTime() + 2 * 3600_000)); // past the reset link, inside the 24 h
    expect(await runMailPurge()).toBeGreaterThanOrEqual(1);
    expect(await rowCount(stale.tokenRef)).toBe(0);
    expect(await rowCount(fresh.tokenRef)).toBe(1);
  });
});

describe("registerIdentityJobs", () => {
  it("checks the queues, schedules the purge and registers the mail topic and the purge handlers", async () => {
    const worked = new Map<string, (jobs: never[]) => Promise<void>>();
    const boss = {
      getQueue: vi.fn(async (_name: string) => ({})),
      schedule: vi.fn(async () => {}),
      work: vi.fn(async (name: string, handler: (jobs: never[]) => Promise<void>) => {
        worked.set(name, handler);
      }),
    };
    const { send } = recorder();
    await registerIdentityJobs(boss as never, send);
    expect(boss.getQueue.mock.calls.map(([name]) => name).sort()).toEqual(
      [...IDENTITY_QUEUES, MailRequested.topic].sort(),
    );
    expect(boss.schedule).toHaveBeenCalledWith(
      "identity.mail.purge",
      "7 0-1,3-23 * * *",
      undefined,
      {
        tz: "Europe/Brussels",
      },
    );
    // igs-pharma#199: the early-access retention purge, daily outside the DST hour
    expect(boss.schedule).toHaveBeenCalledWith(
      "identity.early_access.purge",
      "37 4 * * *",
      undefined,
      {
        tz: "Europe/Brussels",
      },
    );
    expect([...worked.keys()].sort()).toEqual(
      [
        MailRequested.topic,
        "identity.mail.purge",
        "identity.mail.purge.failed",
        "identity.early_access.purge",
        "identity.early_access.purge.failed",
      ].sort(),
    );
  });

  it("refuses to start when a queue is missing (the migrate entry has not run)", async () => {
    const boss = { getQueue: async () => null, schedule: vi.fn(), work: vi.fn() };
    await expect(registerIdentityJobs(boss as never, recorder().send)).rejects.toThrow(
      /kernel\.queue_missing/,
    );
  });
});
