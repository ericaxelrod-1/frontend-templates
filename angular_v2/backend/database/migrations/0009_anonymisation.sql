-- Privacy/DSAR, part one: the anonymisation columns on `users`, and the single
-- choke point that makes a soft-deleted user resolve to NOTHING.
-- Target: PostgreSQL 18+, applied as the migration/owner role like every migration.
--
-- Apply as the migration/owner role, the same way 0001–0008 are applied.
--
-- =============================================================================
-- WHAT THIS MIGRATION IS, AND WHY IT IS NOT JUST THREE COLUMNS
-- =============================================================================
-- `deleted_at`, `deletion_reason` and `email_anonymized` are the visible half.
-- The load-bearing half is the rest of the file: a user row that says
-- "this account is anonymised" must resolve to no scope and no capability, and
-- nothing in the schema did that before this migration. A timestamp records an
-- intention; the choke point is what makes it true.
--
-- THE DEFECT THIS CLOSES, stated as a concrete attack
--
--   1. `POST /privacy/erase` anonymises the account: it sets `deleted_at`,
--      `deletion_reason = 'rtbf'` and overwrites the identifying columns.
--   2. It does NOT delete the row. That is correct and deliberate — the record
--      has to survive, and CPRA §1798.105(c)(2) and 11 CCR §7101(a) require the
--      record of a consumer request to be RETAINED for at least 24 months.
--   3. `0008_user_identity.sql` gives `user_roles` and `user_groups`
--      `REFERENCES public.users (id) ON DELETE CASCADE`. **A referential action
--      fires on `DELETE`, and anonymisation is an `UPDATE`.** The cascade never
--      runs, and 0008 says so itself (`0008:213-232`).
--   4. So the anonymised user's `user_roles` and `user_groups` rows survive.
--      `has_permission()` seeds its ancestor set from `user_roles`, so their
--      capabilities resolve exactly as before; `authz.visible_user_ids()` reads
--      `user_groups`, so their scope resolves exactly as before.
--   5. The account still authenticates, if `password_hash` was not scrubbed, and
--      even if it was: the erasure "worked", the audit row was written, and the
--      erased person's authority is still live with no database signal at all.
--
-- That is the worst available outcome for a deletion feature, and it is silent.
-- `0008:117-123` spends eleven lines describing the same orphan-membership bug
-- from the `DELETE` side; this migration closes it from the `UPDATE` side.
--
-- =============================================================================
-- WHERE THE CHOKE POINT IS, AND WHY IT IS NOT IN `has_permission()`
-- =============================================================================
-- The obvious fix is to make the two resolvers read `users`:
-- `has_permission(who, …)` returns false when `users.deleted_at IS NOT NULL`,
-- and `authz.visible_user_ids()` drops the id. That implementation is not
-- merely unavailable, it is IMPOSSIBLE in this schema, and the reason is worth
-- writing down because it will be proposed again.
--
-- `public.users` is FORCE ROW LEVEL SECURITY (`0008:326`), so the owner is bound
-- by `users_read_scope`, which is:
--
--     current_user = 'app_admin'
--     OR id IN (SELECT authz.actor() AS actor_id WHERE authz.can_read_user())
--
-- and `authz.can_read_user()` is a wrapper over `has_permission()`. So:
--
--   * A read of `users` from inside `has_permission()` re-enters
--     `users_read_scope`, which calls `has_permission()`, which reads `users`.
--     PostgreSQL does not tolerate that: it raises
--     **`ERROR: infinite recursion detected in policy for relation "users"`** on
--     every call, for every caller. It is a hard failure, not a denial.
--   * A read of `users` from inside `visible_user_ids()` does not recurse, but it
--     is bound by the same policy, and the owner reading `users` sees — in a
--     claimless session, which is what a migration, a seed and the sweeper all
--     are — **ZERO rows**. `0008:64-95` measured exactly this: an orphan count
--     taken from inside a migration reported three orphans against a `users`
--     table holding one perfectly valid row. A helper built on that read cannot
--     distinguish "the user is not deleted" from "the user is invisible", and
--     the safe-looking choice for each is different.
--
-- SO THE CHOKE POINT IS THE ROW SET THE TWO AXES ALREADY RESOLVE FROM, and it is
-- enforced at write time instead:
--
--     anonymisation removes the deleted user's `user_roles` and `user_groups`
--     rows, in the same transaction, from a BEFORE trigger on `users`.
--
-- That is one place, it is below the application, and it needs no read of
-- `users` at all. Both axes then resolve to nothing by construction:
-- `has_permission()`'s ancestor CTE is seeded from `user_roles` and finds no
-- rows; `visible_user_ids()` anchors on the caller's own membership rows and
-- finds none. The trigger is also what makes the invariant hold for a FUTURE
-- resolver nobody has written yet, which no policy on two functions does.
--
-- WHY THERE IS NO SECOND, PARTIAL LAYER HERE
--
-- A reader who noticed that `visible_user_ids()` could *also* carry
-- `AND NOT EXISTS (SELECT 1 FROM users …)` will find that it does not, and the
-- reason is worth recording so the idea is not re-proposed as an improvement.
-- That read is subject to `users_read_scope`, whose self-read branch requires
-- `authz.can_read_user()` — which is `has_permission()` — and the caller of a
-- DELETED account holds no roles, so that conjunct is FALSE, so the caller's own
-- `users` row is INVISIBLE to the read, so the `NOT EXISTS` cannot observe the
-- tombstone. The layer would be inert in precisely the case it was written for,
-- while looking like a second line of defence in a diff. A guard that cannot
-- fire is worse than no guard: it is the "looks finished and isn't" shape
-- (§2.1) reached through the schema instead of through a stub.
--
-- WHY `authz.actor()` CANNOT DO IT, in one sentence, because it is the other
-- thing an agent will reach for: `authz.actor()` reads the `sub` claim out of
-- `request.jwt.claims` and returns it. It reads no table, deliberately — "it is
-- not a general licence to make helpers privileged" (`0001:270-274`) — and the
-- one table it would have to read is the one table whose policy calls it back.
--
-- WHAT IS LEFT AS A RESIDUAL, STATED RATHER THAN ASSUMED
--
-- The trigger fires on the transition to `deleted_at`. If the OWNER role
-- afterwards re-inserts a `user_roles` / `user_groups` row for a tombstoned
-- user, that user is soft-deleted and authorised again. Nothing in the schema
-- can prevent it: the check "is this user deleted?" is the read of `users` that
-- the paragraphs above prove unavailable, and `user_roles` / `user_groups` carry
-- no write grant for any serving role (`0001:1009-1019`), so the only identity
-- that can do it is the migration role itself, by definition the trusted one.
-- The application never does this; the anonymisation path deletes those rows and
-- nothing re-inserts them.
--
-- A SECOND, INDEPENDENT RESIDUAL, WHICH IS NOT ABOUT MIGRATION ROLE AT ALL: an
-- account can be anonymised WITHOUT being deactivated, because this schema
-- stores the fact (`deletion_reason`) and does not enforce that an RTBF erasure
-- also revokes the account's sessions. `refresh_tokens` is a separate table
-- under a separate migration's decision (`0002`), and this one does not reach
-- across and delete them — see the "WHAT THIS DOES NOT DO" note at the foot of
-- this file.
-- =============================================================================

