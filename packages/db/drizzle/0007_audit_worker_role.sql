-- T-006b (architect Q3): the daily partition job must not need a DDL credential in the worker.
-- Instead of a second connection with CREATE rights, `audit.ensure_partitions` becomes a narrow
-- SECURITY DEFINER function owned by the migrator (who owns audit.events), executable only by the
-- worker role. Custom migration; `meta/` from `drizzle-kit generate --custom` (D-016).
--
-- What a caller can do with it is bounded: months_ahead is limited to 0..24 inside the function,
-- it only creates monthly partitions of audit.events, and the partitions stay owned by the owner.
-- `igs_app` (web / platform) still cannot execute it (42501).

DO $$
BEGIN
  -- worker role (NOLOGIN group); additive to igs_app: B-08 makes the worker's login role a member
  -- of both. The production role mapping is B-08.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'igs_worker') THEN
    CREATE ROLE "igs_worker" NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- search_path last-entry hardening for definer functions: pg_temp goes LAST so a caller cannot
-- shadow pg_catalog / audit objects with temporary ones. TimeZone = 'UTC' (0006) is kept.
ALTER FUNCTION "audit"."ensure_partitions"(integer, date)
  SECURITY DEFINER SET search_path = pg_catalog, audit, pg_temp;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "audit"."ensure_partitions"(integer, date) FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "audit" TO "igs_worker";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "audit"."ensure_partitions"(integer, date) TO "igs_worker";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "audit"."future_partitions"() TO "igs_worker";
--> statement-breakpoint
-- the verify job reads the chain (it runs with the app role's grants plus these)
GRANT SELECT ON "audit"."events" TO "igs_worker";
--> statement-breakpoint
GRANT SELECT ON "audit"."chain_head" TO "igs_worker";
