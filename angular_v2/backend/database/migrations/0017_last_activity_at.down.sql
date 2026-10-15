-- =============================================================================
-- 0017_last_activity_at.down.sql — REVERT, and it is a REVERT
-- =============================================================================
-- The order below is load-bearing and is the reverse of the up file's:
--
--   1. the functions that WRITE this migration's column go first, because
--      `DROP COLUMN` would otherwise leave a body referencing a column that no
--      longer exists — and PostgreSQL does not check function bodies against the
--      catalog, so it would accept the drop and defer the breakage to the first
--      call. A down script that produces that is exactly the "looks reverted and
--      isn't" shape `AGENTS.md` §2.3 is about;
--   2. the index, which depends on the column;
--   3. the CHECK domain, restored to `0011`'s four codes;
--   4. the column;
--   5. `0016`'s two functions, restored VERBATIM — including its 1..36500 bound.
--      Restoring the body without restoring the bound would leave the migration
--      half-reverted in the one direction that matters: the schema would claim
--      `0016` while still refusing `RETENTION_TOMBSTONE_DAYS=1`;
--   6. the grants, which are re-written because a recreated function is granted
--      `EXECUTE` to `PUBLIC` by default. Skipping this would leave
--      `authz.enqueue_inactive_purges(uuid[])` anonymously executable, which is
--      a `SECURITY DEFINER` writer reachable by `app_anon` — an escalation the
--      revert must not introduce on its way out.
-- =============================================================================

-- 1 — the writers. `retention_due_accounts` and `record_user_activity` exist only
-- in 0017; the two `0016` functions are restored in step 5 rather than dropped.
DROP FUNCTION IF EXISTS authz.retention_due_accounts(integer);
DROP FUNCTION IF EXISTS authz.record_user_activity(uuid);

-- The enqueue seam goes back to one argument, so the two-argument overload this
-- migration installed has to go with it.
DROP FUNCTION IF EXISTS authz.enqueue_inactive_purges(uuid[], uuid[]);

-- 2 — the index, before the column it is built on.
DROP INDEX IF EXISTS public.users_last_activity_at_idx;

-- 3 — the reason vocabulary, back to `0011`'s four codes.
ALTER TABLE public.privacy_purge_queue
  DROP CONSTRAINT privacy_purge_queue_reason_check;

ALTER TABLE public.privacy_purge_queue
  ADD CONSTRAINT privacy_purge_queue_reason_check
  CHECK (reason IN (
    'inactivity_purge',
    'retention_login_attempts',
    'retention_unverified_request',
    'retention_export_artefact'
  ));

-- 4 — the column, with its comment (a COMMENT travels with the column, so
-- dropping the column drops it; this is here so a reader of this file sees that
-- nothing about the comment needs reverting separately).
ALTER TABLE public.users
  DROP COLUMN IF EXISTS last_activity_at;

-- 5 — `0016_purge_machine_path.sql` §5 and §5b, restored character for character
-- on the parts that changed, and byte-identical on the parts that did not.
CREATE OR REPLACE FUNCTION authz.enqueue_inactive_purges(p_target_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  written integer;
BEGIN
  IF p_target_ids IS NULL THEN
    RAISE EXCEPTION
      'authz.enqueue_inactive_purges: p_target_ids is required; an absent list is not an empty list.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_target_ids) AS candidate(id) WHERE candidate.id IS NULL) THEN
    RAISE EXCEPTION
      'authz.enqueue_inactive_purges: the list of targets contains a NULL.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.privacy_purge_queue (
    target_kind, target_id, target_ref, reason, scheduled_for
  )
  SELECT 'user', candidate.id, NULL, 'inactivity_purge', now()
    FROM unnest(p_target_ids) AS candidate(id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS written = ROW_COUNT;

  RETURN written;
END
$$;

CREATE OR REPLACE FUNCTION authz.retention_due_tombstones(p_window_days integer)
RETURNS TABLE (user_id uuid, deleted_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_window_days IS NULL THEN
    RAISE EXCEPTION
      'authz.retention_due_tombstones: the retention window is required. It is a decision that '
      'destroys personal data and it is not this function''s to invent.'
      USING ERRCODE = '22023';
  END IF;

  IF p_window_days < 1 OR p_window_days > 36500 THEN
    RAISE EXCEPTION
      'authz.retention_due_tombstones: the retention window must be between 1 and 36500 days, '
      'received % — zero deletes every tombstone that has ever existed and a large value is a '
      'retention policy nobody reads as one.',
      p_window_days
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT u.id, u.deleted_at
    FROM public.users u
   WHERE u.deleted_at IS NOT NULL
     AND u.deleted_at < now() - make_interval(days => p_window_days)
   ORDER BY u.deleted_at, u.id;
END
$$;

-- 6 — the grants, because a recreated function is `PUBLIC`-executable by
-- default. Revoke and grant, in the same breath, for both reasons `0016:455-482`
-- gives: the revoke is not optional, and revoking while granting to nobody is
-- strictly worse than doing nothing.
REVOKE EXECUTE ON FUNCTION authz.enqueue_inactive_purges(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authz.retention_due_tombstones(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION authz.enqueue_inactive_purges(uuid[]) TO app_admin;
GRANT EXECUTE ON FUNCTION authz.retention_due_tombstones(integer) TO app_admin;

-- And the schema cache, for the column that just went away: a PostgREST that
-- still advertises `last_activity_at` answers `select=*` with a column the table
-- no longer has, and the committed `openapi.json` disagrees with the database
-- until it is regenerated.
NOTIFY pgrst, 'reload schema';