-- =============================================================================
-- PREFLIGHT — `users` must exist, and the migration role must own it
-- =============================================================================
-- Copied from `0008:36-59` rather than re-derived, for the same reason: this
-- migration ALTERs the table and reads it from inside `SECURITY DEFINER`
-- functions. On a database where `users` predates the migration and belongs to
-- somebody else, every one of those statements either fails or — worse — runs
-- with privileges that make the invariant unreachable. It stops instead, and
-- the message names the fix.
DO $$
DECLARE
  owner_name text;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION
      '0009 requires public.users, which 0002_refresh_tokens.sql creates; run the migrations in order';
  END IF;

  SELECT pg_get_userbyid(c.relowner) INTO owner_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'users' AND n.nspname = 'public';

  IF owner_name IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION
      'public.users is owned by %, not the migration role %; the anonymisation columns, the '
      'revocation trigger and the SECURITY DEFINER helper cannot be applied by a role that does '
      'not own the table, so 0009 would record an invariant nothing enforces. Take ownership '
      '(ALTER TABLE public.users OWNER TO %) before migrating, or recreate the database.',
      owner_name, current_user, current_user;
  END IF;
END
$$;

-- =============================================================================
-- CHANGE 1 — THREE COLUMNS
-- =============================================================================
-- `ADD COLUMN IF NOT EXISTS` rather than a plain `ADD COLUMN`, because a
-- migration is applied to databases that may already carry them and
-- "applies cleanly" and "is idempotent" are different claims. The CHECK is a
-- separate statement because an inline `CHECK` inside an `ADD COLUMN IF NOT
-- EXISTS` is skipped wholesale when the column already exists — the constraint
-- would silently never be created on a re-run.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at      timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deletion_reason text;

