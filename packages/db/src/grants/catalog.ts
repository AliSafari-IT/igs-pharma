import { type SchemaGrants, fn, table } from "./types";

export const catalog: SchemaGrants = {
  schema: "catalog",
  usage: { app: true, worker: false },
  objects: [
    table("catalog.brands", "mutable", { app: ["SELECT", "INSERT"] }),
    table("catalog.categories", "mutable", { app: ["SELECT", "INSERT", "UPDATE", "DELETE"] }),
    table("catalog.products", "mutable", { app: ["SELECT", "INSERT", "UPDATE"] }),
    table("catalog.product_content", "mutable", { app: ["SELECT", "INSERT", "UPDATE", "DELETE"] }),
    table("catalog.product_categories", "mutable", { app: ["SELECT", "INSERT", "DELETE"] }),
    table("catalog.stop_sales", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      note: "stop-sales (igs-pharma#187); a trigger lets only an active one end, once, and refuses DELETE",
      since: 72,
    }),
    fn("catalog.stop_sale_guard()", {
      note: "trigger function: the stop-sale lifecycle",
      since: 72,
    }),
  ],
};
