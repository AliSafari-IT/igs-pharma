import { configureAuth, configureCustomerAuth } from "@igs/auth";
import { auditEnv, parseEnvFor, storefrontEnv } from "@igs/config/env";
import {
  configureKernel,
  isDomainError,
  registerEvents,
  registerKernelAuditActions,
} from "@igs/kernel";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import {
  MailRequested,
  applySecurityEvent,
  ensureRbacCatalogue,
  redeemEarlyAccessInvitation,
  registerAuditActions as registerIdentityAuditActions,
  requestMail,
} from "@igs/module-identity";
import { registerAuditActions as registerInventoryAuditActions } from "@igs/module-inventory";
import {
  OrderMailRequested,
  registerAuditActions as registerOrdersAuditActions,
} from "@igs/module-orders";
import { configureStorefront } from "@igs/module-storefront";
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
 * - 36b: `configureAuth` routes Better Auth's factor changes to `applySecurityEvent`: a removal
 *   and its audit entry commit together, an enrolment without its entry is undone (#90). `getAuth()` refuses to start without it, so anything that resolves
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
  // igs-pharma#210: a person refused by any command or query leaves a `kernel.access.denied` entry
  registerKernelAuditActions(registerAuditAction);
  registerIdentityAuditActions(registerAuditAction);
  // the cart and checkout (igs-pharma#116) audit their changes; the checkout holds stock through
  // inventory's reservation commands, which audit too
  registerOrdersAuditActions(registerAuditAction);
  registerInventoryAuditActions(registerAuditAction);
  configureKernel({ audit: createAuditPort({ hmacKey: env.AUDIT_HMAC_KEY }) });
  // The name says "auth" but this is the web app's one synchronous composition root: every request
  // path goes through it, so the storefront read model's setting is parsed HERE (modules do not read
  // the environment). Rename in a later PR.
  const lowStockThreshold = parseEnvFor(storefrontEnv).STOREFRONT_LOW_STOCK_THRESHOLD;
  configureStorefront({
    ...(lowStockThreshold === undefined ? {} : { lowStockThreshold }),
  });
  // identity mails leave through the outbox (D-019): the callbacks below only store the link and
  // publish `identity.mail.requested`; the worker sends (PR 2)
  registerEvents(MailRequested);
  // a recorded payment asks for the customer's order mail (igs-pharma#157); the worker sends it
  registerEvents(OrderMailRequested);
  configureCustomerAuth({
    requestMail: async (input) => {
      await ensureRbacCatalogue();
      await requestMail(input, AUTH_HOOK_ACTOR);
    },
    // igs-pharma#211: a confirmed address redeems its early-access invitation. The address is
    // confirmed already, so a failure is logged, not thrown: the pass check redeems again.
    onEmailVerified: async ({ userId }) => {
      try {
        await ensureRbacCatalogue();
        await redeemEarlyAccessInvitation({ userId }, AUTH_HOOK_ACTOR);
      } catch (error) {
        logger.error(
          { event: "identity.early_access.redeem_failed", userId, err: error },
          "identity.early_access.redeem_failed",
        );
      }
    },
  });
  configureAuth({
    onSecurityEvent: async (event) => {
      try {
        await ensureRbacCatalogue();
        // a removal happens HERE, with its audit entry; a failed enrolment audit makes @igs/auth
        // delete the new factor again (#90 C5)
        await applySecurityEvent(event, AUTH_HOOK_ACTOR);
      } catch (error) {
        // a refusal (e.g. the last passkey) is an answer, not a failure
        if (isDomainError(error)) throw error;
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
