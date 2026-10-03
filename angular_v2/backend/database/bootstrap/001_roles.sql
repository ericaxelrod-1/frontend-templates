-- W26 — role bootstrap. RUN ONCE, AS A SUPERUSER, against the target database.
--
-- Why this is not a migration: `CREATE ROLE` needs CREATEROLE, which is a
-- cluster-level privilege. A migration runner connects as an ordinary role and
-- cannot create roles — verified, it fails with "permission denied to create
-- role". Roles are also cluster-scoped while migrations are database-scoped, so
-- putting them in the migration chain would make a migration's meaning depend on
-- which cluster it ran against.
--
-- Four roles, and the list is the design:
--
--   app_anon          unauthenticated requests (PostgREST's db-anon-role)
--   app_member        an authenticated, capability-checked principal
--   app_admin         the superset principal — more of everything, never a bypass
--   pgrst_authenticator  the ONLY role PostgREST ever logs in as
--
-- The migration/owner role (DB_USER in backend/.env) is deliberately NOT created
-- here: it needs a LOGIN credential, which must never be committed, and it is a
-- deployment-specific identity rather than part of the design. The migration
-- asserts that it exists and owns the schema, and fails loudly if it does not.
--
-- Every role is NOSUPERUSER NOBYPASSRLS. This is not decoration:
-- FORCE ROW LEVEL SECURITY does not bind a superuser or a BYPASSRLS role, so
-- these attributes are the only thing standing between a serving role and every
-- row in the database. Verified — a postgres session read 5 of 5 rows from a
-- table that had ENABLE + FORCE + a working policy. Asserted by the test suite,
-- not assumed here.
--
-- Idempotent: safe to re-run. The DO block below exists because plain
-- `CREATE ROLE` is NOT idempotent — verified, a second run aborts with
-- `role "app_member" already exists` and, because psql continues past an error
-- by default, still exits 0. That is a fail-open in a security file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_anon') THEN
    CREATE ROLE app_anon NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_member') THEN
    CREATE ROLE app_member NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;

  -- The single role PostgREST connects as. It is granted ONLY the three app roles
  -- below, and that grant — nothing else — is the privilege-escalation boundary.
  -- A token naming any other role is refused by Postgres with 403.
  --
  -- It is LOGIN because PostgREST authenticates with a login role; a NOLOGIN
  -- authenticator makes PostgREST unable to serve at all (verified). It owns
  -- nothing and bypasses nothing. The password is set out of band from
  -- PGRST_DB_URI, never committed here.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgrst_authenticator') THEN
    CREATE ROLE pgrst_authenticator LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- The escalation boundary itself. It lives here, not in the migration, because
-- `GRANT <role> TO <role>` requires ADMIN OPTION on every role granted — verified:
-- running it as the migration role fails with
-- `must have admin option on role "app_anon"`. Only a superuser can build the
-- grant chain, so the one statement that IS the security boundary is a superuser
-- statement. Only these three roles are reachable from a token; every other role
-- in the cluster, including the table owner, is refused by Postgres.
GRANT app_anon, app_member, app_admin TO pgrst_authenticator;

-- Assert the boundary is in place rather than assuming it. Without this the
-- absence of the GRANT surfaces much later as
-- `permission denied to set role "app_admin"` from an unrelated-looking place,
-- and the suite reports a fixture error instead of naming the missing control.
DO $$
DECLARE
  reachable text;
  missing   text;
BEGIN
  SELECT string_agg(granted.rolname, ', ' ORDER BY granted.rolname)
    INTO reachable
    FROM pg_auth_members membership
    JOIN pg_roles member ON member.oid = membership.member
    JOIN pg_roles granted ON granted.oid = membership.roleid
   WHERE member.rolname = 'pgrst_authenticator'
     AND granted.rolname IN ('app_anon', 'app_member', 'app_admin');

  IF reachable IS DISTINCT FROM 'app_admin, app_anon, app_member' THEN
    RAISE EXCEPTION
      'escalation boundary is wrong: pgrst_authenticator reaches [%], expected [app_admin, app_anon, app_member]', coalesce(reachable, 'nothing');
  END IF;

  -- The reverse direction: an ALLOW list is only an allow list if nothing else
  -- is reachable either. `REVOKE <role> FROM pgrst_authenticator` is the
  -- rejected alternative — a per-role denylist, bypassed by any role not yet
  -- revoked — so the assertion here is that the member set is exactly three.
  SELECT string_agg(granted.rolname, ', ' ORDER BY granted.rolname)
    INTO missing
    FROM pg_auth_members membership
    JOIN pg_roles member ON member.oid = membership.member
    JOIN pg_roles granted ON granted.oid = membership.roleid
   WHERE member.rolname = 'pgrst_authenticator'
     AND granted.rolname NOT IN ('app_anon', 'app_member', 'app_admin');

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'escalation boundary is too wide: pgrst_authenticator also reaches [%], which no token may assume', missing;
  END IF;
END
$$;

\echo 'roles created and the escalation boundary granted. Per-database object grants are applied by database/migrations/0001_rls_foundation.sql'