import { getFeatureFlags } from "@igs/config/feature-flags";
import { isDomainError } from "@igs/kernel";
import { PAYMENT_WEBHOOK_ACTOR, syncPayment } from "@igs/module-orders";
import { logger } from "@igs/observability/logger";
import { MOLLIE_PAYMENT_ID, MollieError } from "@igs/payments";
import { NextResponse } from "next/server";

import { ensureKernelConfigured } from "../../../../server/kernel";
import { paymentsSetup } from "../../../../server/payments";

/**
 * Mollie's webhook (igs-pharma#116). The call carries only a payment id and is not signed: nothing
 * in it is trusted. The status is read back from Mollie with our key (`syncPayment`), so a forged
 * call can at most make us re-read a payment.
 *
 * - 200: recorded, or a payment that is not ours / that Mollie does not know (retrying won't help);
 * - 500: anything else, so Mollie retries (the worker's reconciliation is the net after that);
 * - 404: payments not configured.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const payments = paymentsSetup();
  if (!payments || !getFeatureFlags().cart) return new NextResponse(null, { status: 404 });

  let id: unknown;
  try {
    id = (await request.formData()).get("id");
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (typeof id !== "string" || !MOLLIE_PAYMENT_ID.test(id)) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    await ensureKernelConfigured();
    await syncPayment(id, payments.provider, PAYMENT_WEBHOOK_ACTOR);
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    if (
      (isDomainError(error) && error.code === "orders.payment_not_found") ||
      (error instanceof MollieError && error.status === 404)
    ) {
      logger.warn(
        { event: "payments.webhook_unknown_payment" },
        "payments.webhook_unknown_payment",
      );
      return new NextResponse(null, { status: 200 });
    }
    logger.error(
      {
        event: "payments.webhook_failed",
        code: isDomainError(error)
          ? error.code
          : error instanceof MollieError
            ? error.code
            : undefined,
      },
      "payments.webhook_failed",
    );
    return new NextResponse(null, { status: 500 });
  }
}
