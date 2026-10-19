import { newId } from "@igs/db/ids";
import { type Ctx, command, conflict, notFound, query } from "@igs/kernel";
import { identitySchema } from "@igs/module-identity";
import { PERMISSIONS } from "@igs/rbac";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";

import { PRIVACY_AUDIT } from "./audit";
import {
  CONSENT_PURPOSES,
  type DsrStatus,
  type DsrType,
  FINAL_DSR_STATUSES,
  dsrDueAt,
  normalizeSubjectRef,
} from "./domain";
import { type SubjectConsents, readConsents } from "./queries";
import { consentEvents, dsrEvents, dsrRequests } from "./schema";

/**
 * A customer's own privacy (igs-pharma#114, D-044). The subject of every row is the signed-in
 * customer's e-mail, read from their account here: no subject, user id or channel comes from the
 * input, so a customer can only ever read and write their own ledger entries. Consents are given
 * from the storefront, requests arrive on the `account` channel. Erasure is a REQUEST that staff
 * process in the back office, never a self-delete: pharmacy records have legal retention.
 */

/** The data-subject requests a customer may file themselves: a copy of their data, or its erasure. */
export const SELF_DSR_TYPES = ["access", "erasure"] as const satisfies readonly DsrType[];

/** The customer's subject reference (their normalised e-mail); `notFound` for a gone or suspended account. */
async function ownSubjectRef(ctx: Pick<Ctx, "tx" | "actor">): Promise<string> {
  const { users } = identitySchema;
  const [user] = await ctx.tx
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.id, ctx.actor.id), eq(users.status, "active")));
  const subjectRef = user ? normalizeSubjectRef(user.email) : null;
  if (!subjectRef) throw notFound("identity.user_not_found");
  return subjectRef;
}

export const getOwnConsents = query({
  name: "privacy.self.consent.get",
  input: z.object({}),
  permission: PERMISSIONS.privacy.selfConsentManage,
  async handler({ ctx }): Promise<SubjectConsents> {
    return readConsents(ctx.tx, await ownSubjectRef(ctx));
  },
});

/** The customer gives (`granted: true`) or withdraws (`false`) consent for one purpose. */
export const recordOwnConsent = command({
  name: "privacy.self.consent.record",
  input: z.object({
    purpose: z.enum(CONSENT_PURPOSES),
    granted: z.boolean(),
    policyVersion: z.string().trim().min(1).max(40),
  }),
  output: z.object({ consentEventId: z.uuid() }),
  permission: PERMISSIONS.privacy.selfConsentManage,
  async handler({ input, ctx }) {
    const subjectRef = await ownSubjectRef(ctx);
    const consentEventId = newId();
    await ctx.tx.insert(consentEvents).values({
      id: consentEventId,
      subjectRef,
      purpose: input.purpose,
      granted: input.granted,
      policyVersion: input.policyVersion,
      source: "storefront",
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      at: ctx.now,
    });
    await ctx.audit.record({
      action: PRIVACY_AUDIT.consentRecorded,
      entityType: "consent_event",
      entityId: consentEventId,
      data: {
        consentEventId,
        purpose: input.purpose,
        granted: input.granted,
        source: "storefront",
      },
    });
    return { consentEventId };
  },
});

/**
 * The customer asks for a copy of their data or its erasure. One open request per type: a second
 * click, or a second tab, is `privacy.dsr_already_open`, not a duplicate for staff to close. The
 * deadline is the usual one calendar month from now (`dsrDueAt`). The sensitive-action rule (a sign-in
 * at most 10 minutes old, D-044) is a session property: the storefront checks it before calling.
 */
export const requestOwnDsr = command({
  name: "privacy.self.dsr.create",
  input: z.object({ type: z.enum(SELF_DSR_TYPES) }),
  output: z.object({ requestId: z.uuid() }),
  permission: PERMISSIONS.privacy.selfDsrCreate,
  async handler({ input, ctx }) {
    const subjectRef = await ownSubjectRef(ctx);
    const [open] = await ctx.tx
      .select({ id: dsrRequests.id })
      .from(dsrRequests)
      .where(
        and(
          eq(dsrRequests.subjectRef, subjectRef),
          eq(dsrRequests.type, input.type),
          notInArray(dsrRequests.status, [...FINAL_DSR_STATUSES]),
        ),
      )
      .limit(1);
    if (open) throw conflict("privacy.dsr_already_open");
    const requestId = newId();
    await ctx.tx.insert(dsrRequests).values({
      id: requestId,
      subjectRef,
      type: input.type,
      channel: "account",
      receivedAt: ctx.now,
      dueAt: dsrDueAt(ctx.now),
      status: "received",
      note: null,
      createdBy: ctx.actor.id,
      createdAt: ctx.now,
    });
    await ctx.tx.insert(dsrEvents).values({
      id: newId(),
      requestId,
      fromStatus: null,
      toStatus: "received",
      note: null,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      at: ctx.now,
    });
    await ctx.audit.record({
      action: PRIVACY_AUDIT.dsrCreated,
      entityType: "dsr_request",
      entityId: requestId,
      data: { requestId, type: input.type, channel: "account" },
    });
    return { requestId };
  },
});

export interface OwnDsr {
  readonly id: string;
  readonly type: DsrType;
  readonly status: DsrStatus;
  readonly receivedAt: Date;
  readonly dueAt: Date;
  readonly closedAt: Date | null;
}

/** The customer's own requests, newest first (the account's privacy page shows where they stand). */
export const listOwnDsr = query({
  name: "privacy.self.dsr.list",
  input: z.object({}),
  permission: PERMISSIONS.privacy.selfDsrCreate,
  async handler({ ctx }): Promise<readonly OwnDsr[]> {
    const rows = await ctx.tx
      .select({
        id: dsrRequests.id,
        type: dsrRequests.type,
        status: dsrRequests.status,
        receivedAt: dsrRequests.receivedAt,
        dueAt: dsrRequests.dueAt,
        closedAt: dsrRequests.closedAt,
      })
      .from(dsrRequests)
      .where(eq(dsrRequests.subjectRef, await ownSubjectRef(ctx)))
      .orderBy(desc(dsrRequests.receivedAt), desc(dsrRequests.id))
      .limit(50);
    return rows.map((row) => ({
      ...row,
      type: row.type as DsrType,
      status: row.status as DsrStatus,
    }));
  },
});
