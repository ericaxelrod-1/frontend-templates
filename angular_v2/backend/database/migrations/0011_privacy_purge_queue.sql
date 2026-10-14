-- Privacy/DSAR, part three: `privacy_purge_queue` — the retention queue.
-- Target: PostgreSQL 18+, applied as the migration/owner role like every migration.
--
-- Apply as the migration/owner role, the same way 0001–0010 are applied.
--
-- =============================================================================
-- THIS TABLE HAS A CONTRACT WITH CODE THAT ALREADY EXISTS
-- =============================================================================
-- `src/purge/purge-claim.ts` holds four statements against this table —
-- `CLAIM_DUE_PURGE_SQL`, `COMPLETE_PURGE_SQL`, `FAIL_PURGE_SQL` and
-- `REQUEUE_PURGE_SQL` — and the sweeper runs them. Every column they name is
-- named in the block below, with the exact spelling and the exact type, because
-- a rename here is not a rename: it is a sweeper that fails at run time against a
-- table that looks correct. `claimed_by` in particular is the ownership key the
-- whole N-sweeper safety story rests on, and it is not decorative:
--
--   * the claim is one statement — an `UPDATE … FROM (SELECT … FOR UPDATE SKIP
--     LOCKED)` — so there is no interval in which a row is locked but unmarked;
--   * every write AFTER the claim predicates on
--     `status = 'claimed' AND claimed_by = $instance`, never on the primary key
--     alone, which is what makes a write safe with N sweepers;
--   * `attempt` advances on the claim and feeds the retry/backoff, and the
--     poison-pill ladder is unreachable without it.
--
-- The `status` vocabulary here is exactly the four values those statements write
-- (`pending`, `claimed`, `done`, `failed`). `docs/rebase.md` §9A.5 also names
-- `cancelled`, for an operator-initiated cancel. It is deliberately NOT in the
-- CHECK: no code path writes it, `privacy_purge:update` gates a cancel that no
-- route implements yet, and an enum value nothing writes is a status the
-- database appears to support and nothing can produce (§2.1). It is one
-- `ALTER TABLE` when the cancel lands.
-- =============================================================================

