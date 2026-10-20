import { getFeatureFlags } from "@igs/config/feature-flags";
import type { Actor } from "@igs/kernel";
import type { ContentLocale } from "@igs/module-catalog";
import { attachCart } from "@igs/module-orders";
import { logger } from "@igs/observability/logger";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { CART_COOKIE, isCartToken } from "../lib/cart-area";
import { currentCustomer } from "./customer";
import { ensureKernelConfigured } from "./kernel";
import { localeOf } from "./storefront";

/**
 * A guest has no account: the cart commands run as an `anonymous` actor (kernel.md A1). Its id is a
 * fixed label, never the cart cookie (which opens the cart and must not reach the audit trail).
 */
export const GUEST_ACTOR: Actor = { type: "anonymous", id: "storefront-guest", roles: [] };

/** The cart page and actions exist only while `NEXT_PUBLIC_FEATURE_CART` is on: otherwise 404. */
export function cartLocale(rawLocale: string): ContentLocale {
  const locale = localeOf(rawLocale);
  if (!locale || !getFeatureFlags().cart) notFound();
  return locale;
}

/** The cart cookie of this request, when it is well-formed. */
export async function cartToken(): Promise<string | undefined> {
  const value = (await cookies()).get(CART_COOKIE)?.value;
  return isCartToken(value) ? value : undefined;
}

/**
 * Who works on the cart: the signed-in customer (their own cart, whatever the cookie), or a guest.
 * A customer who still carries a guest cookie gets that cart attached (merged into theirs) first;
 * attaching again is harmless, so a page may do it on every visit.
 */
export async function cartActor(): Promise<{ actor: Actor; token: string | undefined }> {
  await ensureKernelConfigured();
  const token = await cartToken();
  const session = getFeatureFlags().customerAccounts ? await currentCustomer() : null;
  if (!session) return { actor: GUEST_ACTOR, token };
  if (token) {
    try {
      await attachCart({ cartToken: token }, session.actor);
    } catch (error) {
      // the customer's own cart still works; the guest lines wait for the next visit
      logger.error(
        { event: "storefront.cart_attach_failed", err: error },
        "storefront.cart_attach_failed",
      );
    }
  }
  return { actor: session.actor, token: undefined };
}
