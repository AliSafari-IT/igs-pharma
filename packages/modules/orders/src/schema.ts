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

import { MAX_DELIVERY_PRICE_CENTS, MAX_FREE_FROM_CENTS } from "./delivery-domain";
import {
  CHECKOUT_STATUSES,
  ORDER_CURRENCY,
  ORDER_LOCALES,
  ORDER_MAIL_KINDS,
  ORDER_MAIL_STATUSES,
  ORDER_REFERENCE_PATTERN,
  ORDER_STATUSES,
  ORDER_VAT_CLASSES,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  REFUND_NOTE_MAX,
  REFUND_REASONS,
  REFUND_STATUSES,
  REVIEW_DECISIONS,
  REVIEW_NOTE_MAX,
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
    /** The checkout it was placed from (one order per checkout); its holds are `checkout:<id>`. */
    checkoutId: uuid("checkout_id").notNull(),
    /** SHA-256 of the order's status link token (`?t=`); the token itself is never stored. */
    statusTokenHash: text("status_token_hash"),
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
    uniqueIndex("orders_checkout_idx").on(t.checkoutId),
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

/** The last order number handed out per calendar year (Brussels), for `IGS-<year>-<number>`. */
export const referenceCounters = orders.table(
  "reference_counters",
  {
    year: integer("year").primaryKey(),
    lastNumber: integer("last_number").notNull(),
  },
  (t) => [check("reference_counters_check", sql`${t.year} >= 2026 AND ${t.lastNumber} >= 1`)],
);

/**
 * A checkout (D-045 step 2): the cart's lines with their prices copied from pricing at the start,
 * and the stock held for them (inventory holds with `holder_ref = checkout:<id>`). Whose it is
 * follows the cart: a customer's by `customer_id`, a guest's by the same cookie hash as the cart.
 */
export const checkouts = orders.table(
  "checkouts",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    tokenHash: text("token_hash"),
    customerId: uuid("customer_id"),
    locale: text("locale").notNull(),
    status: text("status").notNull().default("open"),
    needsReview: boolean("needs_review").notNull(),
    totalCents: integer("total_cents").notNull(),
    vatCents: integer("vat_cents").notNull(),
    /** When the stock holds lapse: the order must be placed before. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("checkouts_token_hash_check", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("checkouts_owner_check", sql`(${t.tokenHash} IS NULL) <> (${t.customerId} IS NULL)`),
    check("checkouts_locale_check", oneOf("locale", ORDER_LOCALES)),
    check("checkouts_status_check", oneOf("status", CHECKOUT_STATUSES)),
    check(
      "checkouts_totals_check",
      sql`${t.totalCents} >= 0 AND ${t.vatCents} >= 0 AND ${t.vatCents} <= ${t.totalCents}`,
    ),
    index("checkouts_token_open_idx").on(t.tokenHash).where(sql`${t.status} = 'open'`),
    index("checkouts_customer_open_idx").on(t.customerId).where(sql`${t.status} = 'open'`),
    index("checkouts_created_at_idx").on(t.createdAt),
  ],
);

export const checkoutLines = orders.table(
  "checkout_lines",
  {
    checkoutId: uuid("checkout_id")
      .notNull()
      .references(() => checkouts.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    cnk: text("cnk").notNull(),
    name: text("name").notNull(),
    isMedicine: boolean("is_medicine").notNull(),
    vatClass: text("vat_class").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
    vatCents: integer("vat_cents").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.checkoutId, t.productId] }),
    check("checkout_lines_vat_class_check", oneOf("vat_class", ORDER_VAT_CLASSES)),
    check(
      "checkout_lines_quantity_check",
      sql`${t.quantity} > 0 AND ${t.quantity} <= ${sql.raw(String(MAX_LINE_QUANTITY))}`,
    ),
    check(
      "checkout_lines_amounts_check",
      sql`${t.unitPriceCents} >= 0 AND ${t.lineTotalCents} = ${t.quantity} * ${t.unitPriceCents}
        AND ${t.vatCents} >= 0 AND ${t.vatCents} <= ${t.lineTotalCents}`,
    ),
  ],
);

/**
 * Who to contact about an order (D-045 step 3): name, e-mail and phone. Personal data, kept apart
 * from the order so it can be purged on its own retention (privacy, follow-up) while the order
 * stays. Sprints 3–4 are pharmacy pickup only: no address yet.
 */
export const orderContacts = orders.table("order_contacts", {
  orderId: uuid("order_id")
    .primaryKey()
    .references(() => ordersTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Pharmacist review decision, one per order; append-only (migration 0053). */
export const orderReviews = orders.table(
  "order_reviews",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    note: text("note"),
    reviewerId: text("reviewer_id").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("order_reviews_decision_check", oneOf("decision", REVIEW_DECISIONS)),
    uniqueIndex("order_reviews_order_idx").on(t.orderId),
    check(
      "order_reviews_note_check",
      sql`${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND ${sql.raw(String(REVIEW_NOTE_MAX))}`,
    ),
  ],
);

/**
 * A payment of an order (D-045 step 4). Created in `created` with the order; the route handler then
 * asks the provider (outside any transaction, D-019) and stores its id and checkout URL. The status
 * only moves forward and is kept apart from the order's.
 */
export const payments = orders.table(
  "payments",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id"),
    checkoutUrl: text("checkout_url"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default(ORDER_CURRENCY),
    status: text("status").notNull().default("created"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("payments_provider_check", oneOf("provider", PAYMENT_PROVIDERS)),
    check("payments_status_check", oneOf("status", PAYMENT_STATUSES)),
    check("payments_currency_check", oneOf("currency", [ORDER_CURRENCY])),
    check("payments_amount_check", sql`${t.amountCents} > 0`),
    uniqueIndex("payments_provider_payment_idx").on(t.providerPaymentId),
    index("payments_order_idx").on(t.orderId),
    index("payments_status_created_idx").on(t.status, t.createdAt),
  ],
);

/**
 * A refund of a paid payment (igs-pharma#156): full amount only, at most one that is not failed or
 * canceled per payment. Recorded by a command before the provider is asked; the worker then asks the
 * provider (our id is the idempotency key) and records its refund id and status. A trigger moves the
 * status forward only; no DELETE for anyone.
 */
export const refunds = orders.table(
  "refunds",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default(ORDER_CURRENCY),
    status: text("status").notNull().default("requested"),
    reason: text("reason").notNull(),
    /** Staff-only, never sent to the provider or audited. */
    note: text("note"),
    requestedByType: text("requested_by_type").notNull(),
    requestedById: text("requested_by_id").notNull(),
    /** The pharmacist who authorised the refund of an order that holds a medicine. */
    approvedById: text("approved_by_id"),
    providerRefundId: text("provider_refund_id"),
    /** The provider's refusal code when it failed. */
    failureCode: text("failure_code"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    /** When the provider accepted it. */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** When it reached an end state. */
    settledAt: timestamp("settled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("refunds_status_check", oneOf("status", REFUND_STATUSES)),
    check("refunds_reason_check", oneOf("reason", REFUND_REASONS)),
    check("refunds_currency_check", oneOf("currency", [ORDER_CURRENCY])),
    check("refunds_amount_check", sql`${t.amountCents} > 0`),
    check(
      "refunds_note_check",
      sql`${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND ${sql.raw(String(REFUND_NOTE_MAX))}`,
    ),
    uniqueIndex("refunds_provider_refund_idx").on(t.providerRefundId),
    uniqueIndex("refunds_one_active_idx")
      .on(t.paymentId)
      .where(sql`${t.status} IN ('requested', 'pending', 'refunded')`),
    index("refunds_order_idx").on(t.orderId),
    index("refunds_status_updated_idx").on(t.status, t.updatedAt),
  ],
);

/**
 * A customer mail about an order (igs-pharma#157): written with the state change it reports and
 * sent by the worker. One per order and kind (per refund and kind for the refund mails), so a
 * repeated event never mails twice. Ids only: the address is read from the contact at send time.
 * A trigger refuses a mail whose order or refund is not in the state the mail reports.
 */
export const orderMails = orders.table(
  "order_mails",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    refundId: uuid("refund_id").references(() => refunds.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    check("order_mails_kind_check", oneOf("kind", ORDER_MAIL_KINDS)),
    check("order_mails_status_check", oneOf("status", ORDER_MAIL_STATUSES)),
    check(
      "order_mails_refund_check",
      sql`(${t.kind} IN ('refund_initiated', 'refund_completed')) = (${t.refundId} IS NOT NULL)`,
    ),
    uniqueIndex("order_mails_order_kind_idx")
      .on(t.orderId, t.kind)
      .where(sql`${t.refundId} IS NULL`),
    uniqueIndex("order_mails_refund_kind_idx")
      .on(t.refundId, t.kind)
      .where(sql`${t.refundId} IS NOT NULL`),
    index("order_mails_status_created_idx").on(t.status, t.createdAt),
  ],
);

/**
 * Home delivery, as staff set it (igs-pharma#202): ONE row, key `delivery`. The price and the
 * free-delivery value are whole cents with VAT included; `free_from_cents` NULL means delivery is
 * never free. With no row the shop uses the defaults in `delivery-domain.ts` and the back-office says
 * so. Read from the database on every request, never cached across a staff change.
 */
export const deliverySettings = orders.table(
  "delivery_settings",
  {
    key: text("key").primaryKey().default("delivery"),
    priceCents: integer("price_cents").notNull(),
    freeFromCents: integer("free_from_cents"),
    /** Bumped by one on every change. */
    version: integer("version").notNull().default(1),
    updatedByType: text("updated_by_type").notNull(),
    updatedById: text("updated_by_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("delivery_settings_key_check", sql`${t.key} = 'delivery'`),
    check(
      "delivery_settings_price_check",
      sql.raw(`price_cents >= 0 AND price_cents <= ${MAX_DELIVERY_PRICE_CENTS}`),
    ),
    check(
      "delivery_settings_free_from_check",
      sql.raw(
        `free_from_cents IS NULL OR (free_from_cents >= 0 AND free_from_cents <= ${MAX_FREE_FROM_CENTS})`,
      ),
    ),
    check("delivery_settings_version_check", sql`${t.version} >= 1`),
  ],
);
