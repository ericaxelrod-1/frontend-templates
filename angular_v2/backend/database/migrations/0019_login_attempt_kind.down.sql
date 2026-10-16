-- =============================================================================
-- 0019_login_attempt_kind.down.sql
--
-- Reverses `0019_login_attempt_kind.sql`. Order matters: the CHECK references
-- the column, so it goes first. Dropping the column would otherwise either fail
-- with a dependent-objects error or leave a constraint behind that names
-- something that no longer exists.
-- =============================================================================

ALTER TABLE public.login_attempts
  DROP CONSTRAINT IF EXISTS login_attempts_attempt_kind_check;

ALTER TABLE public.login_attempts
  DROP COLUMN IF EXISTS attempt_kind;

NOTIFY pgrst, 'reload schema';