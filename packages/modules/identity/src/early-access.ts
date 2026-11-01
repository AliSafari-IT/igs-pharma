import { createHash } from "node:crypto";

import { type Ctx, command, conflict, forbidden, notFound, query } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { aliasedTable, and, desc, eq, gt, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { IDENTITY_AUDIT } from "./audit";
import { requireFreshMfa } from "./commands";
import { queueMail } from "./mail";
import {
  EARLY_ACCESS_TEXT_MAX,
  type EarlyAccessStatus,
  USER_LOCALES,
  earlyAccessRequests,
  users,
} from "./schema";

/**
 * Early access to the gated storefront (igs-pharma#199). Before launch (`SITE_GATE=coming-soon`) a
 * signed-in customer with a verified e-mail asks for access; an owner approves (for 7, 30 or 90 days,
 * or until launch), rejects or revokes. The storefront asks `issueEarlyAccessPass` for a short-lived
 * pass, and that command reads the grant from the database every time: nothing the browser holds is
 * ever trusted on its own.
 *
 * Customer commands act on `ctx.actor.id` and take no user id (`storefront.early_access.self.request`);
 * staff commands (`storefront.early_access.manage`, the owner only) need a fresh passkey check and
 * never decide the acting person's own request. Audit data carries identifiers and flags only: never
 * the note, a reason or a pass (D-028).
 *
 * Invitations (igs-pharma#211): an owner invites an e-mail address. The row is `approved` with no
 * `user_id`; when a customer CONFIRMS that address, the row gets their `user_id` and the shop opens
 * for them (`redeemEarlyAccessInvitation`, run by the Better Auth hook; the pass check and a request
 * redeem too, in case the hook failed). An address that already belongs to a verified customer gets
 * the grant at once. The invite answers the same either way, so the form never tells whether an
 * address has an account.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long an approval lasts. `until_launch` ends when the gate is switched off (and has no date). */
export const EARLY_ACCESS_DURATIONS = ["7d", "30d", "90d", "until_launch"] as const;
export type EarlyAccessDuration = (typeof EARLY_ACCESS_DURATIONS)[number];
export const DEFAULT_EARLY_ACCESS_DURATION: EarlyAccessDuration = "30d";

const DURATION_DAYS: Record<Exclude<EarlyAccessDuration, "until_launch">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** After a rejection or a revocation, the person may ask again only after this many days. */
export const EARLY_ACCESS_REASK_DAYS = 30;

/**
 * How long a storefront pass lives before the storefront asks again (igs-pharma#199, decision 2): the
 * longest a revoked or expired grant keeps showing the shop.
 */
export const EARLY_ACCESS_PASS_TTL_MS = 15 * 60 * 1000;

/** Optional free text: trimmed, at most 500 characters, empty = none. */
const optionalText = z
  .string()
  .trim()
  .max(EARLY_ACCESS_TEXT_MAX)
  .optional()
  .transform((value) => (value ? value : null));

/**
 * How long an invitation can be redeemed (igs-pharma#211): an address nobody confirms within this many
 * days of the (last) invitation gets nothing. Never past the access's own end.
 */
export const EARLY_ACCESS_INVITATION_DAYS = 30;

/** When an invitation made (or renewed) at `invitedAt` can no longer be redeemed. */
export function invitationEndsAt(invitedAt: Date, expiresAt: Date | null): Date {
  const window = invitedAt.getTime() + EARLY_ACCESS_INVITATION_DAYS * DAY_MS;
  return new Date(expiresAt === null ? window : Math.min(window, expiresAt.getTime()));
}

/** SQL: an invitation (no user yet) that can still be redeemed at `now`. */
const openInvitation = (now: Date) =>
  and(
    isNull(earlyAccessRequests.userId),
    eq(earlyAccessRequests.status, "approved"),
    gt(
      earlyAccessRequests.requestedAt,
      new Date(now.getTime() - EARLY_ACCESS_INVITATION_DAYS * DAY_MS),
    ),
    or(isNull(earlyAccessRequests.expiresAt), gt(earlyAccessRequests.expiresAt, now)),
  );

/**
 * The address in an audit entry (igs-pharma#211): a hash, never the address, salted with the
 * invitation's id so a list of addresses cannot be matched against every entry at once.
 */
const addressHash = (requestId: string, email: string) =>
  createHash("sha256")
    .update(`igs-early-access-invitation/${requestId}/${email.trim().toLowerCase()}`, "utf8")
    .digest("hex");

/** Whether an approved row still grants access at `now`. */
const grantsAt = (row: { status: EarlyAccessStatus; expiresAt: Date | null }, now: Date) =>
  row.status === "approved" && (row.expiresAt === null || row.expiresAt.getTime() > now.getTime());

/** SQL twin of {@link grantsAt}. */
const activeGrant = (now: Date) =>
  and(
    eq(earlyAccessRequests.status, "approved"),
    or(isNull(earlyAccessRequests.expiresAt), gt(earlyAccessRequests.expiresAt, now)),
  );

// ── The customer's side ─────────────────────────────────────────────────────────────────────────

/** Where a person stands, as their own early-access page shows it. */
export type OwnEarlyAccess =
  | { readonly state: "none" }
  | { readonly state: "pending"; readonly requestedAt: Date; readonly note: string | null }
  | { readonly state: "approved"; readonly expiresAt: Date | null }
  | { readonly state: "expired"; readonly expiredAt: Date }
  | {
      readonly state: "rejected" | "revoked";
      readonly reason: string | null;
      /** From when they may ask again. */
      readonly askAgainAt: Date;
    };

interface Row {
  readonly id: string;
  readonly status: EarlyAccessStatus;
  readonly note: string | null;
  readonly requestedAt: Date;
  readonly decidedAt: Date | null;
  readonly decisionReason: string | null;
  readonly expiresAt: Date | null;
}

const rowColumns = {
  id: earlyAccessRequests.id,
  status: earlyAccessRequests.status,
  note: earlyAccessRequests.note,
  requestedAt: earlyAccessRequests.requestedAt,
  decidedAt: earlyAccessRequests.decidedAt,
  decisionReason: earlyAccessRequests.decisionReason,
  expiresAt: earlyAccessRequests.expiresAt,
};

/** The rows of one user, newest first. */
async function rowsOf(ctx: Pick<Ctx, "tx">, userId: string): Promise<Row[]> {
  return ctx.tx
    .select(rowColumns)
    .from(earlyAccessRequests)
    .where(eq(earlyAccessRequests.userId, userId))
    .orderBy(desc(earlyAccessRequests.requestedAt), desc(earlyAccessRequests.id));
}

/**
 * The state of a person from their rows: an active grant wins, then an open request, then the most
 * recent decision. Pure, so the page and the commands read the same thing.
 */
export function earlyAccessState(rows: readonly Row[], now: Date): OwnEarlyAccess {
  const grant = rows.find((row) => grantsAt(row, now));
  if (grant) return { state: "approved", expiresAt: grant.expiresAt };
  const pending = rows.find((row) => row.status === "pending");
  if (pending) return { state: "pending", requestedAt: pending.requestedAt, note: pending.note };
  const last = rows.find((row) => row.decidedAt !== null);
  if (!last?.decidedAt) return { state: "none" };
  if (last.status === "approved") {
    // an approved row that no longer grants: it expired (`expiresAt` is set, or it would grant)
    return { state: "expired", expiredAt: last.expiresAt ?? last.decidedAt };
  }
  if (last.status === "rejected" || last.status === "revoked") {
    return {
      state: last.status,
      reason: last.decisionReason,
      askAgainAt: new Date(last.decidedAt.getTime() + EARLY_ACCESS_REASK_DAYS * DAY_MS),
    };
  }
  return { state: "none" };
}

/** Whether a person in `state` may send a (new or updated) request at `now`. */
export function canAskForEarlyAccess(state: OwnEarlyAccess, now: Date): boolean {
  switch (state.state) {
    case "none":
    case "pending":
    case "expired":
      return true;
    case "approved":
      return false;
    case "rejected":
    case "revoked":
      return state.askAgainAt.getTime() <= now.getTime();
  }
}

/** The acting customer, active and verified, locked for the rest of the transaction (or a refusal). */
async function lockVerifiedCustomer(ctx: Ctx) {
  const [user] = await ctx.tx
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(and(eq(users.id, ctx.actor.id), eq(users.status, "active")))
    .for("update");
  if (!user) throw notFound("identity.user_not_found");
  if (!user.emailVerified) throw forbidden("identity.email_not_verified");
  return user;
}

/** The acting customer's own early-access state. */
export const getOwnEarlyAccess = query({
  name: "identity.early_access.self.get",
  input: z.object({}),
  permission: PERMISSIONS.storefront.earlyAccessSelf,
  async handler({ ctx }): Promise<OwnEarlyAccess> {
    return earlyAccessState(await rowsOf(ctx, ctx.actor.id), ctx.now);
  },
});

/**
 * Asks for early access, or updates the note of the open request (one open request per person: the
 * partial unique index, and the user row lock serialises two tabs). A new request queues a receipt to
 * the person and a notice to staff; an update queues nothing. Refused with
 * `identity.early_access.already_granted` while a grant is active and `identity.early_access.too_soon`
 * within {@link EARLY_ACCESS_REASK_DAYS} of a rejection or revocation.
 */
export const requestEarlyAccess = command({
  name: "identity.early_access.self.request",
  input: z.object({ note: optionalText }),
  output: z.object({ requestId: z.uuid(), created: z.boolean() }),
  permission: PERMISSIONS.storefront.earlyAccessSelf,
  async handler({ input, ctx }) {
    const user = await lockVerifiedCustomer(ctx);
    // an invitation the hook did not redeem (igs-pharma#211) is a grant, not a reason to ask
    await redeemInvitations(ctx, user.id);
    const state = earlyAccessState(await rowsOf(ctx, user.id), ctx.now);
    if (state.state === "approved") throw conflict("identity.early_access.already_granted");
    if (!canAskForEarlyAccess(state, ctx.now)) throw conflict("identity.early_access.too_soon");

    let requestId: string;
    let created: boolean;
    if (state.state === "pending") {
      const [row] = await ctx.tx
        .update(earlyAccessRequests)
        .set({ note: input.note, updatedAt: ctx.now })
        .where(
          and(eq(earlyAccessRequests.userId, user.id), eq(earlyAccessRequests.status, "pending")),
        )
        .returning({ id: earlyAccessRequests.id });
      if (!row) throw conflict("identity.early_access.state_changed");
      requestId = row.id;
      created = false;
    } else {
      const [row] = await ctx.tx
        .insert(earlyAccessRequests)
        .values({ userId: user.id, note: input.note, requestedAt: ctx.now })
        .returning({ id: earlyAccessRequests.id });
      if (!row) throw new Error("identity.early_access_not_stored");
      requestId = row.id;
      created = true;
    }
    await ctx.audit.record({
      action: IDENTITY_AUDIT.earlyAccessRequested,
      entityType: "early_access_request",
      entityId: requestId,
      data: { requestId, userId: user.id, updated: !created, hasNote: input.note !== null },
    });
    if (created) {
      await queueMail(ctx, { userId: user.id, template: "early_access_received" });
      await queueMail(ctx, { userId: user.id, template: "early_access_staff_notice" });
    }
    return { requestId, created };
  },
});

/**
 * The storefront pass check (igs-pharma#199): whether the acting customer holds an active grant NOW,
 * read from the database on every call. `until` is when the pass the storefront issues must end: the
 * pass lifetime, or the grant's end if that is sooner. Both outcomes are audited.
 */
export const issueEarlyAccessPass = command({
  name: "identity.early_access.self.pass",
  input: z.object({}),
  output: z.object({ granted: z.boolean(), until: z.date().nullable() }),
  permission: PERMISSIONS.storefront.earlyAccessSelf,
  async handler({ ctx }) {
    // igs-pharma#211: the e-mail hook redeems; this catches a confirmation whose hook failed
    await redeemInvitations(ctx, ctx.actor.id);
    const [grant] = await ctx.tx
      .select({ expiresAt: earlyAccessRequests.expiresAt })
      .from(earlyAccessRequests)
      .innerJoin(users, eq(users.id, earlyAccessRequests.userId))
      .where(
        and(
          eq(earlyAccessRequests.userId, ctx.actor.id),
          activeGrant(ctx.now),
          eq(users.status, "active"),
          eq(users.emailVerified, true),
        ),
      )
      .limit(1);
    const granted = grant !== undefined;
    await ctx.audit.record({
      action: granted
        ? IDENTITY_AUDIT.earlyAccessPassIssued
        : IDENTITY_AUDIT.earlyAccessPassRefused,
      entityType: "user",
      entityId: ctx.actor.id,
      data: { userId: ctx.actor.id },
    });
    if (!grant) return { granted: false, until: null };
    const passEnd = ctx.now.getTime() + EARLY_ACCESS_PASS_TTL_MS;
    const until = new Date(
      grant.expiresAt === null ? passEnd : Math.min(passEnd, grant.expiresAt.getTime()),
    );
    return { granted: true, until };
  },
});

// ── Invitations: the redeeming side (igs-pharma#211) ────────────────────────────────────────────

/**
 * Turns the open invitations for `userId`'s address into their grant: only for an active customer
 * whose address is VERIFIED, and only invitations still in their window. The address matches
 * case-insensitively (`citext`). Each redemption is audited; returns how many there were.
 */
async function redeemInvitations(ctx: Ctx, userId: string): Promise<number> {
  const [user] = await ctx.tx
    .select({ email: users.email })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.status, "active"),
        eq(users.kind, "customer"),
        eq(users.emailVerified, true),
      ),
    );
  if (!user) return 0;
  const redeemed = await ctx.tx
    .update(earlyAccessRequests)
    .set({ userId, updatedAt: ctx.now })
    .where(and(openInvitation(ctx.now), eq(earlyAccessRequests.invitedEmail, user.email)))
    .returning({ id: earlyAccessRequests.id });
  for (const row of redeemed) {
    await ctx.audit.record({
      action: IDENTITY_AUDIT.earlyAccessInvitationRedeemed,
      entityType: "early_access_request",
      entityId: row.id,
      data: { requestId: row.id, userId },
    });
  }
  return redeemed.length;
}

