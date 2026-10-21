import { getFeatureFlags } from "@igs/config/feature-flags";
import { isDomainError } from "@igs/kernel";
import { getOrder, startPayment } from "@igs/module-orders";
import { logger } from "@igs/observability/logger";
import { type NextRequest, NextResponse } from "next/server";

import { uuidOf } from "../../../../../lib/checkout-area";
import { cartActor } from "../../../../../server/cart";
import { paymentsSetup } from "../../../../../server/payments";
import { localeOf } from "../../../../../server/storefront";

interface Context {
  readonly params: Promise<{ locale: string; id: string }>;
}

/**
 * "Pay now" (igs-pharma#116): a plain link, not a form (the CSP's `form-action 'self'` would block a
 * form posting on to Mollie). Only the order's owner gets past `getOrder`; the payment is created on
 * the first visit (an idempotency key makes a double click harmless) and the shopper is sent to
 * Mollie's page with a 303. Anything else lands back on the order page, which says where it stands.
 */
export async function GET(_request: NextRequest, { params }: Context): Promise<NextResponse> {
  const { locale: rawLocale, id } = await params;
  const locale = localeOf(rawLocale);
  const orderId = uuidOf(id);
  if (!locale || !orderId || !getFeatureFlags().cart) {
    return new NextResponse(null, { status: 404 });
  }
  const back = (reason?: string) =>
    redirect(`/${locale}/orders/${orderId}${reason ? `?payment=${reason}` : ""}`);
  const payments = paymentsSetup();
  if (!payments) return back();

  try {
    const { actor, token } = await cartActor();
    await getOrder({ cartToken: token, orderId }, actor);
  } catch (error) {
    if (isDomainError(error) && error.code === "orders.order_not_found") {
      return new NextResponse(null, { status: 404 });
    }
    logger.error({ event: "storefront.pay_failed", err: error }, "storefront.pay_failed");
    return back("unavailable");
  }

  try {
    const checkoutUrl = await startPayment(orderId, payments.provider, payments.urls);
    return checkoutUrl ? redirectTo(checkoutUrl) : back();
  } catch (error) {
    logger.error(
      {
        event: "storefront.pay_failed",
        code: isDomainError(error) ? error.code : undefined,
        err: isDomainError(error) ? undefined : error,
      },
      "storefront.pay_failed",
    );
    return back("unavailable");
  }
}

/** A same-origin redirect (relative, so it follows the request's host). */
function redirect(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

/** Mollie's payment page: only an https URL on mollie.com is followed. */
function redirectTo(url: string): NextResponse {
  const target = new URL(url);
  if (target.protocol !== "https:" || !/(^|\.)mollie\.com$/.test(target.hostname)) {
    throw new Error("unexpected checkout URL host");
  }
  return new NextResponse(null, { status: 303, headers: { location: target.toString() } });
}
