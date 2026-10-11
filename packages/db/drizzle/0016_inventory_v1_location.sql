-- igs-pharma#53: the one v1 location, with the fixed id DEFAULT_LOCATION_ID in
-- packages/modules/inventory/src/domain.ts, and the append-only stock ledger.
INSERT INTO "inventory"."locations" ("id", "name", "kind")
VALUES ('0192f000-0000-7000-8000-000000000001', 'Saint-Gilles pharmacy', 'pharmacy')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- On-hand is the sum of the movements: a movement is never changed or removed, a mistake is fixed
-- by a `correction` movement.
CREATE FUNCTION "inventory"."reject_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not allowed: the stock ledger is append-only', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "stock_movements_append_only_rows" BEFORE UPDATE OR DELETE ON "inventory"."stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "stock_movements_append_only_truncate" BEFORE TRUNCATE ON "inventory"."stock_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory"."reject_mutation"();
