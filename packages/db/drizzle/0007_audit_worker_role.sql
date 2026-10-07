-- T-006b (architect Q3 + R1): the daily partition job must not need a DDL credential in the worker,
-- and the grant must give the worker EXACTLY the daily action, nothing parametric.
--
-- `audit.ensure_partitions(integer, date)` stays SECURITY INVOKER and executable only by its owner
-- (as after 0006): it is the testable workhorse. The worker gets a zero-argument SECURITY DEFINER
-- wrapper, `audit.maintain_partitions()`, which calls it with fixed arguments (3 months ahead, from
-- now): no `from_month`, no `months_ahead` for the caller to choose. Custom migration; `meta/` from
-- `drizzle-kit generate --custom` (D-016). `igs_app` (web / platform) cannot execute it (42501).

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
-- A new name, not an overload: `ensure_partitions(3)` would become ambiguous against the defaulted
-- two-argument form. pg_temp goes LAST in the search_path (definer-function hardening); TimeZone
-- is pinned like every audit function (0006).
CREATE FUNCTION "audit"."maintain_partitions"() RETURNS integer LANGUAGE sql
  SECURITY DEFINER SET search_path = pg_catalog, audit, pg_temp SET TimeZone = 'UTC' AS $$
  SELECT audit.ensure_partitions(3, NULL)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "audit"."maintain_partitions"() FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "audit" TO "igs_worker";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "audit"."maintain_partitions"() TO "igs_worker";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "audit"."future_partitions"() TO "igs_worker";
--> statement-breakpoint
-- the verify job reads the chain (it runs with the app role's grants plus these)
GRANT SELECT ON "audit"."events" TO "igs_worker";
--> statement-breakpoint
GRANT SELECT ON "audit"."chain_head" TO "igs_worker";
