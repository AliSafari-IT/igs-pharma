-- igs-pharma#189: recall disposals (inventory), the disposal movement reason, and the recall notice mail.
CREATE TABLE "inventory"."recall_disposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recall_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"method" text NOT NULL,
	"note" text,
	"recorded_by_type" text NOT NULL,
	"recorded_by_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recall_disposals_movement_id_unique" UNIQUE("movement_id"),
	CONSTRAINT "recall_disposals_quantity_check" CHECK ("inventory"."recall_disposals"."quantity" > 0 AND "inventory"."recall_disposals"."quantity" <= 1000000),
	CONSTRAINT "recall_disposals_method_check" CHECK (method IN ('destroyed', 'returned_to_supplier')),
	CONSTRAINT "recall_disposals_note_check" CHECK ("inventory"."recall_disposals"."note" IS NULL OR char_length("inventory"."recall_disposals"."note") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" DROP CONSTRAINT "stock_movements_reason_check";--> statement-breakpoint
ALTER TABLE "orders"."order_mails" DROP CONSTRAINT "order_mails_kind_check";--> statement-breakpoint
ALTER TABLE "inventory"."recall_disposals" ADD CONSTRAINT "recall_disposals_recall_id_recalls_id_fk" FOREIGN KEY ("recall_id") REFERENCES "inventory"."recalls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."recall_disposals" ADD CONSTRAINT "recall_disposals_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recall_disposals_recall_id_idx" ON "inventory"."recall_disposals" USING btree ("recall_id");--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ADD CONSTRAINT "stock_movements_reason_check" CHECK (reason IN ('import', 'reconciliation', 'adjustment', 'correction', 'sale', 'receipt', 'return', 'disposal'));--> statement-breakpoint
ALTER TABLE "orders"."order_mails" ADD CONSTRAINT "order_mails_kind_check" CHECK (kind IN ('order_received', 'stock_short', 'ready_for_pickup', 'refund_initiated', 'refund_completed', 'recall_notice'));--> statement-breakpoint
-- a disposal is written once: no UPDATE, no DELETE, no TRUNCATE
CREATE TRIGGER "recall_disposals_no_change" BEFORE UPDATE OR DELETE ON "inventory"."recall_disposals"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "recall_disposals_no_truncate" BEFORE TRUNCATE ON "inventory"."recall_disposals"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
-- the order mail guard of 0060, plus `recall_notice`: only for an order that was paid
CREATE OR REPLACE FUNCTION "orders"."order_mail_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
    WHEN 'recall_notice' THEN paid
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
