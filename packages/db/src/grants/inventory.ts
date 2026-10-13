import { type SchemaGrants, fn, table } from "./types";

export const inventory: SchemaGrants = {
  schema: "inventory",
  usage: { app: true, worker: false },
  objects: [
    table("inventory.locations", "catalogue", { app: ["SELECT"] }),
    table("inventory.stock_movements", "append_only", { app: ["SELECT", "INSERT"] }),
    table("inventory.stock_levels", "mutable", {
      app: ["SELECT"],
      note: "derived from the ledger by the definer trigger only; the runtime roles cannot write it",
      since: 29,
    }),
    table("inventory.import_plans", "mutable", {
      app: ["SELECT", "INSERT"],
      note: "a stock-file preview, insert-only for the runtime by grant; expired rows are purged by a definer function (follow-up)",
      since: 29,
    }),
    fn("inventory.reject_mutation()", { note: "trigger function" }),
    fn("inventory.apply_movement_to_level()", {
      note: "SECURITY DEFINER trigger function (no EXECUTE for anyone: a trigger needs none)",
      since: 29,
    }),
  ],
};
