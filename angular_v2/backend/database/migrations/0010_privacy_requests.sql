-- Privacy/DSAR, part two: the request, its per-regulation clocks, and the
-- append-only compliance record.
-- Target: PostgreSQL 18+, applied as the migration/owner role like every migration.
--
-- Apply as the migration/owner role, the same way 0001–0009 are applied.
--
-- =============================================================================
-- THREE TABLES, THREE CATEGORIES, THREE DIFFERENT JOBS
-- =============================================================================
--
--   privacy_requests             DERIVED   the request itself
--   privacy_request_regulations  DERIVED   one row per statute, one clock each
--   privacy_request_audits       unscoped  the compliance record. Append-only.
--
-- `docs/rebase.md` §9.4 calls the audit table `privacy_request_events`. The name
-- here is `privacy_request_audits` because that is the name the compliance
-- vocabulary and the surrounding work items use, and a table's name is what a
-- forker greps for. The category and the policy shape are unchanged by the
-- rename; `0009`'s `users` columns are a separate migration and nothing here
-- depends on the order.
-- =============================================================================

-- =============================================================================
-- 1. privacy_requests — DERIVED, no group_id
-- =============================================================================
-- THE CATEGORY IS DERIVED AND THE SHAPE FOLLOWS FROM IT, which is the part an
-- agent pattern-matching the other three tables gets wrong (`0005:7-39`).
--
-- A `group_id` was rejected, for the same two reasons `email_messages` has
-- none, and both apply here verbatim:
--
--   1. A user may hold SEVERAL groups. One column means duplicating the request
--      per group, after which "which groups is this request in?" is ambiguous
--      and every read has to de-duplicate or pick arbitrarily.
--   2. A data-subject request names NO group at all. Its scope is the SUBJECT's
--      membership, resolved per statement; inventing a group puts the row in a
--      scope nobody chose — which is the mistake ADR-0025 names.
--
-- So the primary key is the SIMPLE `id`, exactly as the category requires, and
-- the scope predicate is another table's membership. A composite
-- `PRIMARY KEY (group_id, id)` would carry a column that does not exist.
--
-- `request_key` is a second uuid and it is NOT the primary key, on purpose. It
-- is the correlation id the audit rows carry — see the note on
-- `privacy_request_audits` for why those rows cannot carry a foreign key and
-- therefore need something to correlate against. Minted by the column default,
-- never by the application: §B1 requires every key to be `uuidv7()`, and a
-- supplied value silently bypasses the default, which is what
-- `test/rls/uuid-keys.spec.ts` reads from the catalog to prove.
CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  request_key     uuid NOT NULL DEFAULT uuidv7(),

  -- THE DERIVED SCOPE KEY. Not a group: the SUBJECT USER whose memberships
  -- decide who may read this row.
  --
  -- THIS FK LEAVES THE GROUP-SCOPED SET, which the referential-integrity rule
  -- forbids EXCEPT at a table members cannot write to — and `app_member` holds
  -- no INSERT, UPDATE or DELETE on `users` (`0008:465-466`), so the check cannot
  -- be used as a write path into identity. The residual is the usual one and
  -- 0005:44-55 already records it: FK checks bypass RLS and fail OPEN, so this
  -- is an existence oracle over `users.id` (`23503` versus success reveals any
  -- id, in scope or not). Accepted, bounded by the 122-bit database-generated
  -- key, and asserted — not forgotten.
  --
  -- `ON DELETE CASCADE`, and the reason is the erasure, not the ergonomics. Both
  -- alternatives forbid the orphan by REFUSING the delete, which moves the
  -- guarantee into a two-statement ordering contract ("delete the request rows,
  -- then the user row, in that order, in one transaction") that exists only in
  -- code nobody has written yet. `0008:130-143` gives the full argument for the
  -- same shape on the membership tables, and it applies unchanged: `CASCADE`
  -- makes the outcome a property of the schema rather than a property of a
  -- future caller.
  --
  -- CASCADE CROSSES RLS, as `0008:144-175` records: the referential action runs
  -- in a constraint trigger with the owner's rights and marked NO FORCE RLS.
  -- What it reaches is the request row of the user being erased — that user's
  -- own data, removed by the erasure of that user. Not a tenant payload, not
  -- another user's rows. The escalation this rule guards against is a cascade
  -- that reaches rows the deleting actor could not otherwise write.
  user_id         uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,

  -- The intake facts, repeated on the response audit row so that EVERY audit row
  -- independently satisfies 11 CCR §7101(b) rather than only the first one. See
  -- the §7101(b) paragraph on `privacy_request_audits` for why repetition is the
  -- mechanism and not duplication.
  request_nature  text NOT NULL CHECK (request_nature IN ('access', 'deletion', 'correction', 'opt_out', 'restriction')),
  request_channel text NOT NULL CHECK (request_channel IN ('in_app', 'email')),
  requested_at    timestamptz NOT NULL DEFAULT now(),

  -- `open` is the only state a member may put a row in; `withdrawn` is the only
  -- one they may move it to. The rest are the operator's to write, and the
  -- policy below enforces that rather than trusting the application.
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'fulfilled', 'partially_fulfilled', 'denied', 'withdrawn')),
  closed_at       timestamptz,

  -- A response state and a closing time are the same event; `fulfilled_at` is
  -- not a column because `closed_at` already says when the response was written.
  CONSTRAINT privacy_requests_closed_requires_response
    CHECK (closed_at IS NULL OR status IN ('fulfilled', 'partially_fulfilled', 'denied', 'withdrawn')),
  CONSTRAINT privacy_requests_open_is_not_closed
    CHECK (status NOT IN ('fulfilled', 'partially_fulfilled', 'denied') OR closed_at IS NOT NULL)
);

