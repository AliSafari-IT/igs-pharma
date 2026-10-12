-- igs-pharma#58: the consent ledger and the request timelines are append-only. The current consent
-- is the latest event and a request's history is never rewritten: a mistake is fixed by a new event.
CREATE FUNCTION "privacy"."reject_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not allowed: the privacy ledger is append-only', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "consent_events_append_only_rows" BEFORE UPDATE OR DELETE ON "privacy"."consent_events"
  FOR EACH ROW EXECUTE FUNCTION "privacy"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "consent_events_append_only_truncate" BEFORE TRUNCATE ON "privacy"."consent_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "privacy"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "dsr_events_append_only_rows" BEFORE UPDATE OR DELETE ON "privacy"."dsr_events"
  FOR EACH ROW EXECUTE FUNCTION "privacy"."reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "dsr_events_append_only_truncate" BEFORE TRUNCATE ON "privacy"."dsr_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "privacy"."reject_mutation"();
