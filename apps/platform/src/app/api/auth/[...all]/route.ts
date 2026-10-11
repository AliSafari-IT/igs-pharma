import { getAuth } from "@igs/auth";

import { ensureAuthConfigured } from "../../../../server/kernel";

/**
 * Better Auth's routes (36b), mounted in the platform only: the staff realm. `AUTH_URL` is this
 * app's origin, so passkeys are bound to it. The composition root runs first because it wires
 * `onSecurityEvent` (factor changes are audited).
 */
async function handler(request: Request): Promise<Response> {
  ensureAuthConfigured();
  return getAuth().handler(request);
}

export { handler as GET, handler as POST };
