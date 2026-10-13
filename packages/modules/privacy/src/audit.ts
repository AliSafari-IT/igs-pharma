import { z } from "zod";

import { CONSENT_PURPOSES, CONSENT_SOURCES, DSR_CHANNELS, DSR_STATUSES, DSR_TYPES } from "./domain";

/** Audit actions recorded by the privacy commands (`<domain>.<noun>.<verb>`). */
export const PRIVACY_AUDIT = {
  consentRecorded: "privacy.consent.recorded",
  dsrCreated: "privacy.dsr.created",
  dsrTransitioned: "privacy.dsr.transitioned",
  retentionPurged: "privacy.retention.purged",
} as const;

const consentRecorded = z.object({
  consentEventId: z.uuid(),
  purpose: z.enum(CONSENT_PURPOSES),
  granted: z.boolean(),
  source: z.enum(CONSENT_SOURCES),
});
const dsrCreated = z.object({
  requestId: z.uuid(),
  type: z.enum(DSR_TYPES),
  channel: z.enum(DSR_CHANNELS),
});
const dsrTransitioned = z.object({
  requestId: z.uuid(),
  from: z.enum(DSR_STATUSES),
  to: z.enum(DSR_STATUSES),
});

const retentionPurged = z.object({
  consentEvents: z.number().int().min(0),
  dsrRequests: z.number().int().min(0),
  dsrEvents: z.number().int().min(0),
});

/** The signature of `registerAuditAction` from `@igs/module-audit`. */
export type RegisterAuditAction = (action: string, data: z.ZodObject<z.ZodRawShape>) => void;

/**
 * Registers the privacy audit actions: identifiers and statuses only (D-028). The subject's e-mail
 * address and the staff notes never enter the audit trail; the entry points at the request or the
 * consent event, which holds them. Each composition root that runs privacy commands calls it once,
 * before `configureKernel`, passing `registerAuditAction` from `@igs/module-audit`.
 */
export function registerAuditActions(register: RegisterAuditAction): void {
  register(PRIVACY_AUDIT.consentRecorded, consentRecorded);
  register(PRIVACY_AUDIT.dsrCreated, dsrCreated);
  register(PRIVACY_AUDIT.dsrTransitioned, dsrTransitioned);
  register(PRIVACY_AUDIT.retentionPurged, retentionPurged);
}
