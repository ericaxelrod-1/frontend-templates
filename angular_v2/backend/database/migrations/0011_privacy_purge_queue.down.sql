-- Rollback for 0011_privacy_purge_queue.sql.
--
-- Kept as a psql script rather than folded into the migration above, because the
-- migration is also the file a runner applies forward and must stay append-only.
-- Apply with:  psql -v ON_ERROR_STOP=1 -d <db> -f 0011_privacy_purge_queue.down.sql
--
-- ORDER IS THE SAME AS EVERY OTHER DOWN SCRIPT: the policy references the
-- helper, so the policy comes off first and the helper second. Dropping the table
-- while a policy names `authz.can_read_privacy_purge()` raises "cannot drop … because
-- other objects depend on it".

DROP POLICY IF EXISTS privacy_purge_read  ON public.privacy_purge_queue;
DROP POLICY IF EXISTS privacy_purge_write ON public.privacy_purge_queue;

DROP FUNCTION IF EXISTS authz.can_read_privacy_purge();

-- The table takes its three indexes with it. Dropping it takes every grant on it
-- with it as well, so no grant state is left behind.
DROP TABLE IF EXISTS public.privacy_purge_queue;

-- The capability rows, and the grants that pointed at them. The `role_permissions`
-- rows go BEFORE the `permissions` rows or the delete leaves a dangling reference.
DELETE FROM public.role_permissions
 WHERE permission_id IN (
   SELECT id FROM public.permissions WHERE resource = 'privacy_purge'
 );
DELETE FROM public.permissions WHERE resource = 'privacy_purge';

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- WHAT A ROLLBACK COSTS — READ BEFORE RUNNING THIS
-- =============================================================================
-- This script is a true reversal of 0011 and nothing else. That is exactly why
-- it must not be run casually on a database with a live retention surface:
--
--   * `DROP TABLE` DELETES THE RECORD THAT A PURGE WAS SCHEDULED. That record
--     is what makes a deletion accountable: after this, an operator cannot
--     answer "was this account ever queued for deletion, by what, and did it run"
--     — and the sweeper, which holds no table, fails every claim with
--     `relation "privacy_purge_queue" does not exist` rather than deleting
--     anything, so retention silently stops while every dashboard that reads the
--     queue reports nothing at all.
--   * It also removes the ONLY DOUBLE-SWEEP GUARD, the partial UNIQUE on
--     `(target_kind, COALESCE(target_id::text, target_ref))`. Any enqueue path
--     that survives the rollback can queue a target twice, and the second sweep
--     writes `rows_deleted = 0`, which an operator reads as a successful purge —
--     the success-shaped value §2.3 exists to forbid.
--   * Removing the `privacy_purge` permission rows revokes the capability axis
--     for the admin view. A client built against the regenerated spec gets
--     `42501` on the table rather than an empty list.
--
-- So: if a purge feature exists, roll this back only together with it. Verify
-- the rollback from the catalog —
--
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'privacy_purge_queue';
--
-- — returning zero rows is the check, and a `migration:revert` exit code is not:
-- it reports that the script ran, not that the consequence was acceptable.