-- THE DERIVED COLUMN, and why it is derived rather than stored
--
-- A stored boolean can drift from the fact that produced it. Every write path
-- would have to remember to set both, and the failure mode is a filter that is
-- wrong in one direction only: an account whose email WAS erased but whose
-- `email_anonymized` says false is counted as still holding personal data, and
-- one that says true when the email is intact is counted as erased. Neither is
-- visible from the row. A `GENERATED ALWAYS AS (...) STORED` column cannot be
-- written at all — `UPDATE users SET email_anonymized = true` raises
-- `cannot update a generated column` — so the two cannot disagree, because only
-- one of them exists.
--
-- It is derived from `deletion_reason` and NOT from `deleted_at IS NOT NULL`,
-- and that is the more precise of the two: a row soft-deleted `inactive` still
-- HAS its email, so `deleted_at` alone would claim an erasure that did not
-- happen. `email_anonymized` answers exactly one question — was this account's
-- email erased because somebody asked to be forgotten — and a service can
-- filter on it (`WHERE email_anonymized`) without re-deriving the reason.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_anonymized boolean
  GENERATED ALWAYS AS (deletion_reason = 'rtbf') STORED;

-- THE CLOSED REASON VOCABULARY, as a named constraint.
--
-- Named rather than inline so `ADD CONSTRAINT` can be made idempotent by
-- conname — `ALTER TABLE … ADD CONSTRAINT` has no `IF NOT EXISTS` form, and a
-- migration runs against databases that may already carry it. `pg_constraint` is
-- read by conname AND conrelid, because by name alone would be wrong the moment
-- a second table grows an identically named constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_deletion_reason_check'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_deletion_reason_check
      CHECK (deletion_reason IN ('rtbf', 'inactive', 'admin'));
  END IF;

  -- A reason without a timestamp is a record of a decision nobody took: the row
  -- would claim an erasure at no instant, which is exactly the shape
  -- AGENTS.md §2.1 forbids. Both columns are written by the one anonymisation
  -- UPDATE, so this cannot fail for a well-formed write.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_deletion_reason_requires_deleted_at'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_deletion_reason_requires_deleted_at
      CHECK (deletion_reason IS NULL OR deleted_at IS NOT NULL);
  END IF;
END
$$;

