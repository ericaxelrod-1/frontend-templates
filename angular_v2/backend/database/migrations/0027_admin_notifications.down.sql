-- =============================================================================
-- 0027_admin_notifications.down.sql
--
-- Reverses `0027_admin_notifications.sql`, and nothing else.
--
-- This migration CREATED one table, one trigger function and one trigger, and it
-- added grants to roles whose privileges on every other table it left exactly as it
-- found them. So the whole reversal is `DROP TABLE` plus the trigger, and there is
-- no grant block to re-issue — a member holds nothing on any table this migration
-- did not create, and an `app_admin` whose read of `users` this file would have
-- revoked is a rollback that breaks something else (see `0026_member_self_write.down.sql`
-- for the shape of a down script that DOES have to re-issue grants, and why the
-- difference matters: a down must restore the state it FOUND, not subtract one
-- statement from a block it no longer has in front of it).
--
-- Apply with:
--   psql -v ON_ERROR_STOP=1 -d <db> -f 0027_admin_notifications.down.sql
-- =============================================================================

-- THE TABLE FIRST, and that is deliberate rather than incidental.
--
-- `DROP TRIGGER ... ON public.admin_notifications` and `DROP TABLE public.admin_notifications`
-- are the same effect, because the trigger is an attribute of the table and goes
-- with it. The explicit `DROP TRIGGER` is written anyway for the same reason
-- `0011_privacy_purge_queue.down.sql` and its neighbours state it: a reader
-- checking whether the trigger function still has a caller should not have to
-- infer it, and a future migration that reuses the function name is then visibly
-- adding a caller rather than silently resurrecting one.
--
-- The FUNCTIONS go first of all, because `authz.touch_admin_notifications_updated_at()`
-- is dropped with the table's dependency graph in mind: dropping it explicitly
-- before the table makes the remaining drop unconditional, so a trigger this
-- script did not know about cannot turn the `DROP TABLE` into an error.
DROP TRIGGER IF EXISTS admin_notifications_touch_updated_at ON public.admin_notifications;

DROP FUNCTION IF EXISTS authz.touch_admin_notifications_updated_at();

DROP TABLE IF EXISTS public.admin_notifications;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- WHAT A ROLLBACK COSTS — READ BEFORE RUNNING THIS
-- =============================================================================
--
--   * IT REMOVES EVERY NOTIFICATION, dismissed ones included. There is no `status`
--     row left anywhere recording that a dismissal happened, because a dismissal
--     IS the row: `dismissed_at` on `admin_notifications` is the only record of it.
--     Re-applying 0027 after materialisation therefore starts from an empty panel,
--     and the next materialiser run re-raises every notification a user dismissed.
--     That is the resurrection this migration's design refuses, reachable the only
--     way it can be reached — by deleting the evidence.
--   * IT BREAKS THE `/admin/security-alerts` PANEL VISIBLY, which is the correct
--     direction: the page reads `admin_notifications` and nothing else, so it
--     answers "The database refused this read for the signed-in role (403)" rather
--     than rendering an empty list that reads like "there are no alerts".
--   * IT LEAVES `public.security_alerts` EXACTLY AS IT WAS. No alert row is
--     deleted, no acknowledgement is lost and no column is altered — the source
--     table is untouched by 0027 in both directions, which is what makes the
--     materialisation a rendering rather than a move. Every notification this
--     migration held can be rebuilt from the source by running the materialiser
--     again, which is the one thing about notifications that IS reproducible.
--
-- Verify the outcome from the catalog rather than from the exit code, which reports
-- only that the script ran:
--
--   SELECT to_regclass('public.admin_notifications') IS NULL AS table_gone;
--   SELECT has_table_privilege('app_member', 'public.admin_notifications', 'SELECT');
--     -- errors with "relation does not exist" once the table is gone, which is the
--     -- answer: the grant went with it, because the grant WAS an attribute of it.
--