-- The scope key, the correlation key and the two states an admin list filters
-- on. `user_id` is the one the policy reads; `request_key` is the one the audit
-- correlation reads.
CREATE INDEX IF NOT EXISTS privacy_requests_user_id_idx      ON public.privacy_requests (user_id);
CREATE INDEX IF NOT EXISTS privacy_requests_request_key_idx ON public.privacy_requests (request_key);
CREATE INDEX IF NOT EXISTS privacy_requests_status_idx      ON public.privacy_requests (status, requested_at DESC);

-- =============================================================================
-- 2. privacy_request_regulations — one row per statute, one clock each
-- =============================================================================
-- WHY A CHILD TABLE AND NOT A COLUMN
--
-- GDPR Art. 12(3) and CCPA §1798.130(a)(2) run INDEPENDENT clocks. One person
-- can be under both at once, on different deadlines, with one extension granted
-- and the other not. A single `regulation text` column on the request can hold
-- exactly one of them and therefore cannot express the case that matters. One
-- row per regulation, each carrying its own deadline and its own extension
-- flag, is the shape that can.
--
-- DEDUP BY CONSTRUCTION, which is the whole point of the composite key: a user
-- who picks CCPA when CCPA is already there writes a row that collides with the
-- primary key and is dropped by `ON CONFLICT (request_id, regulation) DO
-- NOTHING`. There is no dedup logic to get wrong, no "does this regulation
-- already exist" branch, and no second spelling of it in the application.
CREATE TABLE IF NOT EXISTS public.privacy_request_regulations (
  -- ON DELETE CASCADE, and here it is uncontroversial: these rows ARE part of
  -- the request. `0008:130-143`'s argument applies — `NO ACTION` would make
  -- `DELETE FROM users` fail with `23503` for every user who ever filed a
  -- request, i.e. block the erasure of exactly the people who filed one.
  request_id  uuid NOT NULL REFERENCES public.privacy_requests (id) ON DELETE CASCADE,

  -- The closed vocabulary. Two statutes, because those are the two this
  -- template can answer for; a forker adds a row by migration rather than by
  -- widening this at runtime, because a widened CHECK is a widened CHECK nobody
  -- reviewed and `ON CONFLICT DO NOTHING` silently starts discarding rows.
  regulation  text NOT NULL CHECK (regulation IN ('gdpr', 'ccpa')),

  -- PER ROW, not per request. See above: the clocks are independent.
  --
  -- `extension_used` is the whole record of whether the clock was moved, so it
  -- is NOT NULL with an explicit `false`: a nullable flag has three states, and
  -- "we do not know whether we extended this" is a state an auditor reads as
  -- "we did not". The absence of a deadline CHECK below is deliberate for the
  -- same reason — a deadline is set by whoever opens the case, and a
  -- `sla_deadline > now()` CHECK would make a row expire by sitting still, which
  -- is the constraint that turns a data table into a clock.
  sla_deadline   timestamptz NOT NULL,
  extension_used boolean NOT NULL DEFAULT false,

  PRIMARY KEY (request_id, regulation)
);

-- The admin's question is "which clocks are overdue, in what order", which is a
-- filter on the deadline across every request rather than a lookup by key.
CREATE INDEX IF NOT EXISTS privacy_request_regulations_deadline_idx
  ON public.privacy_request_regulations (sla_deadline);

