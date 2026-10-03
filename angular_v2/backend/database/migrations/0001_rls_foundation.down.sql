-- W26 — rollback for 0001_rls_foundation.sql. See the DOWN section in the
-- migration for why roles are not reversed here.
-- DESTRUCTIVE: tenant rows do not come back.
--
-- Kept as a psql script rather than folded into the migration above, because the
-- migration is also the file a runner applies forward and must stay append-only.
-- Apply with:  psql -v ON_ERROR_STOP=1 -d <db> -f 0001_rls_foundation.down.sql
--
-- This is destructive and irreversible. That is inherent in down() for a schema
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
-- (pgrst_authenticator is shared across databases: drop it only when the last
-- database using it is gone.)

-- ORDER IS THE WHOLE OF THIS FILE, and the dependency that dictates it is not
-- obvious. Verified: dropping the closure first fails with
--   cannot drop materialized view authz.org_closure because other objects depend on it
--   DETAIL: policy row_scope on table projects depends on ...
-- A policy is a dependent object, so the policies come off first, then the functions
-- that read the closure, then the closure itself, and only then the tables.

DROP POLICY IF EXISTS row_scope ON projects;
DROP POLICY IF EXISTS row_scope ON customers;
DROP POLICY IF EXISTS row_scope ON groups;
DROP POLICY IF EXISTS row_scope ON user_groups;

-- Triggers before their functions, so a partial rollback fails on the object that is
-- actually wrong rather than on a cascade.
DROP TRIGGER IF EXISTS groups_refresh_closure ON groups;
DROP TRIGGER IF EXISTS groups_no_cycle ON groups;
DROP TRIGGER IF EXISTS roles_no_cycle ON roles;
DROP TRIGGER IF EXISTS groups_no_system_row ON groups;
DROP TRIGGER IF EXISTS roles_no_system_row ON roles;

DROP FUNCTION IF EXISTS refresh_org_closure();
DROP FUNCTION IF EXISTS authz.visible_group_ids();
DROP FUNCTION IF EXISTS assert_group_acyclic();
DROP FUNCTION IF EXISTS assert_role_acyclic();
DROP FUNCTION IF EXISTS protect_system_row();
DROP FUNCTION IF EXISTS has_permission(uuid, text, text);
DROP FUNCTION IF EXISTS authz.actor();

DROP MATERIALIZED VIEW IF EXISTS authz.org_closure;

-- The table order is a second dependency, and the same shape: membership carries a
-- foreign key to the hierarchy, so `groups` cannot go before `user_groups`.
-- Verified: `constraint user_groups_group_id_fkey on table user_groups depends on
-- table groups`. Children before parents, in both hierarchies.
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS user_groups;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS actions;

-- The `authz` schema goes with it.
--
-- WHAT THIS LEAVES BEHIND ON SCHEMA `public`, stated rather than discovered later:
--
--   * USAGE on schema `public` stays revoked for PUBLIC unless the statement at the
--     end of this file restores it, which it does. The per-role USAGE grants
--     (app_anon, app_member, app_admin, pgrst_authenticator) necessarily stay — they
--     were not revoked by this migration, only created.
--
-- CORRECTION TO THE RECORD. An earlier revision of this file asserted the opposite
-- of what follows: that `GRANT USAGE ON SCHEMA public TO PUBLIC` "does NOT put it
-- back: it reports `WARNING: no privileges were granted for "public"` and leaves the
-- ACL unchanged. Verified twice." That measurement is REFUTED on PostgreSQL 15.19 —
-- the grant applies, emits no warning, and `has_schema_privilege` flips from `false`
-- to `true`. Re-measured rather than argued: the statement runs, psql is silent, and
-- the privilege check before and after the revert reads `false` then `true`.
--
-- The claim that produced the old text was almost certainly the PostgreSQL 15
-- behaviour where PUBLIC already holds the privilege implicitly and the grant is
-- reported as redundant. That is a different situation from this one: here the
-- migration REVOKEs from PUBLIC, so the grant is a real change and is applied.
GRANT USAGE ON SCHEMA public TO PUBLIC;
--
--   * Nothing in the design needs PUBLIC's schema USAGE: every role that reaches the
--     database holds an explicit grant, the owner owns the schema, and a superuser
--     bypasses the check. The restore above is therefore returning the cluster to its
--     pre-migration state, not granting anything new.
DROP SCHEMA IF EXISTS authz;