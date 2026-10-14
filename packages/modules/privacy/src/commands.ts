import { newId } from "@igs/db/ids";
import { type Ctx, command, conflict, notFound, validationFailed } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { PRIVACY_AUDIT } from "./audit";
import {
  CONSENT_PURPOSES,
  CONSENT_SOURCES,
  DSR_CHANNELS,
  DSR_EXTENSION_MONTHS,
  DSR_EXTENSION_REASONS,
  DSR_STATUSES,
  DSR_TYPES,
  type DsrExtensionMonths,
  type DsrStatus,
  MAX_SUBJECT_REF_LENGTH,
  canExtendDsr,
  canMoveDsr,
  dsrDueAt,
  dsrExtendedDueAt,
  isFinalDsrStatus,
  normalizeSubjectRef,
} from "./domain";
import { consentEvents, dsrEvents, dsrRequests } from "./schema";

/**
 * Privacy commands (igs-pharma#58). Every one runs through the kernel: authorize → validate → one
 * transaction (handler + audit). Consents and request timelines are only ever INSERTed; the current
 * state is derived (see `queries.ts`).
 */

const subjectRefInput = z.string().max(MAX_SUBJECT_REF_LENGTH + 20);

/** The normalised subject reference, or `privacy.subject_ref_invalid` on the `subjectRef` field. */
export function subjectRefOrThrow(value: string): string {
  const ref = normalizeSubjectRef(value);
  if (!ref) {
    throw validationFailed("privacy.subject_ref_invalid", [
      { path: "subjectRef", code: "privacy.subject_ref_invalid" },
    ]);
  }
  return ref;
}

const actorColumns = (ctx: Ctx) => ({ actorType: ctx.actor.type, actorId: ctx.actor.id });

const note = z.string().trim().max(1000).optional();
const emptyToUndefined = (value: string | undefined) => (value ? value : undefined);

/** Records that a subject gave (`granted: true`) or withdrew (`false`) consent for one purpose. */
export const recordConsent = command({
  name: "privacy.consent.record",
  input: z.object({
    subjectRef: subjectRefInput,
    purpose: z.enum(CONSENT_PURPOSES),
    granted: z.boolean(),
    policyVersion: z.string().trim().min(1).max(40),
    source: z.enum(CONSENT_SOURCES),
  }),
  output: z.object({ consentEventId: z.uuid() }),
  permission: PERMISSIONS.privacy.consentRecord,
  async handler({ input, ctx }) {
    const subjectRef = subjectRefOrThrow(input.subjectRef);
    const consentEventId = newId();
    await ctx.tx.insert(consentEvents).values({
      id: consentEventId,
      subjectRef,
      purpose: input.purpose,
      granted: input.granted,
      policyVersion: input.policyVersion,
      source: input.source,
      ...actorColumns(ctx),
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
        source: input.source,
      },
    });
    return { consentEventId };
  },
});

/**
 * Logs a data-subject request. The deadline (`due_at`) is `receivedAt` + one calendar month (`dsrDueAt`); `receivedAt` may
 * lie in the past (a letter opened late) but not in the future (`privacy.received_at_invalid`).
 */
export const createDsr = command({
  name: "privacy.dsr.create",
  input: z.object({
    subjectRef: subjectRefInput,
    type: z.enum(DSR_TYPES),
    channel: z.enum(DSR_CHANNELS),
    receivedAt: z.coerce.date(),
    note: note.transform(emptyToUndefined),
  }),
  output: z.object({ requestId: z.uuid() }),
  permission: PERMISSIONS.privacy.dsrManage,
  async handler({ input, ctx }) {
    const subjectRef = subjectRefOrThrow(input.subjectRef);
    if (input.receivedAt.getTime() > ctx.now.getTime()) {
      throw validationFailed("privacy.received_at_invalid", [
        { path: "receivedAt", code: "privacy.received_at_invalid" },
      ]);
    }
    const requestId = newId();
    await ctx.tx.insert(dsrRequests).values({
      id: requestId,
      subjectRef,
      type: input.type,
      channel: input.channel,
      receivedAt: input.receivedAt,
      dueAt: dsrDueAt(input.receivedAt),
      status: "received",
      note: input.note ?? null,
      createdBy: ctx.actor.id,
      createdAt: ctx.now,
    });
    await ctx.tx.insert(dsrEvents).values({
      id: newId(),
      requestId,
      fromStatus: null,
      toStatus: "received",
      note: input.note ?? null,
      ...actorColumns(ctx),
      at: ctx.now,
    });
    await ctx.audit.record({
      action: PRIVACY_AUDIT.dsrCreated,
      entityType: "dsr_request",
      entityId: requestId,
      data: { requestId, type: input.type, channel: input.channel },
    });
    return { requestId };
  },
});

