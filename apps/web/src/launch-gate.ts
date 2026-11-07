import { type StorefrontGate, storefrontGate } from "@igs/config/launch";
import { logger } from "@igs/observability/logger";

/**
 * The storefront's gate with the launch check (igs-pharma#238), for the proxy, `/robots.txt` and the
 * early-access pass route: they must agree, so they all ask here. `SITE_GATE=off` is refused while a
 * launch item is missing and `LAUNCH_CHECK` enforces (the default in production).
 *
 * Loud on purpose: the first request after a start (and every change of state) logs an `error` when
 * the opening is refused, or when the shop is open while items are still missing (`LAUNCH_CHECK=report`),
 * with the ids of the missing checks only (#2: every alarm is also a log until metrics have a
 * backend). The owner sees the full list in the back-office (Admin › Launch checklist).
 */
let reported: string | undefined;

export function currentStorefrontGate(): StorefrontGate {
  const gate = storefrontGate();
  const missing = gate.readiness.missing.map((check) => check.id);
  const state = `${gate.closed}:${gate.refused}:${missing.join(",")}`;
  if (state !== reported) {
    reported = state;
    if (gate.refused) {
      logger.error(
        { event: "launch.open_refused", missing },
        "SITE_GATE=off refused: launch items are missing, the storefront stays closed (igs-pharma#238)",
      );
    } else if (!gate.closed && missing.length > 0) {
      logger.error(
        { event: "launch.open_not_ready", missing },
        "the storefront is open while launch items are missing (LAUNCH_CHECK=report)",
      );
    } else if (missing.length > 0) {
      logger.info({ event: "launch.not_ready", missing }, "launch items are missing");
    }
  }
  return gate;
}
