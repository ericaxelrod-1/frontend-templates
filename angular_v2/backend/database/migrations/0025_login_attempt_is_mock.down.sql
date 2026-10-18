-- =============================================================================
-- 0025_login_attempt_is_mock.down.sql
--
-- Reverses `0025_login_attempt_is_mock.sql`: drops the index and the column.
--
-- The index goes first because dropping the column drops the index with it, and
-- naming it makes the intent legible rather than leaving the drop to happen
-- implicitly.
--
-- The column is dropped even though it holds information: reverting it removes
-- the ability to tell a synthetic attempt from a real one, which is what the
-- admin pages' default filter depends on. A down that left the column in place
-- would be a partial revert of a migration the tree records as applied.
-- =============================================================================

DROP INDEX IF EXISTS public.login_attempts_is_mock_idx;

ALTER TABLE public.login_attempts
  DROP COLUMN IF EXISTS is_mock;

NOTIFY pgrst, 'reload schema';