/**
 * Moves a request to its next status, adding an event to its timeline. Allowed moves:
 * `received → in_progress → completed` and `received | in_progress → rejected`
 * (`privacy.dsr_invalid_transition`, with the current status). Rejecting needs a reason in `note`
 * (`privacy.dsr_reason_required`); `completed` and `rejected` are final.
 */
export const transitionDsr = command({
  name: "privacy.dsr.transition",
  input: z.object({
    requestId: z.uuid(),
    to: z.enum(DSR_STATUSES),
    note: note.transform(emptyToUndefined),
  }),
  output: z.object({ status: z.enum(DSR_STATUSES) }),
  permission: PERMISSIONS.privacy.dsrManage,
  async handler({ input, ctx }) {
    const [request] = await ctx.tx
      .select({ id: dsrRequests.id, status: dsrRequests.status })
      .from(dsrRequests)
      .where(eq(dsrRequests.id, input.requestId))
      .for("update");
    if (!request) throw notFound("privacy.dsr_not_found");
    const from = request.status as DsrStatus;
    if (!canMoveDsr(from, input.to)) {
      throw conflict("privacy.dsr_invalid_transition", { status: from });
    }
    if (input.to === "rejected" && !input.note) {
      throw validationFailed("privacy.dsr_reason_required", [
        { path: "note", code: "privacy.dsr_reason_required" },
      ]);
    }
    const final = isFinalDsrStatus(input.to);
    await ctx.tx
      .update(dsrRequests)
      .set({
        status: input.to,
        closedAt: final ? ctx.now : null,
        closedReason: final ? (input.note ?? null) : null,
      })
      .where(eq(dsrRequests.id, request.id));
    await ctx.tx.insert(dsrEvents).values({
      id: newId(),
      requestId: request.id,
      fromStatus: from,
      toStatus: input.to,
      note: input.note ?? null,
      ...actorColumns(ctx),
      at: ctx.now,
    });
    await ctx.audit.record({
      action: PRIVACY_AUDIT.dsrTransitioned,
      entityType: "dsr_request",
      entityId: request.id,
      data: { requestId: request.id, from, to: input.to },
    });
    return { status: input.to };
  },
});

/** The request row, locked for the rest of the transaction (`privacy.dsr_not_found`). */
async function lockedRequest(ctx: Ctx, requestId: string) {
  const [request] = await ctx.tx
    .select({
      id: dsrRequests.id,
      status: dsrRequests.status,
      receivedAt: dsrRequests.receivedAt,
      dueAt: dsrRequests.dueAt,
      extendedAt: dsrRequests.extendedAt,
      extensionNoticeAt: dsrRequests.extensionNoticeAt,
    })
    .from(dsrRequests)
    .where(eq(dsrRequests.id, requestId))
    .for("update");
  if (!request) throw notFound("privacy.dsr_not_found");
  return { ...request, status: request.status as DsrStatus };
}

/**
 * Extends a request's deadline (art. 12(3) GDPR, igs-pharma#88 C9) by one or two calendar months
 * (Brussels), for a reason code. Only for an open request, once (`privacy.dsr_already_extended`),
 * and before its original deadline (`privacy.dsr_extension_too_late`): the person must be told
 * within the first month. `due_at` becomes the new deadline, so overdue checks use it; the original
 * one is kept. The timeline gets an `extended` entry; the status does not change.
 */
