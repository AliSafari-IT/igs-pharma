-- igs-pharma#187: recalls (inventory) and the stop-sales they start (catalog), REQ-SAF-01.
CREATE TABLE "catalog"."stop_sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"reference_id" uuid NOT NULL,
	"started_by_type" text NOT NULL,
	"started_by_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_by_type" text,
	"ended_by_id" text,
	"ended_at" timestamp with time zone,
	CONSTRAINT "stop_sales_reason_check" CHECK (reason IN ('recall')),
	CONSTRAINT "stop_sales_ended_check" CHECK (("catalog"."stop_sales"."ended_at" IS NULL) = ("catalog"."stop_sales"."ended_by_id" IS NULL) AND ("catalog"."stop_sales"."ended_at" IS NULL) = ("catalog"."stop_sales"."ended_by_type" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "inventory"."recall_lots" (
	"recall_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	CONSTRAINT "recall_lots_recall_id_lot_id_pk" PRIMARY KEY("recall_id","lot_id")
);
--> statement-breakpoint
CREATE TABLE "inventory"."recalls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"source" text NOT NULL,
	"note" text NOT NULL,
	"started_by_type" text NOT NULL,
	"started_by_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_by_type" text,
	"ended_by_id" text,
	"ended_at" timestamp with time zone,
	CONSTRAINT "recalls_scope_check" CHECK (scope IN ('all_lots', 'lots')),
	CONSTRAINT "recalls_source_check" CHECK (source IN ('famhp', 'manufacturer', 'wholesaler', 'pharmacy')),
	CONSTRAINT "recalls_note_check" CHECK (char_length("inventory"."recalls"."note") BETWEEN 1 AND 500),
	CONSTRAINT "recalls_ended_check" CHECK (("inventory"."recalls"."ended_at" IS NULL) = ("inventory"."recalls"."ended_by_id" IS NULL) AND ("inventory"."recalls"."ended_at" IS NULL) = ("inventory"."recalls"."ended_by_type" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "catalog"."stop_sales" ADD CONSTRAINT "stop_sales_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."recall_lots" ADD CONSTRAINT "recall_lots_recall_id_recalls_id_fk" FOREIGN KEY ("recall_id") REFERENCES "inventory"."recalls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."recall_lots" ADD CONSTRAINT "recall_lots_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stop_sales_reference_idx" ON "catalog"."stop_sales" USING btree ("reason","reference_id");--> statement-breakpoint
CREATE INDEX "stop_sales_active_idx" ON "catalog"."stop_sales" USING btree ("product_id") WHERE "catalog"."stop_sales"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "recall_lots_lot_id_idx" ON "inventory"."recall_lots" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recalls_active_product_idx" ON "inventory"."recalls" USING btree ("product_id") WHERE "inventory"."recalls"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "recalls_started_at_idx" ON "inventory"."recalls" USING btree ("started_at");--> statement-breakpoint
-- igs-pharma#187: a recall and its stop-sale keep what they are. Only an active one ends, once,
-- with who and when. The lots of a recall are written once. No DELETE, no TRUNCATE.
CREATE FUNCTION "inventory"."recall_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.product_id, NEW.scope, NEW.source, NEW.note, NEW.started_by_type, NEW.started_by_id, NEW.started_at)
     IS DISTINCT FROM
     (OLD.id, OLD.product_id, OLD.scope, OLD.source, OLD.note, OLD.started_by_type, OLD.started_by_id, OLD.started_at) THEN
    RAISE EXCEPTION 'recall % keeps what it covers, who started it and when', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.ended_by_type, NEW.ended_by_id, NEW.ended_at)
     IS DISTINCT FROM (OLD.ended_by_type, OLD.ended_by_id, OLD.ended_at)
     AND OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'recall % has ended and cannot change', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "inventory"."recall_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "recalls_guard" BEFORE UPDATE ON "inventory"."recalls"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."recall_guard"();
--> statement-breakpoint
CREATE TRIGGER "recalls_no_delete" BEFORE DELETE ON "inventory"."recalls"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "recalls_no_truncate" BEFORE TRUNCATE ON "inventory"."recalls"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "recall_lots_no_change" BEFORE UPDATE OR DELETE ON "inventory"."recall_lots"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "recall_lots_no_truncate" BEFORE TRUNCATE ON "inventory"."recall_lots"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
CREATE FUNCTION "catalog"."stop_sale_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'stop-sales are kept'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.id, NEW.product_id, NEW.reason, NEW.reference_id, NEW.started_by_type, NEW.started_by_id, NEW.started_at)
     IS DISTINCT FROM
     (OLD.id, OLD.product_id, OLD.reason, OLD.reference_id, OLD.started_by_type, OLD.started_by_id, OLD.started_at) THEN
    RAISE EXCEPTION 'stop-sale % keeps what it stops, who started it and when', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.ended_by_type, NEW.ended_by_id, NEW.ended_at)
     IS DISTINCT FROM (OLD.ended_by_type, OLD.ended_by_id, OLD.ended_at)
     AND OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'stop-sale % has ended and cannot change', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "catalog"."stop_sale_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "stop_sales_guard" BEFORE UPDATE OR DELETE ON "catalog"."stop_sales"
  FOR EACH ROW EXECUTE FUNCTION "catalog"."stop_sale_guard"();
--> statement-breakpoint
CREATE TRIGGER "stop_sales_no_truncate" BEFORE TRUNCATE ON "catalog"."stop_sales"
  FOR EACH STATEMENT EXECUTE FUNCTION "catalog"."stop_sale_guard"();
