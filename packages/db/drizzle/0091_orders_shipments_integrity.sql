-- igs-pharma#202 (milestone 5.3, part 3): the database enforces the shipping states like the rest of
-- the order lifecycle.
--
-- * A pickup order takes the pickup states (ready_for_pickup, collected), a delivery order the
--   shipping ones (ready_to_ship → shipped → delivered | returned). delivered and returned are end
--   states, like collected.
-- * A delivery order is handed to the carrier (shipped) only with a parcel whose label exists
--   (shipments.status = 'created').
-- * A shipment belongs to a delivery order that is packed (ready_to_ship) when it is made; its status
--   moves forward only, its parcel id is set once, and it is never deleted.
-- * The shipped mail goes out only for a shipped order; a returned parcel's paid order may be refunded.

-- 1. the order lifecycle (the guard of 0083, with the shipping states and the per-method rule)
CREATE OR REPLACE FUNCTION "orders"."order_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending_payment' OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'order % starts in pending_payment at version 1', NEW.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('collected', 'delivered', 'returned', 'cancelled', 'expired') THEN
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
      OR (OLD.status = 'preparing' AND NEW.status IN ('ready_for_pickup', 'ready_to_ship', 'cancelled'))
      OR (OLD.status = 'ready_for_pickup' AND NEW.status IN ('collected', 'cancelled'))
      OR (OLD.status = 'ready_to_ship' AND NEW.status IN ('shipped', 'cancelled'))
      OR (OLD.status = 'shipped' AND NEW.status IN ('delivered', 'returned'))
    ) THEN
      RAISE EXCEPTION 'order % may not move from % to %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.status = 'ready_to_prepare' AND NEW.needs_review AND OLD.status <> 'in_review' THEN
      RAISE EXCEPTION 'order % holds a medicine: a pharmacist approves it before it is prepared', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF (NEW.delivery_method = 'pickup' AND NEW.status IN ('ready_to_ship', 'shipped', 'delivered', 'returned'))
       OR (NEW.delivery_method = 'delivery' AND NEW.status IN ('ready_for_pickup', 'collected')) THEN
      RAISE EXCEPTION 'order % (%) cannot take the state %', OLD.id, NEW.delivery_method, NEW.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.status = 'shipped' AND NOT EXISTS (
      SELECT 1 FROM "orders"."shipments" s WHERE s.order_id = NEW.id AND s.status = 'created'
    ) THEN
      RAISE EXCEPTION 'order % has no parcel with a label: it cannot be handed to the carrier', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- 2. a shipment: made for a packed delivery order, forward only, its parcel id set once
CREATE FUNCTION "orders"."shipment_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o orders.orders%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO o FROM "orders"."orders" WHERE id = NEW.order_id;
    IF o.delivery_method IS DISTINCT FROM 'delivery' OR o.status IS DISTINCT FROM 'ready_to_ship' THEN
      RAISE EXCEPTION 'shipment %: only a packed (ready_to_ship) delivery order gets a parcel', NEW.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.status <> 'requested' OR NEW.version <> 1 OR NEW.provider_parcel_id IS NOT NULL
       OR NEW.tracking_number IS NOT NULL OR NEW.tracking_url IS NOT NULL THEN
      RAISE EXCEPTION 'shipment % starts requested at version 1, without a parcel', NEW.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.order_id, NEW.provider, NEW.requested_at)
     IS DISTINCT FROM (OLD.id, OLD.order_id, OLD.provider, OLD.requested_at) THEN
    RAISE EXCEPTION 'shipment % keeps its order, provider and request time', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'shipment % is at version %: an update writes version %', OLD.id, OLD.version, OLD.version + 1
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.provider_parcel_id IS NOT NULL AND NEW.provider_parcel_id IS DISTINCT FROM OLD.provider_parcel_id THEN
    RAISE EXCEPTION 'shipment % keeps its parcel id', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'requested' AND NEW.status IN ('created', 'failed', 'cancel_requested'))
    OR (OLD.status = 'created' AND NEW.status = 'cancel_requested')
    OR (OLD.status = 'failed' AND NEW.status IN ('requested', 'cancel_requested'))
    OR (OLD.status = 'cancel_requested' AND NEW.status = 'cancelled')
  ) THEN
    RAISE EXCEPTION 'shipment % may not move from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'shipment % is cancelled and cannot change', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "orders"."shipment_guard"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "shipments_guard" BEFORE INSERT OR UPDATE ON "orders"."shipments"
  FOR EACH ROW EXECUTE FUNCTION "orders"."shipment_guard"();
--> statement-breakpoint
CREATE TRIGGER "shipments_no_delete" BEFORE DELETE ON "orders"."shipments"
  FOR EACH ROW EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "shipments_no_truncate" BEFORE TRUNCATE ON "orders"."shipments"
  FOR EACH STATEMENT EXECUTE FUNCTION "orders"."reject_mutation"();
--> statement-breakpoint
-- 3. the order mail guard of 0074, plus `shipped`: only for an order handed to the carrier
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
    WHEN 'shipped' THEN order_status = 'shipped'
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
-- 4. the refund guard of 0057: a returned parcel's paid order may be refunded too
CREATE OR REPLACE FUNCTION "orders"."refund_insert_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
      AND o.status IN ('cancelled', 'expired', 'returned')
  ) THEN
    RAISE EXCEPTION 'refund %: only the full amount of a paid payment of a closed order is refunded', NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
