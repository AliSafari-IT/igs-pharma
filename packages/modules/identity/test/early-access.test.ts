// igs-pharma#199: early access to the gated storefront against real Postgres, with the RBAC catalogue
// loaded from the database and the real audit port: the request lifecycle, the one-open-request
// index, the staff decisions (fresh MFA, never your own), the pass check, the mails and the purge.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, getKernelRuntime, isDomainError, registerEvents } from "@igs/kernel";
import { type KernelTestHandles, actors, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  EARLY_ACCESS_PASS_TTL_MS,
  MailRequested,
  type MailToSend,
  approveEarlyAccess,
  deliverMail,
  getOwnEarlyAccess,
  issueEarlyAccessPass,
  listEarlyAccessRequests,
  loadRbacCatalogue,
  registerAuditActions,
  rejectEarlyAccess,
  requestEarlyAccess,
  revokeEarlyAccess,
  runEarlyAccessPurge,
} from "../src";
import { earlyAccessRequests, mailTokens, userRoles, users } from "../src/schema";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;
const NOW = new Date("2026-10-31T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
/** The test clock; owners prove their passkey "now" by this clock. */
let current = NOW;
const setNow = (date: Date) => {
  current = date;
  kernel.clock.set(date);
};

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
  setNow(NOW);
  registerEvents(MailRequested);
});

async function createUser(
  kind: "customer" | "staff",
  fields: { emailVerified?: boolean; locale?: "nl" | "fr" | "de" | "en" } = {},
) {
  const [user] = await iso.db
    .insert(users)
    .values({
      name: "An Peeters",
      email: `${crypto.randomUUID()}@example.test`,
      kind,
      emailVerified: fields.emailVerified ?? true,
      locale: fields.locale ?? "nl",
    })
    .returning({ id: users.id });
  if (!user) throw new Error("insert failed");
  return user.id;
}

async function customer(fields: Parameters<typeof createUser>[1] = {}): Promise<Actor> {
  const id = await createUser("customer", fields);
  await iso.db.insert(userRoles).values({ userId: id, roleKey: "customer" });
  return actors.user({ id, roles: ["customer"], kind: "customer" });
}

