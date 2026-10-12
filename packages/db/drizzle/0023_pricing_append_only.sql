-- igs-pharma#59: prices and VAT rates are append-only. A price change is a new row, so the table is
-- its own history ("who changed it, and when"); a VAT rate change is a new row with a later valid_from.
CREATE FUNCTION "pricing"."reject_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not allowed: prices are append-only', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "prices_append_only_rows" BEFORE UPDATE OR DELETE ON "pricing"."prices"
  FOR EACH ROW EXECUTE FUNCTION "pricing"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "prices_append_only_truncate" BEFORE TRUNCATE ON "pricing"."prices"
  FOR EACH STATEMENT EXECUTE FUNCTION "pricing"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "vat_classes_append_only_rows" BEFORE UPDATE OR DELETE ON "pricing"."vat_classes"
  FOR EACH ROW EXECUTE FUNCTION "pricing"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "vat_classes_append_only_truncate" BEFORE TRUNCATE ON "pricing"."vat_classes"
  FOR EACH STATEMENT EXECUTE FUNCTION "pricing"."reject_mutation"();
--> statement-breakpoint
-- The Belgian rates of the catalogue's VAT classes (catalog VAT_CLASSES), in basis points.
INSERT INTO "pricing"."vat_classes" ("code", "rate_bp", "valid_from") VALUES
  ('BE_6', 600, '2000-01-01T00:00:00Z'),
  ('BE_21', 2100, '2000-01-01T00:00:00Z');
