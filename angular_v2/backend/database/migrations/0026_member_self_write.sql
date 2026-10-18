-- =============================================================================
-- 0026_member_self_write.sql
--
-- THE MEMBER'S OWN NAME WRITE, AS A PROPERTY OF THE SCHEMA INSTEAD OF A PROPERTY
-- OF ONE `WHERE id = $1`.
-- Target: PostgreSQL 18+, applied as the migration/owner role (`app`).
--
-- =============================================================================
-- WHAT THIS FILE IS, IN ONE PARAGRAPH
-- =============================================================================
--
-- `UsersService.updateMe` wrote a member's `first_name` / `last_name` like this:
--
--     BEGIN; SET LOCAL ROLE app_admin;
--     UPDATE users SET first_name = ..., last_name = ... WHERE id = $1
--      AND deleted_at IS NULL RETURNING <twelve columns>;
--
-- with `$1` read from the verified token's `sub`. It was CORRECT — a member could
-- write their own row and only those two columns — and it was correct BY ACCOMERSE.
-- `app_member` held **no** `UPDATE` on `users` at all (`0008:465-466`), and
-- `users_update` was `USING (current_user = 'app_admin')` (`0008:421`). So the write
-- executed under the one role whose policy admits every row, and `id = $1` was the
-- ONLY thing bounding it. That is exactly the shape AGENTS.md §B2 warns about: the
-- check lives in the application, so a third column in the `SET` list, a forgotten
-- `WHERE`, or a service rewritten to drop the `id` is silent, invisible, and refused
-- by nothing. `0008:457-464` predicted it in writing and deferred it deliberately:
--
--   "A member with UPDATE here would need a per-column UPDATE grant AND a `WITH CHECK`
--    pinning `id`, so that a member cannot rewrite their own `created_at` or repoint
--    `id` at another row. That is a separate change with its own argument."
--
-- This is that separate change. It grants the two columns, and it writes the `WITH
-- CHECK` the earlier file asked for.

-- =============================================================================
-- WHY THE APPEND-ONLY RULE IS NOT BEING STRETCHED
-- =============================================================================
--
-- `0008` has been applied everywhere and its column grant is the twelve-column
-- member READ that the frontend's generated types are pinned to, so it is not edited
-- (§B1). What is re-stated below is the GRANT BLOCK, not `0008` — re-issued in the
-- order that works, so the member's new `UPDATE` grant is not a grant layered on top
-- of whatever the target database happened to carry when this file ran.

-- =============================================================================
-- PREFLIGHT — `users` MUST EXIST AND MUST BE OURS
-- =============================================================================
--
-- Copied from `0008`'s preflight for its reason. This file's whole subject is a
-- POLICY and a GRANT on `users`; applied by a role that does not own the table, both
-- statements are refused and the database is left carrying the pre-0026 write path
-- while the ledger records 0026 — the "looks finished and isn't" shape (§2.1)
-- reached through a migration rather than through a stub.
DO $$
DECLARE
  owner_name text;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION
      '0026 requires public.users, which 0002_refresh_tokens.sql creates; run the migrations in order';
  END IF;

  SELECT pg_get_userbyid(c.relowner) INTO owner_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'users' AND n.nspname = 'public';

  IF owner_name IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION
      'public.users is owned by %, not the migration role %; a policy and a grant cannot be '
      'applied to a table this role does not own, so 0026 would record a member write path that '
      'does not exist. Take ownership (ALTER TABLE public.users OWNER TO %) before migrating, or '
      'recreate the database.',
      owner_name, current_user, current_user;
  END IF;
END
$$;

