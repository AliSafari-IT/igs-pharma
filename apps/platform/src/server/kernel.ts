import { auditEnv, parseEnvFor } from "@igs/config/env";
import { configureKernel } from "@igs/kernel";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import {
  ensureRbacCatalogue,
  registerAuditActions as registerIdentityAuditActions,
} from "@igs/module-identity";

let configured = false;

/**
 * Composition root of the kernel for this app (T-006b). Call it at the top of every Server Action /
 * route handler that runs a `command()` or `query()` (`await ensureKernelConfigured()`); it is
 * memoised and cheap after the first call.
 *
 * - `AUDIT_HMAC_KEY` (`auditEnv`) is required HERE, not at boot: a missing key makes the first
 *   command fail closed (a readable error) and does not affect `/api/health`.
 * - Audit action registrations: every module that audits exports `registerAuditActions()`; call
 *   them here BEFORE `configureKernel` (an unregistered action is rejected, fail closed).
 * - The RBAC catalogue (T-016) is loaded from the database on first use and checked against the
 *   code; until it is, `hasPermission` throws (fail closed). A drifted database fails the call
 *   with `rbac.catalogue_drift` and is retried on the next one; `/api/health` is unaffected.
 * - The edge adapter passes the caller's `origin` ({ ip, userAgent }) as a command call option;
 *   the audit port hashes it with the key. Handlers never see it.
 */
export async function ensureKernelConfigured(): Promise<void> {
  if (!configured) {
    const env = parseEnvFor(auditEnv);
    registerIdentityAuditActions(registerAuditAction);
    configureKernel({ audit: createAuditPort({ hmacKey: env.AUDIT_HMAC_KEY }) });
    configured = true;
  }
  await ensureRbacCatalogue();
}
