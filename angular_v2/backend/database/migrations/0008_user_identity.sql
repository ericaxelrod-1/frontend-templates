-- Referential integrity and self-read on the identity table.
-- Target: PostgreSQL 18+, applied as the migration/owner role like every migration.
--
-- TWO CHANGES, AND WHY THEY ARE ONE MIGRATION
--
--   1. `user_roles.user_id` and `user_groups.user_id` get the foreign keys to
--      `users (id)` that `0001_rls_foundation.sql:137-146` explicitly deferred
--      ("the authentication tables are a later work item … When `users` lands this
--      becomes `REFERENCES users (id)`").
--   2. `users` gets a self-read policy, so a member can read their own row through
--      PostgREST and erasure stops needing the thin Nest app for a plain read.
--
-- They are one file because they are one story — "the identity table is a
-- referenced table now, and the caller may read themselves in it" — and because the
-- rollback that matters is the one that undoes both. Splitting them would give an
-- operator two half-states to reason about and no second benefit.
--
-- Apply as the migration/owner role, the same way 0001–0007 are applied.

-- =============================================================================
-- PREFLIGHT 1 — `users` must exist, and the migration role must own it
-- =============================================================================
-- `0002_refresh_tokens.sql` creates `public.users` inside an ownership guard: on a
-- database where the table predates the migration and belongs to somebody else it
-- RAISES A WARNING and leaves the table undisciplined. 0002 can afford to warn,
-- because the consequence is a missing policy on a table no serving role may reach.
-- This migration cannot: its whole subject is a policy ON `users`, and an
-- ownership guard that skips it leaves a schema whose migration file claims a
-- self-read path that does not exist — the "looks finished and isn't" shape
-- (AGENTS.md §2.1), reached by a migration rather than by a stub.
--
-- So it stops instead. The message names the fix, because "recreate the database"
-- is what 0002's warning says and it is a heavier instruction than this needs:
-- `ALTER TABLE public.users OWNER TO <migration role>` is enough, provided the
-- caller is one that may administer it.
DO $$
DECLARE
  owner_name text;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION
      '0008 requires public.users, which 0002_refresh_tokens.sql creates; run the migrations in order';
  END IF;

  SELECT pg_get_userbyid(c.relowner) INTO owner_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'users' AND n.nspname = 'public';

  IF owner_name IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION
      'public.users is owned by %, not the migration role %; a policy and a grant cannot be '
      'applied to a table this role does not own, so 0008 would record a self-read path that does '
      'not exist. Take ownership (ALTER TABLE public.users OWNER TO %) before migrating, or '
      'recreate the database.',
      owner_name, current_user, current_user;
  END IF;
END
$$;

-- =============================================================================
-- WHY THERE IS NO COUNT-BASED ORPHAN PREFLIGHT HERE
-- =============================================================================
-- An earlier draft of this file counted orphans first, before adding the
-- constraints:
--
--   SELECT count(*) FROM user_roles ur
--    WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ur.user_id);
--
-- and it was WRONG IN A WAY THAT FAILED LOUDLY ON A HEALTHY DATABASE, which is the
-- one failure mode a preflight exists to rule out. This migration runs as the OWNER
-- of `users`, and `users` is `FORCE ROW LEVEL SECURITY` — so the owner is bound by
-- `users_read_scope`, admits nothing without `request.jwt.claims`, and the
-- `NOT EXISTS` sees an EMPTY `users`. Every membership row then looks like an
-- orphan. Measured on `app_dev`: three membership rows reported as orphans against
-- a `users` table holding one perfectly valid row.
--
-- That is the documented trap rather than a surprise: AGENTS.md §B5 — "under
-- `FORCE`, a claimless owner read returns 0 rows, so an owner-connection count
-- helper silently reads zero forever". A migration cannot set `row_security = off`
-- (it would not help under FORCE, and §B2 forbids it anyway), and there is no
-- `SECURITY DEFINER` function a migration could use to read the table past its own
-- policy.
--
-- So the orphan check is delegated to the ONE mechanism documented to bypass RLS:
-- the referential-integrity check itself. The constraints are added `NOT VALID` —
-- which skips the scan but still enforces every subsequent write — and then
-- `VALIDATE CONSTRAINT`, in the SAME `DO` block, runs the scan with RI privileges,
-- where policies do not apply. One block rather than two is what makes that safe: a
-- `DO` block is a single statement, so an exception escaping it rolls back the
-- `ADD CONSTRAINT` with it, and the failure is reported from inside the block with
-- the offending key attached. `test/rls/user-identity.spec.ts` asserts the
-- re-application to a SEEDED database, which is the case the broken preflight
-- turned red on.