-- =============================================================================
-- THE CATEGORY IS UNSCOPED, AND THE ALTERNATIVE WAS REJECTED ON A SPECIFIC ROW
-- =============================================================================
-- §B2's four categories, chosen rather than by analogy:
--
--   Group-scoped  ✗  A purge is not tenant data. It is infrastructure.
--   The hierarchy ✗  It is not a group.
--   DERIVED       ✗  Rejected on a concrete half-row: a retention sweep over
--                       `login_attempts` past its window has NO SUBJECT, so
--                       there is no `user_id` to route through
--                       `authz.visible_user_ids()`. One table, two row
--                       populations, one of them un-ownable by any user — and
--                       forcing it into the derived shape means inventing a
--                       group nobody chose, which is the exact mistake ADR-0025
--                       warns about for `email_messages`.
--   UNSCOPED      ✓  Global operational record-keeping. Simple
--                       `PRIMARY KEY (id uuid DEFAULT uuidv7())`, no `group_id`.
--
-- THE COST OF UNSCOPED IS STATED RATHER THAN HIDDEN: a member cannot read their
-- own pending purge, because the queue is admin-readable only. That is
-- acceptable because the member's window into the same fact is the
-- `privacy_requests` row they can already read, and the anonymisation is recorded
-- there. What would NOT be acceptable is inventing a member-scoped view of a
-- table whose other half has no subject — so there is not one.
CREATE TABLE IF NOT EXISTS public.privacy_purge_queue (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),

  -- THE CLOSED SET OF THINGS A QUEUE ROW CAN ACT ON, and `src/purge/purge-claim.ts`
  -- narrows to exactly these three in `toPurgeClaim()`: a `target_kind` outside
  -- them becomes `undefined` rather than being passed through, so no downstream
  -- `switch` can grow a default branch and start treating an unknown target as
  -- something it is not. This CHECK is the database half of that same decision.
  target_kind   text NOT NULL CHECK (target_kind IN ('user', 'table', 'file')),

  -- THE ROW BEING ACTED ON. `NOT NULL` exactly when the target is a user row,
  -- and the CHECK below says so — `SqlPurgeExecutor.deleteUser()` documents that
  -- constraint as the reason its `targetId === null` branch is unreachable, and
  -- checks it anyway rather than assuming, because a `DELETE … WHERE id = NULL`
  -- deletes nothing and would record that as a successful zero-row purge.
  target_id     uuid,

  -- THE SAME TARGET, NAMED. `target_ref` carries a table or file target; it is
  -- the human-readable half of "what is being deleted", which is the column the
  -- admin view renders (§9A.5).
  target_ref    text,

  -- WHY THIS ROW EXISTS, AS A CLOSED SET. Each code names WHAT GETS DELETED, and
  -- the executor dispatches on it through a closed `switch` whose default branch
  -- RAISES (`UnsupportedPurgeReasonError`) rather than returning a zero that
  -- would read in the admin view as "we deleted a row and it was already gone".
  -- The CHECK and the executor therefore disagree on purpose: the CHECK admits
  -- four reasons and the executor implements one, and a row for the other three
  -- ends as a `failed` row with the reason attached — visible, attributable and
  -- retryable — instead of a `done` row claiming zero deletions.
  --
  -- `inactivity_purge` is ONE code for every `users` row, anonymised or not: see
  -- the invariant section below for why anonymisation is a status and not a
  -- second population with its own lifecycle.
  reason        text NOT NULL CHECK (reason IN (
                  'inactivity_purge',
                  'retention_login_attempts',
                  'retention_unverified_request',
                  'retention_export_artefact')),

  -- THE CLAIM ORDER. `ORDER BY scheduled_for, id` is the sweeper's only query and
  -- its tie-break must be STABLE across two sweepers or two of them contend for
  -- the same row and one does nothing. No DEFAULT: whoever writes a queue row
  -- states when a purge is due, and a default of `now()` would make a row
  -- enqueued for a future retention expiry immediately claimable by a job that
  -- asked for the wrong time.
  scheduled_for timestamptz NOT NULL,

  -- `attempt` advances on EVERY claim, including a failed one, and it is what
  -- the retry/backoff ladder reads and what the poison-pill threshold counts.
  -- `NOT NULL DEFAULT 0` rather than nullable: a null attempt is a third state
  -- nobody has a meaning for, and a comparison against the threshold would treat
  -- NULL as "no attempts yet" on a row that has failed nine times.
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'claimed', 'done', 'failed')),
  attempt       integer NOT NULL DEFAULT 0,

  -- THE OWNERSHIP KEY. Written by the claiming sweeper to its own instance id,
  -- and the predicate on every write after the claim. `text` rather than a
  -- hostname column because the identity is whatever the process can prove about
  -- itself, and an operator reading the admin view needs to distinguish two
  -- instances of the same binary on two machines — which a hostname alone does
  -- not always do.
  claimed_at    timestamptz,
  claimed_by    text,

  -- `completed_at` and `rows_deleted` are set TOGETHER by
  -- `COMPLETE_PURGE_SQL`, and the CHECK at the foot of the table enforces that:
  -- a `done` row with no count is a row claiming a deletion whose size nobody
  -- recorded, and an operator recomputing the expected figure with the same
  -- predicate has nothing to compare against.
  completed_at  timestamptz,
  rows_deleted  integer,
  error         text,

  -- EXACTLY ONE TARGET COLUMN PER KIND. Two CHECKs rather than a boolean
  -- identity, so each is separately readable and separately removable, and
  -- because the second one is what makes `target_ref` load-bearing rather than a
  -- free-text field nothing reads.
  CONSTRAINT privacy_purge_queue_user_needs_an_id
    CHECK (target_kind <> 'user' OR target_id IS NOT NULL),
  CONSTRAINT privacy_purge_queue_non_user_needs_a_ref
    CHECK (target_kind = 'user' OR target_ref IS NOT NULL),

  -- `rows_deleted` IS A COUNT, NEVER NEGATIVE, AND NEVER GUESSED. `0` is a
  -- legitimate answer — a target already gone — and it is legitimate ONLY when
  -- the executor returns the real number it deleted, which is why
  -- `SqlPurgeExecutor` raises rather than returning zero for a reason it cannot
  -- execute.
  CONSTRAINT privacy_purge_queue_rows_deleted_is_a_count
    CHECK (rows_deleted IS NULL OR rows_deleted >= 0),
  CONSTRAINT privacy_purge_queue_done_is_counted
    CHECK (status <> 'done' OR (completed_at IS NOT NULL AND rows_deleted IS NOT NULL)),
  CONSTRAINT privacy_purge_queue_attempt_is_a_count
    CHECK (attempt >= 0),
  -- A finished row keeps its `error` (the poison pill is terminal AND
  -- attributable) and a claimed row must name its owner. The second half is what
  -- makes "this sweeper still owns the row" a question the table answers rather
  -- than one the sweeper remembers.
  CONSTRAINT privacy_purge_queue_claimed_is_owned
    CHECK (status <> 'claimed' OR (claimed_at IS NOT NULL AND claimed_by IS NOT NULL)),
  -- A requeued row carries NO owner: `REQUEUE_PURGE_SQL` clears `claimed_at` and
  -- `claimed_by` together, and a `pending` row that still named a sweeper would
  -- let that sweeper's next write match a row it no longer holds.
  CONSTRAINT privacy_purge_queue_pending_is_unowned
    CHECK (status <> 'pending' OR (claimed_at IS NULL AND claimed_by IS NULL))
);

