-- igs-pharma#156: orders.refunds and its guards. Grants: 0058.
CREATE TABLE "orders"."refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"requested_by_type" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"approved_by_id" text,
	"provider_refund_id" text,
	"failure_code" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_status_check" CHECK (status IN ('requested', 'pending', 'refunded', 'failed', 'canceled')),
	CONSTRAINT "refunds_reason_check" CHECK (reason IN ('pharmacist_rejected', 'stock_short', 'paid_after_close', 'customer_request', 'other')),
	CONSTRAINT "refunds_currency_check" CHECK (currency IN ('EUR')),
	CONSTRAINT "refunds_amount_check" CHECK ("orders"."refunds"."amount_cents" > 0),
	CONSTRAINT "refunds_note_check" CHECK ("orders"."refunds"."note" IS NULL OR char_length("orders"."refunds"."note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "orders"."refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "orders"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_refund_idx" ON "orders"."refunds" USING btree ("provider_refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_one_active_idx" ON "orders"."refunds" USING btree ("payment_id") WHERE "orders"."refunds"."status" IN ('requested', 'pending', 'refunded');--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "orders"."refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_status_updated_idx" ON "orders"."refunds" USING btree ("status","updated_at");--> statement-breakpoint
CREATE FUNCTION "orders"."refund_insert_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'requested' OR NEW.provider_refund_id IS NOT NULL THEN
    RAISE EXCEPTION 'refund % starts requested, without a provider refund', NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "orders"."payments" p
    JOIN "orders"."orders" o ON o.id = p.order_id
    WHERE p.id = NEW.payment_id AND p.order_id = NEW.order_id AND p.status = 'paid'
      AND p.amount_cents = NEW.amount_cents AND p.currency = NEW.currency
      AND o.status IN ('cancelled', 'expired')
  ) THEN
    RAISE EXCEPTION 'refund %: only the full amount of a paid payment of a closed order is refunded', NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."refund_insert_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "refunds_insert_guard" BEFORE INSERT ON "orders"."refunds"
  FOR EACH ROW EXECUTE FUNCTION "orders"."refund_insert_guard"();
--> statement-breakpoint
CREATE FUNCTION "orders"."refund_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_rank integer := CASE OLD.status WHEN 'requested' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END;
  new_rank integer := CASE NEW.status WHEN 'requested' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END;
BEGIN
  IF (NEW.id, NEW.order_id, NEW.payment_id, NEW.amount_cents, NEW.currency, NEW.reason, NEW.note,
      NEW.requested_by_type, NEW.requested_by_id, NEW.approved_by_id, NEW.requested_at)
     IS DISTINCT FROM
     (OLD.id, OLD.order_id, OLD.payment_id, OLD.amount_cents, OLD.currency, OLD.reason, OLD.note,
      OLD.requested_by_type, OLD.requested_by_id, OLD.approved_by_id, OLD.requested_at) THEN
    RAISE EXCEPTION 'refund % keeps its order, payment, amount, reason and requester', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.provider_refund_id IS NOT NULL AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id THEN
    RAISE EXCEPTION 'refund % keeps its provider refund id', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status <> OLD.status AND (old_rank = 2 OR new_rank <= old_rank) THEN
    RAISE EXCEPTION 'refund % may not move from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'requested' AND NEW.status = 'pending' AND NEW.provider_refund_id IS NULL THEN
    RAISE EXCEPTION 'refund % is pending only with a provider refund id', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."refund_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "refunds_guard" BEFORE UPDATE ON "orders"."refunds"
  FOR EACH ROW EXECUTE FUNCTION "orders"."refund_guard"();
--> statement-breakpoint
CREATE TRIGGER "refunds_no_delete" BEFORE DELETE ON "orders"."refunds"
  FOR EACH ROW EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "refunds_no_truncate" BEFORE TRUNCATE ON "orders"."refunds"
  FOR EACH STATEMENT EXECUTE FUNCTION "orders"."reject_mutation"();
