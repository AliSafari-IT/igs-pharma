import { type SchemaGrants, fn, table } from "./types";

export const inventory: SchemaGrants = {
  schema: "inventory",
  usage: { app: true, worker: false },
  objects: [
    table("inventory.locations", "catalogue", { app: ["SELECT"] }),
    table("inventory.stock_movements", "append_only", { app: ["SELECT", "INSERT"] }),
    fn("inventory.reject_mutation()", { note: "trigger function" }),
  ],
};
