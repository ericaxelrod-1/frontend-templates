-- Rollback for 0009_anonymisation.sql.
--
-- Restores the state 0008 and 0005 left behind, in full:
--   * the anonymisation trigger dropped and `authz.revoke_subject_authority()`
--     dropped with it;
--   * `users_read_scope` recreated with 0008's exact predicate;
--   * the partial index, both CHECK constraints and the three columns dropped.
--
-- `authz.visible_user_ids()` is NOT touched, because 0009 does not redefine it:
-- the tombstone check cannot live there (0009's header paragraph explains that a
-- read of `users` from inside that function resolves to the caller's own row at
-- best and to nothing at worst, so the guard would be inert in exactly the case
-- it was written for). There is therefore nothing to restore, and this file not
-- restating its body is the correct outcome rather than an omission.
--
-- Kept as a psql script rather than folded into the migration above, because the
-- migration is also the file a runner applies forward and must stay append-only.
-- Apply with:  psql -v ON_ERROR_STOP=1 -d <db> -f 0009_anonymisation.down.sql
--
-- ORDER IS LOAD-BEARING HERE: the policy restored below references `users`, so it
-- must be recreated BEFORE the column it names is dropped. Dropping the column
-- first leaves a policy naming a column that does not exist, and PostgreSQL will
-- refuse to drop a column a policy expression depends on — so the script would
-- abort part-way with the database in neither the old state nor the new one.

-- The trigger first: it is attached to `users`, and dropping the function while
-- a trigger still calls it fails the DROP.
DROP TRIGGER IF EXISTS users_revoke_authority_on_anonymisation ON public.users;
DROP FUNCTION IF EXISTS authz.revoke_subject_authority();

-- 0008's exact predicate, character for character: the `deleted_at IS NULL`
-- conjunct added by 0009 is what stops being applied, because the column it
-- named is about to be dropped.
DROP POLICY IF EXISTS users_read_scope ON public.users;
CREATE POLICY users_read_scope ON public.users FOR SELECT USING (
    current_user = 'app_admin'
    OR id IN (
      SELECT authz.actor() AS actor_id WHERE authz.can_read_user()
    )
);

DROP INDEX IF EXISTS public.users_deleted_at_idx;

-- Constraints before columns: `ALTER TABLE … DROP COLUMN` would take the
-- unnamed inline constraints with it, and dropping them explicitly first is
-- what makes this script's shape obvious in a diff.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_deletion_reason_check;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_deletion_reason_requires_deleted_at;

-- The generated column goes before the column it reads, which is not required
-- (a generated column does not block dropping its source) but keeps the
-- dependency order of the file the same as the file that built it.
ALTER TABLE public.users DROP COLUMN IF EXISTS email_anonymized;
ALTER TABLE public.users DROP COLUMN IF EXISTS deletion_reason;
ALTER TABLE public.users DROP COLUMN IF EXISTS deleted_at;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- WHAT A ROLLBACK COSTS — READ BEFORE RUNNING THIS
-- =============================================================================
-- This script is a true reversal of 0009 and nothing else. That is exactly why
-- it must not be run casually once an anonymisation path exists:
--
--   * `authz.revoke_subject_authority()` — the trigger that removes a
--     tombstoned user's `user_roles`/`user_groups` rows — is gone, and the
--     `users_read_scope` conjunct that hid the tombstone from its subject is
--     gone with it. An anonymised account therefore resolves to its full former
--     scope and its full former capability again, with the tombstone still
--     standing, so nothing anywhere reports a problem. That is the defect 0009
--     exists to close, reopened in reverse, and the erasure that already ran is
--     not undone by it.
--   * A tombstone that had been anonymised keeps its scrubbed columns, so the
--     account is still useless; it simply is not *inert* any more.
--   * The three columns go, so a client built against the regenerated spec gets
--     `42703 column … does not exist` rather than an empty result.
--
-- So: if an anonymisation path has landed, roll this back only together with it.
-- Verify the rollback from the catalog —
--
--   SELECT deleted_at, deletion_reason, email_anonymized FROM public.users
--    WHERE id = '<a tombstone you have>';
--
-- — returning "column does not exist" is the check, and a `migration:revert`
-- exit code is not: it reports that the script ran, not that the consequence
-- was acceptable.