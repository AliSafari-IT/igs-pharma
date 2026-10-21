import { authEnv, parseEnvFor, paymentsEnv } from "@igs/config/env";
import {
  PAYMENTS_ACTOR,
  type PaymentProvider,
  type PaymentUrls,
  getOrderPayment,
  syncPayment,
} from "@igs/module-orders";
import { logger } from "@igs/observability/logger";
import { createMollieClient } from "@igs/payments";

export interface PaymentsSetup {
  readonly provider: PaymentProvider;
  readonly urls: PaymentUrls;
}

let setup: PaymentsSetup | null | undefined;

const schema = paymentsEnv.extend({ STOREFRONT_URL: authEnv.shape.STOREFRONT_URL });

/**
 * Online payment (igs-pharma#116): the Mollie client and the URLs it needs, or `null` when payment
 * is not configured. Both `MOLLIE_API_KEY` and `STOREFRONT_URL` (where the shopper comes back to)
 * are needed; without them the shop takes orders and offers no payment. Read once and memoised.
 */
export function paymentsSetup(): PaymentsSetup | null {
  if (setup !== undefined) return setup;
  let env: ReturnType<typeof parseEnvFor<typeof schema>>;
  try {
    env = parseEnvFor(schema);
  } catch (error) {
    // a malformed key or URL turns payment off; it never takes the order pages down with it
    logger.error(
      { event: "storefront.payments_misconfigured", err: error },
      "storefront.payments_misconfigured",
    );
    setup = null;
    return setup;
  }
  if (!env.MOLLIE_API_KEY || !env.STOREFRONT_URL) {
    if (env.MOLLIE_API_KEY) {
      logger.warn(
        { event: "storefront.payments_unconfigured" },
        "storefront.payments_unconfigured: MOLLIE_API_KEY is set but STOREFRONT_URL is not",
      );
    }
    setup = null;
    return setup;
  }
  setup = {
    provider: createMollieClient(env.MOLLIE_API_KEY),
    urls: {
      storefrontUrl: env.STOREFRONT_URL.replace(/\/+$/, ""),
      webhookBaseUrl: env.MOLLIE_WEBHOOK_BASE_URL?.replace(/\/+$/, ""),
    },
  };
  return setup;
}

/**
 * The shopper is back from Mollie, usually before the webhook: re-read the order's payment once so
 * the page shows where it stands. Best effort: a failure is logged, the webhook and the worker's
 * reconciliation still record the status. Call only after the caller has shown the order is theirs.
 */
export async function refreshPayment(orderId: string, payments: PaymentsSetup): Promise<void> {
  try {
    const payment = await getOrderPayment({ orderId }, PAYMENTS_ACTOR);
    if (payment.providerPaymentId) await syncPayment(payment.providerPaymentId, payments.provider);
  } catch (error) {
    logger.warn(
      { event: "storefront.payment_refresh_failed", err: error },
      "storefront.payment_refresh_failed",
    );
  }
}