-- =============================================================================
-- THE PARTIAL UNIQUE — THE DOUBLE-SWEEP GUARD
-- =============================================================================
-- ONE OPEN PURGE PER TARGET, enforced by the DATABASE rather than by an enqueue
-- function remembering to check. Without it, a sweeper that runs twice inside
-- one retention window queues every tombstone twice; the second attempt finds
-- nothing to delete, writes `rows_deleted = 0`, and the admin view reads that as
-- a successful purge — a success-shaped value for work that did not happen
-- (§2.3). The constraint is the control and `ON CONFLICT DO NOTHING` at the call
-- site is only the polite way to be quiet about it.
--
-- `pending` AND `claimed`, because a claimed row is work in flight and a
-- re-enqueue behind it would queue a second purge for a target being deleted
-- RIGHT NOW. `done` and `failed` are terminal, so a later sweep may schedule a
-- fresh purge for the same target.
--
-- `COALESCE(target_id::text, target_ref)` because the two columns are `uuid` and
-- `text` and have no common type — `COALESCE(uuid, text)` is a type error at
-- creation, not a runtime surprise, so the cast goes inside the index and the
-- queue's own columns stay uncast. The cast is inside an EXPRESSION, which §B1's
-- snake_case rule does not govern (it is about identifiers).
--
-- `target_kind` is the leading column so the index also partitions by kind: a
-- file named the same as a user id is not the same target.
CREATE UNIQUE INDEX IF NOT EXISTS privacy_purge_queue_one_open_per_target
  ON public.privacy_purge_queue (target_kind, COALESCE(target_id::text, target_ref))
  WHERE status IN ('pending', 'claimed');

-- "What is due now" is the sweeper's only query, so it gets a PARTIAL index on
-- exactly its predicate: `status = 'pending' AND scheduled_for <= now()`,
-- `ORDER BY scheduled_for, id`. Terminal rows never enter it and never bloat it.
-- `(scheduled_for, id)` rather than `scheduled_for` alone because the tie-break
-- must be stable across two sweepers, and the ids are `uuidv7()` so the tie
-- break IS mint order — which is also the btree-insertion order §B1's key rule
-- is built around.
CREATE INDEX IF NOT EXISTS privacy_purge_queue_due_idx
  ON public.privacy_purge_queue (scheduled_for, id)
  WHERE status = 'pending';

-- The admin table asks a DIFFERENT question — "everything still open, oldest
-- first" — so it gets its own partial index. Reusing the one above would leave
-- the ordering to a sort over the pending subset and, worse, would serve
-- `claimed` rows from an index that excludes them.
CREATE INDEX IF NOT EXISTS privacy_purge_queue_open_idx
  ON public.privacy_purge_queue (scheduled_for, id)
  WHERE status IN ('pending', 'claimed', 'failed');

