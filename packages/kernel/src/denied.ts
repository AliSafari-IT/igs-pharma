import { lt } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "./actor";
import type { AuditEntry, KernelConfig, Origin } from "./config";
import { type DomainError, isDomainError } from "./errors";
import { deniedAuditThrottle } from "./schema";

/**
 * Refused actions in the audit trail (igs-pharma#210). A command or query refuses a person in two
 * places: the kernel's own check (`kernel.forbidden`, `kernel.mfa_required`) BEFORE any transaction
 * opens (K1), and a handler's `forbidden(...)` (`identity.fresh_mfa_required`, "not your own request")
 * whose transaction rolls back. Neither reaches the command's audit. This writes ONE entry for them, in
 * its own short transaction after the refusal:
 *
 * - only for `user` actors: anonymous refusals are the public's and system actors are code;
 * - only for `Forbidden` refusals: validation errors, not-found and conflicts stay unaudited;
 * - at most one entry per (person, operation, minute), across every app instance (the throttle row);
 * - ids and codes only, never the input (D-028);
 * - it never changes the answer: if it fails, the refusal still stands and an alarm is logged.
 */

export const KERNEL_AUDIT = {
  accessDenied: "kernel.access.denied",
} as const;

const accessDenied = z.object({
  /** The command or query that refused, e.g. `identity.early_access.approve`. */
  operation: z.string().max(200),
  /** Its permission (`public` for none). */
  permission: z.string().max(200),
  /** The refusal's code, e.g. `kernel.forbidden` or `identity.fresh_mfa_required`. */
  code: z.string().max(200),
});

/** The signature of `registerAuditAction` from `@igs/module-audit`. */
export type RegisterKernelAuditAction = (action: string, data: z.ZodObject<z.ZodRawShape>) => void;

/** Registers the kernel's audit actions; each app's composition root calls it with the others. */
export function registerKernelAuditActions(register: RegisterKernelAuditAction): void {
  register(KERNEL_AUDIT.accessDenied, accessDenied);
}

/** How long a throttle row is kept: the window is a minute, the rest is slack for clock skew. */
const THROTTLE_KEEP_MS = 60 * 60 * 1000;

/** Whether `error` is a refusal the audit trail records for `actor`. */
export function isAuditedRefusal(error: unknown, actor: Actor): error is DomainError {
  return actor.type === "user" && isDomainError(error) && error.kind === "Forbidden";
}

/**
 * Records one `kernel.access.denied` entry for `actor` refused by `operation`, unless one was
 * already recorded for them and that operation this minute. Never throws.
 */
export async function recordDenied(
  config: KernelConfig,
  operation: string,
  permission: string,
  error: DomainError,
  actor: Actor,
  origin: Origin | undefined,
): Promise<void> {
  try {
    await config.db().transaction(async (tx) => {
      const now = config.clock();
      const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
      const fresh = await tx
        .insert(deniedAuditThrottle)
        .values({ actorId: actor.id, operation, minute })
        .onConflictDoNothing()
        .returning({ minute: deniedAuditThrottle.minute });
      if (fresh.length === 0) return;
      await tx
        .delete(deniedAuditThrottle)
        .where(lt(deniedAuditThrottle.minute, new Date(now.getTime() - THROTTLE_KEEP_MS)));
      const entry: AuditEntry = {
        action: KERNEL_AUDIT.accessDenied,
        entityType: "operation",
        entityId: operation,
        data: { operation, permission, code: error.code },
      };
      config.audit.validate?.(entry);
      await config.audit.record(entry, { actor, tx, at: now, ...(origin ? { origin } : {}) });
    });
    config.metrics.increment("kernel.access.denied", { code: error.code });
  } catch (failure) {
    config.logger.error(
      {
        alarm: "kernel.denied_audit_failed",
        operation,
        code: error.code,
        err: failure instanceof Error ? { name: failure.name, message: failure.message } : failure,
      },
      "kernel.denied_audit_failed: a refused action could not be audited",
    );
  }
}
