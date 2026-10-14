import { type SchemaGrants, table } from "./types";

const ALL = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

/**
 * Accounts and the RBAC catalogue. The catalogue (`roles`, `permissions`, `role_permissions`) is
 * written by migrations only, so the runtime reads it.
 */
export const identity: SchemaGrants = {
  schema: "identity",
  usage: { app: true, worker: false },
  objects: [
    table("identity.users", "mutable", { app: ["SELECT", "INSERT", "UPDATE"] }),
    table("identity.accounts", "mutable", { app: ALL }),
    table("identity.sessions", "mutable", { app: ALL }),
    table("identity.verifications", "mutable", { app: ALL }),
    table("identity.two_factors", "mutable", { app: ALL }),
    table("identity.passkeys", "mutable", { app: ALL }),
    table("identity.user_roles", "mutable", { app: ["SELECT", "INSERT", "DELETE"] }),
    // the database-backed rate limiter and the mail links waiting for the worker (igs-pharma#114);
    // the worker gets its own grant on mail_tokens with the mail jobs
    table("identity.rate_limits", "mutable", { app: ALL, since: 43 }),
    table("identity.mail_tokens", "mutable", { app: ALL, since: 43 }),
    table("identity.roles", "catalogue", { app: ["SELECT"] }),
    table("identity.permissions", "catalogue", { app: ["SELECT"] }),
    table("identity.role_permissions", "catalogue", { app: ["SELECT"] }),
  ],
};