-- =============================================================================
-- THE INVARIANT: ANONYMISATION AND PURGE ARE DIFFERENT OPERATIONS
-- =============================================================================
-- **Anonymisation rewrites a row in place — the row survives as a tombstone, and
-- the person does not. Purge deletes a row outright.** They are two statements on
-- two tables with OPPOSITE failure modes, and conflating them is not a style
-- mistake; it is the one that either never deletes anything or destroys the
-- evidence:
--
--   * CONFLATED TOWARDS ANONYMISATION — i.e. anonymise everything and never
--     purge — is retention that never expires. Every table with a retention
--     window grows without bound in a template nobody watches, and the specific
--     harm is not disk: it is that the retention policy the template PUBLISHES is
--     one it does not ENFORCE, and an auditor reads the policy. GDPR Art. 5(1)(e)
--     storage limitation and CPRA §1798.100(a)(3) both operate on the documented
--     window, not the intended one.
--   * CONFLATED TOWARDS PURGE — i.e. hard-delete at erasure time — DESTROYS THE
--     COMPLIANCE RECORD. CPRA §1798.105(c)(2) and 11 CCR §7101(a) require the
--     record of a consumer request to be RETAINED for at least 24 months.
--     Erasure that deletes the audit row destroys the only evidence that the
--     request was honoured, which converts compliance from an obligation into an
--     unverifiable claim.
--
-- WHICH IS WHY `privacy_request_audits` IS ON NO PURGE PATH AT ALL. There is no
-- reason code in this table's CHECK that can name it, and that absence is a
-- design decision with a test rather than an omission — an operator who edits
-- the CHECK to add one has found a bug, not extended the mechanism.
--
-- ANONYMISATION IS A STATUS, NOT A SECOND QUEUE POPULATION. An anonymised
-- tombstone is a `users` row like any other row and it becomes a purge candidate
-- through the SAME inactivity scan as every other user: one candidate query, one
-- reason code (`inactivity_purge`), one queue, one admin list. The reason code
-- `erasure_anonymized` was rejected because a code that names a POPULATION
-- implies that population has its own lifecycle, and it does not need one — the
-- two populations differ by one boolean (`users.email_anonymized`), and
-- duplicating that fact onto the queue row restates something the schema already
-- owns, which is how a duplicated fact starts to drift with nothing enforcing
-- either copy.
-- =============================================================================

-- =============================================================================
-- CAPABILITY — TWO NEW PERMISSION ROWS, AND TWO DELIBERATE OMISSIONS
-- =============================================================================
-- Neither of these reuses an existing permission. `privacy_purge:read` is not
-- `privacy_request:read` and not `user:read`: reading what the system is about to
-- delete is a different question from reading what a user asked to delete, and
-- reusing a row makes the grant invisible (`0005:96-101`).
INSERT INTO public.permissions (resource, action_id)
  SELECT 'privacy_purge', 'read'   WHERE EXISTS (SELECT 1 FROM public.actions WHERE name = 'read')
  ON CONFLICT (resource, action_id) DO NOTHING;
INSERT INTO public.permissions (resource, action_id)
  SELECT 'privacy_purge', 'update' WHERE EXISTS (SELECT 1 FROM public.actions WHERE name = 'update')
  ON CONFLICT (resource, action_id) DO NOTHING;

-- TWO OF THE FOUR VERBS ARE DELIBERATELY ABSENT, and the verb vocabulary is
-- exactly `create, read, update, delete`:
--
--   create  NO  Queue rows are written by the erasure path or by the retention
--               scan, never by a person. A human who can insert a purge row has an
--               unaccountable deletion path wearing a queue as a disguise — the
--               invariant above with the log file removed. The control is
--               structural, not documentary: NO serving role holds INSERT on this
--               table, so `privacy_purge:create` could be granted to every role
--               in the database and not one of them could use it.
--   read    YES The admin view. Gated by `authz.can_read_privacy_purge()` in the
--               POLICY, so an admin token whose role lacks the row reads ZERO
--               rows despite holding the table grant.
--   update  YES The CANCEL, and the only reason it exists: an operator must be
--               able to stop a purge that is due but not yet claimed, and nothing
--               else about a purge row is editable by a human. A semantic stretch
--               the permission row says out loud, and it buys one narrow,
--               separately revocable capability.
--   delete  NO  Deleting a queue row looks like a purge, is not a purge, and
--               destroys the record that a purge was scheduled — which is the one
--               record §9A.1 says must not be destroyed. No serving role holds
--               DELETE, so this cannot be granted into existence by accident.
--
-- Grants. `admin` only, matching the table grants below: a permission nobody can
-- reach the table with is a decorative row, and the seed's admin role takes every
-- permission row that exists (`database/seed.ts`), so the superset stays a
-- superset without a second list to keep in step.
--
-- `database/seed.ts` writes the SAME rows, both `ON CONFLICT DO NOTHING`, so a
-- fresh provision and a migrated-then-seeded one agree.
DO $$
BEGIN
  ALTER TABLE public.role_permissions DISABLE TRIGGER role_permissions_grant_subset;

  INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
      FROM public.roles r
      JOIN public.permissions p
        ON p.resource = 'privacy_purge' AND p.action_id IN ('read', 'update')
     WHERE r.name = 'admin'
    ON CONFLICT DO NOTHING;

  ALTER TABLE public.role_permissions ENABLE TRIGGER role_permissions_grant_subset;