/**
 * Better Auth's "e-mail verified" hook (igs-pharma#211), run by the app's composition root as the
 * `system_auth` actor: an open invitation for the address the customer just confirmed becomes their
 * grant. Audited only when something was redeemed (most confirmations have no invitation).
 */
export const redeemEarlyAccessInvitation = command({
  name: "identity.early_access.redeem",
  input: z.object({ userId: z.uuid() }),
  output: z.object({ redeemed: z.number().int().nonnegative() }),
  permission: PERMISSIONS.storefront.earlyAccessRedeem,
  audit: "none",
  async handler({ input, ctx }) {
    return { redeemed: await redeemInvitations(ctx, input.userId) };
  },
});

// ── The staff side ──────────────────────────────────────────────────────────────────────────────

/** One request as the back-office lists it. */
export interface EarlyAccessListItem {
  readonly id: string;
  readonly userId: string | null;
  readonly name: string | null;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly status: EarlyAccessStatus;
  /** `approved` past its end shows as expired. */
  readonly active: boolean;
  readonly note: string | null;
  readonly requestedAt: Date;
  readonly decidedAt: Date | null;
  readonly decidedByName: string | null;
  readonly decisionReason: string | null;
  readonly expiresAt: Date | null;
  /** igs-pharma#211: an invitation nobody has redeemed yet (no user; `email` is the invited address). */
  readonly invitation: boolean;
  /** For an unredeemed invitation: until when it can be redeemed. */
  readonly invitationEndsAt: Date | null;
}

