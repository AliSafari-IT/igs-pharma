import { type SchemaGrants, fn, table } from "./types";

export const pricing: SchemaGrants = {
  schema: "pricing",
  usage: { app: true, worker: false },
  objects: [
    table("pricing.prices", "append_only", { app: ["SELECT", "INSERT"] }),
    table("pricing.vat_classes", "catalogue", { app: ["SELECT"] }),
    fn("pricing.reject_mutation()", { note: "trigger function" }),
  ],
};
