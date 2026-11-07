import { z } from "zod";

import { SAM_SKIP_REASONS } from "./map";

const count = z.number().int().min(0);

/** The run report as the audit event stores it: flat counts (D-028), no CNK, no text. */
export const samRunAudit = z.object({
  runId: z.uuid(),
  outcome: z.enum(["completed", "aborted"]),
  read: count,
  rows: count,
  created: count,
  updated: count,
  unchanged: count,
  withdrawn: count,
  conflicts: count,
  failed: count,
  gtinInvalid: count,
  gtinTaken: count,
  gtinKept: count,
  textsKept: count,
  skipped_no_public_cnk: count,
  skipped_invalid_cnk: count,
  skipped_no_current_data: count,
  skipped_no_delivery_modus: count,
  skipped_prescription: count,
  skipped_missing_name: count,
});

/** One `skipped_<reason>` key per `SAM_SKIP_REASONS` entry (a test keeps both in step). */
export const SKIPPED_KEYS = SAM_SKIP_REASONS.map((reason) => `skipped_${reason}` as const);

export type SamRunAudit = z.infer<typeof samRunAudit>;
