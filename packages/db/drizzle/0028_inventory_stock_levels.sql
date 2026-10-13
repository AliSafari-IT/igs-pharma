CREATE TABLE "inventory"."import_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"rows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_levels" (
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"on_hand" integer NOT NULL,
	CONSTRAINT "stock_levels_product_id_location_id_pk" PRIMARY KEY("product_id","location_id"),
	CONSTRAINT "stock_levels_on_hand_check" CHECK ("inventory"."stock_levels"."on_hand" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory"."stock_levels" ADD CONSTRAINT "stock_levels_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- igs-pharma#83 (D7, D-037): the database guard against overselling. `stock_levels` is derived from
-- the ledger by a trigger; its `on_hand >= 0` check refuses any movement that would take a product
-- below zero, whoever inserts it and whether or not they hold the application's stock lock.
--
-- LOCK: the backfill reads every movement once (one aggregate pass) and runs under SHARE ROW
-- EXCLUSIVE on `stock_movements` (readers continue, writers wait) so no insert can slip in between
-- the backfill and the trigger. The lock is held to the end of the migration transaction: seconds at
-- today's volume (a single location, one row per count change).
LOCK TABLE "inventory"."stock_movements" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO "inventory"."stock_levels" ("product_id", "location_id", "on_hand")
  SELECT "product_id", "location_id", sum("delta")::integer
  FROM "inventory"."stock_movements"
  GROUP BY "product_id", "location_id";
--> statement-breakpoint
-- The backfill's own check constraint would already refuse a negative sum; this states it and
-- verifies that levels equal the ledger for every product and location (both directions).
DO $$
DECLARE
  mismatches integer;
BEGIN
  SELECT count(*) INTO mismatches
  FROM (
    SELECT "product_id", "location_id", sum("delta")::integer AS total
      FROM "inventory"."stock_movements" GROUP BY "product_id", "location_id"
  ) m
  FULL JOIN "inventory"."stock_levels" l USING ("product_id", "location_id")
  WHERE m.total IS DISTINCT FROM l."on_hand";
  IF mismatches > 0 THEN
    RAISE EXCEPTION 'igs-pharma#83: stock_levels differs from the ledger for % product(s)', mismatches;
  END IF;
END
$$;
--> statement-breakpoint
-- Owned by the migrator role, SECURITY DEFINER (the runtime roles can only SELECT stock_levels),
-- search_path pinned with pg_temp last, no EXECUTE for anyone else: a trigger does not need the
-- inserting role to hold EXECUTE.
CREATE FUNCTION "inventory"."apply_movement_to_level"() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, inventory, pg_temp AS $$
BEGIN
  -- a zero row first (it satisfies the check), then the UPDATE: it takes the row lock that
  -- serialises writers of one product, and re-evaluates against the latest committed value. (An
  -- INSERT ... ON CONFLICT DO UPDATE would check the NEGATIVE inserted tuple before resolving the
  -- conflict and refuse a valid decrement.)
  INSERT INTO inventory.stock_levels (product_id, location_id, on_hand)
    VALUES (NEW.product_id, NEW.location_id, 0)
    ON CONFLICT (product_id, location_id) DO NOTHING;
  UPDATE inventory.stock_levels SET on_hand = on_hand + NEW.delta
    WHERE product_id = NEW.product_id AND location_id = NEW.location_id;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "inventory"."apply_movement_to_level"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "stock_movements_apply_to_level" AFTER INSERT ON "inventory"."stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."apply_movement_to_level"();
