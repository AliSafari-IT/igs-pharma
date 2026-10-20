-- igs-pharma#116 (D-045): the orders schema's runtime grants. igs_app reads and writes carts, creates
-- and moves orders (no DELETE; triggers keep lines and history), and only reads the status history.

DO $$
DECLARE
  offenders text;
BEGIN
  WITH RECURSIVE runtime(oid) AS (
    SELECT oid FROM pg_roles WHERE rolname IN ('igs_app', 'igs_worker')
    UNION
    SELECT m.member FROM pg_auth_members m JOIN runtime r ON m.roleid = r.oid
  )
  SELECT string_agg(kind || ' ' || name || ' is owned by ' || owner, E'\n' ORDER BY kind, name)
    INTO offenders
  FROM (
    SELECT 'relation' AS kind, n.nspname || '.' || c.relname AS name, pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('orders') AND c.relowner IN (SELECT oid FROM runtime)
    UNION ALL
    SELECT 'function', p.oid::regprocedure::text, pg_get_userbyid(p.proowner)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('orders') AND p.proowner IN (SELECT oid FROM runtime)
    UNION ALL
    SELECT 'schema', n.nspname, pg_get_userbyid(n.nspowner)
      FROM pg_namespace n
      WHERE n.nspname IN ('orders') AND n.nspowner IN (SELECT oid FROM runtime)
  ) owned;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION E'igs-pharma#66: the runtime roles (and their members) must not own objects; the administrative role must. Offenders:\n%', offenders
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
--> statement-breakpoint
GRANT USAGE ON SCHEMA "orders" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "orders"."carts" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "orders"."cart_lines" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "orders"."orders" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "orders"."order_lines" TO "igs_app";
--> statement-breakpoint
GRANT SELECT ON "orders"."order_events" TO "igs_app";
