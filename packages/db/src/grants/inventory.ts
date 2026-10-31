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
    table("inventory.reservations", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      note: "stock set aside for a checkout or an order (igs-pharma#99); no DELETE for anyone (a trigger refuses it), and a trigger enforces the lifecycle",
      since: 39,
    }),
    fn("inventory.reject_mutation()", { note: "trigger function" }),
    fn("inventory.reservation_guard()", {
      note: "trigger function: the reservation lifecycle",
      since: 39,
    }),
    fn("inventory.reservation_reject_delete()", {
      note: "trigger function: reservations are kept",
      since: 39,
    }),
    fn("inventory.lock_stock_level(uuid,uuid)", {
      app: true,
      note: "SECURITY DEFINER: takes a product's stock-level row lock (FOR UPDATE needs UPDATE, which the runtime lacks) and returns on-hand; a reservation calls it before reading what is available",
      since: 39,
    }),
    fn("inventory.purge_expired_import_plans()", {
      worker: true,
      note: "SECURITY DEFINER, zero arguments: the worker's daily purge of expired import plans (igs-pharma#88)",
      since: 33,
    }),
    fn("inventory.apply_movement_to_level()", {
      note: "SECURITY DEFINER trigger function (no EXECUTE for anyone: a trigger needs none)",
      since: 29,
    }),
    table("inventory.lots", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      note: "lots of the web pool (igs-pharma#164); a trigger lets only the quarantine columns change and refuses DELETE",
      since: 63,
    }),
    table("inventory.lot_levels", "mutable", {
      app: ["SELECT"],
      note: "on-hand per lot, derived from the ledger by the definer trigger only",
      since: 63,
    }),
    table("inventory.settings", "mutable", {
      app: ["SELECT", "UPDATE"],
      note: "the single settings row (expiry buffer); a trigger refuses DELETE",
      since: 63,
    }),
    fn("inventory.lot_guard()", {
      note: "trigger function: a lot keeps its identity",
      since: 63,
    }),
    table("inventory.reservation_allocations", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      note: "which lots an order reservation is picked from (igs-pharma#165); a trigger enforces the lifecycle and refuses DELETE",
      since: 66,
    }),
    fn("inventory.allocation_guard()", {
      note: "trigger function: the allocation lifecycle",
      since: 66,
    }),
    table("inventory.reconciliations", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      note: "counts of web-pool lots (igs-pharma#166); a trigger lets only an open one end, once, and refuses DELETE",
      since: 68,
    }),
    table("inventory.reconciliation_lines", "mutable", {
      app: ["SELECT", "INSERT"],
      note: "the counted lots of a reconciliation, insert-only by grant; a trigger refuses UPDATE and DELETE",
      since: 68,
    }),
    fn("inventory.reconciliation_guard()", {
      note: "trigger function: the reconciliation lifecycle",
      since: 68,
    }),
    table("inventory.recalls", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      note: "recalls (igs-pharma#187); a trigger lets only an active one end, once, and refuses DELETE",
      since: 72,
    }),
    table("inventory.recall_lots", "mutable", {
      app: ["SELECT", "INSERT"],
      note: "the lots a recall covers, insert-only by grant; a trigger refuses UPDATE and DELETE",
      since: 72,
    }),
    fn("inventory.recall_guard()", {
      note: "trigger function: the recall lifecycle",
      since: 72,
    }),
    table("inventory.recall_disposals", "mutable", {
      app: ["SELECT", "INSERT"],
      note: "what happened to a recall's stock (igs-pharma#189), insert-only by grant; a trigger refuses UPDATE and DELETE",
      since: 75,
    }),
  ],
};
