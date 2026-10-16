-- =============================================================================
-- 0020_users_email_verified_at.down.sql
--
-- Removes `users.email_verified_at`.
--
-- WHAT THIS DESTROYS, WHICH IS WHY IT IS NOT ROUTINE
--
-- The column is the ONLY record that an address was ever confirmed. Dropping it
-- leaves every verified account indistinguishable from one that was never
-- verified — and because nothing in the application reads the column, no test in
-- this repository will go red to say so. There is no way to recover the value: the
-- `email_verification` tokens that would have carried the evidence are single-use
-- and already consumed.
--
-- So this reverts a record, not a mechanism, and it is not safe to run on a
-- database that has verified addresses in it.
-- =============================================================================

ALTER TABLE public.users
  DROP COLUMN IF EXISTS email_verified_at;

NOTIFY pgrst, 'reload schema';