import { configureAuth } from "@igs/auth";
import { auditEnv, parseEnvFor } from "@igs/config/env";
import { configureKernel } from "@igs/kernel";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { registerAuditActions as registerCatalogAuditActions } from "@igs/module-catalog";
import {
  ensureRbacCatalogue,
  recordSecurityEvent,
  registerAuditActions as registerIdentityAuditActions,
} from "@igs/module-identity";
import { registerAuditActions as registerInventoryAuditActions } from "@igs/module-inventory";
import { registerAuditActions as registerPrivacyAuditActions } from "@igs/module-privacy";
import { logger } from "@igs/observability/logger";

/** The actor Better Auth's factor changes are audited as (36b); `system_auth` can do nothing else. */
const AUTH_HOOK_ACTOR = { type: "system", id: "better-auth", roles: ["system_auth"] } as const;

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
 * - 36b: `configureAuth` routes Better Auth's `mfa.enrolled|removed` events to an audit entry
 *   (`recordSecurityEvent`). `getAuth()` refuses to start without it, so anything that resolves
 *   the actor (`resolveActor`) or serves `/api/auth/*` calls `ensureAuthConfigured()` first.
 * - The edge adapter passes the caller's `origin` ({ ip, userAgent }) as a command call option;
 *   the audit port hashes it with the key. Handlers never see it.
 */
export async function ensureKernelConfigured(): Promise<void> {
  ensureAuthConfigured();
  await ensureRbacCatalogue();
}

/**
 * The synchronous part (no database work): audit registrations, `configureKernel`, `configureAuth`.
 * Enough for `resolveActor` and `/api/auth/*`, so a signed-out page needs no database round trip.
 */
export function ensureAuthConfigured(): void {
  if (configured) return;
  const env = parseEnvFor(auditEnv);
  registerIdentityAuditActions(registerAuditAction);
  registerCatalogAuditActions(registerAuditAction);
  registerInventoryAuditActions(registerAuditAction);
  registerPrivacyAuditActions(registerAuditAction);
  configureKernel({ audit: createAuditPort({ hmacKey: env.AUDIT_HMAC_KEY }) });
  configureAuth({
    onSecurityEvent: async (event) => {
      try {
        await ensureRbacCatalogue();
        await recordSecurityEvent(event, AUTH_HOOK_ACTOR);
      } catch (error) {
        // Better Auth's factor change already stands: make the missing audit row traceable
        logger.error(
          {
            event: "auth.security_event_audit_failed",
            type: event.type,
            userId: event.userId,
            err: error,
          },
          "auth.security_event_audit_failed",
        );
        throw error;
      }
    },
  });
  configured = true;
}
