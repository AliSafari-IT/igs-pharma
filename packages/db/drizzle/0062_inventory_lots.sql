-- igs-pharma#164 (ADR 0011): lots, per-lot levels, the inventory settings, and every movement in a
-- lot. Existing stock moves into one lot per product: `no_lot` for other products, `unknown` (never
-- sellable) for medicines, whose lot was never recorded. Grants: 0063.
CREATE TABLE "inventory"."lot_levels" (
	"lot_id" uuid PRIMARY KEY NOT NULL,
	"on_hand" integer NOT NULL,
	CONSTRAINT "lot_levels_on_hand_check" CHECK ("inventory"."lot_levels"."on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory"."lots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"tracking" text NOT NULL,
	"lot_number" text,
	"expiry_date" date,
	"quarantined_at" timestamp with time zone,
	"quarantine_reason" text,
	"quarantined_by_type" text,
	"quarantined_by_id" text,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lots_tracking_check" CHECK (tracking IN ('lot', 'no_lot', 'unknown')),
	CONSTRAINT "lots_lot_number_check" CHECK (("inventory"."lots"."tracking" = 'lot') = ("inventory"."lots"."lot_number" IS NOT NULL) AND ("inventory"."lots"."lot_number" IS NULL OR char_length("inventory"."lots"."lot_number") BETWEEN 1 AND 40)),
	CONSTRAINT "lots_expiry_check" CHECK ("inventory"."lots"."tracking" = 'lot' OR "inventory"."lots"."expiry_date" IS NULL),
	CONSTRAINT "lots_quarantine_check" CHECK (("inventory"."lots"."quarantined_at" IS NULL) = ("inventory"."lots"."quarantine_reason" IS NULL) AND ("inventory"."lots"."quarantined_at" IS NULL) = ("inventory"."lots"."quarantined_by_id" IS NULL) AND ("inventory"."lots"."quarantined_at" IS NULL) = ("inventory"."lots"."quarantined_by_type" IS NULL)),
	CONSTRAINT "lots_quarantine_reason_check" CHECK ("inventory"."lots"."quarantine_reason" IS NULL OR quarantine_reason IN ('quality', 'recall', 'damaged', 'other'))
);
--> statement-breakpoint
CREATE TABLE "inventory"."settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"expiry_buffer_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_type" text,
	"updated_by_id" text,
	CONSTRAINT "settings_single_row_check" CHECK ("inventory"."settings"."id" = 1),
	CONSTRAINT "settings_expiry_buffer_check" CHECK ("inventory"."settings"."expiry_buffer_days" BETWEEN 0 AND 365)
);
--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" DROP CONSTRAINT "stock_movements_reason_check";--> statement-breakpoint
ALTER TABLE "inventory"."lot_levels" ADD CONSTRAINT "lot_levels_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."lots" ADD CONSTRAINT "lots_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lots_lot_number_expiry_idx" ON "inventory"."lots" USING btree ("product_id","location_id","lot_number","expiry_date") WHERE "inventory"."lots"."tracking" = 'lot' AND "inventory"."lots"."expiry_date" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "lots_lot_number_no_expiry_idx" ON "inventory"."lots" USING btree ("product_id","location_id","lot_number") WHERE "inventory"."lots"."tracking" = 'lot' AND "inventory"."lots"."expiry_date" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "lots_untracked_idx" ON "inventory"."lots" USING btree ("product_id","location_id","tracking") WHERE "inventory"."lots"."tracking" <> 'lot';--> statement-breakpoint
CREATE INDEX "lots_product_location_idx" ON "inventory"."lots" USING btree ("product_id","location_id");--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ADD CONSTRAINT "stock_movements_reason_check" CHECK (reason IN ('import', 'adjustment', 'correction', 'sale', 'receipt', 'return'));--> statement-breakpoint
INSERT INTO "inventory"."settings" ("id", "expiry_buffer_days") VALUES (1, 30);
--> statement-breakpoint
-- the backfill below must see every movement and no new one: writers wait, readers continue
LOCK TABLE "inventory"."stock_movements" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ADD COLUMN "lot_id" uuid;
--> statement-breakpoint
-- one lot per product and location that has stock history; a product the catalog no longer knows
-- is treated as a medicine (never sellable until staff record its lot)
INSERT INTO "inventory"."lots" ("id", "product_id", "location_id", "tracking", "created_by_type", "created_by_id")
  SELECT gen_random_uuid(), m."product_id", m."location_id",
    CASE WHEN coalesce(p."product_type" IN ('otc_medicine', 'rx_medicine') OR p."legal_status" IN ('otc', 'rx'), true)
      THEN 'unknown' ELSE 'no_lot' END,
    'system', 'migration'
  FROM (SELECT DISTINCT "product_id", "location_id" FROM "inventory"."stock_movements") m
  LEFT JOIN "catalog"."products" p ON p."id" = m."product_id";