-- =============================================================================
-- THE WRITE PATH — ONE POLICY, AND WHAT IT NOW DECIDES
-- =============================================================================
--
-- `0008:369-387` explains why `users` carries FOUR policies rather than one `FOR
-- ALL`: the rule forbids splitting ONE OPERATION's requirements across two PERMISSIVE
-- policies, because those are OR-ed, and says nothing about splitting the TABLE by
-- verb. The count stays at four. Only the UPDATE one changes.
--
-- WHAT THE POLICY DECIDES THAT THE SERVICE USED TO, itemised:
--
--   * WHICH ROW may be written — `id = authz.actor()`, read from the verified token
--     inside the transaction PostgREST opens. The service's `WHERE id = $1` and this
--     are the same question asked of two different authorities, and from here there is
--     only one: a service that dropped its `id` would get zero rows rather than every
--     row, because the policy no longer moves with it.
--   * WHICH COLUMN may be written — not at all: that is the GRANT below, and it is
--     the only mechanism in this schema that can withhold a column (§B2 §Operation;
--     `0023:595-616` says the same about the read side).
--   * WHETHER A TOMBSTONE MAY BE NAMED — `deleted_at IS NULL`, borrowed verbatim from
--     `users_read_scope` (`0009:328-337`). The service could not express this one:
--     a PostgREST filter on `deleted_at` is privilege-checked like any other column
--     reference, and `deleted_at` is not in the member's twelve-column grant. Putting
--     it in the policy is not a stylistic choice, it is the only place from which the
--     rule is expressible at all.
--
-- ## WHY THERE IS NO `authz.can_update_user()` CONJUNCT, WHICH IS THE ONE
-- ## DECISION HERE A REVIEWER SHOULD DISAGREE WITH IF THEY DISAGREE WITH ANYTHING
--
-- The obvious shape copies `users_read_scope` and swaps the verb:
--
--     OR id IN (SELECT authz.actor() AS actor_id WHERE authz.can_update_user())   -- REFUSED
--
-- It is refused because it is DEAD. Read the seeded `role_permissions` in
-- `database/seed.ts`: `member` holds `project:read`, `customer:read` and
-- `privacy_request:{create,read,update}`. It holds **no `user:*` row at all**. It
-- resolves `user:read` only by walking UP the role tree — `member` → `manager`, which
-- holds `user:read` and nothing more. So `has_permission(<a plain member>, 'user',
-- 'update')` is FALSE today, and a `can_update_user()` conjunct would refuse
-- `PATCH /api/users/me` for every account the seed creates. The write would be
-- correct and dead.
--
-- The alternative — grant `user:update` to `member` so the helper returns true — was
-- rejected on two independent grounds, and either is sufficient:
--
--   * IT REUSES A CAPABILITY THAT MEANS SOMETHING ELSE. `user:update` is the
--     administrative capability to administer USERS. "A member may correct the
--     spelling of their own name" is not that capability, and §B2 is explicit: "Give a
--     NEW capability its own row — never reuse an existing one. `email:read` is not
--     `user:read` and not `user:create`". Worse, `has_permission()` is an ADVISORY
--     oracle any authenticated member can sweep (§B2 §Capability: 63 unauthenticated
--     probes recovered the administrator's whole permission set). Making it answer
--     `user:update = true` for every member publishes a capability matrix that says
--     something untrue about the boundary that matters.
--   * IT IS A SECOND MECHANISM FOR ONE DECISION (§2.4). Every member holds identical
--     capabilities, there is no per-user grant and no deny, so the capability this
--     write carries is CONSTANT: "a member may write two columns of their own row".
--     §B2 §Operation already names where a CRUD capability lives on this side of the
--     schema — "Object-level security over CRUD belongs to grants, so PostgREST
--     cannot offer an operation the grants withhold even by accident" — and the grant
--     below IS that grant. A conjunct that is always true for a member and always
--     false for `app_member`'s absence would be decoration.
--
-- The policy is therefore keyed on IDENTITY, which is also the honest name for what it
-- answers: "is this row yours?" — a question about the token, never about its contents.
--
-- ## THE POLICY IS TOTAL, AND EVERY BRANCH IS SAFE TO EVALUATE
--
-- §B2 requires every `OR` branch to be evaluable, because `OR` does not short-circuit
-- past a raising operand and a cast that raises takes the whole query down INCLUDING
-- the admin branch. Two things make that true here, and they are the reason the
-- service no longer holds the identity in a parameter at all:
--
--   * `authz.actor()` is the `0001` `plpgsql` function whose `EXCEPTION WHEN others`
--     returns NULL rather than raising, so a malformed or empty `sub` makes
--     `deleted_at IS NULL AND id IN (SELECT NULL ...)` evaluate to NULL, which a
--     `USING` clause treats as a denial. `authz.can_read_user()` is not called by this
--     policy at all, so the member branch's only function call is the cast-guarded one.
--   * `id IN (SELECT authz.actor() AS actor_id)` is kept as a subquery rather than
--     written `id = authz.actor()`, and that is not decoration either: a bare scalar
--     comparison keeps the `STABLE` call in the qual, where it is evaluated once per
--     CANDIDATE ROW (§B2: `email_messages` measured 1 call inside the hoisted subquery
--     against 3,300 beside it, at 3,300 rows). Inside an uncorrelated subquery the planner
--     lifts it to a one-time filter. `test/rls/user-identity.spec.ts` asserts that count for
--     the read policy; `test/rls/member-self-write.spec.ts` asserts the catalog shape here
--     and re-runs the same reasoning against the shipped `USING` text.
--
-- `app_admin` KEEPS `current_user = 'app_admin'` and it is still FIRST, because the
-- admin is the superset principal and not a bypass: erasure
-- (`erasure.service.ts`'s anonymisation rewrite), the retention sweeper's
-- `DELETE FROM users` (`0016`), the seed's admin provisioning and every admin path
-- write these columns, and `users_read_scope` already reasons the same way.
DROP POLICY IF EXISTS users_update ON public.users;

CREATE POLICY users_update ON public.users FOR UPDATE
  USING (
    current_user = 'app_admin'
    OR (
      deleted_at IS NULL
      AND id IN (SELECT authz.actor() AS actor_id)
    )
  )
  WITH CHECK (
    current_user = 'app_admin'
    OR (
      deleted_at IS NULL
      AND id IN (SELECT authz.actor() AS actor_id)
    )
  );

-- =============================================================================
-- WHY THE `WITH CHECK` IS WRITTEN OUT WHEN `0008`/`0009` OMITTED IT
-- =============================================================================
--
-- AGENTS.md §B2 says omitting `WITH CHECK` is safe because PostgreSQL reuses `USING`
-- for a new row, and `0008:414-419` leans on that. Omitting it here would be a
-- regression, and the reason is the one this whole file exists to address: an
-- inherited clause is a guarantee NOBODY CAN SEE IN THE CATALOG.
--
-- `pg_policies` reports an UPDATE policy's `USING` in `qual` and leaves `with_check`
-- NULL. A `users_update` with no `WITH CHECK` therefore reads — to `pg_policies`, to
-- `\d users`, to the next agent who greps for it — as a policy that says nothing at
-- all about what a row may be REWRITTEN INTO. The guarantee is real and invisible,
-- which is the same pair §B2 calls the worst available: a control that does nothing
-- next to a comment that says it does, or here a control that does something next to
-- a schema that does not show it.
--
-- So both clauses are written, and the member's half of each says the same two
-- things in the same order:
--
--     USING       current_user = 'app_admin'
--                 OR (deleted_at IS NULL AND id IN (SELECT authz.actor() AS actor_id))
--
--     WITH CHECK  current_user = 'app_admin'
--                 OR (deleted_at IS NULL AND id IN (SELECT authz.actor() AS actor_id))
--
-- and the duplication is the point, not an oversight to be tidied away later. What it
-- buys is that the `WITH CHECK` is INDEPENDENT of the `USING`: a later migration that
-- relaxes `users_update` to admit, say, any undeleted row of the caller's GROUP still
-- finds the `WITH CHECK` refusing the write, and `pg_policies.with_check` shows it. The
-- second half of `0008`'s prediction — "so that a member cannot rewrite their own
-- `created_at` or repoint `id` at another row" — is the reason this clause exists:
-- `id` is pinned here, so a grant that was widened to include `id` by accident still
-- cannot repoint a row. `created_at` is pinned by the GRANT and by nothing else; §B2's
-- only mechanism for withholding a column is a column privilege, and no policy clause
-- can express "this column did not change" because a policy sees only the NEW row.
-- That is stated rather than papered over.
--
-- `member-self-write.spec.ts` proves the independence by tampering, and it needs two
-- different shapes of refusal to do it — which is worth stating because they are NOT the
-- same thing and a test that conflates them proves neither:
--
--   * a row the `USING` clause filters out is NOT AN ERROR. The statement simply updates
--     zero rows and exits 0. That is what "a member cannot write a colleague" looks like;
--   * a row the `WITH CHECK` clause rejects IS an error: `42501`, `new row violates
--     row-level security policy`. That is what "a member cannot repoint a row" looks
--     like, and it is why that case asserts on the SQLSTATE and on the row's surviving
--     key rather than on a row count.
--
-- So the repoint case grants `UPDATE (id)` as well, attempts the repoint, and asserts the
-- refusal arrived as the POLICY's — with `id` in the grant the statement would otherwise
-- have succeeded, so the assertion distinguishes the two controls rather than accepting
-- whichever happened to fire.
--
-- The admin's half is unchanged in both clauses, so erasure, the retention sweeper
-- and the seed are untouched: a tombstone being written is `current_user =
-- 'app_admin'` on both sides and passes.

-- =============================================================================
-- GRANTS — `0008`'s ORDER, REPEATED, BECAUSE THE WRONG ORDER FAILS OPEN
-- =============================================================================
--
-- Verified and recorded at `0001:1021`, restated at `0008:427-432` and
-- `0023:512-529`: revoking a COLUMN privilege while a TABLE-level grant exists is
-- ACCEPTED, EXITS 0, and CHANGES NOTHING. So the only order that works is
--
--     REVOKE ALL  ->  verb grants  ->  table-level REVOKE SELECT / UPDATE  ->  column list
--
-- and this file needs the `UPDATE` half of that sentence for the first time, so it is
-- stated here rather than left to be re-derived: `app_member` holds no TABLE-level
-- `UPDATE` on `users` today, but a column-level grant CANNOT SUBTRACT from a
-- table-level one either. A database that arrived here carrying a standing
-- `GRANT UPDATE ON users TO app_member` — a hand-applied repair, a restored dump, an
-- operator's own doing — would end this file with a member who can rewrite every
-- column on their own row, and `GRANT UPDATE (first_name, last_name)` on top of that
-- is a no-op that reads like a restriction. Taking the table-level verb away FIRST is
-- what makes the column list the whole of it.
REVOKE ALL ON public.users FROM PUBLIC, app_anon, app_member, app_admin;

-- `app_admin` KEEPS TABLE-LEVEL EVERYTHING, re-issued because the `REVOKE ALL` above
-- took it away and something must put it back.
--
-- The verb list is IDENTICAL to `0008:455`, `0023:546` and the seed's
-- `createAuthSchema()`, and identical for the reason `database/seed.ts:311-318` gives:
-- two lists that can drift from one another produce a schema whose privileges depend
-- on which command ran last. A table-level grant also covers every column the table
-- acquires later, so the seven columns `0023` added needed no GRANT line and the two
-- `0026` grants do not add one either.
--
-- Narrowing the admin here would break authentication outright:
-- `src/auth/auth.service.ts` reads `id, username, password_hash` on the login and
-- refresh paths, and §B2's "app_admin is a superset, not a bypass" is four
-- mechanisms that all have to be removed before it stops working.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO app_admin;

-- BOTH TABLE-LEVEL READ AND WRITE ARE TAKEN AWAY FROM THE MEMBER FIRST. Neither
-- revoke is cosmetic: without the first, the twelve-column grant below could not
-- narrow anything; without the second, a pre-existing table-level `UPDATE` would
-- swallow the two-column grant whole.
REVOKE SELECT ON public.users FROM app_member;
REVOKE UPDATE ON public.users FROM app_member;

-- ## THE TWELVE READ COLUMNS ARE RE-ISSUED VERBATIM, AND THAT IS THE POINT
--
-- A column-level grant is not CUMULATIVE: `GRANT SELECT (a, b)` REPLACES the role's
-- whole readable set, so every column the list is meant to contain has to be written
-- out (`0023:555-562`). That is why this file, which is about a WRITE, restates
-- `0023`'s read list character for character: it is the union of `0008`'s four,
-- `0012`'s six and `0023`'s two, and it is now maintained in three files instead of
-- two.
--
-- `test/rls/member-self-write.spec.ts` asserts this list against the LIVE CATALOG
-- rather than against this comment, and
-- `test/rls/geo-profile.spec.ts:944-952` already asserts that `password_hash` is
-- still absent from it — so a write migration that quietly narrowed a read is a red
-- run, not a review question.
GRANT SELECT (
    id, username, email, created_at,
    country_code, region_code, city, geo_source, geo_accuracy_km, geo_updated_at,
    first_name, last_name
  )
  ON public.users TO app_member;

-- ## AND NOW THE WRITE — EXACTLY TWO COLUMNS
--
-- `first_name` and `last_name` are the subject's own display data, they are the two
-- columns the self-service profile page is FOR, and they are the only two columns
-- this schema will let an account change about itself.
--
-- Everything else stays out, and the categories are `0023:564-576`'s rather than a
-- new list:
--
--   * `created_at`, `last_login_at`, `last_activity_at` — AUDIT COLUMNS. A subject who
--     can move their own creation timestamp can age themselves past the retention scan
--     (`0017`) or out of a dormancy report, and nothing else in the schema would notice.
--   * `deleted_at`, `deletion_reason`, `email_anonymized` — the erasure record. A
--     subject who can write these can un-delete their own tombstone, and
--     `authz.revoke_subject_authority` (`0009`) is a BEFORE trigger on exactly those
--     columns: un-deleting would not restore the roles it removed, producing an
--     account with a resurrected row and no authority, which reads as corruption.
--   * `disabled_at`, `disabled_by`, `disabled_reason`, `disabled_until` — the
--     enforcement record. A member who can clear `disabled_at` re-enables a suspended
--     account, and §B6's entire suspension story is this column.
--   * `email`, `username`, `password_hash` — credentials. `username` is immutable by
--     trigger (`0023:398-442`) and `email` moves only through the two-phase
--     address change, which proves control of the new mailbox. Neither is reachable
--     through a body this route parses.
--
-- There is NO table-level `UPDATE`, NO `INSERT`, NO `DELETE` and NO `TRUNCATE` for
-- `app_member`, and `test/rls/member-self-write.spec.ts` asserts all four from
-- `has_table_privilege` (which reads `pg_class.relacl` and therefore reports the
-- TABLE-level verb — a column grant does not answer true there) so the two-column
-- grant cannot be mistaken for a whole-table one.
GRANT UPDATE (first_name, last_name) ON public.users TO app_member;

-- `app_anon` gets NO table grant at all, unchanged from `0008:470-472`. An
-- unauthenticated read or write is refused at the grant layer with `permission denied
-- for table` and never reaches a policy — the denial that names nothing about the
-- schema behind it.

-- =============================================================================
-- WHAT THIS COSTS THE CLIENT
-- =============================================================================
--
--   * `openapi.json` and the generated Angular types are UNCHANGED. A privilege is not
--     a column: `openapi-mode = "ignore-privileges"` advertises every column of every
--     relation in `db-schemas` regardless of grants (`0008:489-495`), so nothing here
--     is a wire change and `npm run generate:client` has nothing to regenerate. That
--     is also why the frontend's twelve-column `Pick` stays valid: the read grant it
--     is pinned to is byte-identical to `0023`'s.
--   * A COLUMN-RESTRICTED ROLE CANNOT USE `select=*` (`0008:475-481`), which now
--     applies to the WRITE path as well as the read: `PATCH /users` must carry
--     `select=` naming the twelve columns, or PostgREST's `RETURNING` asks for columns
--     the role cannot read and the write is refused with `42501`. `UsersService.updateMe`
--     names them from `MEMBER_PROFILE_COLUMNS` — the same constant, which is the third
--     thing that list is simultaneously.
--   * `PATCH /users` becomes a route PostgREST can serve, and it can serve exactly one
--     shape of it. There is no per-column verb to misconfigure: the columns are the
--     grant and the row is the policy.

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
-- PostgREST caches privileges in its schema cache, and `UPDATE` on a resource it has
-- already published is a route that 404s or refuses until it reloads. Nothing here
-- adds a column, so the served document is byte-identical — but the RELOAD is what
-- keeps the new verb addressable, and it belongs in the migration rather than in a
-- README step nobody performs.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0026_member_self_write.down.sql. Kept as a separate file
-- so this one stays append-only, exactly as in 0001-0025.
-- `test/unit/down-script.spec.ts` fails if this section ever grows a body again.
--
-- ROLLING THIS BACK BREAKS `PATCH /api/users/me`, AND IT BREAKS IT LOUDLY. The down
-- script drops the policy and reinstates `0008`'s `USING (current_user = 'app_admin')`
-- and removes the member's `UPDATE` grant, so a member's name write raises `42501`
-- rather than silently writing nothing. `UsersService.updateMe` no longer holds a
-- `SET LOCAL ROLE app_admin` to fall back on, so it fails at the grant layer — which
-- is the correct direction for a rollback: a refusal a member sees, not a name that
-- quietly stopped saving. If the thin app's name write is still wanted, roll this back
-- only together with the route change, and verify by catalog rather than by the
-- absence of an error.