export interface EarlyAccessList {
  /** Oldest first: the next one to decide on top. */
  readonly pending: readonly EarlyAccessListItem[];
  /** Active grants, the soonest to end first (until launch last). */
  readonly approved: readonly EarlyAccessListItem[];
  /** igs-pharma#211: open invitations nobody has redeemed yet, the newest first. */
  readonly invited: readonly EarlyAccessListItem[];
  /**
   * Rejected, revoked and expired, and invitations cancelled or never redeemed, the latest decision
   * first (at most `HISTORY_LIMIT`).
   */
  readonly history: readonly EarlyAccessListItem[];
}

const HISTORY_LIMIT = 100;

/** Every open request and active grant, and the recent history, for the back-office page. */
export const listEarlyAccessRequests = query({
  name: "identity.early_access.list",
  input: z.object({}),
  permission: PERMISSIONS.storefront.earlyAccessManage,
  async handler({ ctx }): Promise<EarlyAccessList> {
    const decider = aliasedTable(users, "decider");
    const select = () =>
      ctx.tx
        .select({
          ...rowColumns,
          userId: earlyAccessRequests.userId,
          name: users.name,
          email: sql<string | null>`coalesce(${users.email}, ${earlyAccessRequests.invitedEmail})`,
          emailVerified: sql<boolean>`coalesce(${users.emailVerified}, false)`,
          decidedByName: decider.name,
        })
        .from(earlyAccessRequests)
        .leftJoin(users, eq(users.id, earlyAccessRequests.userId))
        .leftJoin(decider, eq(decider.id, earlyAccessRequests.decidedBy));
    const toItem = <
      T extends {
        userId: string | null;
        status: EarlyAccessStatus;
        requestedAt: Date;
        expiresAt: Date | null;
      },
    >(
      row: T,
    ) => {
      const invitation = row.userId === null;
      return {
        ...row,
        active: !invitation && grantsAt(row, ctx.now),
        invitation,
        invitationEndsAt: invitation ? invitationEndsAt(row.requestedAt, row.expiresAt) : null,
      };
    };
    const pending = await select()
      .where(eq(earlyAccessRequests.status, "pending"))
      .orderBy(earlyAccessRequests.requestedAt);
    const approved = await select()
      .where(and(isNotNull(earlyAccessRequests.userId), activeGrant(ctx.now)))
      .orderBy(sql`${earlyAccessRequests.expiresAt} ASC NULLS LAST`);
    const invited = await select()
      .where(openInvitation(ctx.now))
      .orderBy(desc(earlyAccessRequests.requestedAt));
    const history = await select()
      .where(
        or(
          eq(earlyAccessRequests.status, "rejected"),
          eq(earlyAccessRequests.status, "revoked"),
          and(
            eq(earlyAccessRequests.status, "approved"),
            lte(earlyAccessRequests.expiresAt, ctx.now),
          ),
          // an invitation whose window closed unredeemed
          and(
            isNull(earlyAccessRequests.userId),
            eq(earlyAccessRequests.status, "approved"),
            lte(
              earlyAccessRequests.requestedAt,
              new Date(ctx.now.getTime() - EARLY_ACCESS_INVITATION_DAYS * DAY_MS),
            ),
          ),
        ),
      )
      .orderBy(desc(earlyAccessRequests.decidedAt))
      .limit(HISTORY_LIMIT);
    return {
      pending: pending.map(toItem),
      approved: approved.map(toItem),
      invited: invited.map(toItem),
      history: history.map(toItem),
    };
  },
});