-- =============================================================================
-- 3. privacy_request_audits — the compliance record. APPEND-ONLY.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.privacy_request_audits (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),

  -- THE CORRELATION KEY, NOT A FOREIGN KEY.
  --
  -- `privacy_requests` rows are DELETED — by the erasure, by the purge, by an
  -- operator's housekeeping. The compliance record has to outlive them, so a
  -- foreign key is impossible: `CASCADE` would erase the evidence, and `SET
  -- NULL` needs an UPDATE nobody holds, so `DELETE FROM privacy_requests` would
  -- die with `23503` and block the deletion for the whole 24-month retention
  -- window. `request_key` is the join that survives the join being impossible.
  request_key uuid NOT NULL,

  event_type  text NOT NULL CHECK (event_type IN
    ('received', 'responded', 'in_review', 'needs_info', 'extension_granted', 'withdrawn')),

  -- ---------------------------------------------------------------------
  -- THE SIX 11 CCR §7101(b) FIELDS
  --
  -- A record of a consumer request must state WHEN it was made, WHAT it was for
  -- and HOW it arrived; and for a response, WHEN it was sent, WHAT it was and,
  -- where it is a denial, the statutory basis. Six columns, no more, because the
  -- statute enumerates six and an extra column is an extra thing nobody agreed
  -- to retain.
  --
  -- THEY ARE REPEATED ON EVERY ROW, INCLUDING THE RESPONSE ROW, and that is the
  -- load-bearing decision of this table. The obvious design is a header row
  -- carrying the intake facts and detail rows carrying only the response — and
  -- it is wrong, because a compliance record is read row by row. A record whose
  -- intake facts live on a sibling row is incomplete the moment that sibling is
  -- not in the extract, and "not in the extract" is every export, every
  -- pagination page and every single-row query.
  --
  -- So each row independently satisfies §7101(b). The repetition is the
  -- mechanism, not a duplicated fact that can drift: the response row repeats
  -- the intake fields of the SAME request and the write function that appends it
  -- is the only writer, so the two copies are written by one caller in one
  -- transaction or not at all.
  -- ---------------------------------------------------------------------
  requested_at        timestamptz NOT NULL,
  request_nature      text NOT NULL CHECK (request_nature IN ('access', 'deletion', 'correction', 'opt_out', 'restriction')),
  request_channel     text NOT NULL CHECK (request_channel IN ('in_app', 'email')),
  responded_at        timestamptz,
  response_nature     text CHECK (response_nature IN ('fulfilled', 'partially_fulfilled', 'denied', 'withdrawn')),
  denial_basis        text,
  denial_basis_cite   text,

  -- ---------------------------------------------------------------------
  -- SUBJECT IDENTITY: A KEYED DIGEST, NEVER THE ID
  --
  -- `subject_hmac` is the HMAC of the subject's user id under a pepper named by
  -- `pepper_kid`. That is what lets an auditor answer "were all requests from
  -- this subject answered?" after the subject's row is gone, WITHOUT retaining a
  -- link to a person who asked to be forgotten — which is the tension the two
  -- retention obligations create and the reason the id itself is not a column
  -- here. `pepper_kid` is on the row rather than in configuration alone because
  -- a pepper that rotates makes every historical row unverifiable unless the
  -- reader can tell WHICH pepper signed it; a single global "current pepper" is
  -- exactly the answer that stops existing the first time it rotates.
  --
  -- `subject_user_id` is a NULLABLE convenience column for the window in which
  -- the row still exists, and it is NULLABLE ON PURPOSE and carries no foreign
  -- key, for the reason `request_key` carries none: the id is written while the
  -- subject is still there and the column is not required to be, because an audit
  -- row that must be written BEFORE the row exists cannot be a constraint on the
  -- row that follows it.
  -- ---------------------------------------------------------------------
  subject_hmac    bytea NOT NULL,
  pepper_kid      text NOT NULL,
  subject_user_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- =====================================================================
  -- APPEND-ONLY IS A MECHANISM HERE, NOT A NICETY — AND THIS IS WHY
  -- =====================================================================
  -- §7101(b) completeness is a `CHECK`, and a `CHECK` is evaluated ONLY on
  -- INSERT. That is fine for an immutable row and catastrophic for a mutable
  -- one: a row could satisfy every constraint above at the moment it is written
  -- and be emptied afterwards by an `UPDATE`, at which point nothing re-evaluates
  -- anything and the constraint that was supposed to be the guarantee has already
  -- done its only job. There is no way to write a constraint that survives a
  -- mutation of the row it constrains.
  --
  -- So append-only is not tidiness. It is the only shape in which these
  -- constraints mean anything, and it is enforced by the absence of grants
  -- rather than by a rule: NO serving role holds INSERT, UPDATE, DELETE or
  -- TRUNCATE on this table — `app_admin` INCLUDED, which is the half that is
  -- actually load-bearing, because `app_admin` is the superset principal and
  -- every other table in this schema grants it the full set. Writes go through
  -- `authz.append_privacy_request_audit()` below, which is `SECURITY DEFINER`
  -- and lives in `authz` — outside `db-schemas`, so PostgREST cannot address it
  -- from `/rpc/` either.
  --
  -- The constraints below are what the append-only property buys:
  CONSTRAINT privacy_request_audits_response_is_complete
    CHECK (event_type <> 'responded'
           OR (responded_at IS NOT NULL AND response_nature IS NOT NULL)),
  CONSTRAINT privacy_request_audits_non_response_has_no_response
    CHECK (event_type = 'responded'
           OR (responded_at IS NULL AND response_nature IS NULL)),
  -- A denial with no statutory citation is an unverifiable denial, so the two
  -- columns move together: a basis without a citation and a citation without a
  -- basis are each half of a claim nobody can check.
  CONSTRAINT privacy_request_audits_denial_basis_is_paired
    CHECK ((denial_basis IS NULL) = (denial_basis_cite IS NULL)),
  CONSTRAINT privacy_request_audits_denial_needs_a_basis
    CHECK (response_nature IS DISTINCT FROM 'denied' OR denial_basis IS NOT NULL),
  -- The clocks run forwards and a response cannot predate the request it
  -- answers. A row that violates this is a mis-stamped record, and it is far
  -- cheaper to refuse at INSERT than to discover during a regulator's visit.
  CONSTRAINT privacy_request_audits_response_is_not_before_the_request
    CHECK (responded_at IS NULL OR responded_at >= requested_at)
);

-- Correlation and the audit read, which is a time-ordered scan.
CREATE INDEX IF NOT EXISTS privacy_request_audits_request_key_idx ON public.privacy_request_audits (request_key, created_at);
CREATE INDEX IF NOT EXISTS privacy_request_audits_subject_idx      ON public.privacy_request_audits (subject_hmac, requested_at);

