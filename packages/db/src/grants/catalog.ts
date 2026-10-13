import { type SchemaGrants, table } from "./types";

export const catalog: SchemaGrants = {
  schema: "catalog",
  usage: { app: true, worker: false },
  objects: [
    table("catalog.brands", "mutable", { app: ["SELECT", "INSERT"] }),
    table("catalog.categories", "mutable", { app: ["SELECT", "INSERT", "UPDATE", "DELETE"] }),
    table("catalog.products", "mutable", { app: ["SELECT", "INSERT", "UPDATE"] }),
    table("catalog.product_content", "mutable", { app: ["SELECT", "INSERT", "UPDATE", "DELETE"] }),
    table("catalog.product_categories", "mutable", { app: ["SELECT", "INSERT", "DELETE"] }),
  ],
};
