-- igs-pharma#157: orders.order_mails and its guards. Grants: 0061.
CREATE TABLE "orders"."order_mails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"refund_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "order_mails_kind_check" CHECK (kind IN ('order_received', 'stock_short', 'ready_for_pickup', 'refund_initiated', 'refund_completed')),
	CONSTRAINT "order_mails_status_check" CHECK (status IN ('pending', 'sent', 'skipped')),
	CONSTRAINT "order_mails_refund_check" CHECK (("orders"."order_mails"."kind" IN ('refund_initiated', 'refund_completed')) = ("orders"."order_mails"."refund_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "orders"."order_mails" ADD CONSTRAINT "order_mails_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_mails" ADD CONSTRAINT "order_mails_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "orders"."refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_mails_order_kind_idx" ON "orders"."order_mails" USING btree ("order_id","kind") WHERE "orders"."order_mails"."refund_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "order_mails_refund_kind_idx" ON "orders"."order_mails" USING btree ("refund_id","kind") WHERE "orders"."order_mails"."refund_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "order_mails_status_created_idx" ON "orders"."order_mails" USING btree ("status","created_at");--> statement-breakpoint
-- A mail only for the state it reports, whoever writes it: payment received is not approval, not
-- stock confirmed, not ready.
CREATE FUNCTION "orders"."order_mail_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  order_status text;
  paid boolean;
  refund_status text;
  allowed boolean;
BEGIN
  IF NEW.status <> 'pending' OR NEW.sent_at IS NOT NULL THEN
    RAISE EXCEPTION 'order mail % starts pending', NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT o.status INTO order_status FROM "orders"."orders" o WHERE o.id = NEW.order_id;
  SELECT EXISTS (
    SELECT 1 FROM "orders"."payments" p WHERE p.order_id = NEW.order_id AND p.status = 'paid'
  ) INTO paid;
  SELECT r.status INTO refund_status FROM "orders"."refunds" r
    WHERE r.id = NEW.refund_id AND r.order_id = NEW.order_id;
  allowed := CASE NEW.kind
    WHEN 'order_received' THEN paid AND order_status IN ('in_review', 'ready_to_prepare')
    WHEN 'stock_short' THEN paid AND order_status = 'paid_stock_short'
    WHEN 'ready_for_pickup' THEN order_status = 'ready_for_pickup'
    WHEN 'refund_initiated' THEN refund_status IS NOT NULL
    WHEN 'refund_completed' THEN refund_status = 'refunded'
    ELSE false
  END;
  IF allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'order mail %: order % is not in the state a % mail reports', NEW.id, NEW.order_id, NEW.kind
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."order_mail_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "order_mails_guard" BEFORE INSERT ON "orders"."order_mails"
  FOR EACH ROW EXECUTE FUNCTION "orders"."order_mail_guard"();
--> statement-breakpoint
CREATE FUNCTION "orders"."order_mail_update_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.order_id, NEW.kind, NEW.refund_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.order_id, OLD.kind, OLD.refund_id, OLD.created_at)
     OR OLD.status <> 'pending' OR NEW.status = 'pending' THEN
    RAISE EXCEPTION 'order mail % only moves from pending to sent or skipped', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."order_mail_update_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "order_mails_update_guard" BEFORE UPDATE ON "orders"."order_mails"
  FOR EACH ROW EXECUTE FUNCTION "orders"."order_mail_update_guard"();
--> statement-breakpoint
CREATE TRIGGER "order_mails_no_delete" BEFORE DELETE ON "orders"."order_mails"
  FOR EACH ROW EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "order_mails_no_truncate" BEFORE TRUNCATE ON "orders"."order_mails"
  FOR EACH STATEMENT EXECUTE FUNCTION "orders"."reject_mutation"();