END
$$;

-- =============================================================================
-- THE CAPABILITY HELPER
-- =============================================================================
-- No argument, SECURITY DEFINER, pinned search_path, revoked from PUBLIC and
-- granted back — the same four reasons `authz.can_read_email()` gives
-- (`0005:157-202`). No argument because a `who` parameter would let any caller
-- ask what somebody ELSE may read, which turns an authorization helper into an
-- enumeration tool.
CREATE OR REPLACE FUNCTION authz.can_read_privacy_purge() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.has_permission(authz.actor(), 'privacy_purge', 'read')
$$;

REVOKE EXECUTE ON FUNCTION authz.can_read_privacy_purge() FROM PUBLIC;
-- `app_anon` IS in the grant list, and the reason is the rule rather than a
-- preference: a policy expression is evaluated for EVERY role that reaches the
-- table, so without it an unauthenticated read fails with `42501` instead of
-- zero rows — a denial-of-service surface and an oracle that names the policy.
-- A denial must arrive as a denial.
GRANT EXECUTE ON FUNCTION authz.can_read_privacy_purge() TO app_anon, app_member, app_admin;

-- =============================================================================
-- ROW-LEVEL SECURITY
-- =============================================================================
-- ENABLE, and deliberately NOT FORCE.
--
-- CORRECTED, 2026-10-14 — and then CORRECTED AGAIN the same day, which is worth
-- recording rather than tidying away. This paragraph originally justified the
-- choice with a "`SECURITY DEFINER` enqueue function that runs as the OWNER".
-- The first correction said **"there is no such function, and there never was"**,
-- and `0016_purge_machine_path.sql` then built it. Three statements in this
-- comment have each been true and each has stopped being true, which is exactly
-- the failure mode careful prose invites and why its present tense has to be
-- re-checked rather than trusted. **The executable SQL of this file has never
-- changed** — every edit to it is comments only, and the comment-stripped
-- checksum is identical before and after.
--
-- WHAT IS TRUE NOW. `pg_proc` holds six functions over `privacy_purge_queue`:
-- `authz.can_read_privacy_purge()` from this file, plus `claim_due_purge`,
-- `complete_purge`, `fail_purge`, `requeue_purge` and `enqueue_inactive_purges`
-- from `0016`. Five of the six are `SECURITY DEFINER` and run as the OWNER, and
-- `app_admin` LOST `UPDATE` on this table in `0016` — so the four bare `UPDATE`s
-- `src/purge/purge-claim.ts` used to issue no longer exist for any role, and would
-- now fail with `permission denied for table` rather than silently matching zero
-- rows.
--
-- What the writer needs is still worth saying precisely, because it is a weaker
-- statement than the reason it replaces. Every write arrives through the
-- escalation boundary `pgrst_authenticator` + `SET LOCAL ROLE app_admin`, and
-- `privacy_purge_write` below is the policy that admits `app_admin` — **but no
-- serving role holds `UPDATE` any more**, so that policy is presently unreachable
-- and is deliberately KEPT as the second half of the control, so a future
-- table-level `GRANT UPDATE` cannot open a write by itself. **FORCE binds the
-- table OWNER, not `app_admin`**, which owns nothing, so FORCE would change
-- nothing for the machine path in either direction. The choice is therefore not
-- forced by the writer, and this file does not claim it is.
--
-- THE RESIDUAL, stated rather than papered over: not FORCEd, so the migration /
-- owner role bypasses every policy on this table, including the read. That is the
-- same trade `groups` and `user_groups` make (`0001:156-180`, `0001:945-948`),
-- and it is bounded by the same fact — the owner never receives a request.
--
-- The "future SECURITY DEFINER writer" this paragraph used to label a
-- hypothetical is now the shipped mechanism, so it is restated as what it is:
-- **the `authz` writers run as the owner, this table is not FORCEd, and therefore
-- those five functions have no policy applied to them at all.** That is a
-- property of the design rather than an accident, and it is why their narrowness
-- is carried entirely by `EXECUTE` — granted to `app_admin` alone, revoked from
-- `PUBLIC` (`0016`).
--
-- `test/rls/privacy-purge-queue.spec.ts` asserts the GRANT state, the policy set
-- and the per-role denials. It does **not** assert `relforcerowsecurity` for this
-- table, so this paragraph is a recorded trade and not a proven one — and
-- `docs/rebase.md` §9A.8 says so in the same words.
ALTER TABLE public.privacy_purge_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS privacy_purge_read ON public.privacy_purge_queue;
DROP POLICY IF EXISTS privacy_purge_write ON public.privacy_purge_queue;

