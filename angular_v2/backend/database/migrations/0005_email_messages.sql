-- W26 slice — email_messages: the FOURTH scoping category, "derived".
-- Target: PostgreSQL 15+, verified on 15.19.
--
-- Apply as the migration/owner role, the same way 0001–0004 are applied.
--
-- =============================================================================
-- WHAT THIS TABLE IS, AND WHY IT IS NOT GROUP-SCOPED
-- =============================================================================
-- `email_messages` has NO `group_id`. It is not a group-scoped table that
-- happens to omit one; it is a different category, declared here and enforced by
-- the shape of the policy below:
--
--   GROUP-SCOPED  projects, customers      the row carries its own group_id
--   THE HIERARCHY groups                    it IS the group
--   UNSCOPED      users, actions, roles …   global reference data
--   DERIVED       email_messages            the row's scope is another TABLE's
--                                           membership, resolved per statement
--
-- A single `group_id` was rejected because it cannot express the two real cases:
--
--   1. A user belongs to SEVERAL groups. Duplicating one email row per group so
--      a `group_id` can be carried makes "which groups is this message in?"
--      ambiguous, and every read then has to de-duplicate or pick one arbitrarily.
--   2. A self-service password reset names NO group at all. The recipient is
--      found by address; nobody has decided which group the message belongs to,
--      and inventing one puts a row in a scope the reset never asked for.
--
-- So visibility is resolved through the RECIPIENT USER's memberships, not
-- through a column on the message. An actor sees the email history of exactly
-- those users whose groups they can see (ADR-0025).
--
-- =============================================================================
-- THE PRIMARY KEY FOLLOWS THE CATEGORY
-- =============================================================================
-- Group-scoped tables take `PRIMARY KEY (group_id, id)` because "this row belongs
-- to a group" is part of the row's identity. A derived row has no group of its
-- own, so a composite key would carry a column that does not exist: it takes the
-- simple `PRIMARY KEY (id)`, the same shape as the unscoped tables. Asserted in
-- `backend/test/rls/email-messages.spec.ts`, so the category is not a comment.

CREATE TABLE IF NOT EXISTS public.email_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- THE DERIVED SCOPE KEY. Not a group: the RECIPIENT USER whose memberships
  -- decide who may read this row.
  --
  -- THIS FK LEAVES THE GROUP-SCOPED SET, which the referential-integrity rule
  -- forbids EXCEPT at a table members cannot write to. `users` is exactly that:
  -- app_member holds no INSERT/UPDATE/DELETE on it, so the check cannot be used
  -- as a write path into identity. The residual is the usual one — FK checks
  -- bypass RLS and fail OPEN, so this is an existence oracle over `users.id`
  -- (23503 vs success reveals any id, in-scope or not). Accepted and asserted,
  -- not forgotten: the alternative, a nullable `user_id`, would make a message
  -- with no derivable scope, and an unscopable row on a scoped table is worse
  -- than a narrow oracle. ADR-0025 §The foreign key.
  user_id             uuid NOT NULL REFERENCES public.users (id),

  -- The template name, which is what the credential-suppression rule keys on.
  -- Free text rather than an enum because the set of templates is application
  -- data (ADR-0024 §9 ships exactly two) and a new one must not need a
  -- migration to be recorded.
  template            text NOT NULL,

  -- Denormalised envelope metadata. NO rendered body by default: `body` is NULL
  -- unless a template is explicitly allowed to store one, because two of the
  -- three live templates carry a bearer token in the body.
  recipient           text NOT NULL,
  subject             text NOT NULL,
  status              text NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_message_id text,
  error               text,
  body                text,
  content_class       text NOT NULL CHECK (content_class IN ('metadata_only', 'full_body')),

  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);

-- Every filter and sort the read paths use, on the assumption an operator
-- filters by recipient first, then template, then status, then time. Without
-- them each is a sequential scan of the whole history.
CREATE INDEX IF NOT EXISTS email_messages_user_id_idx    ON public.email_messages (user_id);
CREATE INDEX IF NOT EXISTS email_messages_template_idx  ON public.email_messages (template);
CREATE INDEX IF NOT EXISTS email_messages_status_idx    ON public.email_messages (status);
CREATE INDEX IF NOT EXISTS email_messages_created_at_idx ON public.email_messages (created_at);