-- =============================================================================
-- CAPABILITY — FOUR NEW PERMISSION ROWS, AND WHAT IS DELIBERATELY MISSING
-- =============================================================================
-- Capability is `resource` + `action` over a TABLE, so a new capability is ONE
-- inserted row and no migration of the grants (`0005:88-93`). Four rows, none of
-- them a reuse: `privacy_request:read` is not `user:read`, and
-- `privacy_request_audit:read` is not `privacy_request:read`, because the denial
-- basis is compliance-review material and a member who can see that a request
-- was DENIED is reading a compliance record they have no business reading.
-- Reusing a permission makes the grant invisible: widening `user:read` for an
-- unrelated reason would silently widen request visibility and nobody reading
-- that diff would know (`0005:96-101`).
--
-- NO `privacy_request:delete`, AND THAT IS THE LOAD-BEARING OMISSION.
--
-- CPRA §1798.105(c)(2) and 11 CCR §7101(a) both require the record of a
-- consumer request to be RETAINED for at least 24 months. A `delete` capability
-- on the request table would be a capability to erase a compliance obligation,
-- and it would be the FIRST such capability anyone reaches for, because deleting
-- the thing the user asked you to do is the most intuitive response to a user
-- asking to be forgotten. The retention lives in `privacy_request_audits`, which
-- no serving role can write at all; `privacy_requests` holds the working copy,
-- and the working copy is allowed to be cascade-deleted with its subject.
--
-- GUARDED BY `WHERE EXISTS (SELECT 1 FROM actions WHERE name = …)`, because
-- `actions` is SEEDED, never migrated (§B1): `permissions.action_id` is a real
-- foreign key to `actions(name)`, so on a migrated-but-not-yet-seeded database
-- an unguarded insert fails the foreign key outright (`0005:103-108`).
INSERT INTO public.permissions (resource, action_id)
  SELECT 'privacy_request', 'create'    WHERE EXISTS (SELECT 1 FROM public.actions WHERE name = 'create')
  ON CONFLICT (resource, action_id) DO NOTHING;
INSERT INTO public.permissions (resource, action_id)
  SELECT 'privacy_request', 'read'      WHERE EXISTS (SELECT 1 FROM public.actions WHERE name = 'read')
  ON CONFLICT (resource, action_id) DO NOTHING;
INSERT INTO public.permissions (resource, action_id)
  SELECT 'privacy_request', 'update'    WHERE EXISTS (SELECT 1 FROM public.actions WHERE name = 'update')
  ON CONFLICT (resource, action_id) DO NOTHING;
INSERT INTO public.permissions (resource, action_id)
  SELECT 'privacy_request_audit', 'read' WHERE EXISTS (SELECT 1 FROM public.actions WHERE name = 'read')
  ON CONFLICT (resource, action_id) DO NOTHING;

-- The grants. `database/seed.ts` writes the SAME rows (the seed owns the grant —
-- roles are seeded, never migrated, §B1), both `ON CONFLICT DO NOTHING`, so
-- whichever runs second is a no-op and a fresh provision and a migrated-then-
-- seeded one end up identical.
--
-- WHO HOLDS WHAT, and each line is a decision rather than a list that grew:
--
--   privacy_request:create   member, manager, admin — a data-subject right is
--                             self-service by definition. A member may file for
--                             THEMSELVES only; the policy below says so.
--   privacy_request:read     member, manager, admin — the subject must be able to
--                             read their own request. It is ALSO the operator's
--                             read of the cases in scope, and the POLICY is what
--                             tells the two apart: because the capability is held
--                             by every tier and §B2's resolver inherits upward,
--                             capability alone cannot, so the subject branch is
--                             `user_id = authz.actor()` and only the
--                             `app_admin` principal gets the closure. That is why
--                             this capability row is not, on its own, the reason a
--                             colleague cannot read a colleague — the policy is,
--                             and the suite proves it by planting two requests in
--                             one group.
--   privacy_request:update   member, manager, admin — the member's use is
--                             WITHDRAWAL, enforced by the `WITH CHECK` on the
--                             update policy. Responding, denying and closing are
--                             the operator's, and the same `WITH CHECK` is what
--                             stops a member from writing `fulfilled` on their
--                             own row — a member who could mark their own request
--                             satisfied would be able to manufacture a compliance
--                             claim, and nothing else in the schema would notice.
--   privacy_request_audit:read  admin ONLY. See above.
--
-- `assert_grant_subset()` (0004) refuses a `role_permissions` write that carries
-- no caller identity and is not the superset principal, and a migration runs as
-- the owner, which is deliberately not a member of any serving role. The trigger
-- is disabled for this one statement and re-enabled by the same transaction,
-- which `0005:118-155` argues in full: `ALTER TABLE … DISABLE TRIGGER` is
-- transactional, so a failure anywhere in the window — including the INSERT —
-- rolls the disable back with it.
DO $$
BEGIN
  ALTER TABLE public.role_permissions DISABLE TRIGGER role_permissions_grant_subset;

  INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
      FROM public.roles r
      CROSS JOIN public.permissions p
     WHERE r.name IN ('admin', 'manager', 'member')
       AND (p.resource = 'privacy_request' AND p.action_id IN ('create', 'read', 'update'))
    ON CONFLICT DO NOTHING;

  INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
      FROM public.roles r
      JOIN public.permissions p
        ON p.resource = 'privacy_request_audit' AND p.action_id = 'read'
     WHERE r.name = 'admin'
    ON CONFLICT DO NOTHING;

  ALTER TABLE public.role_permissions ENABLE TRIGGER role_permissions_grant_subset;
END
$$;

-- =============================================================================
-- THE CAPABILITY HELPERS — no-argument, SECURITY DEFINER, pinned search_path
-- =============================================================================
-- Four wrappers, one per capability, each for the same four reasons
-- `authz.can_read_email()` gives (`0005:157-175`):
--
--   * NO ARGUMENT, so a caller can only ever ask about ITSELF. A `who`
--     parameter turns an authorization helper into an enumeration tool, and that
--     is how 63 unauthenticated probes recovered an administrator's complete
--     permission set (`0001:646-668`).
--   * SECURITY DEFINER, so the call to `has_permission` runs with the OWNER's
--     privileges and no serving role needs SELECT on the permission matrix.
--   * `search_path` PINNED, or a later-searched schema could shadow anything the
--     body names.
--   * EXECUTE revoked from PUBLIC below, and granted back — a revoke without a
--     grant is strictly worse than nothing, because every scoped read then dies
--     with `permission denied for function` and row scoping is 100%
--     non-functional while every policy, grant and comment still looks correct.
CREATE OR REPLACE FUNCTION authz.can_create_privacy_request() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT public.has_permission(authz.actor(), 'privacy_request', 'create') $$;

