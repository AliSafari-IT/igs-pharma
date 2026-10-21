-- igs-pharma#116: orders.order_reviews and its guards. Grants: 0054.
CREATE TABLE "orders"."order_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"note" text,
	"reviewer_id" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_reviews_decision_check" CHECK (decision IN ('approved', 'rejected')),
	CONSTRAINT "order_reviews_note_check" CHECK ("orders"."order_reviews"."note" IS NULL OR char_length("orders"."order_reviews"."note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "orders"."order_reviews" ADD CONSTRAINT "order_reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_reviews_order_idx" ON "orders"."order_reviews" USING btree ("order_id");--> statement-breakpoint
CREATE TRIGGER "order_reviews_no_change" BEFORE UPDATE OR DELETE ON "orders"."order_reviews"
  FOR EACH ROW EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "order_reviews_no_truncate" BEFORE TRUNCATE ON "orders"."order_reviews"
  FOR EACH STATEMENT EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
CREATE FUNCTION "orders"."order_review_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "orders"."orders" WHERE id = NEW.order_id AND status = 'in_review'
  ) THEN
    RAISE EXCEPTION 'order % is not in_review: no review decision can be recorded', NEW.order_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."order_review_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "order_reviews_guard" BEFORE INSERT ON "orders"."order_reviews"
  FOR EACH ROW EXECUTE FUNCTION "orders"."order_review_guard"();
--> statement-breakpoint
CREATE FUNCTION "orders"."order_approval_required"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "orders"."order_reviews" WHERE order_id = NEW.id AND decision = 'approved'
  ) THEN
    RAISE EXCEPTION 'order % has no approved review: it cannot be prepared', NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."order_approval_required"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "orders_approval_required" BEFORE UPDATE OF "status" ON "orders"."orders"
  FOR EACH ROW WHEN (OLD.status = 'in_review' AND NEW.status = 'ready_to_prepare')
  EXECUTE FUNCTION "orders"."order_approval_required"();
