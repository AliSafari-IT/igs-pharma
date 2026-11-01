import { type SchemaGrants, fn, table } from "./types";

/** igs-pharma#116 (D-045): the orders module's schema, introduced by migrations 0047 and 0048 (carts, orders), 0049/0050 (checkout, payments) and 0053/0054 (pharmacist reviews) and 0057/0058 (refunds) and 0060/0061 (customer mails). */
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
    table("orders.reference_counters", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      note: "the last order number per year, for IGS-<year>-<number>",
      since: 50,
    }),
    table("orders.checkouts", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      note: "deleted only by the definer purge, 30 days after the start",
      since: 50,
    }),
    table("orders.checkout_lines", "mutable", {
      app: ["SELECT", "INSERT"],
      note: "written with the checkout; deleted with it by the purge",
      since: 50,
    }),
    table("orders.order_contacts", "mutable", {
      app: ["SELECT", "INSERT"],
      note: "personal data, insert-only for the runtime by grant, apart from the order for its own retention (follow-up)",
      since: 50,
    }),
    table("orders.payments", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      note: "no DELETE for anyone (a trigger refuses it); a trigger moves the status forward only",
      since: 50,
    }),
    fn("orders.payment_guard()", {
      note: "trigger function: a payment's status only moves forward",
      since: 50,
    }),
    fn("orders.purge_expired_carts()", {
      worker: true,
      note: "SECURITY DEFINER, zero arguments: the worker's daily purge of expired carts and month-old checkouts",
      since: 50,
    }),
    table("orders.order_reviews", "append_only", {
      app: ["SELECT", "INSERT"],
      note: "append-only (triggers refuse UPDATE and DELETE)",
      since: 54,
    }),
    fn("orders.order_review_guard()", {
      note: "trigger function",
      since: 54,
    }),
    fn("orders.order_approval_required()", {
      note: "trigger function",
      since: 54,
    }),
    table("orders.refunds", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      note: "no DELETE for anyone (a trigger refuses it); a trigger moves the status forward only",
      since: 58,
    }),
    fn("orders.refund_insert_guard()", {
      note: "trigger function: only the full amount of a paid payment of a closed order",
      since: 58,
    }),
    fn("orders.refund_guard()", {
      note: "trigger function: a refund's status only moves forward",
      since: 58,
    }),
    table("orders.order_mails", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      note: "ids only; a trigger allows a mail only in the state it reports, and pending → sent/skipped only; no DELETE",
      since: 61,
    }),
    fn("orders.order_mail_guard()", {
      note: "trigger function: a mail only for the state it reports",
      since: 61,
    }),
    fn("orders.order_mail_update_guard()", {
      note: "trigger function: pending → sent or skipped",
      since: 61,
    }),
    table("orders.order_addresses", "mutable", {
      app: ["SELECT", "INSERT"],
      note: "where a home-delivery order goes (igs-pharma#202); written with the order, never changed (a trigger refuses UPDATE and DELETE); personal data like the contact",
      since: 84,
    }),
    fn("orders.order_address_match()", {
      note: "deferred constraint trigger function: a delivery order has one address, a pickup order none",
      since: 84,
    }),
    table("orders.delivery_settings", "mutable", {
      app: ["SELECT", "INSERT", "UPDATE"],
      note: "one row: the home-delivery price and the free-delivery value staff set (igs-pharma#202); never deleted",
      since: 80,
    }),
  ],
};
