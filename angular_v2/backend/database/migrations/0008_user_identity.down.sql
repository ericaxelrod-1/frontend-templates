-- Rollback for 0008_user_identity.sql.
--
-- Restores the state 0002 left behind, in full:
--   * both foreign keys dropped;
--   * the four per-verb policies dropped and 0002's single `row_scope` recreated;
--   * `authz.can_read_user()` dropped;
--   * the grants returned to admin-only, so a member can no longer read `users`
--     at all and the column-restricted grant is gone with them.
--
-- Kept as a psql script rather than folded into the migration above, because the
-- migration is also the file a runner applies forward and must stay append-only.
-- Apply with:  psql -v ON_ERROR_STOP=1 -d <db> -f 0008_user_identity.down.sql

-- The constraints first, so the policy and grant statements below are not
-- evaluated against a schema whose membership tables have already changed shape.
ALTER TABLE public.user_roles  DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;
ALTER TABLE public.user_groups DROP CONSTRAINT IF EXISTS user_groups_user_id_fkey;

-- The grants first, then the policies: dropping a policy while a caller still
-- holds the column grant would leave a window in which the grant is live and the
-- policy is gone — which, with FORCE, reads as zero rows rather than as a leak,
-- but for the wrong reason.
REVOKE ALL ON public.users FROM PUBLIC, app_anon, app_member, app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO app_admin;

DROP POLICY IF EXISTS users_read_scope ON public.users;
DROP POLICY IF EXISTS users_insert      ON public.users;
DROP POLICY IF EXISTS users_update      ON public.users;
DROP POLICY IF EXISTS users_delete      ON public.users;

-- 0002's exact policy: one `FOR ALL` keyed on `current_user`, no `WITH CHECK`.
DROP POLICY IF EXISTS row_scope ON public.users;
CREATE POLICY row_scope ON public.users USING (current_user = 'app_admin');

DROP FUNCTION IF EXISTS authz.can_read_user();

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- WHAT A ROLLBACK COSTS — READ BEFORE RUNNING THIS
-- =============================================================================
-- This script is a true reversal of 0008 and nothing else. That is exactly why it
-- must not be run casually once an inactivity purge exists:
--
--   * Dropping `user_roles_user_id_fkey` and `user_groups_user_id_fkey` re-opens
--     both orphan paths. A purge that deletes `users` rows will then leave the
--     principal's role rows and membership rows behind. `has_permission()` keeps
--     resolving that user's capabilities from the orphaned `user_roles` rows, and
--     `authz.visible_user_ids()` keeps returning the purged user to every caller
--     who shared a group — so a deleted account KEEPS ITS AUTHORITY, and its
--     `email_messages` history stays readable by its former colleagues. The purge
--     reports success while none of that happened.
--   * It also re-opens the INSERT side, which is not about deletion at all: with
--     the key gone, a membership row may again name a `user_id` that does not
--     exist, and that row is invisible to every query that resolves scope through
--     a real user.
--
-- So: if a purge feature has landed, roll this back only together with that
-- feature. Verify the rollback from the catalog —
--
--   SELECT conname FROM pg_constraint
--    WHERE conname IN ('user_roles_user_id_fkey', 'user_groups_user_id_fkey');
--
-- — returning zero rows is the check, and a `migration:revert` exit code is not:
-- it reports that the script ran, not that the consequence was acceptable.