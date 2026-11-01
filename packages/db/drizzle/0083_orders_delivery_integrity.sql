-- igs-pharma#202 (milestone 5.3, part 2): home delivery on an order, enforced by the database like the
-- rest of the order. The delivery fee is PART of the order's total (and its VAT part of the order's
-- VAT), so the match between an order and its lines now reads: total = lines + delivery fee. A
-- delivery order has an address and a pickup order has none. The delivery columns never change once
-- the order exists.

-- 1. totals: the lines plus the delivery fee (0 for a pickup order, so nothing changes for those).
CREATE OR REPLACE FUNCTION "orders"."order_lines_match"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  total := total + o.delivery_fee_cents;
  vat := vat + o.delivery_vat_cents;
  IF n = 0 OR total <> o.total_cents OR vat <> o.vat_cents OR medicine <> o.needs_review THEN
    RAISE EXCEPTION 'order % does not match its lines (lines %, total % vs %, VAT % vs %, medicine % vs %)',
      o.id, n, total, o.total_cents, vat, o.vat_cents, medicine, o.needs_review
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- 2. the delivery columns are fixed when the order is placed (same guard as 0049, with them added).
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
      NEW.currency, NEW.total_cents, NEW.vat_cents, NEW.delivery_method, NEW.delivery_fee_cents,
      NEW.delivery_vat_cents, NEW.created_by_type, NEW.created_by_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.reference, OLD.customer_id, OLD.checkout_id, OLD.locale, OLD.needs_review,
      OLD.currency, OLD.total_cents, OLD.vat_cents, OLD.delivery_method, OLD.delivery_fee_cents,
      OLD.delivery_vat_cents, OLD.created_by_type, OLD.created_by_id, OLD.created_at) THEN
    RAISE EXCEPTION 'order % keeps its reference, customer, checkout, locale, totals, delivery and creator', OLD.id
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
-- 3. a delivery order has an address and a pickup order has none. Checked when the order is created
-- (deferred, so the order and the address can be written in either order inside the transaction) and
-- when an address is added.
CREATE FUNCTION "orders"."order_address_match"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o orders.orders%ROWTYPE;
  addresses integer;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    SELECT * INTO o FROM orders.orders WHERE id = NEW.id;
  ELSE
    SELECT * INTO o FROM orders.orders WHERE id = NEW.order_id;
  END IF;
  SELECT count(*) INTO addresses FROM orders.order_addresses WHERE order_id = o.id;
  IF (o.delivery_method = 'delivery') <> (addresses = 1) OR addresses > 1 THEN
    RAISE EXCEPTION 'order % (%) has % delivery addresses: a delivery order has one, a pickup order none',
      o.id, o.delivery_method, addresses
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."order_address_match"() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "orders_address_match" AFTER INSERT ON "orders"."orders"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "orders"."order_address_match"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "order_addresses_match" AFTER INSERT ON "orders"."order_addresses"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "orders"."order_address_match"();
--> statement-breakpoint
-- 4. an address is kept with its order: no UPDATE or DELETE (like the lines).
CREATE TRIGGER "order_addresses_no_change" BEFORE UPDATE OR DELETE ON "orders"."order_addresses"
  FOR EACH ROW EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "order_addresses_no_truncate" BEFORE TRUNCATE ON "orders"."order_addresses"
  FOR EACH STATEMENT EXECUTE FUNCTION "orders"."reject_mutation"();
