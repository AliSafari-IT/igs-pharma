-- igs-pharma#166: reconciliations of web-pool lots, replacing the absolute CSV import (ADR 0011 §1).
CREATE TABLE "inventory"."reconciliation_lines" (
	"reconciliation_id" uuid NOT NULL,
	"line" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"booked" integer NOT NULL,
	"counted" integer NOT NULL,
	CONSTRAINT "reconciliation_lines_reconciliation_id_line_pk" PRIMARY KEY("reconciliation_id","line"),
	CONSTRAINT "reconciliation_lines_booked_check" CHECK ("inventory"."reconciliation_lines"."booked" >= 0),
	CONSTRAINT "reconciliation_lines_counted_check" CHECK ("inventory"."reconciliation_lines"."counted" >= 0 AND "inventory"."reconciliation_lines"."counted" <= 1000000)
);
--> statement-breakpoint
CREATE TABLE "inventory"."reconciliations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text NOT NULL,
	"started_by_type" text NOT NULL,
	"started_by_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_by_type" text,
	"ended_by_id" text,
	"ended_at" timestamp with time zone,
	CONSTRAINT "reconciliations_status_check" CHECK (status IN ('open', 'applied', 'discarded')),
	CONSTRAINT "reconciliations_source_check" CHECK (source IN ('csv', 'typed')),
	CONSTRAINT "reconciliations_ended_check" CHECK (("inventory"."reconciliations"."status" = 'open') = ("inventory"."reconciliations"."ended_at" IS NULL) AND ("inventory"."reconciliations"."ended_at" IS NULL) = ("inventory"."reconciliations"."ended_by_id" IS NULL) AND ("inventory"."reconciliations"."ended_at" IS NULL) = ("inventory"."reconciliations"."ended_by_type" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" DROP CONSTRAINT "stock_movements_reason_check";--> statement-breakpoint
ALTER TABLE "inventory"."reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_reconciliation_id_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "inventory"."reconciliations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_lines_lot_idx" ON "inventory"."reconciliation_lines" USING btree ("reconciliation_id","lot_id");--> statement-breakpoint
CREATE INDEX "reconciliations_open_idx" ON "inventory"."reconciliations" USING btree ("started_at") WHERE "inventory"."reconciliations"."status" = 'open';--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ADD CONSTRAINT "stock_movements_reason_check" CHECK (reason IN ('import', 'reconciliation', 'adjustment', 'correction', 'sale', 'receipt', 'return'));--> statement-breakpoint
-- a reconciliation keeps what it is; only an open one ends, once (applied or discarded), with who
-- and when. Its lines are written once. No DELETE, no TRUNCATE.
CREATE FUNCTION "inventory"."reconciliation_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.source, NEW.started_by_type, NEW.started_by_id, NEW.started_at)
     IS DISTINCT FROM
     (OLD.id, OLD.source, OLD.started_by_type, OLD.started_by_id, OLD.started_at) THEN
    RAISE EXCEPTION 'reconciliation % keeps who started it and when', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.status, NEW.ended_by_type, NEW.ended_by_id, NEW.ended_at)
     IS DISTINCT FROM (OLD.status, OLD.ended_by_type, OLD.ended_by_id, OLD.ended_at)
     AND NOT (OLD.status = 'open' AND NEW.status IN ('applied', 'discarded')) THEN
    RAISE EXCEPTION 'reconciliation % is % and cannot change', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "inventory"."reconciliation_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "reconciliations_guard" BEFORE UPDATE ON "inventory"."reconciliations"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."reconciliation_guard"();
--> statement-breakpoint
CREATE TRIGGER "reconciliations_no_delete" BEFORE DELETE ON "inventory"."reconciliations"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "reconciliations_no_truncate" BEFORE TRUNCATE ON "inventory"."reconciliations"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "reconciliation_lines_no_change" BEFORE UPDATE OR DELETE ON "inventory"."reconciliation_lines"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "reconciliation_lines_no_truncate" BEFORE TRUNCATE ON "inventory"."reconciliation_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory"."reject_mutation"();
