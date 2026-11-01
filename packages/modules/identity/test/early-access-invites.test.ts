// igs-pharma#211: early access by invitation against real Postgres, with the RBAC catalogue loaded
// from the database and the real audit port: inviting (fresh passkey, never your own address, the
// same answer for known and unknown addresses), the one-open-invitation index, redeeming on a
// confirmed address only, cancelling, the invitation mail to an address with no account, the purge.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, getKernelRuntime, isDomainError, registerEvents } from "@igs/kernel";
import { type KernelTestHandles, actors, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  EARLY_ACCESS_INVITATION_DAYS,
  EARLY_ACCESS_RETENTION_MS,
  MailRequested,
  type MailToSend,
  cancelEarlyAccessInvitation,
  deliverMail,
  getOwnEarlyAccess,
  inviteEarlyAccess,
  issueEarlyAccessPass,
  listEarlyAccessRequests,
  loadRbacCatalogue,
  redeemEarlyAccessInvitation,
  registerAuditActions,
  requestEarlyAccess,
  revokeEarlyAccess,
  runEarlyAccessPurge,
} from "../src";
import { earlyAccessRequests, mailTokens, userRoles, users } from "../src/schema";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;
// the audit trail only has partitions from the current UTC month on: the clock follows the real month
const month = new Date();
const NOW = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 14, 12));
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
let current = NOW;
const setNow = (date: Date) => {
  current = date;
  kernel.clock.set(date);
};
const HOOK = actors.system({ id: "better-auth", roles: ["system_auth"] });

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

const address = () => `${crypto.randomUUID()}@example.test`;