CREATE OR REPLACE FUNCTION authz.can_read_privacy_request() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT public.has_permission(authz.actor(), 'privacy_request', 'read') $$;

CREATE OR REPLACE FUNCTION authz.can_update_privacy_request() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT public.has_permission(authz.actor(), 'privacy_request', 'update') $$;

CREATE OR REPLACE FUNCTION authz.can_read_privacy_request_audit() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT public.has_permission(authz.actor(), 'privacy_request_audit', 'read') $$;

-- `app_anon` IS in every grant list below, and it is not a preference: a policy
-- expression is evaluated for EVERY role that reaches the table, so without it
-- an unauthenticated read fails with `42501` instead of zero rows — a denial-of-
-- service surface and an oracle that names the policy. A denial must arrive as a
-- denial. (`app_anon` holds no table grant on any of the three tables, so in
-- practice it never evaluates these; the grant is what makes that a
-- zero-row answer rather than an error if a grant is ever widened.)
REVOKE EXECUTE ON FUNCTION authz.can_create_privacy_request()        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authz.can_read_privacy_request()          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authz.can_update_privacy_request()        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authz.can_read_privacy_request_audit()    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.can_create_privacy_request()        TO app_anon, app_member, app_admin;
GRANT EXECUTE ON FUNCTION authz.can_read_privacy_request()          TO app_anon, app_member, app_admin;
GRANT EXECUTE ON FUNCTION authz.can_update_privacy_request()        TO app_anon, app_member, app_admin;
GRANT EXECUTE ON FUNCTION authz.can_read_privacy_request_audit()    TO app_anon, app_member, app_admin;

-- =============================================================================
-- ROW-LEVEL SECURITY
-- =============================================================================
-- ENABLE and FORCE on the two tables a serving role WRITES, because a table's
-- owner bypasses its own policies and nothing errors when it does.
ALTER TABLE public.privacy_requests            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_requests            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_request_regulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_request_regulations FORCE ROW LEVEL SECURITY;

-- `privacy_request_audits` is ENABLEd and deliberately NOT FORCEd, and the
-- precedent is measured rather than preferred: its only writer is
-- `authz.append_privacy_request_audit()`, which is `SECURITY DEFINER` and
-- therefore runs as the OWNER. Under FORCE the owner is bound by this table's own
-- policy, `current_user` inside the function is the owner rather than
-- `app_admin`, the predicate is false, and EVERY audit write fails — the
-- compliance record would be unreadable-by-construction. The same is why
-- `groups` and `user_groups` are not FORCEd (`0001:156-180`).
--
-- The trade is stated rather than buried: the owner can read and write the audit
-- trail unrestricted. It is the same trade `user_groups` makes, and it is
-- bounded the same way — the owner never receives a request, and the blast
-- radius is a record of deletions rather than tenant payload. Every
-- REQUEST-serving role is bound by the policy below, including `app_admin`.
ALTER TABLE public.privacy_request_audits ENABLE ROW LEVEL SECURITY;

-- ONE POLICY PER OPERATION, never two PERMISSIVE policies on the same operation:
-- those are OR-ed, so a scope policy covering DELETE admits it alone, and the
-- measured failure that produced the rule was a member holding ZERO capabilities
-- running DELETE and INSERT with no error and no warning (`0001:872-890`). The
-- per-verb split is not a retreat from "one policy per table" — the rule forbids
-- splitting ONE OPERATION's requirements, and it says nothing about splitting a
-- table by verb, which is what `0005` (`email_read_scope` beside `email_write`)
-- and `0008` (four per-verb policies on `users`) already ship.
--
-- Every `CREATE POLICY` is preceded by its own `DROP POLICY IF EXISTS`, because
-- `CREATE POLICY` has no `IF NOT EXISTS` form and a file that has only ever run
-- once has been shown to apply cleanly and to be idempotent by different claims.
DROP POLICY IF EXISTS privacy_request_read   ON public.privacy_requests;
DROP POLICY IF EXISTS privacy_request_create ON public.privacy_requests;
DROP POLICY IF EXISTS privacy_request_update ON public.privacy_requests;

