import { type SchemaGrants, fn, table } from "./types";

export const privacy: SchemaGrants = {
  schema: "privacy",
  usage: { app: true, worker: false },
  objects: [
    table("privacy.consent_events", "append_only", { app: ["SELECT", "INSERT"] }),
    table("privacy.dsr_events", "append_only", { app: ["SELECT", "INSERT"] }),
    table("privacy.dsr_requests", "mutable", { app: ["SELECT", "INSERT", "UPDATE"] }),
    fn("privacy.reject_mutation()", { note: "trigger function" }),
  ],
};