-- =============================================================================
-- CHANGE 1 — THE TWO MISSING FOREIGN KEYS
-- =============================================================================
-- `0001_rls_foundation.sql` deferred both of these because `users` did not exist
-- when it was written, and recorded the intention in a comment:
--
--   user_roles  "No foreign key to `users`: … When `users` lands this becomes
--                `REFERENCES users (id)`" (0001:137-146)
--   user_groups "No foreign key to `users`" — the same deferral, unremarked
--
-- Nothing re-read that comment, so the gap survived six migrations. It is closed
-- here, and the closing is permanent: a foreign key cannot be forgotten by a
-- later migration, which a comment can.
--
-- WHY IT MATTERS NOW, and why this is the cheapest moment it ever will be
--
-- Nothing deletes a `users` row today — erasure is anonymisation, an UPDATE that
-- scrubs the row in place, not a DELETE — so the constraint cannot break a single
-- existing write. What it PREVENTS is the first feature that deletes. The planned
-- 5-year inactivity purge deletes user rows, and without these keys that purge
-- leaves `user_roles` and `user_groups` rows behind:
--
--   * `user_groups` orphans keep the purged user's scope resolvable.
--     `authz.visible_user_ids()` reads `user_groups` directly, so a purged user
--     stays inside the visible set of every caller who shares a group with them,
--     and their `email_messages` history stays readable by colleagues.
--   * `user_roles` orphans keep the purged user's capability resolvable, because
--     `has_permission()` seeds its ancestor set from `user_roles` for a given id.
--
-- In other words the purge would look like it worked and leave the principal's
-- authority intact. That is the worst available outcome for a deletion feature, and
-- it is the failure mode a future agent would not anticipate, because the migration
-- that would catch it is one they never read.
--
-- ON DELETE CASCADE — THE DECISION, AND THE TENSION IT CREATES
--
-- `CASCADE`, and the reasoning is the deletion guarantee rather than ergonomics.
--
-- The alternatives are `NO ACTION` and `RESTRICT`, and both do forbid the orphan.
-- But they forbid it by REFUSING THE DELETE, which moves the guarantee into the
-- purge's own code: "remember to delete this user's role rows and membership rows
-- first, in that order, inside the same transaction". That is a two-statement
-- ordering contract that exists only in one place, in code nobody has written yet,
-- and an inactivity purge is precisely the kind of scheduled, unattended, rarely
-- exercised code where a forgotten step is invisible until someone asks why a
-- purged account's mail is still visible. `CASCADE` makes the outcome a property of
-- the schema rather than a property of a future caller.
--
-- `CASCADE` ALSO CROSSES RLS, and AGENTS.md §B2 says so: the referential action is
-- executed by the constraint trigger with the owner's rights, so it writes rows the
-- deleting actor's policies would not otherwise admit. `0001` records the same
-- concern ("no CASCADE is declared anywhere, because ON DELETE CASCADE is a write
-- across RLS"). Here is why that does not bite, stated rather than assumed:
--
--   * WHO CAN TRIGGER IT. Only a role holding `DELETE` on `users`: `app_admin` and
--     the owner. Neither is a partially-trusted principal — `app_admin` is the
--     superset, and it already holds `DELETE` on `groups`, which is a strictly
--     larger blast radius than any membership row.
--   * WHAT IT REACHES. Only the two unscoped reference tables that ARE the
--     principal's own authority rows. A cascade that removes your own role rows
--     with your own account is not an escalation; it is the account ceasing to
--     exist. The escalation this rule guards against is a cascade that reaches
--     rows the deleting actor could not otherwise write — tenant payloads,
--     another user's data. These are not that.
--   * THE RESIDUAL, STATED, AND CORRECTED AGAINST THE CATALOG. `0001` withholds
--     INSERT/UPDATE/DELETE on `user_groups` from every serving role, so on a
--     migrations-only database `app_admin` cannot remove a membership row directly
--     and the cascade would be a widening for it. On a SEEDED database it is not:
--     `database/seed.ts` `grantSeedAccess()` runs `GRANT SELECT, INSERT, UPDATE,
--     DELETE ON user_roles, user_groups TO app_admin` as a seed-time provisioning
--     step — its own comment calls that a production hardening step that needs
--     revoking — and the grant persists. So on any database that has been seeded,
--     `app_admin` could already delete those rows itself and the cascade reaches
--     nothing new. That is recorded here rather than asserted the other way round,
--     because the migration-only reading is the one that would have been written
--     by somebody reading `0001` and never running the seed.
--   * WHAT IS ASSERTED. `test/rls/user-identity.spec.ts` proves the outcome that
--     matters rather than the grant that reaches it: `app_admin` deletes a user
--     through the escalation boundary, and both membership rows are gone afterwards
--     — asserted by count, read by a superuser, because "the DELETE succeeded" is
--     true whether or not the cascade fired.
--
-- THE §B2 FK-DISCIPLINE RULE DOES NOT BITE, and the reason is the category
-- declaration rather than an argument. The rule is "a GROUP-SCOPED table may only
-- carry foreign keys that stay within the group-scoped set; any FK leaving that set
-- must terminate at a table members cannot write to." `user_roles` and
-- `user_groups` are declared **UNSCOPED** (AGENTS.md §B2 category table, and 0001's
-- own header), so neither is a group-scoped table and neither is bound by the rule
-- at all. The second clause is satisfied independently as well: `app_member` holds
-- no `INSERT`/`UPDATE`/`DELETE` on `users`, so the FK terminates at a table members
-- cannot write to, exactly as `email_messages.user_id` already does (0005:46-56).
--
-- The residual every FK leaves behind, accepted and asserted as 0005 already does:
-- FK checks bypass RLS and fail OPEN, so this is an existence oracle over
-- `users.id` — `23503` versus success reveals any id. Closed for `app_member` by
-- the grant, and vacuous for `app_admin` because it holds table-level `SELECT` on
-- the whole of `users` already and could simply read the row.
--
-- IDEMPOTENT BY NAMING THE CONSTRAINT. `ALTER TABLE … ADD CONSTRAINT` has no
-- `IF NOT EXISTS` form, and a migration is applied to databases that may already
-- carry it. So the existence check reads `pg_constraint` by conname AND conrelid —
-- by name alone would be wrong the moment a second table grows an identically
-- named constraint, which is the failure that produces "constraint already exists"
-- on a database where it does not.
--
-- ONE BLOCK, NOT TWO, AND THAT IS LOAD-BEARING. A `DO` block is a single statement,
-- so an exception escaping it rolls back everything the block did. Add and validate
-- therefore share a block, which means a failed validation leaves NO constraint
-- behind — including under `psql -f`, which does not wrap the file in a transaction
-- and is how `test/rls/uuid-keys.spec.ts` and a developer both apply migrations.
-- Split into two blocks, the `ADD CONSTRAINT … NOT VALID` commits and the database
-- is left carrying a `NOT VALID` foreign key the migration was supposed to have
-- either installed fully or not at all: still enforced for new writes, never
-- validated against the rows that already exist, and invisible to the ledger
-- because the runner rolls the failure back.
--
-- `NOT VALID` SKIPS THE SCAN, AND THAT IS THE POINT: see the note above on why this
-- file cannot count orphans itself. It does not weaken anything either — a `NOT
-- VALID` foreign key still enforces every subsequent INSERT and UPDATE — and the
-- scan is not skipped, only moved to the `VALIDATE CONSTRAINT` below, where it runs
-- with RI privileges instead of the owner's RLS-bound ones.
--
-- `VALIDATE CONSTRAINT` on an already-valid constraint is a no-op, so a re-run takes
-- the `IF` branch, validates a constraint that is already valid, and changes
-- nothing.
--
-- The exception handler names the table and the remediation. Without it an orphan
-- aborts the migration with `violates foreign key constraint` and a DETAIL naming
-- one key, which is accurate but reads as a constraint problem rather than as "this
-- database predates the key and has rows the key forbids" — and the operator's next
-- action (delete or repair the orphans) is in neither message. The DETAIL is carried
-- through, because the offending `user_id` is the one piece of information that
-- makes the cleanup tractable.
DO $$
DECLARE
  constraint_table text;
  detail           text;
BEGIN
  FOREACH constraint_table IN ARRAY ARRAY['user_roles', 'user_groups'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = constraint_table || '_user_id_fkey'
         AND conrelid = format('public.%I', constraint_table)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) '
        'REFERENCES public.users (id) ON DELETE CASCADE NOT VALID',
        constraint_table, constraint_table || '_user_id_fkey');
    END IF;

    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', constraint_table, constraint_table || '_user_id_fkey');
    EXCEPTION
      WHEN foreign_key_violation THEN
        GET STACKED DIAGNOSTICS detail = PG_EXCEPTION_DETAIL;
        RAISE EXCEPTION
          '0008 cannot validate the users foreign key on public.%: %  Those orphans are exactly what '
          'these constraints exist to forbid — delete or repair them before migrating. Note that the '
          'orphans cannot be counted from inside a migration: it runs as the owner of a FORCE-RLS table '
          'and reads zero rows, so count them as a superuser.',
          constraint_table, coalesce(detail, '(no detail reported)');
    END;
  END LOOP;
