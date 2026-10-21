-- igs-pharma#165: which lots each order reservation is picked from (ADR 0011 §4).
CREATE TABLE "inventory"."reservation_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reservation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_allocations_quantity_check" CHECK ("inventory"."reservation_allocations"."quantity" > 0 AND "inventory"."reservation_allocations"."quantity" <= 1000000),
	CONSTRAINT "reservation_allocations_status_check" CHECK (status IN ('active', 'superseded', 'consumed', 'released'))
);
--> statement-breakpoint
ALTER TABLE "inventory"."reservation_allocations" ADD CONSTRAINT "reservation_allocations_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "inventory"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."reservation_allocations" ADD CONSTRAINT "reservation_allocations_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_allocations_active_idx" ON "inventory"."reservation_allocations" USING btree ("reservation_id","lot_id") WHERE "inventory"."reservation_allocations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "reservation_allocations_lot_active_idx" ON "inventory"."reservation_allocations" USING btree ("lot_id") WHERE "inventory"."reservation_allocations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "reservation_allocations_reservation_idx" ON "inventory"."reservation_allocations" USING btree ("reservation_id");--> statement-breakpoint
-- igs-pharma#165: an allocation is born active, for an active ORDER reservation, from a lot of the
-- same product; afterwards only its status changes, once, from active to superseded, consumed or
-- released. No DELETE, no TRUNCATE.
CREATE FUNCTION "inventory"."allocation_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'an allocation starts active' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "inventory"."reservations" r
      WHERE r.id = NEW.reservation_id AND r.kind = 'order' AND r.status = 'active'
        AND r.product_id = NEW.product_id
    ) THEN
      RAISE EXCEPTION 'only an active order reservation is allocated'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "inventory"."lots" l WHERE l.id = NEW.lot_id AND l.product_id = NEW.product_id
    ) THEN
      RAISE EXCEPTION 'an allocation takes a lot of its own product'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.reservation_id, NEW.product_id, NEW.lot_id, NEW.quantity, NEW.created_by_type,
      NEW.created_by_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.reservation_id, OLD.product_id, OLD.lot_id, OLD.quantity, OLD.created_by_type,
      OLD.created_by_id, OLD.created_at) THEN
    RAISE EXCEPTION 'allocation % keeps its reservation, lot and quantity', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'active' AND NEW.status IN ('superseded', 'consumed', 'released')) THEN
    RAISE EXCEPTION 'allocation % cannot go from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "inventory"."allocation_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "reservation_allocations_guard" BEFORE INSERT OR UPDATE
  ON "inventory"."reservation_allocations"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."allocation_guard"();
--> statement-breakpoint
CREATE TRIGGER "reservation_allocations_no_delete" BEFORE DELETE
  ON "inventory"."reservation_allocations"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "reservation_allocations_no_truncate" BEFORE TRUNCATE
  ON "inventory"."reservation_allocations"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory"."reject_mutation"();