-- THE READ IS CAPABILITY-ONLY, WITH NO ADMIN BRANCH, and that is deliberate
-- rather than an oversight. `current_user = 'app_admin'` is not here, so an
-- admin token whose role lacks `privacy_purge:read` reads ZERO rows despite
-- holding the table grant: capability is resolved from the ROLE ROWS and never
-- from the database role, and a table that bypasses its own capability axis is
-- the arrangement that produced the recorded escalation (§2.4).
CREATE POLICY privacy_purge_read ON public.privacy_purge_queue
  FOR SELECT USING (authz.can_read_privacy_purge());

-- THE WRITE IS `current_user` AND NOTHING ELSE, and the constraint on it is
-- worth stating because it is unusual: **no capability conjunct appears here**,
-- so the sweeper is not gated on `privacy_purge:update`.
--
-- The sweeper connects through the escalation boundary with
-- `SET LOCAL ROLE app_admin` and NO claims in scope, so `authz.actor()` is NULL
-- inside it and any conjunct naming a permission would deny the retention job on
-- a database whose seed had never run — retention that silently stops deleting
-- anything, which is the one outcome worse than not having the queue. The gate on
-- a human UPDATE is the GRANT below, not this predicate: `app_member` holds no
-- UPDATE at all, so there is no member who can write here.
CREATE POLICY privacy_purge_write ON public.privacy_purge_queue
  FOR UPDATE USING (current_user = 'app_admin');

-- NO INSERT POLICY, because there is also no INSERT GRANT. The control is the
-- GRANT below: `REVOKE ALL` followed by `GRANT SELECT, UPDATE` leaves every
-- serving role — `app_admin` included — without `INSERT` on this table, so an
-- insert is refused by the grant layer with `permission denied for table` and no
-- policy is ever consulted. That is deliberate: "no human path to enqueue" is a
-- property of a grant somebody has to widen visibly, not of a rule in this file
-- that anybody can edit.
--
-- CORRECTED TWICE, 2026-10-14, and the second correction is the current text.
-- The original said the enqueue path "is the owner's, through a SECURITY DEFINER
-- function". The first correction said **no such function exists**, which was true
-- and is no longer: `0016_purge_machine_path.sql` built
-- `authz.enqueue_inactive_purges(uuid[])`, the only `INSERT` into this table in the
-- tree. **The absence of an INSERT policy is therefore still exactly right, and
-- for a stronger reason than it was written with.** The insert happens inside a
-- `SECURITY DEFINER` body that runs as the table OWNER, and the owner is exactly
-- the principal this grant deliberately does not name — no grant is needed to
-- write as yourself, and the function's narrowness is carried entirely by
-- `EXECUTE`, revoked from `PUBLIC` and granted to `app_admin` alone. Had the
-- enqueue been a bare `INSERT`, closing it would have meant a table-level
-- privilege somebody could widen; it is a body, and the privilege to reach the
-- body is one line above.
--
-- So the accurate statement is not "there is no policy because there is no
-- function" and not "there is no policy because there is a function". It is:
-- **no INSERT grant exists for any serving role, and the one writer does not need
-- one.** The policy that would have gated it is absent because the privilege it
-- would gate is absent from every principal that could have used it.
--
-- NO DELETE POLICY AND NO TRUNCATE POLICY. `GRANT DELETE` to nobody, and
-- `TRUNCATE` does not fire a row trigger, so the suite asserts it per role.