const decisionInput = z.object({ requestId: z.uuid() });

/**
 * The request `requestId`, locked; refused unless it belongs to a person (not an invitation) other
 * than the acting staff member (issue decision 3: a second owner decides your own request).
 */
async function lockRequest(ctx: Ctx, requestId: string) {
  const [row] = await ctx.tx
    .select({ ...rowColumns, userId: earlyAccessRequests.userId })
    .from(earlyAccessRequests)
    .where(eq(earlyAccessRequests.id, requestId))
    .for("update");
  if (!row?.userId) throw notFound("identity.early_access.not_found");
  if (row.userId === ctx.actor.id) throw forbidden("identity.early_access.own_request");
  return { ...row, userId: row.userId };
}

const decisionOutput = z.object({ ok: z.literal(true) });

/**
 * Approves a pending request, or extends an active grant (approving it again). `duration` picks the
 * end: 7, 30 or 90 days from now, or until launch. `link`, when given, is where the mail sends the
 * person (the storefront's early-access page; the caller builds it from configuration).
 */
export const approveEarlyAccess = command({
  name: "identity.early_access.approve",
  input: decisionInput.extend({
    duration: z.enum(EARLY_ACCESS_DURATIONS).default(DEFAULT_EARLY_ACCESS_DURATION),
    link: z.string().url().max(2048).optional(),
  }),
  output: decisionOutput,
  permission: PERMISSIONS.storefront.earlyAccessManage,
  async handler({ input, ctx }) {
    const row = await lockRequest(ctx, input.requestId);
    const extended = grantsAt(row, ctx.now);
    if (row.status !== "pending" && !extended) {
      throw conflict("identity.early_access.state_changed");
    }
    requireFreshMfa(ctx);
    const expiresAt =
      input.duration === "until_launch"
        ? null
        : new Date(ctx.now.getTime() + DURATION_DAYS[input.duration] * DAY_MS);
    await ctx.tx
      .update(earlyAccessRequests)
      .set({
        status: "approved",
        decidedBy: ctx.actor.id,
        decidedAt: ctx.now,
        decisionReason: null,
        expiresAt,
        updatedAt: ctx.now,
      })
      .where(eq(earlyAccessRequests.id, row.id));
    await ctx.audit.record({
      action: IDENTITY_AUDIT.earlyAccessApproved,
      entityType: "early_access_request",
      entityId: row.id,
      data: { requestId: row.id, userId: row.userId, duration: input.duration, extended },
    });
    await queueMail(ctx, {
      userId: row.userId,
      template: "early_access_approved",
      url: input.link,
      validUntil: expiresAt,
    });
    return { ok: true as const };
  },
});

