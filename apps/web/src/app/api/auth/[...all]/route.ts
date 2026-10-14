import { getCustomerAuth } from "@igs/auth";
import { getFeatureFlags } from "@igs/config/feature-flags";

import { ensureAuthConfigured } from "../../../../server/kernel";

/**
 * Better Auth's CUSTOMER routes (igs-pharma#114, D-044), on the storefront origin with their own
 * cookies (`igs-c.*`). Staff never sign in here: the platform has its own instance. While
 * `NEXT_PUBLIC_FEATURE_CUSTOMER_ACCOUNTS` is off the routes do not exist (404) and nothing is
 * configured or opened: no database work happens for a request that is refused.
 */
async function handler(request: Request): Promise<Response> {
  if (!getFeatureFlags().customerAccounts) return new Response(null, { status: 404 });
  ensureAuthConfigured();
  return getCustomerAuth().handler(request);
}

export { handler as GET, handler as POST };
