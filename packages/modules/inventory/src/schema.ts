import { newId } from "@igs/db/ids";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  ALLOCATION_STATUSES,
  DISPOSAL_METHODS,
  EXPIRY_BUFFER_DEFAULT_DAYS,
  EXPIRY_BUFFER_MAX_DAYS,
  HOLDER_REF_PATTERN,
  LOCATION_KINDS,
  LOT_NUMBER_MAX,
  LOT_TRACKING,
  MAX_QUANTITY,
  MOVEMENT_REASONS,
  QUARANTINE_REASONS,
  RECALL_NOTE_MAX,
  RECALL_SCOPES,
  RECALL_SOURCES,
  RECONCILIATION_SOURCES,
  RECONCILIATION_STATUSES,
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

/**
 * A lot of one product at one location (igs-pharma#164, ADR 0011): every unit of stock belongs to
 * one. `lot` has a lot number (and, for a medicine, an expiry date: the receipt command checks it);
 * `no_lot` is a non-medicine received without one; `unknown` holds stock from before lots and is
 * never sellable. Only the quarantine columns ever change (a trigger refuses the rest and DELETE).
 */
export const lots = inventory.table(
  "lots",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    productId: uuid("product_id").notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    tracking: text("tracking").notNull(),
    lotNumber: text("lot_number"),
    expiryDate: date("expiry_date", { mode: "string" }),
    quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
    quarantineReason: text("quarantine_reason"),
    quarantinedByType: text("quarantined_by_type"),
    quarantinedById: text("quarantined_by_id"),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("lots_tracking_check", oneOf("tracking", LOT_TRACKING)),
    check(
      "lots_lot_number_check",
      sql`(${t.tracking} = 'lot') = (${t.lotNumber} IS NOT NULL) AND (${t.lotNumber} IS NULL OR char_length(${t.lotNumber}) BETWEEN 1 AND ${sql.raw(String(LOT_NUMBER_MAX))})`,
    ),
    check("lots_expiry_check", sql`${t.tracking} = 'lot' OR ${t.expiryDate} IS NULL`),
    check(
      "lots_quarantine_check",
      sql`(${t.quarantinedAt} IS NULL) = (${t.quarantineReason} IS NULL) AND (${t.quarantinedAt} IS NULL) = (${t.quarantinedById} IS NULL) AND (${t.quarantinedAt} IS NULL) = (${t.quarantinedByType} IS NULL)`,
    ),
    check(
      "lots_quarantine_reason_check",
      sql`${t.quarantineReason} IS NULL OR ${oneOf("quarantine_reason", QUARANTINE_REASONS)}`,
    ),
    // one lot per number and expiry date; a lot without an expiry date counts as one value too
    uniqueIndex("lots_lot_number_expiry_idx")
      .on(t.productId, t.locationId, t.lotNumber, t.expiryDate)
      .where(sql`${t.tracking} = 'lot' AND ${t.expiryDate} IS NOT NULL`),
    uniqueIndex("lots_lot_number_no_expiry_idx")
      .on(t.productId, t.locationId, t.lotNumber)
      .where(sql`${t.tracking} = 'lot' AND ${t.expiryDate} IS NULL`),
    uniqueIndex("lots_untracked_idx")
      .on(t.productId, t.locationId, t.tracking)
      .where(sql`${t.tracking} <> 'lot'`),
    index("lots_product_location_idx").on(t.productId, t.locationId),
  ],
);

/**
 * On-hand per lot, maintained BY THE DATABASE from the movements (the same trigger as
 * `stock_levels`); `on_hand >= 0` refuses a movement that would take a lot below zero.
 */
export const lotLevels = inventory.table(
  "lot_levels",
  {
    lotId: uuid("lot_id")
      .primaryKey()
      .references(() => lots.id, { onDelete: "restrict" }),
    onHand: integer("on_hand").notNull(),
  },
  (t) => [check("lot_levels_on_hand_check", sql`${t.onHand} >= 0`)],
);