-- THE READ, AND IT IS NOT A COPY OF `email_read_scope`
--
-- `email_read_scope` answers "whose mail may this caller read?", and for mail the
-- answer is the group closure: a colleague's history is a manager's job and nobody
-- else's. A data-subject request is not that. `privacy_request:read` is held by
-- EVERY tier — member, manager, admin — because a subject who cannot read their own
-- request cannot exercise the right they are exercising. Granting the same
-- capability to everybody and then filtering everybody by the same closure would
-- therefore publish every colleague's request to every colleague with no way to
-- narrow it, because §B2's capability axis CANNOT be the discriminator: `has_permission`
-- walks UP the role tree (`0001:373-387`), so a user holding `member` resolves the
-- ancestor set {member, manager, admin} and holds EVERY row `admin` holds.
--
-- THAT IS THE WHOLE REASON THIS PREDICATE HAS TWO BRANCHES. The operator discriminator
-- has to come from somewhere capability does not already saturate, and the only such
-- thing in this schema is the database role — which §B2 endorses for exactly this
-- ("Key the admin branch on `current_user`, never on the `role` claim"). `app_admin`
-- is the principal the boundary GRANT admits, it is not a token field, and it still
-- has to hold `privacy_request:read` below, so this is not a bypass: remove the
-- capability row and the admin reads zero rows with the branch still present.
--
--   * SUBJECT BRANCH — `v.user_id = authz.actor()`. The subject's own request, and
--     the only row any tier but the operator can reach.
--   * OPERATOR BRANCH — `current_user = 'app_admin'` AND the subject is in the
--     caller's group closure, read through the same `authz.visible_user_ids()` the
--     mail table uses. The closure is NOT widened: an admin sees requests for users
--     in their own closure, which is a narrower read than every other admin branch
--     in this schema and the reason this is not simply "every request in the
--     database".
--
-- ONE PREDICATE, UNCORRELATED WITH THE TABLE, HOLDING BOTH AXES. Neither the visible
-- set nor the capability answer depends on which row is being tested, which is what
-- lets the planner hoist the whole thing into a hashed SubPlan evaluated once per
-- statement.
--
-- EVERYTHING LIVES INSIDE THE SUBQUERY — the union, the capability helper and the
-- `current_user` test alike — and that is the whole difference between a policy that
-- costs one capability resolution and one that costs one PER CANDIDATE ROW. Beside the
-- `IN`, a `STABLE` function is still evaluated once per row: `STABLE` means "the same
-- answer within this statement", NOT "called once". Inside the uncorrelated subquery
-- it becomes a One-Time Filter. MEASURED on `email_messages`: 1 call inside against
-- 3,300 beside at 3,300 rows (7.6 ms against 1.3 s).
-- `test/rls/privacy-requests.spec.ts` asserts the call count from
-- `pg_stat_user_functions` and not the plan alone — `loops = 1` is NECESSARY AND NOT
-- SUFFICIENT, and a function that was never called has NO ROW there, so a missing row
-- reads as zero rather than as a broken measurement.
--
-- A CLAIMLESS READER GETS ZERO ROWS, and that falls out of the shape rather than being
-- a separate guard: `authz.actor()` is NULL, so the subject branch never matches, and
-- the operator branch evaluates its closure against an empty capability answer.
CREATE POLICY privacy_request_read ON public.privacy_requests FOR SELECT USING (
  privacy_requests.user_id IN (
    SELECT v.user_id
      FROM (
        SELECT authz.actor() AS user_id
        UNION
        SELECT u.user_id FROM authz.visible_user_ids() AS u (user_id)
      ) AS v
     WHERE authz.can_read_privacy_request()
       AND (v.user_id = authz.actor() OR current_user = 'app_admin')
  )
);

-- THE WRITE PATH. `current_user`, never a token field: Postgres sets
-- `current_user` from the SET ROLE the escalation boundary has already
-- constrained to three roles, and a member who forges `"role":"app_admin"` into
-- their own validly-signed token gets nothing.
--
-- SELF-SERVICE ONLY. `user_id = authz.actor()` is the whole of the member's
-- right: a data-subject request is a statement by the subject ABOUT the
-- subject, and a member who can open one about somebody else has turned the
-- privacy request path into a way to start an administrative process against a
-- colleague — and, once the operator responds to it, a way to learn that
-- colleague's request was denied.
CREATE POLICY privacy_request_create ON public.privacy_requests
  FOR INSERT WITH CHECK (
    current_user = 'app_admin'
    OR (user_id = authz.actor() AND authz.can_create_privacy_request())
  );

-- `WITH CHECK` is the load-bearing half of this policy and it is omitted for
-- nobody. Postgres reuses `USING` when no `WITH CHECK` is written, so a member
-- could take their own row from `open` to `fulfilled` and manufacture a
-- satisfied request. The member's only reachable end state is `withdrawn`;
-- everything else is the operator's, and the admin branch above is the
-- superset principal answering for itself.
CREATE POLICY privacy_request_update ON public.privacy_requests
  FOR UPDATE
  USING (
    current_user = 'app_admin'
    OR (user_id = authz.actor() AND authz.can_update_privacy_request())
  )
  WITH CHECK (
    current_user = 'app_admin'
    OR status IN ('open', 'withdrawn')
  );

-- NO DELETE POLICY AND NO TRUNCATE. `GRANT DELETE … TO no serving role` below is
-- the actual control; the missing policy is the second half of it, so a future
-- table-level `DELETE` grant cannot be opened by editing one policy.

-- ---------------------------------------------------------------------
-- THE REGULATION POLICIES — SCOPE DERIVED THROUGH THE REQUEST
-- ---------------------------------------------------------------------
-- These read `privacy_requests` in the policy expression, which is CORRECT here
-- and is the opposite of the trap `0005:204-235` records. There, a policy
-- subquery read `user_groups` and saw only the caller's OWN rows, because
-- `user_groups` self-scopes — so the scope predicate degenerated to "the
-- recipient is me". Here, `privacy_requests` is scoped by exactly the derived
-- rule the caller should inherit, so the nesting resolves the intended set and
-- a regulation is visible precisely when its request is. Nothing reaches past a
-- policy here on purpose; if the request's policy is ever widened, the
-- regulations follow it, which is the correct direction for a child table to
-- move in.
DROP POLICY IF EXISTS privacy_request_regulation_read   ON public.privacy_request_regulations;
DROP POLICY IF EXISTS privacy_request_regulation_create ON public.privacy_request_regulations;
DROP POLICY IF EXISTS privacy_request_regulation_update ON public.privacy_request_regulations;