END
$$;

-- =============================================================================
-- CHANGE 2 — `users` GETS A SELF-READ PATH
-- =============================================================================
-- Until now the policy on `users` was `USING (current_user = 'app_admin')` (0002),
-- so the table was reachable only by the superset principal. That is the correct
-- answer to "may this account read SOME user's row" and the wrong answer to "may
-- this account read ITS OWN row", which is the only question a signed-in member
-- asks of it.
--
-- THE SHAPE IS `0005_email_messages.sql`'S, and the resemblance is deliberate:
--
--   ONE policy, and BOTH axes AND-ed inside it. Two PERMISSIVE policies are
--   OR-ed, so a scope branch and a capability branch cannot be split across them
--   (AGENTS.md §B2; the measured failure was a member holding ZERO capabilities
--   running DELETE and INSERT with no error and no warning).
--   `current_user = 'app_admin'` FIRST, never a token field. A member who forges
--   `"role":"app_admin"` into their own validly-signed token gets nothing, because
--   nothing reads that field.
--   THE CAPABILITY CHECK GOES INSIDE THE UNCORRELATED SUBQUERY. A `STABLE` function
--   in a qual means "the same answer within this statement", NOT "called once"; as
--   a sibling conjunct it runs once per candidate row. Inside the `IN`, the planner
--   hoists it to a one-time filter. `email_messages` measured 1 call inside against
--   3,300 beside at 3,300 rows, and `test/rls/user-identity.spec.ts` asserts the
--   call count from `pg_stat_user_functions` rather than trusting the plan's shape.
--   THE POLICY IS TOTAL. Every branch is safe to evaluate: `actor()` catches a
--   malformed `sub` and returns NULL rather than raising, so a garbage token is a
--   denial and not a 500.
--
-- WHY `authz.actor()` AND NOT `authz.visible_user_ids()`
--
-- `email_messages` needs `visible_user_ids()` because its row is derived from the
-- RECIPIENT USER's memberships and must reach past `user_groups`'s own policy,
-- which hides the caller's peers. `users` has no such problem and must not have
-- such a reach: the caller is asking "is this row mine", and `authz.actor()` is
-- already the answer, read from the same verified token `visible_user_ids()` uses
-- internally. Using the visible-USERS set here would grant every member a read of
-- every colleague's row in their group — the one thing (b) exists to forbid — and
-- it would be a much larger grant dressed as a copy of a shipped pattern. Following
-- the established pattern means following its SHAPE (one total policy, capability
-- inside a hoisted subquery, a no-argument SECURITY DEFINER helper), not importing
-- its scope predicate, which answers a different question.
--
-- `id IN (SELECT authz.actor() WHERE authz.can_read_user())` degrades correctly in
-- every empty case: a NULL actor makes the `IN` NULL, which a `USING` clause treats
-- as a denial; a caller holding no `user:read` makes the subquery return no rows.
DO $$
DECLARE
  owner_name text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO owner_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'users' AND n.nspname = 'public';

  IF owner_name IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION
      'public.users is owned by %, not the migration role %; the self-read policy and the column '
      'grants below cannot be applied by a role that does not own the table',
      owner_name, current_user;
  END IF;
