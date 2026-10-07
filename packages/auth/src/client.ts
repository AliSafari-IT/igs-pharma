/**
 * Better Auth client — for use in Client Components and browser-side code.
 * Server-side code should use the `getAuth()` from `@igs/auth` directly.
 */
import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient();