--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" DISABLE TRIGGER "stock_movements_append_only_rows";
--> statement-breakpoint
UPDATE "inventory"."stock_movements" m SET "lot_id" = l."id"
  FROM "inventory"."lots" l
  WHERE l."product_id" = m."product_id" AND l."location_id" = m."location_id";
--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ENABLE TRIGGER "stock_movements_append_only_rows";
--> statement-breakpoint
INSERT INTO "inventory"."lot_levels" ("lot_id", "on_hand")
  SELECT "lot_id", sum("delta")::integer FROM "inventory"."stock_movements" GROUP BY "lot_id";
--> statement-breakpoint
-- every movement has its lot, and per-lot levels add up to the product levels
DO $$
DECLARE
  mismatches integer;
BEGIN
  IF EXISTS (SELECT 1 FROM "inventory"."stock_movements" WHERE "lot_id" IS NULL) THEN
    RAISE EXCEPTION 'igs-pharma#164: a movement has no lot after the backfill';
  END IF;
  SELECT count(*) INTO mismatches
  FROM (
    SELECT l."product_id", l."location_id", sum(ll."on_hand")::integer AS total
      FROM "inventory"."lot_levels" ll JOIN "inventory"."lots" l ON l."id" = ll."lot_id"
      GROUP BY l."product_id", l."location_id"
  ) per_lot
  FULL JOIN "inventory"."stock_levels" s USING ("product_id", "location_id")
  WHERE per_lot.total IS DISTINCT FROM s."on_hand";
  IF mismatches > 0 THEN
    RAISE EXCEPTION 'igs-pharma#164: lot levels differ from stock levels for % product(s)', mismatches;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ALTER COLUMN "lot_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ADD CONSTRAINT "stock_movements_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "stock_movements_lot_idx" ON "inventory"."stock_movements" USING btree ("lot_id");
--> statement-breakpoint
-- the level trigger now keeps the lot's level too, and refuses a movement whose lot is another
-- product's or location's
CREATE OR REPLACE FUNCTION "inventory"."apply_movement_to_level"() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, inventory, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM inventory.lots
    WHERE id = NEW.lot_id AND product_id = NEW.product_id AND location_id = NEW.location_id
  ) THEN
    RAISE EXCEPTION 'movement %: lot % is not a lot of this product at this location', NEW.id, NEW.lot_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  INSERT INTO inventory.stock_levels (product_id, location_id, on_hand)
    VALUES (NEW.product_id, NEW.location_id, 0)
    ON CONFLICT (product_id, location_id) DO NOTHING;
  UPDATE inventory.stock_levels SET on_hand = on_hand + NEW.delta
    WHERE product_id = NEW.product_id AND location_id = NEW.location_id;
  INSERT INTO inventory.lot_levels (lot_id, on_hand) VALUES (NEW.lot_id, 0)
    ON CONFLICT (lot_id) DO NOTHING;
  UPDATE inventory.lot_levels SET on_hand = on_hand + NEW.delta WHERE lot_id = NEW.lot_id;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "inventory"."apply_movement_to_level"() FROM PUBLIC;
--> statement-breakpoint
-- a lot keeps what identifies it; only its quarantine changes. No DELETE, no TRUNCATE.
CREATE FUNCTION "inventory"."lot_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.product_id, NEW.location_id, NEW.tracking, NEW.lot_number, NEW.expiry_date,
      NEW.created_by_type, NEW.created_by_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.product_id, OLD.location_id, OLD.tracking, OLD.lot_number, OLD.expiry_date,
      OLD.created_by_type, OLD.created_by_id, OLD.created_at) THEN
    RAISE EXCEPTION 'lot % keeps its product, location, lot number and expiry date', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "inventory"."lot_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "lots_guard" BEFORE UPDATE ON "inventory"."lots"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."lot_guard"();
--> statement-breakpoint
CREATE TRIGGER "lots_no_delete" BEFORE DELETE ON "inventory"."lots"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "lots_no_truncate" BEFORE TRUNCATE ON "inventory"."lots"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "settings_no_delete" BEFORE DELETE ON "inventory"."settings"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "settings_no_truncate" BEFORE TRUNCATE ON "inventory"."settings"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory"."reject_mutation"();