const endInput = decisionInput.extend({ reason: optionalText });

/** Rejects a pending request; the person may ask again after {@link EARLY_ACCESS_REASK_DAYS} days. */
export const rejectEarlyAccess = command({
  name: "identity.early_access.reject",
  input: endInput,
  output: decisionOutput,
  permission: PERMISSIONS.storefront.earlyAccessManage,
  async handler({ input, ctx }) {
    const row = await lockRequest(ctx, input.requestId);
    if (row.status !== "pending") throw conflict("identity.early_access.state_changed");
    requireFreshMfa(ctx);
    await endRequest(ctx, row, "rejected", input.reason);
    return { ok: true as const };
  },
});

/**
 * Ends an active grant. The storefront stops showing the shop when the person's current pass runs out
 * (at most {@link EARLY_ACCESS_PASS_TTL_MS}).
 */
export const revokeEarlyAccess = command({
  name: "identity.early_access.revoke",
  input: endInput,
  output: decisionOutput,
  permission: PERMISSIONS.storefront.earlyAccessManage,
  async handler({ input, ctx }) {
    const row = await lockRequest(ctx, input.requestId);
    if (!grantsAt(row, ctx.now)) throw conflict("identity.early_access.state_changed");
    requireFreshMfa(ctx);
    await endRequest(ctx, row, "revoked", input.reason);
    return { ok: true as const };
  },
});

