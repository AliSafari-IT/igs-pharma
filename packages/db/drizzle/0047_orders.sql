CREATE SCHEMA "orders";
--> statement-breakpoint
CREATE TABLE "orders"."cart_lines" (
	"cart_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_lines_cart_id_product_id_pk" PRIMARY KEY("cart_id","product_id"),
	CONSTRAINT "cart_lines_quantity_check" CHECK ("orders"."cart_lines"."quantity" > 0 AND "orders"."cart_lines"."quantity" <= 100)
);
--> statement-breakpoint
CREATE TABLE "orders"."carts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text,
	"customer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "carts_token_hash_check" CHECK ("orders"."carts"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "carts_owner_check" CHECK (("orders"."carts"."token_hash" IS NULL) <> ("orders"."carts"."customer_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "orders"."order_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "order_events_from_status_check" CHECK ("orders"."order_events"."from_status" IS NULL OR from_status IN ('pending_payment', 'paid_stock_short', 'in_review', 'ready_to_prepare', 'preparing', 'ready_for_pickup', 'collected', 'cancelled', 'expired')),
	CONSTRAINT "order_events_to_status_check" CHECK (to_status IN ('pending_payment', 'paid_stock_short', 'in_review', 'ready_to_prepare', 'preparing', 'ready_for_pickup', 'collected', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "orders"."order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"cnk" text NOT NULL,
	"name" text NOT NULL,
	"is_medicine" boolean NOT NULL,
	"vat_class" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"line_total_cents" integer NOT NULL,
	"vat_cents" integer NOT NULL,
	CONSTRAINT "order_lines_cnk_check" CHECK ("orders"."order_lines"."cnk" ~ '^[0-9]{7}$'),
	CONSTRAINT "order_lines_vat_class_check" CHECK (vat_class IN ('BE_6', 'BE_21')),
	CONSTRAINT "order_lines_quantity_check" CHECK ("orders"."order_lines"."quantity" > 0 AND "orders"."order_lines"."quantity" <= 100),
	CONSTRAINT "order_lines_amounts_check" CHECK ("orders"."order_lines"."unit_price_cents" >= 0 AND "orders"."order_lines"."line_total_cents" = "orders"."order_lines"."quantity" * "orders"."order_lines"."unit_price_cents"
        AND "orders"."order_lines"."vat_cents" >= 0 AND "orders"."order_lines"."vat_cents" <= "orders"."order_lines"."line_total_cents")
);
--> statement-breakpoint
CREATE TABLE "orders"."orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid,
	"locale" text NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"needs_review" boolean NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"total_cents" integer NOT NULL,
	"vat_cents" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_type" text NOT NULL,
	"updated_by_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_reference_check" CHECK ("orders"."orders"."reference" ~ '^IGS-[0-9]{4}-[0-9]{6,}$'),
	CONSTRAINT "orders_locale_check" CHECK (locale IN ('nl', 'fr', 'de', 'en')),
	CONSTRAINT "orders_status_check" CHECK (status IN ('pending_payment', 'paid_stock_short', 'in_review', 'ready_to_prepare', 'preparing', 'ready_for_pickup', 'collected', 'cancelled', 'expired')),
	CONSTRAINT "orders_currency_check" CHECK (currency IN ('EUR')),
	CONSTRAINT "orders_totals_check" CHECK ("orders"."orders"."total_cents" >= 0 AND "orders"."orders"."vat_cents" >= 0 AND "orders"."orders"."vat_cents" <= "orders"."orders"."total_cents"),
	CONSTRAINT "orders_version_check" CHECK ("orders"."orders"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "orders"."cart_lines" ADD CONSTRAINT "cart_lines_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "orders"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "carts_token_hash_idx" ON "orders"."carts" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_customer_idx" ON "orders"."carts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "carts_expires_at_idx" ON "orders"."carts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "order_events_order_at_idx" ON "orders"."order_events" USING btree ("order_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_order_product_idx" ON "orders"."order_lines" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_reference_idx" ON "orders"."orders" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "orders_customer_created_idx" ON "orders"."orders" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "orders"."orders" USING btree ("status","created_at");--> statement-breakpoint
-- igs-pharma#116 (D-045): the order lifecycle, enforced by the database whoever writes. A new order
-- starts in pending_payment at version 1; every status change follows ORDER_TRANSITIONS in
-- packages/modules/orders/src/domain.ts (a test tries every pair against both); an order holding a
-- medicine (needs_review) reaches ready_to_prepare only from in_review, so it is never prepared
-- without a pharmacist; an order in an end state never changes; the identifying columns and the
-- totals never change; each update bumps version by exactly one.
CREATE FUNCTION "orders"."order_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF (NEW.id, NEW.reference, NEW.customer_id, NEW.locale, NEW.needs_review, NEW.currency,
      NEW.total_cents, NEW.vat_cents, NEW.created_by_type, NEW.created_by_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.reference, OLD.customer_id, OLD.locale, OLD.needs_review, OLD.currency,
      OLD.total_cents, OLD.vat_cents, OLD.created_by_type, OLD.created_by_id, OLD.created_at) THEN
    RAISE EXCEPTION 'order % keeps its reference, customer, locale, totals and creator', OLD.id
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
REVOKE ALL ON FUNCTION "orders"."order_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "orders_guard" BEFORE INSERT OR UPDATE ON "orders"."orders"
  FOR EACH ROW EXECUTE FUNCTION "orders"."order_guard"();
--> statement-breakpoint
-- The status history: one event when the order is created and one per status change, with who
-- changed it (the row's updated_by) and when (its updated_at). SECURITY DEFINER because the runtime
-- roles may only READ order_events: the history is written here and nowhere else. The id is a
-- UUIDv7 (D-003) built from the clock and a random v4.
CREATE FUNCTION "orders"."record_order_event"() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, orders, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NULL;
  END IF;
  INSERT INTO orders.order_events (id, order_id, from_status, to_status, actor_type, actor_id, at)
  VALUES (
    encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1), 'hex')::uuid,
    NEW.id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
    NEW.status,
    NEW.updated_by_type,
    NEW.updated_by_id,
    NEW.updated_at
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."record_order_event"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "orders_record_event" AFTER INSERT OR UPDATE OF "status" ON "orders"."orders"
  FOR EACH ROW EXECUTE FUNCTION "orders"."record_order_event"();
--> statement-breakpoint
-- Lines are written once, with their order, while it is pending_payment.
CREATE FUNCTION "orders"."order_line_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders.orders WHERE id = NEW.order_id AND status = 'pending_payment') THEN
    RAISE EXCEPTION 'order % takes lines only while it is pending_payment', NEW.order_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."order_line_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "order_lines_guard" BEFORE INSERT ON "orders"."order_lines"
  FOR EACH ROW EXECUTE FUNCTION "orders"."order_line_guard"();
--> statement-breakpoint
-- At COMMIT (deferred): an order has at least one line, its totals are the sums of its lines, and it
-- needs a review exactly when a line is a medicine. Checked when the order is created and again when
-- a line is added, so neither a missing line nor a late one gets through.
CREATE FUNCTION "orders"."order_lines_match"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o orders.orders%ROWTYPE;
  n integer;
  total bigint;
  vat bigint;
  medicine boolean;
BEGIN
  -- NEW is an order or a line: each branch reads only the field its table has
  IF TG_TABLE_NAME = 'orders' THEN
    SELECT * INTO o FROM orders.orders WHERE id = NEW.id;
  ELSE
    SELECT * INTO o FROM orders.orders WHERE id = NEW.order_id;
  END IF;
  SELECT count(*), coalesce(sum(line_total_cents), 0), coalesce(sum(vat_cents), 0), coalesce(bool_or(is_medicine), false)
    INTO n, total, vat, medicine
    FROM orders.order_lines WHERE order_id = o.id;
  IF n = 0 OR total <> o.total_cents OR vat <> o.vat_cents OR medicine <> o.needs_review THEN
    RAISE EXCEPTION 'order % does not match its lines (lines %, total % vs %, VAT % vs %, medicine % vs %)',
      o.id, n, total, o.total_cents, vat, o.vat_cents, medicine, o.needs_review
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."order_lines_match"() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "orders_lines_match" AFTER INSERT ON "orders"."orders"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "orders"."order_lines_match"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "order_lines_match" AFTER INSERT ON "orders"."order_lines"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "orders"."order_lines_match"();
--> statement-breakpoint
-- Orders, their lines and their history are kept: no DELETE or TRUNCATE for anyone, no UPDATE of a
-- line or an event.
CREATE FUNCTION "orders"."reject_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not allowed: orders are kept', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."reject_mutation"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "orders_no_delete" BEFORE DELETE ON "orders"."orders"
  FOR EACH ROW EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "orders_no_truncate" BEFORE TRUNCATE ON "orders"."orders"
  FOR EACH STATEMENT EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "order_lines_no_change" BEFORE UPDATE OR DELETE ON "orders"."order_lines"
  FOR EACH ROW EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "order_lines_no_truncate" BEFORE TRUNCATE ON "orders"."order_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "order_events_no_change" BEFORE UPDATE OR DELETE ON "orders"."order_events"
  FOR EACH ROW EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "order_events_no_truncate" BEFORE TRUNCATE ON "orders"."order_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "orders"."reject_mutation"();
