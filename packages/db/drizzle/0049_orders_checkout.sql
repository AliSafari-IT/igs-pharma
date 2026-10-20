CREATE TABLE "orders"."checkout_lines" (
	"checkout_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"cnk" text NOT NULL,
	"name" text NOT NULL,
	"is_medicine" boolean NOT NULL,
	"vat_class" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"line_total_cents" integer NOT NULL,
	"vat_cents" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "checkout_lines_checkout_id_product_id_pk" PRIMARY KEY("checkout_id","product_id"),
	CONSTRAINT "checkout_lines_vat_class_check" CHECK (vat_class IN ('BE_6', 'BE_21')),
	CONSTRAINT "checkout_lines_quantity_check" CHECK ("orders"."checkout_lines"."quantity" > 0 AND "orders"."checkout_lines"."quantity" <= 100),
	CONSTRAINT "checkout_lines_amounts_check" CHECK ("orders"."checkout_lines"."unit_price_cents" >= 0 AND "orders"."checkout_lines"."line_total_cents" = "orders"."checkout_lines"."quantity" * "orders"."checkout_lines"."unit_price_cents"
        AND "orders"."checkout_lines"."vat_cents" >= 0 AND "orders"."checkout_lines"."vat_cents" <= "orders"."checkout_lines"."line_total_cents")
);
--> statement-breakpoint
CREATE TABLE "orders"."checkouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text,
	"customer_id" uuid,
	"locale" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"needs_review" boolean NOT NULL,
	"total_cents" integer NOT NULL,
	"vat_cents" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkouts_token_hash_check" CHECK ("orders"."checkouts"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "checkouts_owner_check" CHECK (("orders"."checkouts"."token_hash" IS NULL) <> ("orders"."checkouts"."customer_id" IS NULL)),
	CONSTRAINT "checkouts_locale_check" CHECK (locale IN ('nl', 'fr', 'de', 'en')),
	CONSTRAINT "checkouts_status_check" CHECK (status IN ('open', 'placed', 'cancelled')),
	CONSTRAINT "checkouts_totals_check" CHECK ("orders"."checkouts"."total_cents" >= 0 AND "orders"."checkouts"."vat_cents" >= 0 AND "orders"."checkouts"."vat_cents" <= "orders"."checkouts"."total_cents")
);
--> statement-breakpoint
CREATE TABLE "orders"."order_contacts" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders"."payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"checkout_url" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_check" CHECK (provider IN ('mollie')),
	CONSTRAINT "payments_status_check" CHECK (status IN ('created', 'open', 'pending', 'authorized', 'paid', 'failed', 'canceled', 'expired')),
	CONSTRAINT "payments_currency_check" CHECK (currency IN ('EUR')),
	CONSTRAINT "payments_amount_check" CHECK ("orders"."payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders"."reference_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer NOT NULL,
	CONSTRAINT "reference_counters_check" CHECK ("orders"."reference_counters"."year" >= 2026 AND "orders"."reference_counters"."last_number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "checkout_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."checkout_lines" ADD CONSTRAINT "checkout_lines_checkout_id_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "orders"."checkouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_contacts" ADD CONSTRAINT "order_contacts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkouts_token_open_idx" ON "orders"."checkouts" USING btree ("token_hash") WHERE "orders"."checkouts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "checkouts_customer_open_idx" ON "orders"."checkouts" USING btree ("customer_id") WHERE "orders"."checkouts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "checkouts_created_at_idx" ON "orders"."checkouts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_idx" ON "orders"."payments" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "orders"."payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_status_created_idx" ON "orders"."payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_checkout_idx" ON "orders"."orders" USING btree ("checkout_id");--> statement-breakpoint
-- igs-pharma#116 (D-045): the checkout an order was placed from never changes either. Same guard as
-- 0047 with checkout_id among the identifying columns.
CREATE OR REPLACE FUNCTION "orders"."order_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending_payment' OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'order % starts in pending_payment at version 1', NEW.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('collected', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'order % is % and cannot change', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.id, NEW.reference, NEW.customer_id, NEW.checkout_id, NEW.locale, NEW.needs_review,
      NEW.currency, NEW.total_cents, NEW.vat_cents, NEW.created_by_type, NEW.created_by_id,
      NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.reference, OLD.customer_id, OLD.checkout_id, OLD.locale, OLD.needs_review,
      OLD.currency, OLD.total_cents, OLD.vat_cents, OLD.created_by_type, OLD.created_by_id,
      OLD.created_at) THEN
    RAISE EXCEPTION 'order % keeps its reference, customer, checkout, locale, totals and creator', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'order % is at version %: an update writes version %', OLD.id, OLD.version, OLD.version + 1
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'pending_payment'
           AND NEW.status IN ('paid_stock_short', 'in_review', 'ready_to_prepare', 'cancelled', 'expired'))
      OR (OLD.status = 'paid_stock_short' AND NEW.status IN ('in_review', 'ready_to_prepare', 'cancelled'))
      OR (OLD.status = 'in_review' AND NEW.status IN ('ready_to_prepare', 'cancelled'))
      OR (OLD.status = 'ready_to_prepare' AND NEW.status IN ('preparing', 'cancelled'))
      OR (OLD.status = 'preparing' AND NEW.status IN ('ready_for_pickup', 'cancelled'))
      OR (OLD.status = 'ready_for_pickup' AND NEW.status IN ('collected', 'cancelled'))
    ) THEN
      RAISE EXCEPTION 'order % may not move from % to %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.status = 'ready_to_prepare' AND NEW.needs_review AND OLD.status <> 'in_review' THEN
      RAISE EXCEPTION 'order % holds a medicine: a pharmacist approves it before it is prepared', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- A payment's status only moves forward (created → open → pending → authorized → an end state:
