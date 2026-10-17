-- =============================================================================
-- 0023_user_profile_and_disable.down.sql
--
-- Reverses `0023_user_profile_and_disable.sql`, and nothing else:
--
--   * the `app_member` column list on `users` returned to the four columns `0008`
--     listed, so a member can no longer read their own name;
--   * the username guard dropped — trigger first, then the function it calls;
--   * the partial index on `disabled_at` dropped;
--   * all seven columns dropped, which takes the five constraints and the
--     `disabled_by` foreign key with them.
--
-- Kept as a psql script rather than folded into the migration above, because the
-- migration is also the file a runner applies forward and must stay append-only.
-- Apply with:
--   psql -v ON_ERROR_STOP=1 -d <db> -f 0023_user_profile_and_disable.down.sql
--
-- ORDER IS LOAD-BEARING IN TWO PLACES, and neither is a preference:
--
--   1. THE TRIGGER BEFORE THE FUNCTION. Dropping the function while a trigger still
--      calls it fails the DROP with a dependent-objects error, so the script would
--      abort half-way with the database in neither the old state nor the new one —
--      the exact failure `0009_anonymisation.down.sql:26-29` records.
--   2. THE GRANT BEFORE THE COLUMNS. Restoring the narrower column list while the
--      two new columns still exist would leave `app_member` holding a privilege over
--      columns that are about to disappear (`0012_user_geo.down.sql:13-16`), and it
--      would leave a window in which a member can still read a name this rollback has
--      just declared does not exist.
-- =============================================================================

