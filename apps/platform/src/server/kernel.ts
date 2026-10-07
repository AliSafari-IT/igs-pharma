import { auditEnv, parseEnvFor } from "@igs/config/env";
import { configureKernel } from "@igs/kernel";
import { createAuditPort } from "@igs/module-audit";

let configured = false;

/**
 * Composition root of the kernel for this app (T-006b). Call it at the top of every Server Action /
 * route handler that runs a `command()` or `query()`; it is memoised and cheap after the first call.
 *
 * - `AUDIT_HMAC_KEY` (`auditEnv`) is required HERE, not at boot: a missing key makes the first
 *   command fail closed (a readable error) and does not affect `/api/health`.
 * - Audit action registrations: every module that audits exports `registerAuditActions()`; call
 *   them here BEFORE `configureKernel` (an unregistered action is rejected, fail closed). None
 *   exist yet besides the audit module itself.
 * - The edge adapter passes the caller's `origin` ({ ip, userAgent }) as a command call option;
 *   the audit port hashes it with the key. Handlers never see it.
 */
export function ensureKernelConfigured(): void {
  if (configured) return;
  const env = parseEnvFor(auditEnv);
  // registerAuditActions() of each auditing module goes here
  configureKernel({ audit: createAuditPort({ hmacKey: env.AUDIT_HMAC_KEY }) });
  configured = true;
}