-- THE READ IS THE REQUEST'S READ, VERBATIM. A regulation row is visible exactly
-- when its request is — no widening and no narrowing — which is what makes "the
-- GDPR clock and the CCPA clock are one request's two deadlines" readable as a
-- unit by a subject and by an operator alike.
CREATE POLICY privacy_request_regulation_read ON public.privacy_request_regulations FOR SELECT USING (
  request_id IN (
    SELECT r.id
      FROM public.privacy_requests r
     WHERE r.user_id IN (
             SELECT v.user_id
               FROM (
                 SELECT authz.actor() AS user_id
                 UNION
                 SELECT u.user_id FROM authz.visible_user_ids() AS u (user_id)
               ) AS v
              WHERE authz.can_read_privacy_request()
                AND (v.user_id = authz.actor() OR current_user = 'app_admin')
          )
  )
);

-- Intake: the subject adds a statute they are invoking, to their own request, and
-- only at the moment the request exists. The `ON CONFLICT DO NOTHING` on the
-- insert is what makes adding CCPA twice a no-op rather than an error.
CREATE POLICY privacy_request_regulation_create ON public.privacy_request_regulations
  FOR INSERT WITH CHECK (
    current_user = 'app_admin'
    OR (
      request_id IN (
        SELECT r.id FROM public.privacy_requests r
         WHERE r.user_id = authz.actor()
           AND authz.can_create_privacy_request()
      )
    )
  );

-- THE CLOCKS ARE THE OPERATOR'S. `extension_used` is a fact about how the
-- business answered, not something a subject may assert about their own
-- deadline, and `sla_deadline` is set by whoever opens the request and corrected
-- by whoever manages the case. So this UPDATE policy is `current_user` and
-- nothing else — the narrowest predicate in this file, and deliberately.
CREATE POLICY privacy_request_regulation_update ON public.privacy_request_regulations
  FOR UPDATE USING (current_user = 'app_admin');

-- ---------------------------------------------------------------------
-- THE AUDIT POLICY
-- ---------------------------------------------------------------------
-- ONE PREDICATE, TWO CONJUNCTS, both load-bearing. `current_user = 'app_admin'`
-- is the superset principal; the capability conjunct is why an admin token whose
-- role lacks `privacy_request_audit:read` reads ZERO rows despite holding the
-- table grant — which is the shape of every other capability gate in this schema
-- and the reason the permission row is not decorative.
DROP POLICY IF EXISTS privacy_request_audit_read ON public.privacy_request_audits;
CREATE POLICY privacy_request_audit_read ON public.privacy_request_audits FOR SELECT USING (
  current_user = 'app_admin' AND authz.can_read_privacy_request_audit()
);

-- NO INSERT, UPDATE OR DELETE POLICY ON THE AUDIT TABLE. That is the control,
-- and it is enforced twice: there is no policy to admit a write, and — further
-- down — no serving role holds the grant. Either alone would do; both are here
-- because the failure this table exists to prevent is a compliance record edited
-- after the fact, and a single forgotten word in one of them would be invisible.

