import { type SchemaGrants, fn, table } from "./types";

/** igs-pharma#116 (D-045): the orders module's schema, introduced by migrations 0047 and 0048. */
export const orders: SchemaGrants = {
  schema: "orders",
  usage: { app: true, worker: false },
  since: 48,
  objects: [
    table("orders.carts", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      note: "server-side carts; a guest's is found by the hash of its cookie; an expired or merged cart is deleted",
      since: 48,
    }),
    table("orders.cart_lines", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      since: 48,
    }),
    table("orders.orders", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      note: "no DELETE for anyone (a trigger refuses it), and a trigger enforces the lifecycle",
      since: 48,
    }),
    table("orders.order_lines", "append_only", {
      app: ["SELECT", "INSERT"],
      note: "written with the order while it is pending_payment; a trigger refuses UPDATE and DELETE",
      since: 48,
    }),
    table("orders.order_events", "append_only", {
      app: ["SELECT"],
      note: "the status history, written only by the definer trigger on orders.orders",
      since: 48,
    }),
    fn("orders.order_guard()", { note: "trigger function: the order lifecycle", since: 48 }),
    fn("orders.record_order_event()", {
      note: "SECURITY DEFINER trigger function (no EXECUTE for anyone: a trigger needs none): writes the status history",
      since: 48,
    }),
    fn("orders.order_line_guard()", {
      note: "trigger function: lines only while the order is pending_payment",
      since: 48,
    }),
    fn("orders.order_lines_match()", {
      note: "deferred constraint trigger function: an order's totals and review flag match its lines",
      since: 48,
    }),
    fn("orders.reject_mutation()", { note: "trigger function: orders are kept", since: 48 }),
  ],
};