-- THE GRANT IS RESTORED FIRST, AND IN THREE STATEMENTS RATHER THAN FOUR.
--
-- `REVOKE ALL` (for `PUBLIC`, `app_anon` and `app_member`) is what actually removes
-- `first_name` and `last_name` from the member's column list: a column-level GRANT
-- cannot be taken away by a `REVOKE SELECT (col)` that sits on top of the column
-- grants themselves, and 0023's member privileges are column grants, so the only
-- clean removal is `REVOKE ALL` followed by a re-issue. (The 0008 ordering rule — that
-- a column revoke under a standing TABLE-level grant is accepted, exits 0, and
-- changes nothing — does not bite here, because 0023 left no table-level grant for
-- `app_member` to sit under. It is spelled out in the up file rather than repeated.)
--
-- `app_admin` IS DELIBERATELY ABSENT FROM THE LIST. 0023 changed nothing about the
-- admin's privileges — it re-issued the same table-level `SELECT, INSERT, UPDATE,
-- DELETE` it already held — so a `REVOKE ALL … FROM app_admin` here would strip
-- grants this script does not restore, and `src/auth/auth.service.ts:425,433` reads
-- `id, username, password_hash` as `app_admin` on the login and refresh paths. A
-- rollback that breaks authentication is a rollback that fails loudly in the worst
-- possible place; this one must leave the admin exactly as it found it.
REVOKE ALL ON public.users FROM PUBLIC, app_anon, app_member;

-- The TEN columns `app_member` held BEFORE this migration, not the four that
-- `0008` alone established. `0012_user_geo.sql` added the six geography columns
-- afterwards, so restoring only the four would silently strip a signed-in member's
-- ability to read their own jurisdiction — the exact regression `0012:284-289`
-- argues against, and the exact reason `test/rls/geo-profile.spec.ts` exists.
-- A down must restore the state it found, not the state some earlier migration
-- left behind.
GRANT SELECT (
    id, username, email, created_at,
    country_code, region_code, city, geo_source, geo_accuracy_km, geo_updated_at
  )
  ON public.users TO app_member;

-- The trigger first, then the function: `DROP FUNCTION` fails while a trigger still
-- references it. `IF EXISTS` on both, because a database that never received the
-- trigger has nothing to drop and a rollback that fails on an absent object is a
-- rollback that stops half-done.
DROP TRIGGER IF EXISTS users_guard_username_immutable ON public.users;
DROP FUNCTION IF EXISTS authz.guard_username_immutable();

-- The index is named explicitly before its column goes, so a failure here names the
-- index rather than surfacing later as a missing index on a column that no longer
-- exists.
DROP INDEX IF EXISTS public.users_disabled_at_idx;

-- NO `DROP CONSTRAINT` STATEMENTS, and the reason is the same one
-- `0012_user_geo.down.sql:34-45` gives: `ALTER TABLE … DROP COLUMN` takes the CHECK
-- constraints defined on the column with it, so the column drops are both necessary
-- and sufficient. Naming the constraints would only add a way to fail — a
-- `DROP CONSTRAINT IF EXISTS users_disabled_reason_check` issued AFTER the columns
-- were gone would succeed and change nothing, and one issued BEFORE on a database
-- where the columns were already absent would raise `column "disabled_reason" does
-- not exist`, because the constraint expression is parsed against the table. Leaving
-- them to the column drop is what keeps this script re-runnable.
--
-- The self-reference goes with its column: `disabled_by`'s foreign key to
-- `public.users (id)` is dropped with the column, and no `ON DELETE SET NULL`
-- action fires, because dropping a column is not a row delete.
--
-- Reverse dependency order, so a reader can follow it: the suspension's expiry and
-- reason, then the self-reference, then the instant, then the three profile columns.
ALTER TABLE public.users DROP COLUMN IF EXISTS disabled_until;
ALTER TABLE public.users DROP COLUMN IF EXISTS disabled_reason;
ALTER TABLE public.users DROP COLUMN IF EXISTS disabled_by;
ALTER TABLE public.users DROP COLUMN IF EXISTS disabled_at;
ALTER TABLE public.users DROP COLUMN IF EXISTS last_login_at;
ALTER TABLE public.users DROP COLUMN IF EXISTS last_name;
ALTER TABLE public.users DROP COLUMN IF EXISTS first_name;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- WHAT A ROLLBACK COSTS — READ BEFORE RUNNING THIS
-- =============================================================================
--
-- This script is a true reversal of 0023 and nothing else, and that is exactly why
-- it must not be run casually:
--
--   * IT DESTROYS EVIDENCE, irreversibly. The four `disabled_*` columns are the only
--     record that an account was disabled, by whom and why, and it is gone. Nothing
--     elsewhere in this schema keeps that history: there is no audit table for
--     operator decisions, and the login ledger (`0002`) records attempts, never
--     administrative acts. After this script the question "who disabled this account
--     on the 3rd, and why" has no answer at all, which is a worse answer than a
--     partial one.
--   * IT DOES NOT RE-ENABLE ANYBODY, and that is the trap. Nothing in `src/` reads
--     `disabled_at` at the time 0023 is written (see the up file's header), so a
--     disabled account's status was never decided by these columns in the first
--     place — but if enforcement IS wired up before this rollback runs, dropping the
--     column removes the check's target and the account is not merely un-disabled, it
--     is unreadable to whatever code asked the question. Verify which of those two
--     states you are in by reading the login path, not by reading this file.
--   * IT REMOVES THE BLANK RULES. The two name columns go, and with them the CHECKs
--     that refused `''` and `'  '`, so the next migration to add a name column back
--     starts from untrimmed data unless it re-adds them.
--   * IT NARROWS A MEMBER'S READ OF ITS OWN DATA. The grant returns to the four
--     columns `0008` listed, so a signed-in person can no longer see the name they
--     gave and the self-service profile page goes back to rendering a username where
--     a name belongs. The six geography columns `0012` granted are NOT restored by
--     this script — they are not in the list above, and they were already removed
--     from `app_member` by the UP migration's `REVOKE ALL` (see the geography note
--     in the grant section of `0023_user_profile_and_disable.sql`). Restoring them is
--     `0012`'s decision, not this script's.
--
-- No policy, function or capability in this tree reads any of these columns, so
-- nothing else breaks — and that is also why nothing will tell you the rollback
-- happened. Verify it from the catalog —
--
--   SELECT attname FROM pg_attribute
--    WHERE attrelid = 'public.users'::regclass
--      AND attname IN ('first_name', 'last_name', 'last_login_at', 'disabled_at',
--                      'disabled_by', 'disabled_reason', 'disabled_until');
--
-- — returning zero rows is the check, and a `migration:revert` exit code is not: it
-- reports that the script ran, not that the consequence was acceptable.