-- W11 slice 1 — refresh tokens and login-attempt recording.
-- Target: PostgreSQL 15+, verified on 15.19.
--
-- Apply as the migration/owner role (`app`), the same way 0001 is applied.
--
-- ROLES ARE NOT HERE. CREATE ROLE needs CREATEROLE, so roles live in
-- database/bootstrap/001_roles.sql and run once as a superuser (AGENTS.md §B1).
--
-- `users` is created out-of-band (database/seed.ts, as the superuser) and is
-- NOT part of this chain — that is a gap, but a migration cannot claim a table
-- the migration role does not own. The two tables here are created as `app`,
-- so they take the full discipline: ENABLE + FORCE, one total policy, grants
-- that discriminate on current_user.

-- =============================================================================
-- users — created here so the FK below can terminate at it.
--
-- The W26 note in seed.ts says the auth tables were "deferred until W11"; this
-- is the deferral resolving. On a fresh database the migration role (`app`)
-- owns it, and so the full discipline applies. On the pre-existing dev
-- database (app_dev) the table predates the migration and is owned by
-- `postgres` — the migration role cannot claim it, so the RLS block below
-- skips with a WARNING that names the residual instead of failing or
-- silently pretending the table is disciplined. The FK itself is created
-- either way: a foreign key constraint is metadata, and the owner check
-- guards only the privilege statements.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  email         text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  owner_name text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO owner_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'users' AND n.nspname = 'public';

  IF owner_name = current_user THEN
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS row_scope ON public.users;
    CREATE POLICY row_scope ON public.users USING (current_user = 'app_admin');

    REVOKE ALL ON public.users FROM PUBLIC, app_anon, app_member, app_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO app_admin;

    RAISE NOTICE 'users table disciplined by 0002 (owner is the migration role)';
  ELSE
    RAISE WARNING 'users table is owned by %, not the migration role — RLS left in the pre-existing state; recreate the database to claim it', owner_name;
  END IF;
END
$$;

-- =============================================================================
-- refresh_tokens — UNSCOPED. No group_id on the key, no FK carrying one.
-- `users` is the same class: identity is global reference data, and its owner
-- bypassing RLS is the risk FORCE exists for. The raw token is NEVER stored;
-- only its SHA-256 hash. The access token's jti links the row to the access
-- token lifetime.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users (id),
  jti        text NOT NULL UNIQUE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_to uuid REFERENCES public.refresh_tokens (id)
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON public.refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_jti_idx ON public.refresh_tokens (jti);

-- =============================================================================
-- login_attempts — UNSCOPED. One row per login POST, pass or fail.
-- security.md: "A wrong password creates a `login_attempt` row with
-- `status: 'failed'`". The table did not exist anywhere in the tree, so the
-- claim was unimplementable; slice 1 makes it real. The security stack that
-- counts and throttles on these rows (W13) is a later slice.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username   text NOT NULL,
  ip         text,
  status     text NOT NULL CHECK (status IN ('failed', 'succeeded')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_username_idx ON public.login_attempts (username);

-- =============================================================================
-- ROW-LEVEL SECURITY — ENABLE + FORCE, the same posture as projects/customers.
-- A table owner bypasses its own policies and nothing errors, so FORCE binds
-- the owner here too. The only role that may read or write these rows at
-- runtime is app_admin, reached through pgrst_authenticator + SET LOCAL ROLE
-- app_admin (the server-side login path). app_anon and app_member are denied
-- by both the grants below and the policy.
-- =============================================================================

ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts FORCE ROW LEVEL SECURITY;

-- ONE policy per table, keyed on current_user — never a token field. The
-- server's write path sets the Postgres role to app_admin, which is the only
-- branch that admits. A caller with no role or any other role gets zero rows;
-- the denied case is indistinguishable from "no such row", which is the point.
DROP POLICY IF EXISTS row_scope ON public.refresh_tokens;
CREATE POLICY row_scope ON public.refresh_tokens USING (current_user = 'app_admin');

DROP POLICY IF EXISTS row_scope ON public.login_attempts;
CREATE POLICY row_scope ON public.login_attempts USING (current_user = 'app_admin');

-- =============================================================================
-- GRANTS — REVOKE ALL first, then the verbs, then nothing else.
-- app_admin gets exactly what the server-side path needs: read, insert, and
-- update (for rotation/revocation, slice 2) on refresh_tokens; insert and
-- read on login_attempts. No DELETE — nothing in slice 1 deletes, and the
-- down script drops the table wholesale. app_anon and app_member get NOTHING.
-- =============================================================================

REVOKE ALL ON public.refresh_tokens, public.login_attempts FROM PUBLIC, app_anon, app_member, app_admin;

GRANT SELECT, INSERT, UPDATE ON public.refresh_tokens TO app_admin;
GRANT SELECT, INSERT ON public.login_attempts TO app_admin;

-- The authenticator needs schema usage (granted by 0001) and nothing on these
-- tables directly: its access is always through SET ROLE.

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0002_refresh_tokens.down.sql. Kept as a separate
-- file so this one stays append-only, exactly as in 0001.