-- paid, failed, canceled, expired); an end state never changes; the order, provider, amount and
-- currency never change; the provider's payment id is set once.
CREATE FUNCTION "orders"."payment_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_rank integer := CASE OLD.status WHEN 'created' THEN 0 WHEN 'open' THEN 1 WHEN 'pending' THEN 2
    WHEN 'authorized' THEN 3 ELSE 4 END;
  new_rank integer := CASE NEW.status WHEN 'created' THEN 0 WHEN 'open' THEN 1 WHEN 'pending' THEN 2
    WHEN 'authorized' THEN 3 ELSE 4 END;
BEGIN
  IF (NEW.id, NEW.order_id, NEW.provider, NEW.amount_cents, NEW.currency, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.order_id, OLD.provider, OLD.amount_cents, OLD.currency, OLD.created_at) THEN
    RAISE EXCEPTION 'payment % keeps its order, provider and amount', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id THEN
    RAISE EXCEPTION 'payment % keeps its provider payment id', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status <> OLD.status AND (old_rank = 4 OR new_rank <= old_rank) THEN
    RAISE EXCEPTION 'payment % may not move from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."payment_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "payments_guard" BEFORE UPDATE ON "orders"."payments"
  FOR EACH ROW EXECUTE FUNCTION "orders"."payment_guard"();
--> statement-breakpoint
CREATE TRIGGER "payments_no_delete" BEFORE DELETE ON "orders"."payments"
  FOR EACH ROW EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "payments_no_truncate" BEFORE TRUNCATE ON "orders"."payments"
  FOR EACH STATEMENT EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
-- The worker's daily purge (gdpr-and-privacy.md: cart and abandoned checkout, 30 days): carts past
-- their expires_at (30 days after the last change) and checkouts started more than 30 days ago (an
-- order keeps its own copy of the lines). Zero arguments, SECURITY DEFINER: the worker role has no
-- DELETE on these tables. Returns how many carts and checkouts it deleted.
CREATE FUNCTION "orders"."purge_expired_carts"() RETURNS integer LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, orders, pg_temp AS $$
DECLARE
  carts_purged integer;
  checkouts_purged integer;
BEGIN
  DELETE FROM orders.carts WHERE expires_at < now();
  GET DIAGNOSTICS carts_purged = ROW_COUNT;
  DELETE FROM orders.checkouts WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS checkouts_purged = ROW_COUNT;
  RETURN carts_purged + checkouts_purged;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."purge_expired_carts"() FROM PUBLIC;
