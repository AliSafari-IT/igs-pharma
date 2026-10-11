import "server-only";

import { passkey } from "@better-auth/passkey";
import { getEnv } from "@igs/config/env";
import { getDb } from "@igs/db/client";
import { newId } from "@igs/db/ids";
import { identitySchema } from "@igs/module-identity";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";

import { type ResolvedActor, ensureRbacCatalogue, loadActor, sessionAllowed } from "./rbac";

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
    session: {
      // T-016 Q2: no roles/status in a signed cookie; every request re-reads the session row
      cookieCache: { enabled: false },
    },
    user: {
      // T-016: profile columns are server-owned. `input: false` keeps them out of every client
      // body (a sign-up request cannot make itself `staff`); the DB defaults apply.
      additionalFields: {
        locale: { type: "string", input: false, required: false },
        kind: { type: "string", input: false, required: false },
        status: { type: "string", input: false, required: false },
        identityAssurance: { type: "string", input: false, required: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // T-016 Q6: suspended or deleted users get no new session
          before: async (session) => ((await sessionAllowed(getDb(), session.userId)) ? undefined : false),
        },
      },
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

export {
  type ResolvedActor,
  type RoleGrant,
  ensureRbacCatalogue,
  loadActor,
  loadRbacCatalogue,
  rbacDrift,
} from "./rbac";

/**
 * The edge adapter's actor for this request (T-016 Q2): validates the Better Auth session, then
 * loads the user's status, kind and role grants from the database. `null` when there is no valid
 * session or the user is not `active`. Loads the RBAC catalogue on first use. Memoise per request
 * in the app (React `cache()`), never across requests.
 */
export async function resolveActor(
  headers: Headers,
  options: { locationId?: string | null } = {},
): Promise<ResolvedActor | null> {
  // no session cookie → no database work at all (public pages stay cheap)
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  const db = getDb();
  await ensureRbacCatalogue(db);
  return loadActor(db, session.user.id, options);
}
