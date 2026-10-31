import { type Ctx, command, conflict, forbidden, notFound, query } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { aliasedTable, and, desc, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { IDENTITY_AUDIT } from "./audit";
import { requireFreshMfa } from "./commands";
import { queueMail } from "./mail";
import {
  EARLY_ACCESS_TEXT_MAX,
  type EarlyAccessStatus,
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
}

export interface EarlyAccessList {
  /** Oldest first: the next one to decide on top. */
  readonly pending: readonly EarlyAccessListItem[];
  /** Active grants, the soonest to end first (until launch last). */
  readonly approved: readonly EarlyAccessListItem[];
  /** Rejected, revoked and expired, the latest decision first (at most `HISTORY_LIMIT`). */
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
    const toItem = <T extends { status: EarlyAccessStatus; expiresAt: Date | null }>(row: T) => ({
      ...row,
      active: grantsAt(row, ctx.now),
    });
    const pending = await select()
      .where(eq(earlyAccessRequests.status, "pending"))
      .orderBy(earlyAccessRequests.requestedAt);
    const approved = await select()
      .where(activeGrant(ctx.now))
      .orderBy(sql`${earlyAccessRequests.expiresAt} ASC NULLS LAST`);
    const history = await select()
      .where(
        or(
          eq(earlyAccessRequests.status, "rejected"),
          eq(earlyAccessRequests.status, "revoked"),
          and(
            eq(earlyAccessRequests.status, "approved"),
            lte(earlyAccessRequests.expiresAt, ctx.now),
          ),
        ),
      )
      .orderBy(desc(earlyAccessRequests.decidedAt))
      .limit(HISTORY_LIMIT);
    return {
      pending: pending.map(toItem),
      approved: approved.map(toItem),
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

// ── Retention (GDPR) ────────────────────────────────────────────────────────────────────────────

/** How long an ended request is kept: 12 months after its rejection, revocation or expiry. */
export const EARLY_ACCESS_RETENTION_MS = 365 * DAY_MS;

/**
 * Deletes the requests that ended more than {@link EARLY_ACCESS_RETENTION_MS} ago (rejected, revoked,
 * or approved and expired). Open requests and active grants are kept. Run by the worker's daily job,
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
      ),
    )
    .returning({ id: earlyAccessRequests.id });
  return deleted.length;
}
