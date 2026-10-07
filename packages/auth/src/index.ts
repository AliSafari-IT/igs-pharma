import "server-only";

import { passkey } from "@better-auth/passkey";
import { getEnv } from "@igs/config/env";
import { getDb } from "@igs/db/client";
import { newId } from "@igs/db/ids";
import { identitySchema } from "@igs/module-identity";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";

function createAuth() {
  const env = getEnv();
  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: identitySchema,
      usePlural: true,
    }),
    secret: env.AUTH_SECRET,
    baseURL: env.AUTH_URL,
    advanced: {
      // UUIDv7 primary keys, generated app-side (D-003)
      database: { generateId: () => newId() },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    plugins: [twoFactor(), passkey()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let _auth: Auth | undefined;

/**
 * Lazy, memoised Better Auth instance. Never call at module top level:
 * it reads env and opens the DB pool on first use (not on import).
 */
export function getAuth(): Auth {
  if (!_auth) _auth = createAuth();
  return _auth;
}

export type Session = Auth["$Infer"]["Session"];
export type User = Session["user"];