async function endRequest(
  ctx: Ctx,
  row: { id: string; userId: string },
  status: "rejected" | "revoked",
  reason: string | null,
): Promise<void> {
  await ctx.tx
    .update(earlyAccessRequests)
    .set({
      status,
      decidedBy: ctx.actor.id,
      decidedAt: ctx.now,
      decisionReason: reason,
      updatedAt: ctx.now,
    })
    .where(eq(earlyAccessRequests.id, row.id));
  await ctx.audit.record({
    action:
      status === "rejected"
        ? IDENTITY_AUDIT.earlyAccessRejected
        : IDENTITY_AUDIT.earlyAccessRevoked,
    entityType: "early_access_request",
    entityId: row.id,
    data: { requestId: row.id, userId: row.userId, hasReason: reason !== null },
  });
  await queueMail(ctx, {
    userId: row.userId,
    template: status === "rejected" ? "early_access_rejected" : "early_access_revoked",
  });
}

// ── Invitations: the staff side (igs-pharma#211) ────────────────────────────────────────────────

/** Approves `userId`'s open request, extends their active grant, or adds a grant: one row stays theirs. */
async function grantToUser(
  ctx: Ctx,
  userId: string,
  invitedEmail: string,
  expiresAt: Date | null,
): Promise<string> {
  const rows = await rowsOf(ctx, userId);
  const current =
    rows.find((row) => grantsAt(row, ctx.now)) ?? rows.find((row) => row.status === "pending");
  const decision = {
    status: "approved" as const,
    decidedBy: ctx.actor.id,
    decidedAt: ctx.now,
    decisionReason: null,
    expiresAt,
    updatedAt: ctx.now,
  };
  if (current) {
    await ctx.tx
      .update(earlyAccessRequests)
      .set(decision)
      .where(eq(earlyAccessRequests.id, current.id));
    return current.id;
  }
  const [row] = await ctx.tx
    .insert(earlyAccessRequests)
    .values({ ...decision, userId, invitedEmail, requestedAt: ctx.now })
    .returning({ id: earlyAccessRequests.id });
  if (!row) throw new Error("identity.early_access_not_stored");
  return row.id;
}

