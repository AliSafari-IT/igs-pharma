CREATE TABLE "privacy"."retention_policy" (
	"key" text PRIMARY KEY NOT NULL,
	"months" integer,
	"awaits_adviser" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_policy_key_check" CHECK (key IN ('consent_after_withdrawal', 'dsr_after_close')),
	CONSTRAINT "retention_policy_months_check" CHECK ("privacy"."retention_policy"."months" IS NULL OR "privacy"."retention_policy"."months" >= 0)
);
--> statement-breakpoint
-- igs-pharma#88: the retention mechanism. The values below are PLACEHOLDERS that await the privacy
-- adviser and the owner (`awaits_adviser`); `NULL` months means keep, never purge. They equal
-- RETENTION_DEFAULTS in packages/modules/privacy/src/domain.ts (a test keeps the two in step).
INSERT INTO "privacy"."retention_policy" ("key", "months", "awaits_adviser") VALUES
  ('consent_after_withdrawal', 60, true),
  ('dsr_after_close', NULL, true);
--> statement-breakpoint
-- The append-only guard of the privacy ledgers (0020) gains ONE exception: a row DELETE made by the
-- purge function. It needs BOTH the transaction-local flag `privacy.purge` (set by
-- `privacy.purge_expired_data()` and reset before it returns) AND `current_user` = the owner of the
-- table, which is what a SECURITY DEFINER function runs as. A runtime role that sets the flag itself
-- is still refused (its current_user is not the owner, and it has no DELETE grant anyway); UPDATE and
-- TRUNCATE stay refused for everyone; no trigger is ever disabled.
CREATE OR REPLACE FUNCTION "privacy"."reject_mutation"() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND TG_LEVEL = 'ROW'
     AND coalesce(current_setting('privacy.purge', true), 'off') = 'on'
     AND current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID)
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% on %.% is not allowed: the privacy ledger is append-only', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
-- The retention purge: zero arguments, SECURITY DEFINER, owned by the migrator role, no EXECUTE for
-- PUBLIC (the grants migration gives it to the worker role only). It reads the policy table, so no
-- number lives here and the worker, which cannot write the table, cannot shorten retention. Months
-- are calendar months on the Europe/Brussels calendar (TimeZone pinned).
--  * consent: a (subject_ref, purpose) chain whose LATEST event is a withdrawal older than
--    consent_after_withdrawal months is deleted entirely; a chain whose latest event is a grant never is.
--  * dsr: a request in a final status, closed longer ago than dsr_after_close months, is deleted
--    with its events (events first: the foreign key restricts); open requests never. NULL = keep.
CREATE FUNCTION "privacy"."purge_expired_data"()
  RETURNS TABLE (consent_events integer, dsr_requests integer, dsr_events integer)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, privacy, pg_temp SET TimeZone = 'Europe/Brussels' AS $$
DECLARE
  consent_months integer;
  dsr_months integer;
  n_consent integer := 0;
  n_requests integer := 0;
  n_events integer := 0;
  due_ids uuid[];
BEGIN
  SELECT p.months INTO consent_months FROM privacy.retention_policy p WHERE p.key = 'consent_after_withdrawal';
  SELECT p.months INTO dsr_months FROM privacy.retention_policy p WHERE p.key = 'dsr_after_close';
  PERFORM set_config('privacy.purge', 'on', true);

  IF consent_months IS NOT NULL THEN
    WITH latest AS (
      SELECT DISTINCT ON (e.subject_ref, e.purpose) e.subject_ref, e.purpose, e.granted, e.at
      FROM privacy.consent_events e
      ORDER BY e.subject_ref, e.purpose, e.at DESC, e.id DESC
    ), due AS (
      SELECT l.subject_ref, l.purpose FROM latest l
      WHERE NOT l.granted AND l.at + make_interval(months => consent_months) < now()
    ), gone AS (
      DELETE FROM privacy.consent_events e USING due d
      WHERE e.subject_ref = d.subject_ref AND e.purpose = d.purpose
      RETURNING 1
    )
    SELECT count(*)::integer INTO n_consent FROM gone;
  END IF;

  IF dsr_months IS NOT NULL THEN
    SELECT array_agg(r.id) INTO due_ids FROM privacy.dsr_requests r
    WHERE r.status IN ('completed', 'rejected') AND r.closed_at IS NOT NULL
      AND r.closed_at + make_interval(months => dsr_months) < now();
    IF due_ids IS NOT NULL THEN
      DELETE FROM privacy.dsr_events WHERE request_id = ANY (due_ids);
      GET DIAGNOSTICS n_events = ROW_COUNT;
      DELETE FROM privacy.dsr_requests WHERE id = ANY (due_ids);
      GET DIAGNOSTICS n_requests = ROW_COUNT;
    END IF;
  END IF;

  PERFORM set_config('privacy.purge', 'off', true);
  RETURN QUERY SELECT n_consent, n_requests, n_events;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "privacy"."purge_expired_data"() FROM PUBLIC;
--> statement-breakpoint
-- The expired import plans (#84): a stock-file preview is valid for one hour; this deletes it 24
-- hours after it expired. No personal data in a plan, so the grace is a constant, not policy.
CREATE FUNCTION "inventory"."purge_expired_import_plans"() RETURNS integer LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, inventory, pg_temp AS $$
DECLARE
  purged integer;
BEGIN
  DELETE FROM inventory.import_plans WHERE expires_at < now() - interval '24 hours';
  GET DIAGNOSTICS purged = ROW_COUNT;
  RETURN purged;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "inventory"."purge_expired_import_plans"() FROM PUBLIC;
