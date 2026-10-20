import { newId } from "@igs/db/ids";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  ORDER_CURRENCY,
  ORDER_LOCALES,
  ORDER_REFERENCE_PATTERN,
  ORDER_STATUSES,
  ORDER_VAT_CLASSES,
} from "./domain";

/**
 * Orders module tables (igs-pharma#116, D-045). Owned by this module (D-001), Postgres schema
 * `orders`; UUIDv7 ids generated app-side (D-003); money in integer cents; timestamptz everywhere.
 * `product_id` and `customer_id` are ids of other modules' rows (catalog products, identity users)
 * without a foreign key: a module never references another module's tables (module-anatomy rule 2).
 */
export const orders = pgSchema("orders");

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

/** A generous database bound on one line's quantity; the commands apply the real limit (O-3). */
const MAX_LINE_QUANTITY = 100;

/**
 * A shopping cart, server-side. A guest's cart is found by the hash of its `__Host-igs-cart` cookie
 * (`token_hash`); a signed-in customer's by `customer_id`, at most one each. When a guest signs in
 * the cart becomes the customer's and loses its token hash, so the cookie left in the browser no
 * longer opens it after sign-out. The cart holds no reservation and no price: checkout re-prices.
 * Kept `CART_TTL_DAYS` after its last change (`expires_at`); an expired cart is treated as absent.
 */
export const carts = orders.table(
  "carts",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    /** SHA-256 (hex) of the cart cookie; NULL once the cart belongs to a customer. */
    tokenHash: text("token_hash"),
    customerId: uuid("customer_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check("carts_token_hash_check", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    // a cart is a guest's (by token) or a customer's, never neither and never both
    check("carts_owner_check", sql`(${t.tokenHash} IS NULL) <> (${t.customerId} IS NULL)`),
    uniqueIndex("carts_token_hash_idx").on(t.tokenHash),
    uniqueIndex("carts_customer_idx").on(t.customerId),
    index("carts_expires_at_idx").on(t.expiresAt),
  ],
);

export const cartLines = orders.table(
  "cart_lines",
  {
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    quantity: integer("quantity").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cartId, t.productId] }),
    check(
      "cart_lines_quantity_check",
      sql`${t.quantity} > 0 AND ${t.quantity} <= ${sql.raw(String(MAX_LINE_QUANTITY))}`,
    ),
  ],
);

/**
 * An order. Its state is enforced BY THE DATABASE (migration `0047_orders`): a new order starts in
 * `pending_payment`; every change follows `ORDER_TRANSITIONS`; an order holding a medicine
 * (`needs_review`) reaches `ready_to_prepare` only from `in_review`; an order in an end state never
 * changes; the identifying columns and the totals never change; each update bumps `version` by one;
 * no DELETE. Every status change is written to `order_events` by a trigger, whoever writes.
 */
export const ordersTable = orders.table(
  "orders",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    /** `IGS-2026-000123`: what the customer and staff read (not an invoice number). */
    reference: text("reference").notNull(),
    /** The customer's user id; NULL for a guest order. */
    customerId: uuid("customer_id"),
    locale: text("locale").notNull(),
    status: text("status").notNull().default("pending_payment"),
    /** At least one line is a medicine: a pharmacist must approve before it is prepared. */
    needsReview: boolean("needs_review").notNull(),
    currency: text("currency").notNull().default(ORDER_CURRENCY),
    /** The sum of the lines, VAT included. */
    totalCents: integer("total_cents").notNull(),
    /** The VAT part of `total_cents`. */
    vatCents: integer("vat_cents").notNull(),
    version: integer("version").notNull().default(1),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedByType: text("updated_by_type").notNull(),
    updatedById: text("updated_by_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      "orders_reference_check",
      sql`${t.reference} ~ ${sql.raw(`'${ORDER_REFERENCE_PATTERN.source}'`)}`,
    ),
    check("orders_locale_check", oneOf("locale", ORDER_LOCALES)),
    check("orders_status_check", oneOf("status", ORDER_STATUSES)),
    check("orders_currency_check", oneOf("currency", [ORDER_CURRENCY])),
    check(
      "orders_totals_check",
      sql`${t.totalCents} >= 0 AND ${t.vatCents} >= 0 AND ${t.vatCents} <= ${t.totalCents}`,
    ),
    check("orders_version_check", sql`${t.version} >= 1`),
    uniqueIndex("orders_reference_idx").on(t.reference),
    index("orders_customer_created_idx").on(t.customerId, t.createdAt),
    index("orders_status_created_idx").on(t.status, t.createdAt),
  ],
);

/**
 * What was bought, copied from the catalog and pricing when the order was placed: the client never
 * sends a price. Written once, with the order, while it is `pending_payment`; never changed or
 * deleted (triggers).
 */
export const orderLines = orders.table(
  "order_lines",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    productId: uuid("product_id").notNull(),
    cnk: text("cnk").notNull(),
    /** The product's name in the order's locale when it was placed. */
    name: text("name").notNull(),
    isMedicine: boolean("is_medicine").notNull(),
    vatClass: text("vat_class").notNull(),
    quantity: integer("quantity").notNull(),
    /** VAT included. */
    unitPriceCents: integer("unit_price_cents").notNull(),
    /** `quantity × unit_price_cents`. */
    lineTotalCents: integer("line_total_cents").notNull(),
    /** The VAT part of `line_total_cents`. */
    vatCents: integer("vat_cents").notNull(),
  },
  (t) => [
    check("order_lines_cnk_check", sql`${t.cnk} ~ '^[0-9]{7}$'`),
    check("order_lines_vat_class_check", oneOf("vat_class", ORDER_VAT_CLASSES)),
    check(
      "order_lines_quantity_check",
      sql`${t.quantity} > 0 AND ${t.quantity} <= ${sql.raw(String(MAX_LINE_QUANTITY))}`,
    ),
    check(
      "order_lines_amounts_check",
      sql`${t.unitPriceCents} >= 0 AND ${t.lineTotalCents} = ${t.quantity} * ${t.unitPriceCents}
        AND ${t.vatCents} >= 0 AND ${t.vatCents} <= ${t.lineTotalCents}`,
    ),
    uniqueIndex("order_lines_order_product_idx").on(t.orderId, t.productId),
  ],
);

/**
 * The status history of an order, written ONLY by the database (a trigger on `orders`, migration
 * `0047_orders`): one row when the order is created (`from_status` NULL) and one per status change,
 * with who changed it. Append-only; the runtime roles may only read it.
 */
export const orderEvents = orders.table(
  "order_events",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "order_events_from_status_check",
      sql`${t.fromStatus} IS NULL OR ${sql.raw(`from_status IN (${ORDER_STATUSES.map((v) => `'${v}'`).join(", ")})`)}`,
    ),
    check("order_events_to_status_check", oneOf("to_status", ORDER_STATUSES)),
    index("order_events_order_at_idx").on(t.orderId, t.at),
  ],
);