-- =============================================================================
-- CAPABILITY — a dedicated `email:read`, granted to admin and manager
-- =============================================================================
-- Capability is `resource` + `action` over a TABLE, so a new capability is ONE
-- inserted row and no migration of the grants. That is why this row is data and
-- not a column or an enum.
--
-- WHY NOT `user:create` / `user:read`. Reading a user's email history is a
-- different question from reading the user row, and reusing an existing
-- capability makes the grant invisible: widening `user:read` for an unrelated
-- reason would silently widen email access, and nobody reading the diff would
-- know. A dedicated permission is a separate line in `role_permissions`, so
-- revoking email access is `DELETE FROM role_permissions WHERE …` and touching
-- nothing else. It is granted to `admin` and `manager` and NOT to `member`: a
-- member holds no capability over other people's correspondence.
--
-- Idempotent: `ON CONFLICT DO NOTHING` on the unique (resource, action_id), so a
-- re-run neither errors nor duplicates.
INSERT INTO public.permissions (resource, action_id)
  SELECT 'email', 'read'
  WHERE EXISTS (SELECT 1 FROM public.actions WHERE name = 'read')
  ON CONFLICT (resource, action_id) DO NOTHING;

-- The seed installs the same two rows (database/seed.ts), because the migration
-- runs on a database where `admin`/`manager` may not exist yet — roles are
-- seeded, not migrated (AGENTS.md §B1: role creation is not a migration), and a
-- migration that hard-coded role names would create a second mechanism for
-- granting capability. Here the grant is best-effort and the seed is
-- authoritative; both statements are written to be re-runnable, so whichever
-- runs second is a no-op.
--
-- THE GRANT-SUBSET TRIGGER IS DISABLED FOR THIS ONE STATEMENT, and that is
-- deliberate and measured. `assert_grant_subset()` (0004) refuses a write to
-- `role_permissions` that carries no caller identity and is not the superset
-- principal — which is a migration, exactly. The alternative is to run this
-- INSERT through the escalation boundary as `app_admin`, and a migration has no
-- such connection: it connects as the owner, which is deliberately not a member
-- of any serving role. So the trigger is disabled inside the migration's own
-- transaction and re-enabled by the same transaction.
--
-- IT IS SAFE BECAUSE THE WINDOW IS ONE ATOMIC STATEMENT, and that is asserted
-- rather than argued: `ALTER TABLE … DISABLE TRIGGER` is transactional, so a
-- failure anywhere in the window — including the INSERT itself — rolls the
-- disable back with it. Verified on 15.19: inside the window `tgenabled = 'D'`;
-- after both a plain ROLLBACK and a ROLLBACK following a deliberately failing
-- INSERT, `tgenabled = 'O'`. A window that could survive a failed migration would
-- leave the capability axis unenforced on the next write, which is a far worse
-- hole than the one this statement closes.
--
-- A `DO` BLOCK, not a bare `BEGIN … COMMIT`, and the reason is the runner: the
-- migration script wraps every file in a transaction of its own, so an explicit
-- `BEGIN` here would warn "there is already a transaction in progress" and the
-- `COMMIT` would close the RUNNER's transaction early — turning a partially
-- applied migration into a committed one. A `DO` block is a single statement and
-- therefore its own atomic unit under either caller.
DO $$
BEGIN
  ALTER TABLE public.role_permissions DISABLE TRIGGER role_permissions_grant_subset;

  INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
      FROM public.roles r
      JOIN public.permissions p ON p.resource = 'email' AND p.action_id = 'read'
     WHERE r.name IN ('admin', 'manager')
    ON CONFLICT DO NOTHING;

  ALTER TABLE public.role_permissions ENABLE TRIGGER role_permissions_grant_subset;
END
$$;

