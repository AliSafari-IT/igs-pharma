import { type SchemaGrants, fn, table } from "./types";

/** The audit log (D-027): append-only; the hash chain head is advanced in place. */
export const audit: SchemaGrants = {
  schema: "audit",
  usage: { app: true, worker: true },
  objects: [
    table("audit.events", "append_only", {
      app: ["SELECT", "INSERT"],
      worker: ["SELECT"],
      note: "the verify job reads the chain; kept on igs_worker itself since migration 0007",
    }),
    table("audit.chain_head", "mutable", {
      app: ["SELECT", "UPDATE"],
      worker: ["SELECT"],
      note: "advanced by every audit write; the row is never created or deleted (trigger)",
    }),
    fn("audit.future_partitions()", { app: true, worker: true }),
    fn("audit.maintain_partitions()", {
      worker: true,
      note: "SECURITY DEFINER, fixed arguments: the worker's daily partition job (T-006b)",
    }),
    fn("audit.ensure_partitions(integer,date)", {
      note: "owner only; wrapped by maintain_partitions",
    }),
    fn("audit.assert_partitions_aligned()", { note: "owner only" }),
    fn("audit.reject_mutation()", { note: "trigger function" }),
  ],
};
