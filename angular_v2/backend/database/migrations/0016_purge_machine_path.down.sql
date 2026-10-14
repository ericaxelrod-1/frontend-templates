-- =============================================================================
-- 0016_purge_machine_path.down.sql
--
-- REVERTS 0016 — AND THEREFORE RESTORES THE RETENTION MECHANISM TO INERT.
-- =============================================================================
--
-- Two statements' worth of effect, in opposite directions:
--
--   * the five `authz` write functions and the retention scan are DROPPED, which
--     is reversible by construction — re-applying `0016_purge_machine_path.sql`
--     recreates them verbatim; and
--   * `GRANT UPDATE ON public.privacy_purge_queue TO app_admin` is RESTORED,
--     which is NOT reversible by anything except re-applying this migration.
--
-- THE RESTORED GRANT IS THE POINT. Before `0016` the sweeper's claim was a bare
-- `UPDATE` whose inner `SELECT … FOR UPDATE SKIP LOCKED` was governed by
-- `privacy_purge_read` — the capability call alone, with no `current_user`
-- branch — so a claimless session matched nothing and the queue drained nothing,
-- silently, with no error anywhere:
--
--     pgrst_authenticator, SET LOCAL ROLE app_admin, no claims in scope:
--     UPDATE privacy_purge_queue … RETURNING q.id;   =>   UPDATE 0
--
-- Putting the grant back therefore does not restore a working retention job. It
-- restores a table the application can write and a function nobody can call, and
-- an operator who reads the down script's exit code as "rolled back cleanly" and
-- the empty admin list as "nothing was due" has been told nothing wrong by either.
-- That is why the grant is restored here rather than left withheld: leaving it
-- withheld would be a different change, and a migration that quietly leaves the
-- schema narrower than the file before it is a rollback that is not a rollback.
--
-- WHAT THIS DOES NOT UNDO, and cannot: nothing here deletes a queue row, a user
-- row or an audit row. The rows a sweep claimed, failed and retried while `0016`
-- was applied are still here with their recorded outcomes.
--
-- ORDER MATTERS. The functions go first and the grant is restored last, so that
-- a failure part-way through leaves the database with the functions still
-- present (which claim) rather than with the grant restored and the functions
-- gone (which does not, and would fail `permission denied for function`).
-- =============================================================================

DROP FUNCTION IF EXISTS authz.enqueue_inactive_purges(uuid[]);
DROP FUNCTION IF EXISTS authz.retention_due_tombstones(integer);
DROP FUNCTION IF EXISTS authz.complete_purge(uuid, text, integer);
DROP FUNCTION IF EXISTS authz.fail_purge(uuid, text, text);
DROP FUNCTION IF EXISTS authz.requeue_purge(uuid, text, text);
DROP FUNCTION IF EXISTS authz.claim_due_purge(text);

-- `0011`'s grant, verbatim: the sweeper's four statements are ordinary `UPDATE`s
-- on this table, and withholding the verb would make them fail with
-- `permission denied for table` rather than silently match zero rows.
GRANT UPDATE ON public.privacy_purge_queue TO app_admin;

NOTIFY pgrst, 'reload schema';