export const extendDsr = command({
  name: "privacy.dsr.extend",
  input: z.object({
    requestId: z.uuid(),
    months: z.coerce
      .number()
      .int()
      .refine((n) => (DSR_EXTENSION_MONTHS as readonly number[]).includes(n)),
    reason: z.enum(DSR_EXTENSION_REASONS),
  }),
  output: z.object({ dueAt: z.date() }),
  permission: PERMISSIONS.privacy.dsrManage,
  async handler({ input, ctx }) {
    const request = await lockedRequest(ctx, input.requestId);
    if (isFinalDsrStatus(request.status)) {
      throw conflict("privacy.dsr_closed", { status: request.status });
    }
    if (request.extendedAt) throw conflict("privacy.dsr_already_extended");
    if (!canExtendDsr(request.status, false, request.dueAt, ctx.now)) {
      throw conflict("privacy.dsr_extension_too_late");
    }
    const months = input.months as DsrExtensionMonths;
    const dueAt = dsrExtendedDueAt(request.dueAt, months);
    await ctx.tx
      .update(dsrRequests)
      .set({
        dueAt,
        originalDueAt: request.dueAt,
        extendedAt: ctx.now,
        extensionMonths: months,
        extensionReason: input.reason,
      })
      .where(eq(dsrRequests.id, request.id));
    await ctx.tx.insert(dsrEvents).values({
      id: newId(),
      requestId: request.id,
      fromStatus: request.status,
      toStatus: request.status,
      kind: "extended",
      note: null,
      ...actorColumns(ctx),
      at: ctx.now,
    });
    await ctx.audit.record({
      action: PRIVACY_AUDIT.dsrExtended,
      entityType: "dsr_request",
      entityId: request.id,
      data: { requestId: request.id, months, reason: input.reason },
    });
    return { dueAt };
  },
});

/**
 * Records that staff told the person about the extension, and when (`sentAt`, between the day the
 * request was received and now; `privacy.dsr_notice_date_invalid`). Only for an extended request
 * (`privacy.dsr_not_extended`), once (`privacy.dsr_notice_already_recorded`). The system sends
 * nothing itself (D-019); the register shows whether the notice went out within the first month.
 */
export const recordDsrExtensionNotice = command({
  name: "privacy.dsr.extension_notice.record",
  input: z.object({ requestId: z.uuid(), sentAt: z.coerce.date() }),
  permission: PERMISSIONS.privacy.dsrManage,
  async handler({ input, ctx }) {
    const request = await lockedRequest(ctx, input.requestId);
    if (!request.extendedAt) throw conflict("privacy.dsr_not_extended");
    if (request.extensionNoticeAt) throw conflict("privacy.dsr_notice_already_recorded");
    if (
      Number.isNaN(input.sentAt.getTime()) ||
      input.sentAt.getTime() > ctx.now.getTime() ||
      input.sentAt.getTime() < request.receivedAt.getTime()
    ) {
      throw validationFailed("privacy.dsr_notice_date_invalid", [
        { path: "sentAt", code: "privacy.dsr_notice_date_invalid" },
      ]);
    }
    await ctx.tx
      .update(dsrRequests)
      .set({ extensionNoticeAt: input.sentAt })
      .where(eq(dsrRequests.id, request.id));
    await ctx.tx.insert(dsrEvents).values({
      id: newId(),
      requestId: request.id,
      fromStatus: request.status,
      toStatus: request.status,
      kind: "notice_sent",
      note: null,
      ...actorColumns(ctx),
      at: ctx.now,
    });
    await ctx.audit.record({
      action: PRIVACY_AUDIT.dsrExtensionNoticeRecorded,
      entityType: "dsr_request",
      entityId: request.id,
      data: { requestId: request.id },
    });
  },
});

/**
 * Deletes the personal data whose retention period has passed (igs-pharma#88): calls
 * `privacy.purge_expired_data()`, a zero-argument SECURITY DEFINER function that reads
 * `privacy.retention_policy` and is the only thing that may delete from the append-only ledgers. The
 * audit entry carries COUNTS only, never an e-mail address or a note. Run daily by the worker's
 * maintenance job as the `system_maintenance` actor (system-only permission).
 */
export const purgeExpiredPrivacyData = command({
  name: "privacy.retention.purge",
  input: z.object({}),
  output: z.object({
    consentEvents: z.number().int(),
    dsrRequests: z.number().int(),
    dsrEvents: z.number().int(),
  }),
  permission: PERMISSIONS.privacy.retentionPurge,
  async handler({ ctx }) {
    const rows = Array.from(
      await ctx.tx.execute<{ consent_events: number; dsr_requests: number; dsr_events: number }>(
        sql`SELECT consent_events, dsr_requests, dsr_events FROM privacy.purge_expired_data()`,
      ),
    );
    const row = rows[0];
    const counts = {
      consentEvents: Number(row?.consent_events ?? 0),
      dsrRequests: Number(row?.dsr_requests ?? 0),
      dsrEvents: Number(row?.dsr_events ?? 0),
    };
    await ctx.audit.record({
      action: PRIVACY_AUDIT.retentionPurged,
      entityType: "retention_purge",
      entityId: newId(),
      data: counts,
    });
    return counts;
  },
});
