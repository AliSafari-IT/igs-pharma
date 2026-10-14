import { newId } from "@igs/db/ids";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  HOLDER_REF_PATTERN,
  LOCATION_KINDS,
  MAX_QUANTITY,
  MOVEMENT_REASONS,
  RELEASE_REASONS,
  RESERVATION_KINDS,
  RESERVATION_STATUSES,
} from "./domain";

/**
 * Inventory module tables (igs-pharma#53, domain-model §4). Owned by this module (D-001), Postgres
 * schema `inventory`; UUIDv7 ids generated app-side (D-003); timestamptz everywhere.
 *
 * `stock_movements` is an append-only ledger and the only truth about stock: on-hand is the sum of
 * a product's deltas at a location, never a stored counter (a trigger in migration
 * `inventory_append_only` refuses UPDATE and DELETE). `product_id` is a catalog product id without a
 * foreign key: a module never references another module's tables (module-anatomy rule 2).
 */
export const inventory = pgSchema("inventory");

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

export const locations = inventory.table(
  "locations",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  () => [check("locations_kind_check", oneOf("kind", LOCATION_KINDS))],
);

export const stockMovements = inventory.table(
  "stock_movements",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    productId: uuid("product_id").notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    /** Free text written by staff for an adjustment; never copied into the audit trail. */
    note: text("note"),
    /** Shared by every movement of one CSV import. */
    importId: uuid("import_id"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("stock_movements_delta_check", sql`${t.delta} <> 0`),
    check("stock_movements_reason_check", oneOf("reason", MOVEMENT_REASONS)),
    index("stock_movements_product_location_at_idx").on(t.productId, t.locationId, t.at),
    index("stock_movements_import_id_idx").on(t.importId),
  ],
);

/**
 * The on-hand per product and location, maintained BY THE DATABASE: a trigger on `stock_movements`
 * (migration `inventory_stock_levels`) adds each movement's delta here, and the `on_hand >= 0`
 * check is the guard against overselling, even for an insert that skips the module's writer
 * (igs-pharma#83, D-037). The ledger stays the truth; this row is derived and nobody writes it
 * directly (the runtime roles have SELECT only).
 */
export const stockLevels = inventory.table(
  "stock_levels",
  {
    productId: uuid("product_id").notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    onHand: integer("on_hand").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.locationId] }),
    check("stock_levels_on_hand_check", sql`${t.onHand} >= 0`),
  ],
);

/** One row of a stored import plan: product ids and counts only, never free text. */
export interface ImportPlanRowData {
  readonly productId: string;
  readonly cnk: string;
  readonly expectedOnHand: number;
  readonly target: number;
}

/**
 * What a stock-file preview showed (igs-pharma#83, D4/D5). The confirm step sends only `id` (the
 * submission nonce) and applies exactly these rows, refusing the whole import when stock moved since.
 * Insert-only for the runtime roles; `expires_at` is one hour after `created_at`.
 */
export const importPlans = inventory.table("import_plans", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => newId()),
  actorId: text("actor_id").notNull(),
  rows: jsonb("rows").$type<readonly ImportPlanRowData[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * Stock set aside for a checkout (`hold`, expires) or an order (`order`, never expires on its own),
 * igs-pharma#99. A reservation does NOT move the ledger: on-hand is still the sum of the movements,
 * and what is available to sell is on-hand minus the reservations that are live. Consuming a
 * reservation (picking) writes one `sale` movement and ends it.
 *
 * `holder_ref` is an opaque reference to the holder (a future checkout or order id), never customer
 * data. The database enforces the lifecycle (migration 0038): the four statuses and their arrows,
 * `expires_at` required for a hold and always NULL for an order, no UPDATE of the identifying
 * columns, no DELETE. `product_id` has no foreign key (module-anatomy rule 2).
 */
export const reservations = inventory.table(
  "reservations",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    productId: uuid("product_id").notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    kind: text("kind").notNull(),
    holderRef: text("holder_ref").notNull(),
    status: text("status").notNull().default("active"),
    /** Required for a hold, always NULL for an order. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Why it was released (set exactly when the status is `released`). */
    releaseReason: text("release_reason"),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedByType: text("updated_by_type").notNull(),
    updatedById: text("updated_by_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      "reservations_quantity_check",
      sql`${t.quantity} > 0 AND ${t.quantity} <= ${sql.raw(String(MAX_QUANTITY))}`,
    ),
    check("reservations_kind_check", oneOf("kind", RESERVATION_KINDS)),
    check("reservations_status_check", oneOf("status", RESERVATION_STATUSES)),
    check(
      "reservations_release_reason_check",
      sql`(${t.status} = 'released') = (${t.releaseReason} IS NOT NULL)
        AND (${t.releaseReason} IS NULL OR ${sql.raw(`release_reason IN (${RELEASE_REASONS.map((v) => `'${v}'`).join(", ")})`)})`,
    ),
    check(
      "reservations_expires_at_check",
      sql`(${t.kind} = 'hold' AND ${t.expiresAt} IS NOT NULL) OR (${t.kind} = 'order' AND ${t.expiresAt} IS NULL)`,
    ),
    check(
      "reservations_only_holds_expire_check",
      sql`${t.status} <> 'expired' OR ${t.kind} = 'hold'`,
    ),
    check(
      "reservations_only_orders_consumed_check",
      sql`${t.status} <> 'consumed' OR ${t.kind} = 'order'`,
    ),
    check(
      "reservations_holder_ref_check",
      sql`${t.holderRef} ~ ${sql.raw(`'${HOLDER_REF_PATTERN.source}'`)}`,
    ),
    // one active reservation per product and holder: asking again returns it
    uniqueIndex("reservations_active_holder_idx")
      .on(t.productId, t.locationId, t.holderRef)
      .where(sql`${t.status} = 'active'`),
    // the sums of "what is reserved" and the expiry job's scan
    index("reservations_product_active_idx")
      .on(t.productId, t.locationId)
      .where(sql`${t.status} = 'active'`),
    index("reservations_hold_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'active' AND ${t.kind} = 'hold'`),
  ],
);