-- =============================================================================
-- GRANTS
-- =============================================================================
REVOKE ALL ON public.privacy_purge_queue FROM PUBLIC, app_anon, app_member, app_admin;

-- SELECT and UPDATE to the admin, and NOTHING ELSE.
--
-- UPDATE is what the sweeper's four statements are: they are ordinary `UPDATE`s
-- on this table, so the grant is not optional for them and withholding it would
-- make the shipped sweeper fail.
--
-- CORRECTED, 2026-10-14. This comment previously added that INSERT and DELETE
-- are withheld "because the enqueue path is a SECURITY DEFINER function as the
-- owner". The conclusion is right and the reason is not: **there is no enqueue
-- function in this schema.** INSERT and DELETE are withheld because they are not
-- needed by anything that exists and nothing may have them, and that is the whole
-- of it — stated from the privilege rather than from an absent writer.
--
-- There is also no enqueue route, no enqueue RPC, and no producer of any kind in
-- this tree: `database/seed.ts` writes none, and the `inactivity_purge` scan of
-- `docs/rebase.md` §9A.6 (`authz.enqueue_inactive_purges`) was never built. So
-- today the only things that write a row are the migration role and the RLS
-- suite's own fixtures. The sweeper is a real, working drain over a queue that
-- nothing in this tree fills, and both halves of that sentence are load-bearing
-- for whoever reads the admin view next — an empty queue is not evidence that
-- retention is running. `docs/rebase.md` §9A.8 records it as an open gap rather
-- than a design.
--
-- >>> SUPERSEDED BY `0016_purge_machine_path.sql`, 2026-10-14. The two paragraphs
-- >>> above are kept verbatim because they record a defect that was real and that
-- >>> a reader must know was closed. Both of their load-bearing claims are now
-- >>> false, and the current position is:
-- >>>
-- >>>   * **There IS an enqueue function**, `authz.enqueue_inactive_purges(uuid[])`,
-- >>>     and there is a producer: `PurgeEnqueuer` in
-- >>>     `src/purge/purge-enqueuer.service.ts`, on its own hourly interval,
-- >>>     sweeping for tombstones past `RETENTION_TOMBSTONE_DAYS` and enqueuing
-- >>>     them in one transaction. The queue is no longer filled only by the
-- >>>     migration role and the test fixtures.
-- >>>   * **`UPDATE` is REVOKED from `app_admin` by `0016`**, so the `GRANT` on the
-- >>>     next line no longer describes the live grant state. It is left as written
-- >>>     because a migration file records what it did, and `0016` is the file that
-- >>>     changed it. Every write to this table is now through `authz`.
-- >>>   * **The reason INSERT is withheld is now the strong one**, not the weak
-- >>>     one: the enqueue is a `SECURITY DEFINER` body running as the owner, and
-- >>>     the owner holds no grant on this table. See the INSERT-policy paragraph
-- >>>     above.
-- >>>
-- >>> The window is still a decision with no default: `RETENTION_TOMBSTONE_DAYS` is
-- >>> required in every mode and validated at module-evaluation time
-- >>> (`src/purge/retention-environment.ts`).
-- >>>
-- >>> STILL TRUE, and worth keeping: an empty queue is not evidence that retention
-- >>> is running. That is now a weaker statement rather than a false one — the
-- >>> enqueuer logs every sweep including `scanned: 0, enqueued: 0`, which is the
-- >>> difference between the two.
GRANT SELECT, UPDATE ON public.privacy_purge_queue TO app_admin;

-- `app_member` gets NOTHING. Not "not yet" — nothing: there is no member-scoped
-- question this table can answer, because half its rows have no subject.
-- `app_anon` gets nothing either, so an unauthenticated read is refused at the
-- grant layer with `permission denied for table`, which names nothing about the
-- schema behind it.

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0011_privacy_purge_queue.down.sql. Kept as a separate
-- file so this one stays append-only, exactly as in 0001–0010.
--
-- The rollback is DESTRUCTIVE in the same direction the table exists to prevent:
-- `DROP TABLE` here deletes the record that a purge was SCHEDULED, which is the
-- one record that makes a deletion accountable. The down script says so at
-- length.