END
$$;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

-- THE CAPABILITY HELPER — no-argument, SECURITY DEFINER, pinned search_path, for
-- the same four reasons `authz.can_read_email()` gives in 0005:
--   * NO ARGUMENT, so a caller can only ever ask about ITSELF. A `who` parameter
--     turns an authorization helper into an enumeration tool, and that is how 63
--     unauthenticated probes recovered an administrator's permission set (0001).
--   * SECURITY DEFINER, so the call to `has_permission` runs with the OWNER's
--     privileges and `app_anon` needs no grant on the permission matrix to have
--     the policy evaluate cleanly.
--   * `search_path` PINNED, or a later-searched schema could shadow anything the
--     body names.
--   * EXECUTE revoked from PUBLIC, which Postgres grants on every new function.
--     Revoke AND grant together: revoking from PUBLIC while granting to nobody is
--     strictly worse than doing nothing, because every scoped read then dies with
--     `permission denied for function` and row scoping is 100% non-functional while
--     every policy, grant and comment still looks correct.
--
-- `app_anon` IS in the grant list, and it is not a preference: a policy expression
-- is evaluated for EVERY role that reaches the table, so without it an
-- unauthenticated read fails with `42501` instead of zero rows. A denial must
-- arrive as a denial.
--
-- THE CAPABILITY ITSELF IS ALREADY HELD BY `member`. No seed change is needed and
-- none is made, which is worth saying because the obvious reading of the seeded
-- grant table is wrong: `role_permissions` carries `user:read` for `admin` and
-- `manager` and NOT for `member`, and `member` resolves it anyway because
-- `has_permission()` walks UP `roles.parent_id` and `member` → `manager` → `admin`.
-- The resolver inherited one level deep is a documented, measured defect (0001), so
-- this is asserted from the live rows in the suite rather than left to the comment.
CREATE OR REPLACE FUNCTION authz.can_read_user() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.has_permission(authz.actor(), 'user', 'read')
$$;

