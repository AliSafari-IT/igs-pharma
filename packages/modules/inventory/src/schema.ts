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
  uuid,
} from "drizzle-orm/pg-core";

import { LOCATION_KINDS, MOVEMENT_REASONS } from "./domain";

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
