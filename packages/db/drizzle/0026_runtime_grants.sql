-- igs-pharma#66 (D-036): the runtime roles' privileges as code. Generated from the manifest in
-- `packages/db/src/grants/` by `renderGrantsSql`; the tests compare the database with that manifest.
-- Idempotent: each schema is reset (PUBLIC, igs_app, igs_worker) and then granted exactly the manifest,
-- so it converges on a database that already has grants made by hand. No ALTER DEFAULT PRIVILEGES:
-- every later table grants itself in its own migration. Ends with an ownership/role assertion that only
-- reports (it never moves ownership). Custom migration (D-016).

REVOKE ALL ON SCHEMA "audit" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "audit" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "audit" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "audit" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
GRANT USAGE ON SCHEMA "audit" TO "igs_app";
--> statement-breakpoint
GRANT USAGE ON SCHEMA "audit" TO "igs_worker";
--> statement-breakpoint
GRANT SELECT, INSERT ON "audit"."events" TO "igs_app";
--> statement-breakpoint
GRANT SELECT ON "audit"."events" TO "igs_worker";
--> statement-breakpoint
GRANT SELECT, UPDATE ON "audit"."chain_head" TO "igs_app";
--> statement-breakpoint
GRANT SELECT ON "audit"."chain_head" TO "igs_worker";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "audit"."future_partitions"() TO "igs_app";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "audit"."future_partitions"() TO "igs_worker";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "audit"."maintain_partitions"() TO "igs_worker";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "catalog" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "catalog" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "catalog" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "catalog" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
GRANT USAGE ON SCHEMA "catalog" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "catalog"."brands" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "catalog"."categories" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "catalog"."products" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "catalog"."product_content" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "catalog"."product_categories" TO "igs_app";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "identity" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "identity" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "identity" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "identity" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
GRANT USAGE ON SCHEMA "identity" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "identity"."users" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "identity"."accounts" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "identity"."sessions" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "identity"."verifications" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "identity"."two_factors" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "identity"."passkeys" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "identity"."user_roles" TO "igs_app";
--> statement-breakpoint
GRANT SELECT ON "identity"."roles" TO "igs_app";
--> statement-breakpoint
GRANT SELECT ON "identity"."permissions" TO "igs_app";
--> statement-breakpoint
GRANT SELECT ON "identity"."role_permissions" TO "igs_app";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "inventory" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "inventory" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "inventory" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "inventory" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
GRANT USAGE ON SCHEMA "inventory" TO "igs_app";
--> statement-breakpoint
GRANT SELECT ON "inventory"."locations" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "inventory"."stock_movements" TO "igs_app";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "pricing" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "pricing" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "pricing" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "pricing" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
GRANT USAGE ON SCHEMA "pricing" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "pricing"."prices" TO "igs_app";
--> statement-breakpoint
GRANT SELECT ON "pricing"."vat_classes" TO "igs_app";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "privacy" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "privacy" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "privacy" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "privacy" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
GRANT USAGE ON SCHEMA "privacy" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "privacy"."consent_events" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "privacy"."dsr_events" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "privacy"."dsr_requests" TO "igs_app";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "system" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "system" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "system" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "system" FROM PUBLIC, "igs_app", "igs_worker";
--> statement-breakpoint
GRANT USAGE ON SCHEMA "system" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "system"."idempotency_keys" TO "igs_app";
--> statement-breakpoint
GRANT DELETE ON "system"."idempotency_keys" TO "igs_worker";
--> statement-breakpoint
GRANT INSERT ON "system"."outbox" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON "system"."outbox" TO "igs_worker";
--> statement-breakpoint
DO $$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(kind || ' ' || name || ' is owned by ' || owner, E'\n' ORDER BY kind, name)
    INTO offenders
  FROM (
    SELECT 'relation' AS kind, n.nspname || '.' || c.relname AS name, pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('audit', 'catalog', 'identity', 'inventory', 'pricing', 'privacy', 'system') AND pg_get_userbyid(c.relowner) IN ('igs_app', 'igs_worker')
    UNION ALL
    SELECT 'function', p.oid::regprocedure::text, pg_get_userbyid(p.proowner)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('audit', 'catalog', 'identity', 'inventory', 'pricing', 'privacy', 'system') AND pg_get_userbyid(p.proowner) IN ('igs_app', 'igs_worker')
    UNION ALL
    SELECT 'schema', n.nspname, pg_get_userbyid(n.nspowner)
      FROM pg_namespace n
      WHERE n.nspname IN ('audit', 'catalog', 'identity', 'inventory', 'pricing', 'privacy', 'system') AND pg_get_userbyid(n.nspowner) IN ('igs_app', 'igs_worker')
  ) owned;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION E'igs-pharma#66: the runtime roles must not own objects; the administrative role must. Offenders:\n%', offenders
      USING ERRCODE = '42501';
  END IF;

  -- the runtime roles, and whoever is a member of them, must be unprivileged login/group roles
  SELECT string_agg(r.rolname || ' (' || concat_ws(', ',
      CASE WHEN r.rolsuper THEN 'superuser' END,
      CASE WHEN r.rolcreaterole THEN 'CREATEROLE' END,
      CASE WHEN r.rolcreatedb THEN 'CREATEDB' END,
      CASE WHEN r.rolbypassrls THEN 'BYPASSRLS' END,
      CASE WHEN pg_has_role(r.oid, current_user, 'MEMBER') AND r.rolname <> current_user
        THEN 'member of the administrative role ' || current_user END) || ')',
    E'\n' ORDER BY r.rolname)
    INTO offenders
  FROM pg_roles r
  WHERE (r.rolname IN ('igs_app', 'igs_worker')
      OR r.oid IN (SELECT m.member FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE g.rolname IN ('igs_app', 'igs_worker')))
    AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls
      OR (pg_has_role(r.oid, current_user, 'MEMBER') AND r.rolname <> current_user));
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION E'igs-pharma#66: the runtime roles must be plain roles that are not superuser, CREATEROLE, CREATEDB, BYPASSRLS or members of the administrative role. Offenders:\n%', offenders
      USING ERRCODE = '42501';
  END IF;
END
$$;
