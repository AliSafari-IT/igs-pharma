CREATE TABLE "inventory"."reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"kind" text NOT NULL,
	"holder_ref" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"release_reason" text,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_type" text NOT NULL,
	"updated_by_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_quantity_check" CHECK ("inventory"."reservations"."quantity" > 0 AND "inventory"."reservations"."quantity" <= 1000000),
	CONSTRAINT "reservations_kind_check" CHECK (kind IN ('hold', 'order')),
	CONSTRAINT "reservations_status_check" CHECK (status IN ('active', 'released', 'consumed', 'expired')),
	CONSTRAINT "reservations_release_reason_check" CHECK (("inventory"."reservations"."status" = 'released') = ("inventory"."reservations"."release_reason" IS NOT NULL)
        AND ("inventory"."reservations"."release_reason" IS NULL OR release_reason IN ('checkout_cancelled', 'order_cancelled', 'refunded', 'staff_correction'))),
	CONSTRAINT "reservations_expires_at_check" CHECK (("inventory"."reservations"."kind" = 'hold' AND "inventory"."reservations"."expires_at" IS NOT NULL) OR ("inventory"."reservations"."kind" = 'order' AND "inventory"."reservations"."expires_at" IS NULL)),
	CONSTRAINT "reservations_only_holds_expire_check" CHECK ("inventory"."reservations"."status" <> 'expired' OR "inventory"."reservations"."kind" = 'hold'),
	CONSTRAINT "reservations_only_orders_consumed_check" CHECK ("inventory"."reservations"."status" <> 'consumed' OR "inventory"."reservations"."kind" = 'order'),
	CONSTRAINT "reservations_holder_ref_check" CHECK ("inventory"."reservations"."holder_ref" ~ '^(checkout|order):[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);
--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" DROP CONSTRAINT "stock_movements_reason_check";--> statement-breakpoint
ALTER TABLE "inventory"."reservations" ADD CONSTRAINT "reservations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_active_holder_idx" ON "inventory"."reservations" USING btree ("product_id","location_id","holder_ref") WHERE "inventory"."reservations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "reservations_product_active_idx" ON "inventory"."reservations" USING btree ("product_id","location_id") WHERE "inventory"."reservations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "reservations_hold_expiry_idx" ON "inventory"."reservations" USING btree ("expires_at") WHERE "inventory"."reservations"."status" = 'active' AND "inventory"."reservations"."kind" = 'hold';--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ADD CONSTRAINT "stock_movements_reason_check" CHECK (reason IN ('import', 'adjustment', 'correction', 'sale'));
--> statement-breakpoint
-- igs-pharma#99: the reservation lifecycle, enforced by the database whoever writes. Four statuses
-- (active → released | consumed | expired); a hold may become an order while it stays active; a
-- reservation in an end state never changes again; the identifying columns never change; no DELETE
-- or TRUNCATE (a reservation is history). The expires_at / kind / status rules are CHECK constraints
-- above.
CREATE FUNCTION "inventory"."reservation_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'active' THEN
    RAISE EXCEPTION 'reservation % is % and cannot change', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.id, NEW.product_id, NEW.location_id, NEW.quantity, NEW.holder_ref,
      NEW.created_by_type, NEW.created_by_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.product_id, OLD.location_id, OLD.quantity, OLD.holder_ref,
      OLD.created_by_type, OLD.created_by_id, OLD.created_at) THEN
    RAISE EXCEPTION 'reservation % keeps its product, quantity, holder and creator', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.kind <> OLD.kind AND NOT (OLD.kind = 'hold' AND NEW.kind = 'order' AND NEW.status = 'active') THEN
    RAISE EXCEPTION 'reservation % may only turn from a hold into an order', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "inventory"."reservation_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "reservations_guard" BEFORE UPDATE ON "inventory"."reservations"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."reservation_guard"();
--> statement-breakpoint
CREATE FUNCTION "inventory"."reservation_reject_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not allowed: reservations are kept', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "inventory"."reservation_reject_delete"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "reservations_no_delete" BEFORE DELETE ON "inventory"."reservations"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."reservation_reject_delete"();
--> statement-breakpoint
CREATE TRIGGER "reservations_no_truncate" BEFORE TRUNCATE ON "inventory"."reservations"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory"."reservation_reject_delete"();
--> statement-breakpoint
-- Takes the row lock of a product's stock level and returns what is on hand (0 for a product that
-- never had stock). A reservation locks this row BEFORE it reads what is available, so it waits for
-- any stock movement in flight (the movement trigger updates this same row) and for any other
-- reservation of the product. SECURITY DEFINER because SELECT ... FOR UPDATE needs UPDATE on the
-- table and the runtime roles can only SELECT stock_levels; the function changes nothing.
CREATE FUNCTION "inventory"."lock_stock_level"(p_product_id uuid, p_location_id uuid) RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, inventory, pg_temp AS $$
  SELECT coalesce(
    (SELECT on_hand FROM inventory.stock_levels
      WHERE product_id = p_product_id AND location_id = p_location_id FOR UPDATE),
    0);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "inventory"."lock_stock_level"(uuid, uuid) FROM PUBLIC;