/** An owner whose passkey check is `checkedAgo` old (fresh by default). */
async function owner(checkedAgo = 0): Promise<Actor> {
  const id = await createUser("staff");
  await iso.db.insert(userRoles).values({ userId: id, roleKey: "owner" });
  const checkedAt = new Date(current.getTime() - checkedAgo);
  return actors.user({
    id,
    roles: ["owner"],
    kind: "staff",
    mfaVerifiedAt: checkedAt,
    passkeyCheckedAt: checkedAt,
  });
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

const rowsOf = (userId: string) =>
  iso.db.select().from(earlyAccessRequests).where(eq(earlyAccessRequests.userId, userId));

const mailsOf = async (userId: string) =>
  (await iso.db.select().from(mailTokens).where(eq(mailTokens.userId, userId)))
    .map((row) => row.template)
    .sort();

const auditOf = (entityId: string) =>
  iso.sql<{ action: string; actor_id: string; data: Record<string, unknown> }[]>`
    SELECT action, actor_id, data FROM audit.events WHERE entity_id = ${entityId} ORDER BY seq`;

async function pending(person: Actor, note?: string) {
  const { requestId } = await requestEarlyAccess(note === undefined ? {} : { note }, person);
  return requestId;
}

describe("asking for early access", () => {
  it("a verified customer asks once; asking again updates the note and adds no row", async () => {
    const an = await customer();
    expect(await getOwnEarlyAccess({}, an)).toEqual({ state: "none" });

    const first = await requestEarlyAccess({ note: "  I test for the pharmacy  " }, an);
    expect(first.created).toBe(true);
    const again = await requestEarlyAccess({ note: "Second try" }, an);
    expect(again).toEqual({ requestId: first.requestId, created: false });

    const rows = await rowsOf(an.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", note: "Second try", decidedAt: null });
    expect(await getOwnEarlyAccess({}, an)).toEqual({
      state: "pending",
      requestedAt: NOW,
      note: "Second try",
    });
    // a receipt and a staff notice for the new request, nothing for the update
    expect(await mailsOf(an.id)).toEqual(["early_access_received", "early_access_staff_notice"]);
    // audited with flags only: the note is in no audit row
    const audit = await auditOf(first.requestId);
    expect(audit.map((row) => [row.action, row.data])).toEqual([
      [
        "identity.early_access.requested",
        { requestId: first.requestId, userId: an.id, updated: false, hasNote: true },
      ],
      [
        "identity.early_access.requested",
        { requestId: first.requestId, userId: an.id, updated: true, hasNote: true },
      ],
    ]);
    expect(JSON.stringify(audit)).not.toContain("Second try");
  });

  it("an empty note is none; a note over 500 characters is refused", async () => {
    const an = await customer();
    await requestEarlyAccess({ note: "   " }, an);
    expect((await rowsOf(an.id))[0]?.note).toBeNull();
    expect(await codeOf(requestEarlyAccess({ note: "x".repeat(501) }, an))).toBe(
      "kernel.validation_failed",
    );
  });

  it("the database keeps one open request per person, whatever the code does", async () => {
    const an = await customer();
    await pending(an);
    await expect(
      iso.db.insert(earlyAccessRequests).values({ userId: an.id, status: "pending" }),
    ).rejects.toThrow(/early_access_requests_one_pending/);
  });

  it("refuses an unverified e-mail, staff and anonymous visitors", async () => {
    const unverified = await customer({ emailVerified: false });
    expect(await codeOf(requestEarlyAccess({}, unverified))).toBe("identity.email_not_verified");
    expect(await rowsOf(unverified.id)).toEqual([]);
    expect(await codeOf(requestEarlyAccess({}, await owner()))).toBe("kernel.forbidden");
    expect(await codeOf(requestEarlyAccess({}, actors.anonymous()))).toBe("kernel.forbidden");
  });
});

describe("staff decisions", () => {
  it("approve (30 days by default) → the pass is issued, ending with the pass lifetime", async () => {
    const an = await customer({ locale: "fr" });
    const boss = await owner();
    const requestId = await pending(an);

    expect(await issueEarlyAccessPass({}, an)).toEqual({ granted: false, until: null });
    await approveEarlyAccess({ requestId, link: "https://shop.example/early-access" }, boss);

    const [row] = await rowsOf(an.id);
    expect(row).toMatchObject({
      status: "approved",
      decidedBy: boss.id,
      decidedAt: NOW,
      expiresAt: at(30 * DAY),
    });
    expect(await getOwnEarlyAccess({}, an)).toEqual({ state: "approved", expiresAt: at(30 * DAY) });
    expect(await issueEarlyAccessPass({}, an)).toEqual({
      granted: true,
      until: at(EARLY_ACCESS_PASS_TTL_MS),
    });
    const [mail] = await iso.db
      .select()
      .from(mailTokens)
      .where(and(eq(mailTokens.template, "early_access_approved"), eq(mailTokens.userId, an.id)));
    expect(mail).toMatchObject({
      userId: an.id,
      url: "https://shop.example/early-access",
      validUntil: at(30 * DAY),
    });
    const audit = await auditOf(requestId);
    expect(audit.at(-1)).toEqual({
      action: "identity.early_access.approved",
      actor_id: boss.id,
      data: { requestId, userId: an.id, duration: "30d", extended: false },
    });
    // both pass outcomes are audited against the person
    const passes = (await auditOf(an.id)).filter((r) => r.action.includes("early_access"));
    expect(passes.map((r) => r.action)).toEqual([
      "identity.early_access.pass_refused",
      "identity.early_access.pass_issued",
    ]);
  });

  it("a grant ending before the pass would makes the pass end with it; until launch has no end", async () => {
    const an = await customer();
    const boss = await owner();
    await approveEarlyAccess({ requestId: await pending(an), duration: "7d" }, boss);
    setNow(at(7 * DAY - 60_000));
    expect(await issueEarlyAccessPass({}, an)).toEqual({ granted: true, until: at(7 * DAY) });
    setNow(at(7 * DAY));
    expect(await issueEarlyAccessPass({}, an)).toEqual({ granted: false, until: null });
    expect(await getOwnEarlyAccess({}, an)).toEqual({ state: "expired", expiredAt: at(7 * DAY) });

    // expired: they may ask again at once, and an approval until launch has no end date
    const again = await pending(an);
    await approveEarlyAccess({ requestId: again, duration: "until_launch" }, await owner());
    expect(await getOwnEarlyAccess({}, an)).toEqual({ state: "approved", expiresAt: null });
    setNow(at(60 * DAY)); // (audit partitions exist only a few months ahead of the real clock)
    expect((await issueEarlyAccessPass({}, an)).granted).toBe(true);
  });

  it("approving an active grant again extends it", async () => {
    const an = await customer();
    const boss = await owner();
    const requestId = await pending(an);
    await approveEarlyAccess({ requestId, duration: "7d" }, boss);
    setNow(at(5 * DAY));
    await approveEarlyAccess({ requestId, duration: "90d" }, await owner());
    expect((await rowsOf(an.id))[0]?.expiresAt).toEqual(at(95 * DAY));
    expect((await auditOf(requestId)).at(-1)?.data).toMatchObject({ extended: true });
  });

  it("reject: the reason is kept for the person, they may ask again after 30 days", async () => {
    const an = await customer();
    const boss = await owner();
    const requestId = await pending(an);
    await rejectEarlyAccess({ requestId, reason: "Testers only for now" }, boss);

    expect(await getOwnEarlyAccess({}, an)).toEqual({
      state: "rejected",
      reason: "Testers only for now",
      askAgainAt: at(30 * DAY),
    });
    expect(await codeOf(requestEarlyAccess({}, an))).toBe("identity.early_access.too_soon");
    expect(await mailsOf(an.id)).toContain("early_access_rejected");
    const audit = await auditOf(requestId);
    expect(audit.at(-1)?.data).toEqual({ requestId, userId: an.id, hasReason: true });
    expect(JSON.stringify(audit)).not.toContain("Testers only");

    setNow(at(30 * DAY));
    expect((await requestEarlyAccess({}, an)).created).toBe(true);
    expect(await rowsOf(an.id)).toHaveLength(2);
  });

  it("revoke ends an active grant at once for the next pass check", async () => {
    const an = await customer();
    const boss = await owner();
    const requestId = await pending(an);
    await approveEarlyAccess({ requestId }, boss);
    await revokeEarlyAccess({ requestId }, boss);
    expect(await issueEarlyAccessPass({}, an)).toEqual({ granted: false, until: null });
    expect(await getOwnEarlyAccess({}, an)).toMatchObject({ state: "revoked", reason: null });
    expect(await mailsOf(an.id)).toContain("early_access_revoked");
    expect(await codeOf(requestEarlyAccess({}, an))).toBe("identity.early_access.too_soon");
  });

  it("refuses a decision that no longer fits the request's state", async () => {
    const an = await customer();
    const boss = await owner();
    const requestId = await pending(an);
    expect(await codeOf(revokeEarlyAccess({ requestId }, boss))).toBe(
      "identity.early_access.state_changed",
    );
    await rejectEarlyAccess({ requestId }, boss);
    expect(await codeOf(approveEarlyAccess({ requestId }, boss))).toBe(
      "identity.early_access.state_changed",
    );
    expect(await codeOf(rejectEarlyAccess({ requestId }, boss))).toBe(
      "identity.early_access.state_changed",
    );
    expect(await codeOf(approveEarlyAccess({ requestId: crypto.randomUUID() }, boss))).toBe(
      "identity.early_access.not_found",
    );
  });

  it("needs a fresh passkey check, and never decides the owner's own request", async () => {
    const an = await customer();
    const requestId = await pending(an);
    const stale = await owner(11 * 60 * 1000);
    expect(await codeOf(approveEarlyAccess({ requestId }, stale))).toBe(
      "identity.fresh_mfa_required",
    );
    expect((await rowsOf(an.id))[0]?.status).toBe("pending");

    // an owner with a request of their own (a row put there directly: staff cannot ask)
    const boss = await owner();
    const [own] = await iso.db
      .insert(earlyAccessRequests)
      .values({ userId: boss.id })
      .returning({ id: earlyAccessRequests.id });
    if (!own) throw new Error("insert failed");
    expect(await codeOf(approveEarlyAccess({ requestId: own.id }, boss))).toBe(
      "identity.early_access.own_request",
    );
    // a second owner may
    expect(await codeOf(approveEarlyAccess({ requestId: own.id }, await owner()))).toBe("ok");
  });

  it("only the owner decides: other staff and customers are refused", async () => {
    const an = await customer();
    const requestId = await pending(an);
    const pharmacistId = await createUser("staff");
    await iso.db.insert(userRoles).values({ userId: pharmacistId, roleKey: "pharmacist_titular" });
    const titular = actors.user({
      id: pharmacistId,
      roles: ["pharmacist_titular"],
      kind: "staff",
      passkeyCheckedAt: NOW,
    });
    for (const actor of [titular, an, await customer()]) {
      expect(await codeOf(approveEarlyAccess({ requestId }, actor))).toBe("kernel.forbidden");
      expect(await codeOf(listEarlyAccessRequests({}, actor))).toBe("kernel.forbidden");
    }
  });
});

describe("the back-office list", () => {
  it("pending oldest first, active grants by end, then the history", async () => {
    const boss = await owner();
    const first = await customer();
    const second = await customer();
    const granted = await customer();
    const ended = await customer();
    const firstId = await pending(first, "Pick me");
    setNow(at(60_000));
    const secondId = await pending(second);
    const grantId = await pending(granted);
    await approveEarlyAccess({ requestId: grantId, duration: "7d" }, boss);
    const endedId = await pending(ended);
    await rejectEarlyAccess({ requestId: endedId }, boss);

    const list = await listEarlyAccessRequests({}, boss);
    const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);
    expect(ids(list.pending).filter((id) => [firstId, secondId].includes(id))).toEqual([
      firstId,
      secondId,
    ]);
    expect(list.pending.find((item) => item.id === firstId)).toMatchObject({
      userId: first.id,
      name: "An Peeters",
      emailVerified: true,
      note: "Pick me",
      active: false,
    });
    expect(list.approved.find((item) => item.id === grantId)).toMatchObject({
      active: true,
      decidedByName: "An Peeters",
    });
    expect(ids(list.history)).toContain(endedId);
    expect(ids(list.history)).not.toContain(grantId);
  });
});

describe("mails and retention", () => {
  it("the staff notice goes to the configured list, one mail each, and names nobody", async () => {
    const an = await customer();
    await pending(an);
    const [notice] = await iso.db
      .select()
      .from(mailTokens)
      .where(
        and(eq(mailTokens.template, "early_access_staff_notice"), eq(mailTokens.userId, an.id)),
      );
    if (!notice) throw new Error("no notice");
    const sent: MailToSend[] = [];
    const send = async (mail: MailToSend) => void sent.push(mail);

    const runtime = getKernelRuntime();
    expect(
      await deliverMail(notice.id, send, runtime, {
        staffRecipients: ["owner@example.be", "pharmacy@example.be"],
      }),
    ).toBe("sent");
    expect(sent).toEqual([
      expect.objectContaining({ to: "owner@example.be", name: "", locale: "en", url: undefined }),
      expect.objectContaining({ to: "pharmacy@example.be", name: "", locale: "en" }),
    ]);
    expect(sent.map((mail) => mail.to)).not.toContain(expect.stringContaining("example.test"));
  });

  it("without a staff list the notice is dropped, never sent to the requester", async () => {
    const an = await customer();
    await pending(an);
    const [notice] = await iso.db
      .select()
      .from(mailTokens)
      .where(
        and(eq(mailTokens.template, "early_access_staff_notice"), eq(mailTokens.userId, an.id)),
      );
    if (!notice) throw new Error("no notice");
    const sent: MailToSend[] = [];
    expect(await deliverMail(notice.id, async (m) => void sent.push(m), getKernelRuntime())).toBe(
      "skipped",
    );
    expect(sent).toEqual([]);
    expect(await iso.db.select().from(mailTokens).where(eq(mailTokens.id, notice.id))).toEqual([]);
  });

  it("the approval mail carries its end date to the sender", async () => {
    const an = await customer({ locale: "de" });
    await approveEarlyAccess({ requestId: await pending(an), duration: "90d" }, await owner());
    const [mail] = await iso.db
      .select()
      .from(mailTokens)
      .where(and(eq(mailTokens.template, "early_access_approved"), eq(mailTokens.userId, an.id)));
    if (!mail) throw new Error("no mail");
    const sent: MailToSend[] = [];
    await deliverMail(mail.id, async (m) => void sent.push(m), getKernelRuntime());
    expect(sent).toEqual([
      expect.objectContaining({ locale: "de", validUntil: at(90 * DAY), url: undefined }),
    ]);
  });

  it("ended requests go 12 months after they end; open requests and grants stay", async () => {
    await iso.db.delete(earlyAccessRequests);
    const boss = await owner();
    const open = await customer();
    const rejected = await customer();
    const expired = await customer();
    const untilLaunch = await customer();
    await pending(open);
    await rejectEarlyAccess({ requestId: await pending(rejected) }, boss);
    await approveEarlyAccess({ requestId: await pending(expired), duration: "7d" }, boss);
    await approveEarlyAccess(
      { requestId: await pending(untilLaunch), duration: "until_launch" },
      boss,
    );

    setNow(at(364 * DAY));
    expect(await runEarlyAccessPurge(getKernelRuntime())).toBe(0);
    setNow(at(365 * DAY + 1));
    expect(await runEarlyAccessPurge(getKernelRuntime())).toBe(1); // the rejection
    setNow(at(372 * DAY + 1));
    expect(await runEarlyAccessPurge(getKernelRuntime())).toBe(1); // the 7-day grant
    const left = await iso.db.select().from(earlyAccessRequests);
    expect(left.map((row) => row.userId).sort()).toEqual([open.id, untilLaunch.id].sort());
  });

  it("erasing a user deletes their requests (GDPR)", async () => {
    const an = await customer();
    await pending(an);
    await iso.db.delete(mailTokens).where(eq(mailTokens.userId, an.id));
    await iso.db.delete(userRoles).where(eq(userRoles.userId, an.id));
    await iso.db.delete(users).where(eq(users.id, an.id));
    expect(await rowsOf(an.id)).toEqual([]);
  });
});