-- =============================================================================
-- THE WRITE FUNCTION — the only way an audit row comes into existence
-- =============================================================================
-- SECURITY DEFINER, in `authz`, granted to the two authenticated serving roles
-- and to nobody else.
--
-- WHY IT IS NOT A TRIGGER OR A POLICY. The table has no write policy and no
-- write grant, so the writer must be a function; and a function rather than a
-- bare `INSERT` because the row is the compliance record and the constraints
-- above only describe the SHAPE. Two things are not expressible as a constraint
-- and are therefore the function's job:
--
--   * WHO the record is about. A member may file for themselves and not for a
--     colleague — the same self-service rule the INSERT policy applies to
--     `privacy_requests`, expressed here because an audit row is written
--     WITHOUT going through that policy.
--   * WHICH events are an operator's to write. `received` is the subject's own
--     act; `responded`, `in_review`, `needs_info`, `extension_granted` and
--     `withdrawn` are the business's answers about them.
--
-- IDENTITY IS THE `actor()` ARGUMENT AND NEVER `current_user`, because inside a
-- SECURITY DEFINER function `current_user` rebinds to the OWNER — a body reading
-- it answers identically for everyone, which DENIES everyone with an ordinary
-- zero-row result and makes the whole capability axis silently absent
-- (`0001:303-309`). `authz.actor()` reads the verified token's `sub` claim and
-- catches the cast, so a malformed `sub` is a NULL actor and a refusal below,
-- not a 500.
--
-- THE KNOWN LIMITATION, inherited rather than solved: `request.jwt.claims` is a
-- caller-writable custom GUC (`0001` F1), so a caller with direct SQL access can
-- name any actor. The control is architectural — no request-reachable SQL path
-- may `SET` it — and this function inherits that rather than removing it. What
-- it does add is that `app_anon` cannot call it at all, so the anonymous surface
-- has no path to the audit trail whatsoever.
--
-- A malformed call RAISES (42501 for the identity checks, 23514 from the table's
-- own CHECKs for the shape) and never writes a partial row. A write function
-- that swallowed a bad event_type would leave a compliance record with a row
-- that describes nothing.
CREATE OR REPLACE FUNCTION authz.append_privacy_request_audit(
  p_event_type        text,
  p_request_key       uuid,
  p_requested_at      timestamptz,
  p_request_nature    text,
  p_request_channel   text,
  p_responded_at      timestamptz,
  p_response_nature   text,
  p_denial_basis      text,
  p_denial_basis_cite text,
  p_subject_hmac      bytea,
  p_pepper_kid        text,
  p_subject_user_id   uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor   uuid;
  written uuid;
BEGIN
  actor := authz.actor();

  IF actor IS NULL THEN
    RAISE EXCEPTION
      'append_privacy_request_audit: no caller identity in request.jwt.claims; a compliance record '
      'cannot be written by a caller that cannot be named'
      USING ERRCODE = '42501';
  END IF;

  -- A member may file for THEMSELVES. Anyone else requires
  -- `privacy_request:update` — the operator's capability, and the same one the
  -- UPDATE policy on `privacy_requests` uses, so "may this caller act on this
  -- subject?" has one answer rather than two.
  IF p_subject_user_id IS NOT NULL
     AND p_subject_user_id <> actor
     AND NOT public.has_permission(actor, 'privacy_request', 'update') THEN
    RAISE EXCEPTION
      'append_privacy_request_audit: % is not permitted to write a privacy record about %',
      actor, p_subject_user_id
      USING ERRCODE = '42501';
  END IF;

  -- Everything past intake is the business answering a request ABOUT somebody.
  IF p_event_type <> 'received'
     AND NOT public.has_permission(actor, 'privacy_request', 'update') THEN
    RAISE EXCEPTION
      'append_privacy_request_audit: % attempted to write the % event, which is an operator''s to make',
      actor, p_event_type
      USING ERRCODE = '42501';
  END IF;

  -- The shape is the TABLE's business, not the function's: an unknown event_type,
  -- a `responded` row with no response, a denial with no statutory basis, or a
  -- response that predates its own request all raise 23514 from the CHECKs
  -- above. Duplicating those rules here would be a second copy of one vocabulary
  -- (§2.4) and would drift from the constraints the compliance claim rests on.
  INSERT INTO public.privacy_request_audits (
    event_type, request_key,
    requested_at, request_nature, request_channel,
    responded_at, response_nature, denial_basis, denial_basis_cite,
    subject_hmac, pepper_kid, subject_user_id
  ) VALUES (
    p_event_type, p_request_key,
    p_requested_at, p_request_nature, p_request_channel,
    p_responded_at, p_response_nature, p_denial_basis, p_denial_basis_cite,
    p_subject_hmac, p_pepper_kid, p_subject_user_id
  ) RETURNING id INTO written;

  RETURN written;
END
$$;

REVOKE EXECUTE ON FUNCTION authz.append_privacy_request_audit(text, uuid, timestamptz, text, text, timestamptz, text, text, text, bytea, text, uuid) FROM PUBLIC;
-- `app_anon` IS DELIBERATELY ABSENT, and this is the one function family in this
-- migration where the "every policy helper goes to app_anon" rule does not
-- apply: `0001:633-646` states the rule as "does a POLICY call it", and no
-- policy on any of these three tables calls this one. A DEFINER write function
-- reachable anonymously is an escalation.
GRANT EXECUTE ON FUNCTION authz.append_privacy_request_audit(text, uuid, timestamptz, text, text, timestamptz, text, text, text, bytea, text, uuid) TO app_member, app_admin;

-- =============================================================================
-- GRANTS
-- =============================================================================
-- Default deny first, then each grant narrows something that was taken away.
-- A column privilege can only narrow a table grant that has already been removed
-- — `REVOKE SELECT (col)` on top of a standing table-level `SELECT` is accepted,
-- exits 0, and changes nothing (`0001:1021-1026`).
REVOKE ALL ON public.privacy_requests, public.privacy_request_regulations, public.privacy_request_audits
  FROM PUBLIC, app_anon, app_member, app_admin;

-- `privacy_requests`: read, open and withdraw. NO DELETE, NO TRUNCATE — for
-- every serving role including `app_admin`, and the reason is in the permission
-- paragraph above: the record must survive, and this table is the working copy
-- rather than the record.
--
-- `app_member` needs the SELECT grant and it is required rather than optional: a
-- policy expression's subquery runs with the QUERYING role's privileges, so
-- without it the scoped read cannot be evaluated at all.
GRANT SELECT, INSERT, UPDATE ON public.privacy_requests            TO app_member, app_admin;

-- `privacy_request_regulations`: the member adds a statute to their own request
-- at intake; the operator moves the clocks. No DELETE — removing a regulation
-- row is a mutation of a retention record, exactly like deleting an audit row,
-- and the correct spelling of "we got this wrong" is another regulation row.
GRANT SELECT, INSERT, UPDATE ON public.privacy_request_regulations TO app_member, app_admin;

-- `privacy_request_audits`: SELECT to the admin and NOTHING ELSE. No INSERT, no
-- UPDATE, no DELETE, no TRUNCATE — not for `app_member`, and not for
-- `app_admin` either, which is the half that is load-bearing because
-- `app_admin` holds the full verb set on every other table in this schema.
-- `TRUNCATE` does not fire a row trigger, so it is closed by this grant alone and
-- the suite asserts it per role rather than leaving it in a comment.
GRANT SELECT ON public.privacy_request_audits TO app_admin;

-- `app_anon` gets NO table grant on any of the three. An unauthenticated read is
-- refused at the grant layer with `permission denied for table`, which is a
-- denial that names nothing about the schema behind it — never
-- `permission denied for function`, which would mean the policy was reached.

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
-- Three new tables and four new functions. PostgREST 404s a table created after
-- startup with no message explaining why, and `openapi-mode =
-- "ignore-privileges"` means the generated Angular types gain three resources
-- the moment this runs — which is why the reload belongs here.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0010_privacy_requests.down.sql. Kept as a separate
-- file so this one stays append-only, exactly as in 0001–0009.
--
-- ROLLING THIS BACK DESTROYS THE COMPLIANCE RECORD, and the file says so at
-- length. `DROP TABLE privacy_request_audits` is irreversible by construction:
-- there is no other copy of what a request was asked for, when, how it arrived,
-- what the business did about it and under which statutory basis. On a database
-- that has answered a single consumer request this is not a rollback, it is the
-- destruction of the evidence — which is the reason the table has no DELETE for
-- any serving role in the first place.