-- =============================================================================
-- 0026_member_self_write.down.sql
--
-- Reverses `0026_member_self_write.sql`, and nothing else:
--
--   * `users_update` returned to `0008`'s `USING (current_user = 'app_admin')`, so a
--     member can no longer write their own row at all;
--   * the member's `UPDATE (first_name, last_name)` grant on `users` removed;
--   * the member's twelve-column READ grant re-issued, unchanged, so the rollback is
--     exact even on a database where something else has touched the grant since.
--
-- Kept as a psql script rather than folded into the migration above, because the
-- migration is also the file a runner applies forward and must stay append-only.
-- Apply with:
--   psql -v ON_ERROR_STOP=1 -d <db> -f 0026_member_self_write.down.sql
--
-- ORDER IS LOAD-BEARING IN ONE PLACE. The member's grants are removed with `REVOKE
-- ALL` and re-issued, rather than removed with a targeted
-- `REVOKE UPDATE (first_name, last_name) FROM app_member`. The targeted form would
-- work today and is still wrong: it leaves whatever else `app_member` holds on this
-- table in place, so the state this script leaves behind depends on what some other
-- migration or operator granted since 0026 ran. `0023_user_profile_and_disable.down.sql`
-- reaches the same decision for `SELECT` and explains why at length; the rule is that
-- a down must restore the state it FOUND, not subtract one statement from a
-- grant block it no longer has in front of it.
-- =============================================================================

-- THE POLICY IS REPLACED, NOT DROPPED. `DROP POLICY` alone would leave `users` with
-- NO UPDATE policy, which is not the pre-0026 state — it is a stricter one, and it
-- would refuse the erasure and retention writes that run as `app_admin`. The exact
-- `0008:421` text is restored, character for character, so the rollback is
-- recognisable in `pg_policies` rather than merely equivalent.
DROP POLICY IF EXISTS users_update ON public.users;

CREATE POLICY users_update ON public.users FOR UPDATE USING (current_user = 'app_admin');

-- `app_admin` IS DELIBERATELY ABSENT FROM THIS LINE, for the reason
-- `0023_user_profile_and_disable.down.sql:31-38` gives and this file repeats rather
-- than re-derives: 0026 changed nothing about the admin's privileges, so a
-- `REVOKE ALL … FROM app_admin` here would strip grants this script does not restore.
-- `src/auth/auth.service.ts` reads `id, username, password_hash` as `app_admin` on the
-- login and refresh paths, and a rollback that breaks authentication fails loudly in
-- the worst possible place.
REVOKE ALL ON public.users FROM PUBLIC, app_anon, app_member;

-- Both table-level verbs are taken away BEFORE any column list is re-issued, and the
-- reason is the one that runs the whole direction of this schema's grants: a column
-- privilege can only NARROW a table grant that has already been taken away, it cannot
-- subtract from one. Issuing the `GRANT SELECT (…)` while a table-level `SELECT`
-- existed would leave `password_hash` readable at HTTP 200 with its value intact —
-- accepted, exits 0, changes nothing (`0001:1021`, `0008:427-432`).
REVOKE SELECT ON public.users FROM app_member;
REVOKE UPDATE ON public.users FROM app_member;

-- The twelve columns, verbatim from `0023_user_profile_and_disable.sql:584-589`, which
-- is where they came from. They are what the pre-0026 database held and re-issued here
-- so this script does not depend on `0026` having been the last writer of the grant.
-- The frontend's generated `Pick` of exactly these twelve is pinned to this list, so
-- restoring a different one would be a wire change disguised as a rollback.
GRANT SELECT (
    id, username, email, created_at,
    country_code, region_code, city, geo_source, geo_accuracy_km, geo_updated_at,
    first_name, last_name
  )
  ON public.users TO app_member;

-- NO `GRANT` FOR THE MEMBER'S WRITE. That absence IS the reversal: pre-0026,
-- `app_member` held no `UPDATE` on `users` at any granularity, and a down script that
-- left the column grant behind would report success while the member's write path was
-- still open and the policy had stopped admitting it.

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- WHAT A ROLLBACK COSTS — READ BEFORE RUNNING THIS
-- =============================================================================
--
--   * IT BREAKS `PATCH /api/users/me`, and it breaks it VISIBLY, which is the correct
--     direction. `UsersService.updateMe` runs as the CALLER through PostgREST and no
--     longer holds a `SET LOCAL ROLE app_admin` to fall back on, so the write is refused
--     at the grant layer with `42501`. A member sees a failed save. The alternative
--     failure — a route that quietly stopped writing and kept answering `200` — is
--     `AGENTS.md` §2.1's worst shape and is the one this rollback deliberately cannot
--     produce.
--   * IT RESTORES A CORRECTNESS-BY-ACCOMERSE PATH. Whatever the thin app does next is
--     bounded by its own `WHERE` clause again, with no schema refusing it. That is the
--     state this migration was written to end, so a rollback re-opens it knowingly.
--   * IT REMOVES NOTHING FROM THE CATALOG. No column, no constraint, no table and no
--     capability is touched, so there is no data loss here — which is exactly why the
--     absence of an error is not evidence that the rollback was safe. Verify it from
--     the catalog:
--
--       SELECT policyname, qual, with_check FROM pg_policies
--        WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'users_update';
--
--     — `qual` must name `current_user = 'app_admin'` and `with_check` must be NULL —
--     and
--
--       SELECT has_any_column_privilege('app_member', 'public.users', 'UPDATE') AS writes_anything;
--
--     — which must be false. A `migration:revert` exit code is not the check: it reports
--     that the script ran, not that the consequence was acceptable.