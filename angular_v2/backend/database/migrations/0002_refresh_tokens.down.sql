-- W11 slice 1 — rollback for 0002_refresh_tokens.sql.
-- DESTRUCTIVE: refresh tokens and login attempts do not come back.
--
-- Kept as a psql script rather than folded into the migration above, because
-- the migration is the file a runner applies forward and must stay append-only.
-- Apply with:  psql -v ON_ERROR_STOP=1 -d <db> -f 0002_refresh_tokens.down.sql
--
-- Tables and grants are dropped together, so no grant state is left behind;
-- the up revoked PUBLIC/app_anon/app_member/app_admin before granting to
-- app_admin, and dropping the table drops every grant on it.

DROP POLICY IF EXISTS row_scope ON public.refresh_tokens;
DROP POLICY IF EXISTS row_scope ON public.login_attempts;
DROP POLICY IF EXISTS row_scope ON public.users;

DROP TABLE IF EXISTS public.refresh_tokens;
DROP TABLE IF EXISTS public.login_attempts;

-- users was claimed (created + disciplined) by the migration only on fresh
-- databases. On a pre-existing database the table is the seed's and out of
-- the migration's ownership — leaving it alone is both the safe and the
-- honest down: that is where the seed put it, and that is where the seed's
-- own GRANT ALL still stands.
DO $$
DECLARE
  owner_name text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO owner_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'users' AND n.nspname = 'public';

  IF owner_name = current_user THEN
    DROP TABLE IF EXISTS public.users;
  ELSE
    RAISE NOTICE 'users table left in place: owned by %, not the migration role', owner_name;
  END IF;
END
$$;