/** The shop-wide inventory settings: one row (ADR 0011: the expiry buffer, set by the titular). */
export const settings = inventory.table(
  "settings",
  {
    id: smallint("id").primaryKey().default(1),
    expiryBufferDays: integer("expiry_buffer_days").notNull().default(EXPIRY_BUFFER_DEFAULT_DAYS),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedByType: text("updated_by_type"),
    updatedById: text("updated_by_id"),
  },
  (t) => [
    check("settings_single_row_check", sql`${t.id} = 1`),
    check(
      "settings_expiry_buffer_check",
      sql`${t.expiryBufferDays} BETWEEN 0 AND ${sql.raw(String(EXPIRY_BUFFER_MAX_DAYS))}`,
    ),
  ],
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
    /** The lot the units moved in or out of (igs-pharma#164). */
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "restrict" }),
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
    index("stock_movements_lot_idx").on(t.lotId),
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

/**
 * Which lots an order reservation will be picked from (igs-pharma#165, ADR 0011 §4). Allocated when
 * the hold becomes an order, earliest expiry first, from sellable lots only; allocated again when a
 * lot stops being sellable or holds less; consumed lot by lot at pickup. A row is never deleted and
 * keeps its reservation, lot and quantity: a new allocation supersedes it (a trigger enforces the
 * lifecycle). The active rows of a reservation may sum to less than its quantity: the order is then
 * short of sellable stock and staff are flagged.
 */
export const reservationAllocations = inventory.table(
  "reservation_allocations",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    productId: uuid("product_id").notNull(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull().default("active"),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      "reservation_allocations_quantity_check",
      sql`${t.quantity} > 0 AND ${t.quantity} <= ${sql.raw(String(MAX_QUANTITY))}`,
    ),
    check("reservation_allocations_status_check", oneOf("status", ALLOCATION_STATUSES)),
    // one active share per reservation and lot
    uniqueIndex("reservation_allocations_active_idx")
      .on(t.reservationId, t.lotId)
      .where(sql`${t.status} = 'active'`),
    // what is already allocated from a lot
    index("reservation_allocations_lot_active_idx")
      .on(t.lotId)
      .where(sql`${t.status} = 'active'`),
    index("reservation_allocations_reservation_idx").on(t.reservationId),
  ],
);

/**
 * A count of lots in the web pool (igs-pharma#166, ADR 0011 §1). Starting one stores what was
 * counted and what the ledger said per lot at that moment (the preview); applying it books one
 * `reconciliation` movement per lot that differs, under its id, and only while every lot still holds
 * what the preview showed. Only the status (and who ended it, when) ever changes, once; a trigger
 * enforces it and refuses DELETE.
 */
export const reconciliations = inventory.table(
  "reconciliations",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    status: text("status").notNull().default("open"),
    source: text("source").notNull(),
    startedByType: text("started_by_type").notNull(),
    startedById: text("started_by_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    endedByType: text("ended_by_type"),
    endedById: text("ended_by_id"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    check("reconciliations_status_check", oneOf("status", RECONCILIATION_STATUSES)),
    check("reconciliations_source_check", oneOf("source", RECONCILIATION_SOURCES)),
    check(
      "reconciliations_ended_check",
      sql`(${t.status} = 'open') = (${t.endedAt} IS NULL) AND (${t.endedAt} IS NULL) = (${t.endedById} IS NULL) AND (${t.endedAt} IS NULL) = (${t.endedByType} IS NULL)`,
    ),
    index("reconciliations_open_idx").on(t.startedAt).where(sql`${t.status} = 'open'`),
  ],
);

/** One counted lot of a reconciliation: what the ledger held when it was previewed, and the count. */
export const reconciliationLines = inventory.table(
  "reconciliation_lines",
  {
    reconciliationId: uuid("reconciliation_id")
      .notNull()
      .references(() => reconciliations.id, { onDelete: "restrict" }),
    /** Its place in the file or the form, from 1. */
    line: integer("line").notNull(),
    productId: uuid("product_id").notNull(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "restrict" }),
    booked: integer("booked").notNull(),
    counted: integer("counted").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.reconciliationId, t.line] }),
    // a lot is counted once per reconciliation
    uniqueIndex("reconciliation_lines_lot_idx").on(t.reconciliationId, t.lotId),
    check("reconciliation_lines_booked_check", sql`${t.booked} >= 0`),
    check(
      "reconciliation_lines_counted_check",
      sql`${t.counted} >= 0 AND ${t.counted} <= ${sql.raw(String(MAX_QUANTITY))}`,
    ),
  ],
);

