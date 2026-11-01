import { query } from "@igs/kernel";
import { and, desc, eq, gte, like, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { events } from "./schema";

/**
 * Reading the audit trail in the back-office (igs-pharma#220). Read-only: nothing here can change
 * `audit.events`, which stays append-only (D-027). The owner only (`audit.events.read`).
 *
 * The window is a half-open range of instants `[from, to)`; the caller turns Brussels days into it.
 * It may span at most {@link AUDIT_MAX_WINDOW_DAYS} days, so a search touches a bounded number of
 * monthly partitions (D-029). Rows come newest first (by `seq`, the chain order), a page at a time.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** The widest window one search may cover. */
export const AUDIT_MAX_WINDOW_DAYS = 366;
/** The biggest page. */
export const AUDIT_MAX_PAGE_SIZE = 100;
/** The action of a refused call (`@igs/kernel`, igs-pharma#210). */
export const DENIED_ACTION = "kernel.access.denied";

/** An action, or a prefix of one ending in `.` (`identity.early_access.`). */
const ACTION = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*\.?$/;

const input = z
  .object({
    from: z.date(),
    to: z.date(),
    action: z.string().max(120).regex(ACTION).optional(),
    actorId: z.string().min(1).max(100).optional(),
    entityId: z.string().min(1).max(200).optional(),
    page: z.number().int().min(1).max(10_000).default(1),
    pageSize: z.number().int().min(1).max(AUDIT_MAX_PAGE_SIZE).default(50),
  })
  .refine((v) => v.from.getTime() < v.to.getTime(), { path: ["to"], message: "after_from" })
  .refine((v) => v.to.getTime() - v.from.getTime() <= AUDIT_MAX_WINDOW_DAYS * DAY_MS, {
    path: ["from"],
    message: "window_too_wide",
  });

/** One audit entry as the back-office shows it: what the trail stores, minus the chain fields. */
export interface AuditEntryView {
  readonly seq: number;
  readonly at: Date;
  readonly actorType: string;
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  /** The allow-listed data (ids, codes, flags; never PII, D-028). */
  readonly data: Readonly<Record<string, string | number | boolean | null>>;
  /** Whether the call carried an origin (its IP and user agent are stored only as keyed hashes). */
  readonly hasOrigin: boolean;
}

export interface AuditPage {
  readonly items: readonly AuditEntryView[];
  readonly page: number;
  readonly pageSize: number;
  /** Whether an older page exists (the trail is not counted: it can be large). */
  readonly hasMore: boolean;
}

/**
 * Searches the audit trail: by action (exact, or a prefix ending in `.`), by who did it, by the entity
 * id, within a window. `kernel.access.denied` (refused actions) is an action like any other.
 */
export const listAuditEvents = query({
  name: "audit.events.list",
  input,
  permission: "audit.events.read",
  async handler({ input: q, ctx }): Promise<AuditPage> {
    const conditions = [gte(events.at, q.from), lt(events.at, q.to)];
    if (q.action) {
      conditions.push(
        q.action.endsWith(".")
          ? like(events.action, `${q.action.replaceAll("_", "\\_")}%`)
          : eq(events.action, q.action),
      );
    }
    if (q.actorId) conditions.push(eq(events.actorId, q.actorId));
    if (q.entityId) conditions.push(eq(events.entityId, q.entityId));
    const rows = await ctx.tx
      .select({
        seq: events.seq,
        at: events.at,
        actorType: events.actorType,
        actorId: events.actorId,
        action: events.action,
        entityType: events.entityType,
        entityId: events.entityId,
        data: events.data,
        hasOrigin: sql<boolean>`(${events.ipHash} IS NOT NULL OR ${events.uaHash} IS NOT NULL)`,
      })
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.seq))
      .limit(q.pageSize + 1)
      .offset((q.page - 1) * q.pageSize);
    return {
      items: rows.slice(0, q.pageSize).map((row) => ({
        ...row,
        data: (row.data ?? {}) as AuditEntryView["data"],
      })),
      page: q.page,
      pageSize: q.pageSize,
      hasMore: rows.length > q.pageSize,
    };
  },
});