REVOKE EXECUTE ON FUNCTION authz.can_read_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.can_read_user() TO app_anon, app_member, app_admin;

-- =============================================================================
-- THE POLICIES
-- =============================================================================
-- 0002's `row_scope` was a single `FOR ALL` policy keyed on `current_user`. It is
-- replaced by FOUR policies, one per operation the table actually needs, and that
-- is not a retreat from "one policy per table" — the rule forbids splitting ONE
-- OPERATION's requirements across two PERMISSIVE policies, because they are OR-ed
-- and each admits on its own. It says nothing about splitting the TABLE by verb,
-- which is what `0005_email_messages.sql` already ships (`email_read_scope:SELECT`
-- beside `email_write:INSERT`).
--
-- The alternative considered and rejected is one `FOR ALL` write policy beside the
-- read policy. It behaves identically — `users_write` is false for every role a
-- member can be, so the `OR` on SELECT changes nothing — and it is still wrong:
-- `SELECT * FROM users` would be governed by a predicate whose capability and
-- scope arguments appear nowhere in it, so a future agent reading `pg_policies`
-- would find the self-read policy and take it for the whole truth. Four named
-- policies, each with one job, each assertable by name from the catalog.
--
-- Every `CREATE POLICY` is preceded by its own `DROP POLICY IF EXISTS`, which is
-- what makes a second application a no-op rather than
-- `policy "users_read_scope" for table "users" already exists`. `CREATE POLICY` has
-- no `IF NOT EXISTS` form, and "applies cleanly" and "is idempotent" are different
-- claims — a file that only ever runs once has been shown to do neither. The drops
-- are idempotent themselves, so the pair is safe in any order.
DROP POLICY IF EXISTS row_scope        ON public.users;
DROP POLICY IF EXISTS users_read_scope ON public.users;
DROP POLICY IF EXISTS users_insert     ON public.users;
DROP POLICY IF EXISTS users_update     ON public.users;
DROP POLICY IF EXISTS users_delete     ON public.users;