/**
 * Recalls (igs-pharma#187, REQ-SAF-01). A pharmacist starts one on a product, for all its lots or the
 * lots it names: those lots are quarantined with reason `recall`, and the catalogue stops the product
 * selling (a `catalog.stop_sales` row whose reference is this recall). Only a pharmacist ends it; its
 * lots stay quarantined (their disposal is recorded later). A product has at most one active recall.
 * A trigger keeps who started it and when, lets only an active recall end, once, and refuses DELETE.
 * `product_id` has no foreign key: a module never references another module's tables.
 */
export const recalls = inventory.table(
  "recalls",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    productId: uuid("product_id").notNull(),
    scope: text("scope").notNull(),
    source: text("source").notNull(),
    /** The pharmacist's note (the notice's reference, what is wrong); never copied into the audit trail. */
    note: text("note").notNull(),
    startedByType: text("started_by_type").notNull(),
    startedById: text("started_by_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedByType: text("ended_by_type"),
    endedById: text("ended_by_id"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    check("recalls_scope_check", oneOf("scope", RECALL_SCOPES)),
    check("recalls_source_check", oneOf("source", RECALL_SOURCES)),
    check(
      "recalls_note_check",
      sql`char_length(${t.note}) BETWEEN 1 AND ${sql.raw(String(RECALL_NOTE_MAX))}`,
    ),
    check(
      "recalls_ended_check",
      sql`(${t.endedAt} IS NULL) = (${t.endedById} IS NULL) AND (${t.endedAt} IS NULL) = (${t.endedByType} IS NULL)`,
    ),
    // one active recall per product
    uniqueIndex("recalls_active_product_idx")
      .on(t.productId)
      .where(sql`${t.endedAt} IS NULL`),
    index("recalls_started_at_idx").on(t.startedAt),
  ],
);

/** The lots a recall covers, recorded when it starts. Written once. */
export const recallLots = inventory.table(
  "recall_lots",
  {
    recallId: uuid("recall_id")
      .notNull()
      .references(() => recalls.id, { onDelete: "restrict" }),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.recallId, t.lotId] }),
    index("recall_lots_lot_id_idx").on(t.lotId),
  ],
);

/**
 * What happened to a recall's stock (igs-pharma#189, REQ-SAF-01): `quantity` units of one of its lots
 * destroyed or returned to the supplier, booked as a `disposal` movement (`movement_id`). Written once,
 * by a pharmacist; the note is staff text, never audited.
 */
export const recallDisposals = inventory.table(
  "recall_disposals",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    recallId: uuid("recall_id")
      .notNull()
      .references(() => recalls.id, { onDelete: "restrict" }),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "restrict" }),
    /** The `disposal` movement. No foreign key: the append-only ledger guards itself (a key would turn its own refusals into key errors). */
    movementId: uuid("movement_id").notNull().unique(),
    quantity: integer("quantity").notNull(),
    method: text("method").notNull(),
    note: text("note"),
    recordedByType: text("recorded_by_type").notNull(),
    recordedById: text("recorded_by_id").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "recall_disposals_quantity_check",
      sql`${t.quantity} > 0 AND ${t.quantity} <= ${sql.raw(String(MAX_QUANTITY))}`,
    ),
    check("recall_disposals_method_check", oneOf("method", DISPOSAL_METHODS)),
    check(
      "recall_disposals_note_check",
      sql`${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND 200`,
    ),
    index("recall_disposals_recall_id_idx").on(t.recallId),
  ],
);
