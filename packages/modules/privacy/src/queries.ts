import { notFound, query } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { type SQL, and, asc, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { subjectRefOrThrow } from "./commands";
import {
  CONSENT_PURPOSES,
  type ConsentPurpose,
  type ConsentSource,
  DSR_STATUSES,
  DSR_TYPES,
  type DsrChannel,
  type DsrStatus,
  type DsrType,
  MAX_SUBJECT_REF_LENGTH,
  daysUntil,
  isDsrOverdue,
  nextDsrStatuses,
} from "./domain";
import { consentEvents, dsrEvents, dsrRequests } from "./schema";

/** Privacy queries for the back-office (igs-pharma#58). */

export interface ConsentEventView {
  readonly id: string;
  readonly purpose: ConsentPurpose;
  readonly granted: boolean;
  readonly policyVersion: string;
  readonly source: ConsentSource;
  readonly actorType: string;
  readonly actorId: string;
  readonly at: Date;
}

export interface ConsentState {
  readonly purpose: ConsentPurpose;
  /** The latest event for this purpose; `null` when the subject never gave or withdrew it. */
  readonly current: ConsentEventView | null;
}

export interface SubjectConsents {
  readonly subjectRef: string;
  /** One entry per purpose, in `CONSENT_PURPOSES` order. */
  readonly purposes: readonly ConsentState[];
  /** Every event, newest first (at most `CONSENT_HISTORY_LIMIT`). */
  readonly history: readonly ConsentEventView[];
}

export const CONSENT_HISTORY_LIMIT = 200;

const consentColumns = {
  id: consentEvents.id,
  purpose: consentEvents.purpose,
  granted: consentEvents.granted,
  policyVersion: consentEvents.policyVersion,
  source: consentEvents.source,
  actorType: consentEvents.actorType,
  actorId: consentEvents.actorId,
  at: consentEvents.at,
};

const asConsentView = (row: {
  id: string;
  purpose: string;
  granted: boolean;
  policyVersion: string;
  source: string;
  actorType: string;
  actorId: string;
  at: Date;
}): ConsentEventView => ({
  ...row,
  purpose: row.purpose as ConsentPurpose,
  source: row.source as ConsentSource,
});

/**
 * A subject's consents: the current state per purpose is its latest event (ids are UUIDv7, so they
 * break a tie between events recorded at the same instant), plus the history.
 */
export const getConsents = query({
  name: "privacy.consent.get",
  input: z.object({ subjectRef: z.string().max(MAX_SUBJECT_REF_LENGTH + 20) }),
  permission: PERMISSIONS.privacy.consentRead,
  async handler({ input, ctx }): Promise<SubjectConsents> {
    const subjectRef = subjectRefOrThrow(input.subjectRef);
    const latest = await ctx.tx
      .selectDistinctOn([consentEvents.purpose], consentColumns)
      .from(consentEvents)
      .where(eq(consentEvents.subjectRef, subjectRef))
      .orderBy(consentEvents.purpose, desc(consentEvents.at), desc(consentEvents.id));
    const history = await ctx.tx
      .select(consentColumns)
      .from(consentEvents)
      .where(eq(consentEvents.subjectRef, subjectRef))
      .orderBy(desc(consentEvents.at), desc(consentEvents.id))
      .limit(CONSENT_HISTORY_LIMIT);
    const byPurpose = new Map(latest.map((row) => [row.purpose, asConsentView(row)]));
    return {
      subjectRef,
      purposes: CONSENT_PURPOSES.map((purpose) => ({
        purpose,
        current: byPurpose.get(purpose) ?? null,
      })),
      history: history.map(asConsentView),
    };
  },
});

export interface DsrListItem {
  readonly id: string;
  readonly subjectRef: string;
  readonly type: DsrType;
  readonly channel: DsrChannel;
  readonly status: DsrStatus;
  readonly receivedAt: Date;
  readonly dueAt: Date;
  readonly closedAt: Date | null;
  /** Open and past its deadline. */
  readonly overdue: boolean;
  /** Whole days until the deadline (negative once overdue); `null` once the request is closed. */
  readonly daysLeft: number | null;
}

export interface DsrPage {
  readonly items: readonly DsrListItem[];
  readonly total: number;
  /** Open requests past their deadline, whatever the filters. */
  readonly overdueTotal: number;
  readonly page: number;
  readonly pageSize: number;
}

const OPEN_STATUSES: readonly DsrStatus[] = ["received", "in_progress"];

const requestColumns = {
  id: dsrRequests.id,
  subjectRef: dsrRequests.subjectRef,
  type: dsrRequests.type,
  channel: dsrRequests.channel,
  status: dsrRequests.status,
  receivedAt: dsrRequests.receivedAt,
  dueAt: dsrRequests.dueAt,
  closedAt: dsrRequests.closedAt,
};

const asListItem = (
  row: {
    id: string;
    subjectRef: string;
    type: string;
    channel: string;
    status: string;
    receivedAt: Date;
    dueAt: Date;
    closedAt: Date | null;
  },
  now: Date,
): DsrListItem => {
  const status = row.status as DsrStatus;
  const open = OPEN_STATUSES.includes(status);
  return {
    ...row,
    type: row.type as DsrType,
    channel: row.channel as DsrChannel,
    status,
    overdue: isDsrOverdue(status, row.dueAt, now),
    daysLeft: open ? daysUntil(row.dueAt, now) : null,
  };
};

/**
 * The register of data-subject requests: open ones first, the closest deadline (so the overdue
 * ones) on top, then the closed ones, most recently received first. Filters by status, type and
 * person (`subjectRef`, matched like the consents: trimmed, case-insensitive).
 */
export const listDsr = query({
  name: "privacy.dsr.list",
  input: z.object({
    status: z.enum(DSR_STATUSES).optional(),
    type: z.enum(DSR_TYPES).optional(),
    subjectRef: z
      .string()
      .max(MAX_SUBJECT_REF_LENGTH + 20)
      .optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  }),
  permission: PERMISSIONS.privacy.dsrRead,
  async handler({ input, ctx }): Promise<DsrPage> {
    const filters: SQL[] = [];
    if (input.status) filters.push(eq(dsrRequests.status, input.status));
    if (input.type) filters.push(eq(dsrRequests.type, input.type));
    if (input.subjectRef !== undefined) {
      filters.push(eq(dsrRequests.subjectRef, subjectRefOrThrow(input.subjectRef)));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const open = inArray(dsrRequests.status, [...OPEN_STATUSES]);
    const [totalRow] = await ctx.tx.select({ total: count() }).from(dsrRequests).where(where);
    const [overdueRow] = await ctx.tx
      .select({ total: count() })
      .from(dsrRequests)
      .where(and(open, lt(dsrRequests.dueAt, ctx.now)));
    const rows = await ctx.tx
      .select(requestColumns)
      .from(dsrRequests)
      .where(where)
      .orderBy(
        sql`CASE WHEN ${open} THEN 0 ELSE 1 END`,
        sql`CASE WHEN ${open} THEN ${dsrRequests.dueAt} END ASC`,
        desc(dsrRequests.receivedAt),
        desc(dsrRequests.id),
      )
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    return {
      items: rows.map((row) => asListItem(row, ctx.now)),
      total: totalRow?.total ?? 0,
      overdueTotal: overdueRow?.total ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    };
  },
});

export interface DsrEventView {
  readonly id: string;
  readonly fromStatus: DsrStatus | null;
  readonly toStatus: DsrStatus;
  readonly note: string | null;
  readonly actorType: string;
  readonly actorId: string;
  readonly at: Date;
}

export interface DsrView extends DsrListItem {
  readonly note: string | null;
  readonly createdBy: string;
  readonly closedReason: string | null;
  /** The statuses it may move to next (empty once final). */
  readonly nextStatuses: readonly DsrStatus[];
  /** The timeline, oldest first. */
  readonly events: readonly DsrEventView[];
}

/** One request with its timeline (`privacy.dsr_not_found`). */
export const getDsr = query({
  name: "privacy.dsr.get",
  input: z.object({ requestId: z.uuid() }),
  permission: PERMISSIONS.privacy.dsrRead,
  async handler({ input, ctx }): Promise<DsrView> {
    const [row] = await ctx.tx
      .select({
        ...requestColumns,
        note: dsrRequests.note,
        createdBy: dsrRequests.createdBy,
        closedReason: dsrRequests.closedReason,
      })
      .from(dsrRequests)
      .where(eq(dsrRequests.id, input.requestId));
    if (!row) throw notFound("privacy.dsr_not_found");
    const events = await ctx.tx
      .select({
        id: dsrEvents.id,
        fromStatus: dsrEvents.fromStatus,
        toStatus: dsrEvents.toStatus,
        note: dsrEvents.note,
        actorType: dsrEvents.actorType,
        actorId: dsrEvents.actorId,
        at: dsrEvents.at,
      })
      .from(dsrEvents)
      .where(eq(dsrEvents.requestId, row.id))
      .orderBy(asc(dsrEvents.at), asc(dsrEvents.id));
    const item = asListItem(row, ctx.now);
    return {
      ...item,
      note: row.note,
      createdBy: row.createdBy,
      closedReason: row.closedReason,
      nextStatuses: nextDsrStatuses(item.status),
      events: events.map((e) => ({
        ...e,
        fromStatus: e.fromStatus as DsrStatus | null,
        toStatus: e.toStatus as DsrStatus,
      })),
    };
  },
});
