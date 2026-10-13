import { type SchemaGrants, table } from "./types";

/** The kernel's schema (D-017): idempotency keys and the transactional outbox. */
export const system: SchemaGrants = {
  schema: "system",
  usage: { app: true, worker: false },
  objects: [
    table("system.idempotency_keys", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      worker: ["DELETE"],
      note: "claims and responses; the worker's daily purge removes expired keys",
    }),
    table("system.outbox", "mutable", {
      app: ["INSERT"],
      worker: ["SELECT", "UPDATE", "DELETE"],
      note: "commands insert; the relay claims and marks published; the purge deletes",
    }),
  ],
};
