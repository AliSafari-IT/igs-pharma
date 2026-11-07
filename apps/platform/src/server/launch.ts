import type { ResolvedActor } from "@igs/auth";
import { type LaunchReadiness, codeLaunchFacts, launchReadiness } from "@igs/config/launch";
import { getDeliverySettings } from "@igs/module-orders";
import { logger } from "@igs/observability/logger";
import { PERMISSIONS, hasPermission } from "@igs/rbac";

import { settle } from "../lib/dashboard";
import { shippingStatus } from "./shipping";

/**
 * The launch checklist as the back-office sees it (igs-pharma#238): the answers held in code, the
 * Sendcloud settings this process holds, and whether staff saved their own delivery amounts. The
 * storefront's own settings (Mollie, its switches) are `elsewhere`: the storefront checks them and
 * stays closed while they are missing.
 *
 * Shown to whoever may set the delivery amounts, the owner and the pharmacist-titular, the people
 * who answer #238. The delivery amounts are read through `getDeliverySettings`, which checks that
 * permission again (D-005); the rest is the shop's public configuration. `undefined` for anyone else.
 */
export async function loadLaunchChecklist(
  actor: ResolvedActor,
): Promise<LaunchReadiness | undefined> {
  if (!hasPermission(actor.roles, PERMISSIONS.orders.deliverySettingsManage)) return undefined;
  const rates = await settle(
    () => getDeliverySettings({}, actor),
    (error) =>
      logger.error(
        { event: "platform.launch_checklist_failed", source: "delivery_settings", err: error },
        "launch checklist source failed",
      ),
  );
  return launchReadiness({
    ...codeLaunchFacts(),
    backOffice: {
      sendcloudConfigured: shippingStatus().configured,
      deliveryRatesSet: rates.state === "ok" ? !rates.data.isDefault : undefined,
    },
  });
}
