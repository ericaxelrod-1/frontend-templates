-- W07 — rollback for 0001_rls_foundation.sql. See the DOWN section in the
-- migration for why roles are not reversed here.
-- DESTRUCTIVE: customer rows do not come back.

-- Kept as a psql script rather than folded into the migration above, because the
-- migration is also the file a runner applies forward and must stay append-only.
-- Apply with:  psql -v ON_ERROR_STOP=1 -d <db> -f 0001_rls_foundation.down.sql
--
-- Drops the RLS layer and the schema. This is destructive and irreversible:
-- customer rows do not come back. That is inherent to down() for a schema
-- migration and is why the runner must never call it in response to a failed
-- apply — roll forward instead.
--
-- The role bootstrap in database/bootstrap/001_roles.sql is deliberately NOT
-- reversed here. Roles are cluster-scoped while this is database-scoped, so a
-- down() cannot clean them up, and dropping `app_member` would break any other
-- database on the cluster that uses it. Reverse it by hand:
--   REVOKE app_anon, app_member, app_admin FROM pgrst_authenticator;
--   DROP OWNED BY app_admin, app_member, app_anon;
--   DROP ROLE IF EXISTS app_admin, app_member, app_anon;
-- (app_migrator and pgrst_authenticator are shared across databases: drop them
-- only when the last database using them is gone.)

-- Policies first: DROP TABLE takes them with it, but doing it explicitly means a
-- partial rollback fails on the object that is actually wrong.
DROP POLICY IF EXISTS row_scope ON sites;
DROP POLICY IF EXISTS row_scope ON customers;
DROP POLICY IF EXISTS row_scope ON projects;

DROP FUNCTION IF EXISTS site_tree_ids(uuid);
DROP FUNCTION IF EXISTS claim_site_id();
DROP FUNCTION IF EXISTS request_claims();

DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS sites;