-- The inactivity scan filters `deleted_at IS NOT NULL AND deleted_at < now() - …`
-- on every sweep, over a table that is otherwise appended to forever. A partial
-- index on the non-null half keeps that scan off the tombstones' absence.
CREATE INDEX IF NOT EXISTS users_deleted_at_idx
  ON public.users (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- =============================================================================
-- CHANGE 2 — THE CHOKE POINT
-- =============================================================================
-- `authz.revoke_subject_authority()`, a BEFORE trigger on `users`.
--
-- SECURITY DEFINER, and the reason is a privilege gap rather than a habit.
--
-- The gap is HALF the pair, and the half matters, so it is stated exactly rather
-- than rounded up: `0001:1009-1019` withholds INSERT/UPDATE/DELETE on
-- `user_groups` from EVERY serving role, `app_admin` included, but
-- `0001:1007` grants `app_admin` the full verb set on `user_roles`. So an
-- anonymisation run as `app_admin` could delete its own `user_groups` rows and
-- not its `user_roles` rows, which would leave the tombstone holding the roles
-- that feed `has_permission()` — a HALF-revoked account: no scope, and its
-- former capability still resolvable by any caller that asks `has_permission()`
-- directly. `DEFINER` removes the split entirely, because it makes both DELETEs
-- run with the owner's rights regardless of which half the actor can reach, and
-- the two DELETEs have to be all-or-nothing.
--
-- (On a SEEDED database `database/seed.ts` `grantSeedAccess()` grants those same
-- verbs on `user_groups` back to `app_admin`, so an INVOKER trigger would work
-- there and fail on a migrated-only one — i.e. it would work on the machine the
-- author tests and fail on the one a fork provisions. Same argument, narrower
-- table, stated separately so neither claim is read as covering the other.)
--
-- It reads no table. It deletes two, both owned by this role and neither FORCEd
-- (`0001:948` — `user_groups` is deliberately not FORCEd for exactly this
-- reason), so the DEFINER has everything it needs and nothing it could abuse.
CREATE OR REPLACE FUNCTION authz.revoke_subject_authority() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Only the transition into anonymisation does anything. An ordinary profile
  -- update touches neither column and is unaffected; `NEW.deleted_at IS NULL`
  -- covers the un-delete direction too, which is deliberately a no-op: restoring
  -- a tombstone restores no authority, and a caller who wants the authority back
  -- re-grants the role rows explicitly, where it is visible.
  IF NEW.deleted_at IS NULL THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.user_groups WHERE user_id = NEW.id;
  DELETE FROM public.user_roles  WHERE user_id = NEW.id;

  RETURN NEW;
END
$$;

-- A trigger function is granted to nobody: it runs attached to the table as the
-- table owner and is never called directly. EXECUTE goes to PUBLIC on every new
-- function, so it is revoked — a DEFINER function reachable by a caller is an
-- escalation, not a write.
REVOKE EXECUTE ON FUNCTION authz.revoke_subject_authority() FROM PUBLIC;

-- BEFORE, not AFTER. "A row is never soft-deleted while it still holds
-- authority" is a stronger statement than "a row that was soft-deleted while it
-- held authority loses it one statement later", and the second one has no
-- observable difference only because both happen in one transaction. BEFORE
-- removes the window rather than relying on the transaction to close it.
--
-- `UPDATE OF deleted_at, deletion_reason` fires when a statement NAMED one of
-- those columns, so a profile update pays nothing for the invariant. It fires
-- on a no-op write too (`deleted_at` set to the value it already has) and the
-- two DELETEs then match zero rows, which is correct and costs two index
-- lookups on a column that is the primary key.
DROP TRIGGER IF EXISTS users_revoke_authority_on_anonymisation ON public.users;
CREATE TRIGGER users_revoke_authority_on_anonymisation
  BEFORE UPDATE OF deleted_at, deletion_reason ON public.users
  FOR EACH ROW EXECUTE FUNCTION authz.revoke_subject_authority();

-- =============================================================================
-- CHANGE 3 — A TOMBSTONE IS NOT READABLE BY ITS SUBJECT
-- =============================================================================
-- `0008`'s self-read branch is kept and one conjunct is added. This is the one
-- place in the schema where `users` is read *without* being subject to its own
-- policy, so it is the one place the check can be stated directly.
--
-- The `current_user = 'app_admin'` branch is deliberately untouched and comes
-- FIRST: the admin is the superset principal and must still see the tombstone,
-- because the inactivity scan is `WHERE deleted_at IS NOT NULL` and a policy
-- that hid those rows would silently empty the purge queue.
--
-- A member's read of their own row is unchanged for every account that exists,
-- so this costs the self-service path nothing, and it is the difference between
-- "the row says the account is gone" and "the row is gone" as far as the subject
-- is concerned.
--
-- It is ALSO what makes the tombstone invisible to every read the anonymised
-- account could otherwise make about itself, and that is deliberate. A caller
-- that cannot see its own `users` row resolves nothing through any derived table
-- whose policy routes through `can_read_user()`-style capability — which, after
-- the trigger above has removed its roles, is every one of them.
DROP POLICY IF EXISTS users_read_scope ON public.users;
CREATE POLICY users_read_scope ON public.users FOR SELECT USING (
    current_user = 'app_admin'
    OR (
      deleted_at IS NULL
      AND id IN (
        SELECT authz.actor() AS actor_id WHERE authz.can_read_user()
      )
    )
);

-- =============================================================================
-- WHAT THIS DOES NOT DO — AND IT IS THE LIST AN AUDITOR WILL ASK FOR
-- =============================================================================
--   * It does not anonymise anything. It adds the columns an anonymisation path
--     writes and the choke point that path depends on; the path itself is a thin
--     application route, and there is no `scrub` function here pretending to be
--     one.
--   * It does not revoke sessions. `refresh_tokens` rows for an anonymised
--     account survive this migration, because revoking them is a statement about
--     the anonymisation path and not about the schema — and §9A.1's line is the
--     right one: "the line is drawn at identity, not at rows". A migration that
--     reached across into `refresh_tokens` on the strength of a column it had
--     just added would be deleting data from a table nobody asked it to.
--   * It does not enqueue anything. `privacy_purge_queue` arrives in 0011 with
--     its own column contract, and the inactivity scan that would read
--     `deleted_at` is not here.
--   * It does not make `password_hash` nullable or scrub it. `0008` keeps it
--     NOT NULL deliberately; a tombstone that still verifies an old password is
--     the anonymisation path's failure, and the honest way to surface it is a
--     failing authentication, not a schema that silently accepts NULL.
-- =============================================================================

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
-- PostgREST caches the schema, and the three new columns and the two redefined
-- functions are invisible to a server started before this file ran. The served
-- spec (`openapi-mode = "ignore-privileges"`) advertises every column of every
-- relation in `db-schemas` regardless of grants, so the generated types for
-- `users` gain three properties here — which is why the reload belongs in this
-- file and not in a note.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0009_anonymisation.down.sql. Kept as a separate file
-- so this one stays append-only, exactly as in 0001–0008.
--
-- ROLLING THIS BACK IS SAFE ONLY WHILE NOTHING ANONYMISES A USER. The down
-- script restores the pre-0009 functions and policy verbatim, so the three
-- columns and the trigger go away and the scope/capability axes go back to
-- reading `user_roles`/`user_groups` with no regard for `deleted_at`. If an
-- anonymised account exists at that moment, it is immediately authorised again
-- with no database signal — which is the defect this migration exists to close,
-- reopened by the rollback. If the anonymisation feature exists, roll this back
-- only together with it, and verify by catalog rather than by the absence of an
-- error.