async function createUser(
  kind: "customer" | "staff",
  fields: { email?: string; emailVerified?: boolean } = {},
) {
  const [user] = await iso.db
    .insert(users)
    .values({
      name: "An Peeters",
      email: fields.email ?? address(),
      kind,
      emailVerified: fields.emailVerified ?? true,
      locale: "fr",
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
async function owner(checkedAgo = 0, email?: string): Promise<Actor> {
  const id = await createUser("staff", email ? { email } : {});
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

/** The invitation rows of an address (any case). */
const invitationsOf = (email: string) =>
  iso.db
    .select()
    .from(earlyAccessRequests)
    .where(eq(earlyAccessRequests.invitedEmail, email.toLowerCase()));

const mailsTo = (email: string) =>
  iso.db.select().from(mailTokens).where(eq(mailTokens.toEmail, email));

const auditOf = (entityId: string) =>
  iso.sql<{ action: string; data: Record<string, unknown> }[]>`
    SELECT action, data FROM audit.events WHERE entity_id = ${entityId} ORDER BY seq`;

/** Confirms the customer's address, as Better Auth does, and runs the hook. */
async function confirm(person: Actor) {
  await iso.db.update(users).set({ emailVerified: true }).where(eq(users.id, person.id));
  return redeemEarlyAccessInvitation({ userId: person.id }, HOOK);
}

describe("inviting an address with no account", () => {
  it("stores an invitation with no user, queues one invitation mail, audits a hash only", async () => {
    const email = address();
    const boss = await owner();
    expect(
      await inviteEarlyAccess(
        { email: `  ${email.toUpperCase()} `, duration: "7d", locale: "de" },
        boss,
      ),
    ).toEqual({ ok: true });

    const [row] = await invitationsOf(email);
    expect(row).toMatchObject({
      userId: null,
      invitedEmail: email,
      status: "approved",
      decidedBy: boss.id,
      expiresAt: at(7 * DAY),
    });
    if (!row) throw new Error("no invitation");
    const mails = await mailsTo(email);
    expect(mails).toEqual([
      expect.objectContaining({
        userId: null,
        locale: "de",
        template: "early_access_invited",
        validUntil: at(7 * DAY),
      }),
    ]);

    const audit = await auditOf(row.id);
    expect(audit.map((e) => e.action)).toEqual(["identity.early_access.invited"]);
    expect(audit[0]?.data).toEqual({
      requestId: row.id,
      addressHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      duration: "7d",
    });
    expect(JSON.stringify(audit)).not.toContain(email.split("@")[0]);

    const list = await listEarlyAccessRequests({}, boss);
    expect(list.invited.map((item) => item.id)).toContain(row.id);
    expect(list.approved.map((item) => item.id)).not.toContain(row.id);
    const item = list.invited.find((i) => i.id === row.id);
    expect(item).toMatchObject({
      email,
      invitation: true,
      active: false,
      invitationEndsAt: at(7 * DAY),
    });
  });

  it("the worker sends the invitation to the address, in its language, greeting nobody", async () => {
    const email = address();
    await inviteEarlyAccess(
      {
        email,
        duration: "until_launch",
        locale: "en",
        link: "https://igs.example.test/early-access",
      },
      await owner(),
    );
    const [mail] = await mailsTo(email);
    if (!mail) throw new Error("no mail");
    const sent: MailToSend[] = [];
    await deliverMail(mail.id, async (m) => void sent.push(m), getKernelRuntime());
    expect(sent).toEqual([
      {
        to: email,
        name: "",
        locale: "en",
        template: "early_access_invited",
        url: "https://igs.example.test/early-access",
        validUntil: undefined,
      },
    ]);
    expect(await mailsTo(email)).toEqual([]);
  });

  it("inviting again renews the one invitation; the database keeps one per address", async () => {
    const email = address();
    await inviteEarlyAccess({ email, duration: "7d" }, await owner());
    setNow(at(DAY));
    await inviteEarlyAccess({ email: email.toUpperCase(), duration: "90d" }, await owner());
    const rows = await invitationsOf(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ requestedAt: at(DAY), expiresAt: at(91 * DAY) });

    // the index, whatever the code does: another open invitation in another case is refused
    await expect(
      iso.db
        .insert(earlyAccessRequests)
        .values({ invitedEmail: email.toUpperCase(), status: "approved", decidedAt: NOW }),
    ).rejects.toThrow();
  });

  it("needs a fresh passkey check, refuses the owner's own address, and other staff", async () => {
    const stale = await owner(11 * 60 * 1000);
    expect(await codeOf(inviteEarlyAccess({ email: address() }, stale))).toBe(
      "identity.fresh_mfa_required",
    );
    const mine = address();
    expect(
      await codeOf(inviteEarlyAccess({ email: mine.toUpperCase() }, await owner(0, mine))),
    ).toBe("identity.early_access.own_address");
    expect(await invitationsOf(mine)).toEqual([]);
    const an = await customer();
    expect(await codeOf(inviteEarlyAccess({ email: address() }, an))).toBe("kernel.forbidden");
    expect(await codeOf(inviteEarlyAccess({ email: "not an address" }, await owner()))).toBe(
      "kernel.validation_failed",
    );
  });
});

describe("redeeming on a confirmed address", () => {
  it("sign up with the address in another case and confirm it: the row is theirs, the shop opens", async () => {
    const email = address();
    await inviteEarlyAccess({ email, duration: "7d" }, await owner());
    const an = await customer({ email: email.toUpperCase(), emailVerified: false });

    // signed up, not confirmed: nothing
    expect(await redeemEarlyAccessInvitation({ userId: an.id }, HOOK)).toEqual({ redeemed: 0 });
    const [open] = await invitationsOf(email);
    expect(open?.userId).toBeNull();

    expect(await confirm(an)).toEqual({ redeemed: 1 });
    const [row] = await invitationsOf(email);
    expect(row).toMatchObject({ userId: an.id, status: "approved", expiresAt: at(7 * DAY) });
    if (!row) throw new Error("no row");
    expect(await getOwnEarlyAccess({}, an)).toEqual({ state: "approved", expiresAt: at(7 * DAY) });
    expect((await issueEarlyAccessPass({}, an)).granted).toBe(true);
    expect((await auditOf(row.id)).map((e) => e.action)).toEqual([
      "identity.early_access.invited",
      "identity.early_access.invitation_redeemed",
    ]);
    // a second confirmation (a changed address back again) redeems nothing more
    expect(await redeemEarlyAccessInvitation({ userId: an.id }, HOOK)).toEqual({ redeemed: 0 });
  });

  it("another address, or no confirmation, gives no access", async () => {
    const email = address();
    await inviteEarlyAccess({ email }, await owner());
    const other = await customer();
    expect(await redeemEarlyAccessInvitation({ userId: other.id }, HOOK)).toEqual({ redeemed: 0 });
    expect((await issueEarlyAccessPass({}, other)).granted).toBe(false);

    const unconfirmed = await customer({ email, emailVerified: false });
    expect(await redeemEarlyAccessInvitation({ userId: unconfirmed.id }, HOOK)).toEqual({
      redeemed: 0,
    });
    expect((await issueEarlyAccessPass({}, unconfirmed)).granted).toBe(false);
    expect((await invitationsOf(email))[0]?.userId).toBeNull();
  });

  it("the pass check redeems when the hook did not run", async () => {
    const email = address();
    await inviteEarlyAccess({ email, duration: "30d" }, await owner());
    const an = await customer({ email });
    expect((await issueEarlyAccessPass({}, an)).granted).toBe(true);
    expect((await invitationsOf(email))[0]?.userId).toBe(an.id);
  });

  it("an invitation past its window, or past its access end, is not redeemed", async () => {
    const late = address();
    await inviteEarlyAccess({ email: late, duration: "90d" }, await owner());
    const short = address();
    await inviteEarlyAccess({ email: short, duration: "7d" }, await owner());
    setNow(at(EARLY_ACCESS_INVITATION_DAYS * DAY + 1));
    expect(await confirm(await customer({ email: late, emailVerified: false }))).toEqual({
      redeemed: 0,
    });
    expect(await confirm(await customer({ email: short, emailVerified: false }))).toEqual({
      redeemed: 0,
    });
    const list = await listEarlyAccessRequests({}, await owner());
    const ids = (await invitationsOf(late)).map((r) => r.id);
    expect(list.invited.map((i) => i.id)).not.toEqual(expect.arrayContaining(ids));
    expect(list.history.map((i) => i.id)).toEqual(expect.arrayContaining(ids));
  });

  it("only the Better Auth hook's role redeems for someone else", async () => {
    const an = await customer();
    expect(await codeOf(redeemEarlyAccessInvitation({ userId: an.id }, an))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(redeemEarlyAccessInvitation({ userId: an.id }, await owner()))).toBe(
      "kernel.forbidden",
    );
  });
});

describe("inviting an address that already has a confirmed account", () => {
  it("grants at once, sends the approval mail and no invitation, and answers the same", async () => {
    const email = address();
    const an = await customer({ email });
    expect(
      await inviteEarlyAccess({ email: email.toUpperCase(), duration: "7d" }, await owner()),
    ).toEqual({ ok: true });
    expect(await getOwnEarlyAccess({}, an)).toEqual({ state: "approved", expiresAt: at(7 * DAY) });
    expect(await mailsTo(email)).toEqual([]);
    const mails = await iso.db.select().from(mailTokens).where(eq(mailTokens.userId, an.id));
    expect(mails.map((m) => m.template)).toEqual(["early_access_approved"]);
    // nothing waits as an invitation
    expect(
      await iso.db
        .select()
        .from(earlyAccessRequests)
        .where(
          and(isNull(earlyAccessRequests.userId), eq(earlyAccessRequests.invitedEmail, email)),
        ),
    ).toEqual([]);
  });

  it("approves their open request instead of adding a second row", async () => {
    const email = address();
    const an = await customer({ email });
    const { requestId } = await requestEarlyAccess({ note: "hi" }, an);
    await inviteEarlyAccess({ email, duration: "until_launch" }, await owner());
    const rows = await iso.db
      .select()
      .from(earlyAccessRequests)
      .where(eq(earlyAccessRequests.userId, an.id));
    expect(rows).toEqual([
      expect.objectContaining({ id: requestId, status: "approved", expiresAt: null }),
    ]);
  });
});

describe("cancelling", () => {
  it("an unredeemed invitation: a later sign-up gets nothing", async () => {
    const email = address();
    const boss = await owner();
    await inviteEarlyAccess({ email }, boss);
    const [row] = await invitationsOf(email);
    if (!row) throw new Error("no invitation");
    expect(
      await codeOf(cancelEarlyAccessInvitation({ requestId: row.id }, await owner(11 * 60 * 1000))),
    ).toBe("identity.fresh_mfa_required");
    expect(await cancelEarlyAccessInvitation({ requestId: row.id }, boss)).toEqual({ ok: true });
    expect(await confirm(await customer({ email, emailVerified: false }))).toEqual({ redeemed: 0 });
    expect((await auditOf(row.id)).map((e) => e.action)).toEqual([
      "identity.early_access.invited",
      "identity.early_access.invitation_cancelled",
    ]);
    expect(await codeOf(cancelEarlyAccessInvitation({ requestId: row.id }, boss))).toBe(
      "identity.early_access.state_changed",
    );
    // a cancelled invitation does not block a new one
    await inviteEarlyAccess({ email: address() }, boss);
    await inviteEarlyAccess({ email }, boss);
    expect((await invitationsOf(email)).map((r) => r.status).sort()).toEqual([
      "approved",
      "revoked",
    ]);
  });

  it("a redeemed one is a grant: revoking it ends the access", async () => {
    const email = address();
    const boss = await owner();
    await inviteEarlyAccess({ email }, boss);
    const an = await customer({ email });
    await confirm(an);
    const [row] = await invitationsOf(email);
    if (!row) throw new Error("no row");
    expect(await codeOf(cancelEarlyAccessInvitation({ requestId: row.id }, boss))).toBe(
      "identity.early_access.state_changed",
    );
    await revokeEarlyAccess({ requestId: row.id }, boss);
    expect((await issueEarlyAccessPass({}, an)).granted).toBe(false);
  });
});

describe("retention", () => {
  it("an unredeemed invitation goes 12 months after its window closed; redeemed grants stay", async () => {
    const gone = address();
    await inviteEarlyAccess({ email: gone, duration: "until_launch" }, await owner());
    const kept = address();
    await inviteEarlyAccess({ email: kept, duration: "until_launch" }, await owner());
    await confirm(await customer({ email: kept }));

    setNow(at(EARLY_ACCESS_INVITATION_DAYS * DAY + EARLY_ACCESS_RETENTION_MS - DAY));
    await runEarlyAccessPurge(getKernelRuntime());
    expect(await invitationsOf(gone)).toHaveLength(1);

    setNow(at(EARLY_ACCESS_INVITATION_DAYS * DAY + EARLY_ACCESS_RETENTION_MS + DAY));
    await runEarlyAccessPurge(getKernelRuntime());
    expect(await invitationsOf(gone)).toEqual([]);
    expect(await invitationsOf(kept)).toHaveLength(1);
  });
});