CREATE POLICY users_read_scope ON public.users FOR SELECT USING (
    current_user = 'app_admin'
    OR id IN (
      SELECT authz.actor() AS actor_id WHERE authz.can_read_user()
    )
);

-- The write path is `current_user`, exactly as 0002 had it, and it is split per
-- verb so the read branch cannot be reached by a write.
--
-- INSERT takes `WITH CHECK` and the other two take `USING`, and that asymmetry is
-- the language, not an oversight: `FOR INSERT` has no rows to filter, so Postgres
-- refuses `USING` there outright with `only WITH CHECK expression allowed for
-- INSERT`. (`FOR ALL` accepts `USING` for INSERT because it stands for all four
-- operations at once — which is precisely the looseness the per-verb split removes,
-- and 0002's single `FOR ALL` policy is why nobody noticed this until now.)
--
-- `WITH CHECK` is omitted on UPDATE on purpose, for the reason 0001 gives: Postgres
-- reuses `USING` for a new row when no `WITH CHECK` is written, so one expression
-- governs both visibility and what a row may be rewritten into. That is verified by
-- a refused out-of-scope write rather than by reading `pg_policies`.
CREATE POLICY users_insert ON public.users FOR INSERT WITH CHECK (current_user = 'app_admin');
CREATE POLICY users_update ON public.users FOR UPDATE USING (current_user = 'app_admin');
CREATE POLICY users_delete ON public.users FOR DELETE USING (current_user = 'app_admin');

-- =============================================================================
-- GRANTS
-- =============================================================================
-- ORDER MATTERS AND THE WRONG ORDER FAILS OPEN. Verified, and recorded in 0001:1021:
-- revoking a column while a table-level `SELECT` grant exists is accepted, exits 0,
-- and changes nothing — the column comes back at HTTP 200 with its value intact. So
-- the shape is:
--
--   REVOKE ALL  ->  verb grants  ->  table-level REVOKE SELECT  ->  column list
--
-- The `REVOKE ALL` at the top is what makes this correct on a database that ALREADY
-- carries the 0002 grants: it is the only statement in the file that can remove a
-- standing table-level `SELECT` from `app_member`, so the `REVOKE SELECT` that
-- follows is a second removal of something already gone. It is written anyway
-- because it is the statement that makes the intent legible, and because a reader
-- who pattern-matches this block against `projects`/`customers` in 0001:1024-1026
-- should find the same four steps in the same order.
REVOKE ALL ON public.users FROM PUBLIC, app_anon, app_member, app_admin;

-- `app_admin` KEEPS TABLE-LEVEL SELECT, and therefore keeps `password_hash`. That
-- is not an oversight and it is not a second hole:
--
--   * `src/auth/auth.service.ts:425,433` reads `id, username, password_hash FROM
--     users` on the login and refresh paths, connected as `pgrst_authenticator`
--     with `SET LOCAL ROLE app_admin`. Narrowing the admin's columns breaks
--     authentication outright, and a narrower column list on the table the
--     credential check reads is the kind of change that passes every test except
--     the one a user notices.
--   * AGENTS.md §B2: "app_admin is a superset, not a bypass: all rows (RLS), all
--     tables (grants)". An admin narrower than a member on one column would invert
--     that, and the column is exactly the one an admin is supposed to hold.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO app_admin;

-- `app_member` gets a COLUMN list with `password_hash` absent, and nothing else.
-- No INSERT, no UPDATE, no DELETE: erasure is a thin-app operation today, and
-- giving a member UPDATE on `users` would be a much larger decision than this
-- migration makes — it would need a per-column UPDATE grant AND a `WITH CHECK`
-- pinning `id`, so that a member cannot rewrite their own `created_at` or repoint
-- `id` at another row. That is a separate change with its own argument, and
-- pretending this migration delivers erasure-as-CRUD would be exactly the
-- "looks finished and isn't" shape (AGENTS.md §2.1).
REVOKE SELECT ON public.users FROM app_member;
GRANT SELECT (id, username, email, created_at) ON public.users TO app_member;

-- `app_anon` gets NO table grant at all. An unauthenticated read is refused at the
-- grant layer with `permission denied for table`, and never reaches the policy —
-- which is the denial that names nothing about the schema behind it.

-- =============================================================================
-- WHAT THIS COSTS THE CLIENT — READ THIS BEFORE ADDING A `SELECT *`
-- =============================================================================
-- A column-restricted role CANNOT use `select=*`. `GET /users` with no `select`
-- parameter defaults to `select=*`, expands to every column including
-- `password_hash`, and Postgres refuses it per column: HTTP 403 for `app_member`.
-- This is the same trade `projects` and `customers` already make (0001:1025-1026),
-- and `test/rls/rls.spec.ts:723` already proves `select=*` is refused on a
-- column-restricted table.
--
-- It costs nothing TODAY, and the reason is worth recording because it is
-- load-bearing for anyone about to add a client call: `angular_v2/openapi.json` is
-- a committed PLACEHOLDER with `"paths": {}` and the generated client at
-- `angular_v2/frontend/src/app/api/schema.ts` is `paths = Record<string, never>`.
-- Nothing in the frontend requests `/users`, so nothing here breaks it, and there
-- is no `npm run generate:client` step in `verify` to re-run. The first client that
-- calls `/users` must name its columns; that call does not exist yet.
--
-- It is also not free of consequences for the served spec: `openapi-mode =
-- "ignore-privileges"` advertises every column of every relation in `db-schemas`
-- regardless of grants, so the generated types for `users` will include
-- `password_hash` while the grant forbids reading it. That is the documented
-- consequence of `ignore-privileges` — "restricted" is not a state PostgREST can
-- represent — and it is why the grant, not the spec, is the control.

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
-- PostgREST caches the schema, and a change made after startup is invisible to it.
-- The two foreign keys are also new EMBED relationships: PostgREST infers both
-- directions of an FK constraint, so `users?select=id,user_groups(…)` and
-- `user_groups?select=group_id,users(…)` become addressable where they were not.
-- Neither is a disclosure — `user_groups` carries its own self-scoping policy, so
-- the forward embed returns only the caller's own memberships, and the reverse one
-- embeds a `users` row the caller may already read; the `user_roles` embed fails
-- closed because `app_member` holds no `SELECT` on that table — but they are new
-- paths, so the reload belongs here rather than in a note.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0008_user_identity.down.sql. Kept as a separate file so
-- this one stays append-only, exactly as in 0001–0007. `test/unit/down-script.spec.ts`
-- fails if this section ever grows a body again.
--
-- ROLLING THIS BACK IS SAFE ONLY WHILE NOTHING DELETES A USER. Plainly: the down
-- script restores the pre-0008 state in full — both constraints dropped, the
-- self-read policy and the four policies replaced by 0002's single
-- `row_scope`, `can_read_user()` dropped, the grants returned to admin-only — so
-- a member can no longer read their own `users` row and any client built against
-- the column grant gets `42501`.
--
-- What it does NOT restore is safety, once an inactivity purge exists. Dropping
-- `user_roles_user_id_fkey` and `user_groups_user_id_fkey` re-opens both orphan
-- paths at once: a purge that deletes `users` rows leaves the principal's role
-- rows and membership rows behind, `has_permission()` keeps resolving the purged
-- user's capabilities from those orphans, and `authz.visible_user_ids()` keeps
-- returning the purged user to every caller who shared a group — so the deleted
-- account retains its authority and its mail history stays readable. The purge will
-- report success. If a purge feature exists, roll this migration back only together
-- with that feature, and verify by catalog rather than by the absence of an error.