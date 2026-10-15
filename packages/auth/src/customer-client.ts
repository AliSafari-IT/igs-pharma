/**
 * Better Auth client for the CUSTOMER instance (igs-pharma#114/#115, D-044), for the storefront's
 * Client Components. It talks to the storefront's own origin at `/api/auth` (apps/web
 * `app/api/auth/[...all]`), which answers 404 while `NEXT_PUBLIC_FEATURE_CUSTOMER_ACCOUNTS` is off.
 * No plugins: customers sign in with e-mail and password (passkeys come later). Staff use
 * `authClient` from `@igs/auth/client`, on the platform origin.
 */
import { createAuthClient } from "better-auth/client";

/** Where the storefront mounts the customer routes (same origin as the page). */
export const CUSTOMER_AUTH_BASE_PATH = "/api/auth";

export const customerAuthClient = createAuthClient({ basePath: CUSTOMER_AUTH_BASE_PATH });
