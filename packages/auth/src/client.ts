/**
 * Better Auth client — for use in Client Components and browser-side code.
 * Server-side code should use the `getAuth()` from `@igs/auth` directly.
 *
 * 36b: passkeys (sign-in, add) and TOTP (the backup factor) for the platform's 2-step login pages.
 */
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [passkeyClient(), twoFactorClient()],
});