/**
 * Stores the open invitation for `email`, or renews the one there is (one per address: the partial
 * unique index; a parallel invite of the same address waits on the row and renews it).
 */
async function upsertInvitation(ctx: Ctx, email: string, expiresAt: Date | null): Promise<string> {
  const decision = {
    status: "approved" as const,
    decidedBy: ctx.actor.id,
    decidedAt: ctx.now,
    decisionReason: null,
    expiresAt,
    requestedAt: ctx.now,
    updatedAt: ctx.now,
  };
  const [created] = await ctx.tx
    .insert(earlyAccessRequests)
    .values({ ...decision, invitedEmail: email })
    .onConflictDoNothing()
    .returning({ id: earlyAccessRequests.id });
  if (created) return created.id;
  const [renewed] = await ctx.tx
    .update(earlyAccessRequests)
    .set(decision)
    .where(
      and(
        isNull(earlyAccessRequests.userId),
        sql`lower(${earlyAccessRequests.invitedEmail}) = lower(${email})`,
        sql`${earlyAccessRequests.status} IN ('pending', 'approved')`,
      ),
    )
    .returning({ id: earlyAccessRequests.id });
  // the conflicting row was redeemed or cancelled in between (rare): the owner tries again
  if (!renewed) throw conflict("identity.early_access.state_changed");
  return renewed.id;
}

/**
 * Invites an e-mail address to see the shop before launch (igs-pharma#211), for 7, 30 or 90 days or
 * until launch. An address of a verified customer gets the grant at once (and the approval mail);
 * any other address gets an invitation (and the invitation mail, in `locale`), which becomes the
 * grant when a customer confirms that address within {@link EARLY_ACCESS_INVITATION_DAYS} days.
 * Inviting the same address again renews it. The answer is the same either way. Needs a fresh
 * passkey check; nobody invites their own address. `link` is the storefront's early-access page.
 */
