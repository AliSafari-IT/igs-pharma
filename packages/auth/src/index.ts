import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { getEnv } from "@igs/config/env";
import { getDb } from "@igs/db/client";

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: "pg",
  }),
  secret: getEnv().AUTH_SECRET,
  baseURL: getEnv().AUTH_URL,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  // Plugins added in Phase 1a:
  // plugins: [twoFactor(), organization(), passkey()]
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