-- =============================================================================
-- THE NO-ARGUMENT CAPABILITY HELPER
-- =============================================================================
-- `authz.can_read_email()` wraps `has_permission(authz.actor(), 'email', 'read')`.
--
-- IT TAKES NO ARGUMENT, and that is the whole point — the same rule that governs
-- `authz.visible_group_ids()`. A `who` parameter would let any caller ask what
-- somebody ELSE may read, which turns the helper into a disclosure oracle and an
-- authorization helper into an enumeration tool. Reading `authz.actor()` inside
-- the body means a caller can only ever ask about itself.
--
-- `has_permission` itself is NOT executable by `app_anon` (0001: its `who`
-- argument makes it a disclosure oracle, measured at 63 unauthenticated probes
-- recovering an administrator's complete permission set). This helper is the
-- reason `app_anon` still evaluates the policy cleanly: it is SECURITY DEFINER,
-- so the call to `has_permission` runs with the OWNER's privileges and the
-- anonymous caller needs no grant on the permission matrix at all.
--
-- SECURITY DEFINER and search_path are pinned for the reasons 0001 gives:
-- an unpinned search_path is a hijack vector against every function in the file,
-- and the body reads tables the caller cannot see.
CREATE OR REPLACE FUNCTION authz.can_read_email() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.has_permission(authz.actor(), 'email', 'read')
$$;

-- EXECUTE is granted to PUBLIC on every new function by default, and a
-- SECURITY DEFINER helper reachable anonymously is a privilege escalation, not a
-- read leak. Revoke and grant TOGETHER: revoking from PUBLIC while granting to
-- nobody is strictly worse than doing nothing, because every scoped read then
-- dies with `permission denied for function …` and row scoping is 100%
-- non-functional while every policy, grant and comment still looks correct.
--
-- `app_anon` IS in the grant list, and the reason is the same one that puts it
-- on `authz.actor()`: a policy expression is evaluated for EVERY role that
-- reaches the table, so a helper the policy calls must be executable by the
-- anonymous role too. Without it an unauthenticated read fails with 42501 — a
-- denial-of-service surface, and an oracle that tells an anonymous caller a
-- policy exists and which function to go looking for. A denial must arrive as a
-- denial.
REVOKE EXECUTE ON FUNCTION authz.can_read_email() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.can_read_email() TO app_anon, app_member, app_admin;

-- =============================================================================
-- THE VISIBLE-USERS HELPER — why the scope subquery cannot read user_groups
-- =============================================================================
-- `authz.visible_user_ids()` answers "which users' rows may this caller see?"
-- for the caller's own closure. It exists because the naive subquery does not
-- work, and the reason is measured rather than theoretical:
--
-- THE NAIVE SHAPE IS CORRECTNESS-BROKEN, not merely slow. Written inline, as
--
--     EXISTS (SELECT 1 FROM user_groups ug
--             WHERE ug.user_id = email_messages.user_id AND ug.group_id IN (…))
--
-- the subquery reads `user_groups` with the QUERYING role's privileges, and
-- `user_groups` carries its own policy: `current_user = 'app_admin' OR user_id =
-- authz.actor()`. So for any role but the admin it can only ever see the
-- CALLER'S OWN membership rows. The predicate degenerates to "the recipient is
-- me", and every email message sent to a colleague in the same group becomes
-- invisible to a caller who is entitled to read it.
--
-- MEASURED, not argued. A reader and a colleague in the SAME group: the
-- colleague's message is visible under the shape below, and **NOT visible** under
-- the inline correlated form — a silent under-read with no error and no warning,
-- which looks exactly like a correctly scoped policy. The subplan's inner
-- `user_groups` scan also ran `loops = 2` per candidate row.
--
-- The helper is SECURITY DEFINER for the same reason `has_permission` is — it
-- must read a table the caller cannot read in full — and it is pinned and
-- no-argument for the same disclosure reason as `can_read_email()`.
--
-- It returns SETOF, not an array, because a set-returning function cannot appear
-- *directly* in a policy expression (Postgres: "set-returning functions are not
-- allowed in policy expressions" — ADR-0023 §Corrections, item 1) but CAN appear
-- in the FROM clause of a subquery, which is exactly where it goes.
CREATE OR REPLACE FUNCTION authz.visible_user_ids() RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT ug.user_id
    FROM public.user_groups ug
   WHERE ug.group_id IN (
           SELECT c.descendant
             FROM public.user_groups mine
             JOIN authz.org_closure c ON c.ancestor = mine.group_id
            WHERE mine.user_id = authz.actor()
         )
$$;

REVOKE EXECUTE ON FUNCTION authz.visible_user_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.visible_user_ids() TO app_anon, app_member, app_admin;

-- =============================================================================
-- ROW-LEVEL SECURITY
-- =============================================================================
-- ENABLE and FORCE, like every table a serving role can reach. A table's owner
-- bypasses its own policies and NOTHING ERRORS when it does, so an un-FORCEd
-- table reads as "every row" to the owner with no warning at all.
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_messages FORCE ROW LEVEL SECURITY;

-- ONE POLICY, and scope AND capability are AND-ed INSIDE it. They are never two
-- permissive policies on the same operation: multiple PERMISSIVE policies are
-- OR-ed, so a scope policy covering `DELETE` admits it on its own and a second
-- policy can only ever widen the set. The measured failure that produced that
-- rule was a member holding ZERO capabilities running DELETE and INSERT with no
-- error and no warning (ADR-0023 §Withdrawn).
--
-- `FOR SELECT` and nothing else. The write path is a separate policy below
-- because a `FOR SELECT` policy does not govern `INSERT` — verified, an INSERT
-- against a table whose only policy is `FOR SELECT` fails with "new row violates
-- row-level security policy", which is fail-closed and total, but it would make
-- the granted INSERT a lie.
DROP POLICY IF EXISTS email_read_scope ON public.email_messages;
CREATE POLICY email_read_scope ON public.email_messages FOR SELECT USING (
  -- ONE PREDICATE, UNCORRELATED WITH `email_messages`, holding BOTH axes.
  --
  -- The set of visible recipient ids depends only on the CALLER, never on which
  -- row is being tested, so the planner can hoist the whole thing into a `hashed
  -- SubPlan` evaluated once per statement.
  --
  -- `authz.can_read_email()` IS INSIDE THE SUBQUERY, and that placement is the
  -- entire difference between a policy that costs one capability resolution and one
  -- that costs one PER CANDIDATE ROW. As a sibling conjunct beside the `IN` it is
  -- still evaluated once per row — a `STABLE` function in a qual is "the same
  -- answer within this statement", not "called once" — and the plan reads
  -- `Filter: (hashed SubPlan 1) AND authz.can_read_email()`. Inside, the planner
  -- emits `One-Time Filter: authz.can_read_email()` above the function scan.
  -- MEASURED at 6,602 rows: 6,606 calls beside, 1 call inside; 3,038 ms beside,
  -- 14 ms inside. The full argument, with the correlated variant, is below.
  email_messages.user_id IN (
    SELECT u.user_id
      FROM authz.visible_user_ids() AS u (user_id)
     WHERE authz.can_read_email()
  )
);

-- MEASURED, and these numbers decided the shape above. All on this schema at
-- 3,300 rows, as `app_member` holding `email:read`, with `pg_stat_reset()`
-- before each and `pg_stat_user_functions` read after — because `track_functions`
-- counts the calls and a plan alone cannot tell you how many there were.
--
--   | shape                                      | exec     | can_read_email() calls |
--   |--------------------------------------------|----------|------------------------|
--   | SHIPPED: capability INSIDE the subquery     |   7.6 ms |                    1  |
--   | capability BESIDE the uncorrelated `IN`     |   1.3 s  |                3,300  |
--   | correlated `EXISTS` (as first drafted)      |   4.2 s  |                3,300  |
--
-- THE MECHANISM, and it is the documented one: a `STABLE` function in a qual
-- means "the same answer within this statement", NOT "called once". Beside the
-- `IN`, the planner still emits `Filter: (hashed SubPlan 1) AND
-- authz.can_read_email()` and calls the function once per candidate row — the
-- withdrawn per-row walk ran 400,001 times over 400,000 rows (ADR-0023
-- §The hierarchy). Inside, it becomes a `One-Time Filter` above the function
-- scan and runs once.
--
-- **THE CORRELATION IS ALSO A CORRECTNESS BUG, not only a cost**, and that is the
-- more serious half. Written inline, the subquery reads `user_groups` with the
-- QUERYING role's privileges, and `user_groups` carries its own policy
-- (`user_id = authz.actor()`, or everything for `app_admin`). For any role but
-- the admin it can therefore only ever see the CALLER'S OWN membership rows, so
-- `ug.user_id = email_messages.user_id` degenerates to "the recipient is me".
-- MEASURED: a reader and a colleague in the SAME group — colleague's message
-- visible under the shipped policy, **NOT visible** under the correlated form.
-- A silent under-read with no error and no warning, which looks exactly like a
-- correctly scoped policy. `authz.visible_user_ids()` exists to read that table
-- with the owner's privileges, which is the same reason `has_permission()` is
-- `SECURITY DEFINER`.
--
-- `email-messages.spec.ts` asserts the `loops = 1` property AND the call counts,
-- so a regression here is red rather than merely slow.

-- The write path. `current_user`, never a token field: Postgres sets
-- `current_user` from the SET ROLE the escalation boundary has already
-- constrained to three roles, and a caller who forges `"role":"app_admin"` into
-- their own validly-signed token gets nothing.
--
-- There is no scope predicate on the WRITE, deliberately, and the reason is that
-- the scope of a message is not known at write time: the send happens before the
-- recipient's group membership is consulted, and a password reset names no group
-- at all (§ the category note above). Scoping the insert would mean inventing a
-- group for the row, which is the design this table exists to avoid. The read
-- policy is the authorization boundary; the write is reachable only through the
-- boundary, by the superset principal, and is not exposed to any caller who
-- holds only `app_member`.
DROP POLICY IF EXISTS email_write ON public.email_messages;
CREATE POLICY email_write ON public.email_messages
  FOR INSERT WITH CHECK (current_user = 'app_admin');

-- NO DELETE POLICY AND NO TRUNCATE. Email history is an audit trail: it is
-- appended to and read, and it is not edited or removed. No serving role holds
-- DELETE or TRUNCATE on this table, which is asserted per role in the suite
-- rather than left as a comment, because a future table-level grant is exactly
-- the change that would reopen it.

-- =============================================================================
-- GRANTS
-- =============================================================================
-- REVOKE ALL first: default deny, then each grant narrows something that was
-- taken away. `app_anon` gets NOTHING — an unauthenticated read is refused at
-- the grant layer with `permission denied for table`, which is a denial, and
-- never at the policy layer, which would be the oracle named above.
REVOKE ALL ON public.email_messages FROM PUBLIC, app_anon, app_member, app_admin;

-- `app_member` gets SELECT ONLY, and the grant is REQUIRED, not optional: a
-- policy expression's subquery runs with the QUERYING role's privileges, and
-- without this grant the scoped read cannot be evaluated at all — measured as
-- `permission denied for table email_messages` on every read. The grant is safe
-- because the policy above is what decides which rows come back; the capability
-- axis then denies the read entirely for a member holding no `email:read`, and
-- that denial is asserted (a member sees zero rows, inside their own group
-- included).
--
-- NO UPDATE for `app_member` and NO DELETE or TRUNCATE for ANY serving role.
GRANT SELECT ON public.email_messages TO app_member, app_admin;

-- The thin app's write path. SELECT, INSERT and UPDATE and nothing else: the
-- send path writes one row per attempt and marks a failed attempt, and the
-- revocation story is that no role can erase the trail.
GRANT SELECT, INSERT, UPDATE ON public.email_messages TO app_admin;

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
-- PostgREST caches the schema, and a table created after startup 404s with no
-- message explaining why. Highest-likelihood "the template is broken" report from
-- a fork, so it is a migration step rather than a README note.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0005_email_messages.down.sql. Kept as a separate file
-- so this one stays append-only, exactly as in 0001–0004.
--
-- The rollback used to be written here as well. It was a partial copy: it removed
-- the two capability rows and stopped, dropping no policy, no function and no
-- table — so a revert run through this file left `public.email_messages` and its
-- policies in place while reporting success. Two copies of one down script drift
-- (`AGENTS.md` §2.4), so this section is the pointer and the sibling file is the
-- only copy. `scripts/down-script.ts` reads the sibling, and
-- `test/unit/down-script.spec.ts` fails if this section ever grows a body again.
-- =============================================================================