export const inviteEarlyAccess = command({
  name: "identity.early_access.invite",
  input: z.object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    duration: z.enum(EARLY_ACCESS_DURATIONS).default(DEFAULT_EARLY_ACCESS_DURATION),
    locale: z.enum(USER_LOCALES).default("nl"),
    link: z.string().url().max(2048).optional(),
  }),
  output: decisionOutput,
  permission: PERMISSIONS.storefront.earlyAccessManage,
  async handler({ input, ctx }) {
    requireFreshMfa(ctx);
    const [self] = await ctx.tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, ctx.actor.id), eq(users.email, input.email)));
    if (self) throw forbidden("identity.early_access.own_address");
    const expiresAt =
      input.duration === "until_launch"
        ? null
        : new Date(ctx.now.getTime() + DURATION_DAYS[input.duration] * DAY_MS);
    // the person's row lock serialises this with their own request and the redeeming hook
    const [customer] = await ctx.tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.email, input.email),
          eq(users.kind, "customer"),
          eq(users.status, "active"),
          eq(users.emailVerified, true),
        ),
      )
      .for("update");
    const requestId = customer
      ? await grantToUser(ctx, customer.id, input.email, expiresAt)
      : await upsertInvitation(ctx, input.email, expiresAt);
    await ctx.audit.record({
      action: IDENTITY_AUDIT.earlyAccessInvited,
      entityType: "early_access_request",
      entityId: requestId,
      data: {
        requestId,
        addressHash: addressHash(requestId, input.email),
        duration: input.duration,
      },
    });
    if (customer) {
      await ctx.audit.record({
        action: IDENTITY_AUDIT.earlyAccessInvitationRedeemed,
        entityType: "early_access_request",
        entityId: requestId,
        data: { requestId, userId: customer.id },
      });
      await queueMail(ctx, {
        userId: customer.id,
        template: "early_access_approved",
        url: input.link,
        validUntil: expiresAt,
      });
    } else {
      await queueMail(ctx, {
        toEmail: input.email,
        locale: input.locale,
        template: "early_access_invited",
        url: input.link,
        validUntil: expiresAt,
      });
    }
    return { ok: true as const };
  },
});

/**
 * Cancels an invitation nobody has redeemed (igs-pharma#211): a later sign-up with that address gets
 * nothing. A redeemed invitation is an ordinary grant: it is revoked with `revokeEarlyAccess`.
 */
export const cancelEarlyAccessInvitation = command({
  name: "identity.early_access.invitation.cancel",
  input: decisionInput,
  output: decisionOutput,
  permission: PERMISSIONS.storefront.earlyAccessManage,
  async handler({ input, ctx }) {
    const [row] = await ctx.tx
      .select({ userId: earlyAccessRequests.userId, status: earlyAccessRequests.status })
      .from(earlyAccessRequests)
      .where(eq(earlyAccessRequests.id, input.requestId))
      .for("update");
    if (!row) throw notFound("identity.early_access.not_found");
    if (row.userId !== null || row.status !== "approved") {
      throw conflict("identity.early_access.state_changed");
    }
    requireFreshMfa(ctx);
    await ctx.tx
      .update(earlyAccessRequests)
      .set({ status: "revoked", decidedBy: ctx.actor.id, decidedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(earlyAccessRequests.id, input.requestId));
    await ctx.audit.record({
      action: IDENTITY_AUDIT.earlyAccessInvitationCancelled,
      entityType: "early_access_request",
      entityId: input.requestId,
      data: { requestId: input.requestId },
    });
    return { ok: true as const };
  },
});

// ── Retention (GDPR) ────────────────────────────────────────────────────────────────────────────

/** How long an ended request is kept: 12 months after its rejection, revocation or expiry. */
export const EARLY_ACCESS_RETENTION_MS = 365 * DAY_MS;

/**
 * Deletes the requests that ended more than {@link EARLY_ACCESS_RETENTION_MS} ago (rejected, revoked,
 * or approved and expired), and the invitations nobody redeemed whose window closed that long ago
 * (igs-pharma#211: the address of someone with no account). Open requests and active grants are kept. Run by the worker's daily job,
 * in the caller's transaction; returns how many rows went.
 */
export async function purgeEndedEarlyAccess(tx: Ctx["tx"], now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - EARLY_ACCESS_RETENTION_MS);
  const deleted = await tx
    .delete(earlyAccessRequests)
    .where(
      or(
        and(
          or(eq(earlyAccessRequests.status, "rejected"), eq(earlyAccessRequests.status, "revoked")),
          lt(earlyAccessRequests.decidedAt, cutoff),
        ),
        and(eq(earlyAccessRequests.status, "approved"), lt(earlyAccessRequests.expiresAt, cutoff)),
        and(
          isNull(earlyAccessRequests.userId),
          eq(earlyAccessRequests.status, "approved"),
          lt(
            earlyAccessRequests.requestedAt,
            new Date(cutoff.getTime() - EARLY_ACCESS_INVITATION_DAYS * DAY_MS),
          ),
        ),
      ),
    )
    .returning({ id: earlyAccessRequests.id });
  return deleted.length;
}
