import { type SchemaGrants, fn, table } from "./types";

export const privacy: SchemaGrants = {
  schema: "privacy",
  usage: { app: true, worker: false },
  objects: [
    table("privacy.consent_events", "append_only", { app: ["SELECT", "INSERT"] }),
    table("privacy.dsr_events", "append_only", { app: ["SELECT", "INSERT"] }),
    table("privacy.dsr_requests", "mutable", { app: ["SELECT", "INSERT", "UPDATE"] }),
    table("privacy.retention_policy", "catalogue", {
      app: ["SELECT"],
      note: "how long personal data is kept; written by migrations only, read by the purge function (igs-pharma#88)",
      since: 33,
    }),
    fn("privacy.reject_mutation()", { note: "trigger function" }),
    fn("privacy.purge_expired_data()", {
      worker: true,
      note: "SECURITY DEFINER, zero arguments: the worker's daily retention purge; the only deleter of the ledgers (igs-pharma#88)",
      since: 33,
    }),
  ],
};
