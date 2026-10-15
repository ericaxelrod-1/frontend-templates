-- =============================================================================
-- 0017_last_activity_at.sql — THE SECOND ANCHOR, AND TWO FLOORS THAT ARE FINALLY
--                              ENFORCED WHERE THE POLICY SAYS THEY ARE
-- =============================================================================
-- `0016` built the machine path end to end and left three things undone, all
-- named in its own comments and all load-bearing rather than cosmetic:
--
--   1. `users.last_activity_at` **is not in the schema**, so the scan enqueues a
--      tombstone and nothing else. A live account that has gone quiet is retained
--      forever, which is `0011:222-228` — retention that never expires, and a
--      published retention policy the code does not enforce, which is the harm
--      GDPR Art. 5(1)(e) and CPRA §1798.100(a)(3) are actually about.
--   2. `authz.retention_due_tombstones()` accepts `1`. A fork that sets
--      `RETENTION_TOMBSTONE_DAYS=1` hard-destroys **every tombstone in the
--      repository on the next sweep**, and the only thing that stood between that
--      and a keypress was `retention-environment.ts`'s floor of… 1.
--   3. There is no window at all for a dormant LIVE account, so the question
--      "how long do we keep an account nobody has used" has no answer in this
--      tree — which is a worse answer than a guarded one, because the template
--      publishes a five-year inactivity policy (`0008:115`, `docs/rebase.md`
--      §9A.6) and implements five-year tombstone retention.
--
-- **THIS FILE IS NOT THE ERASURE FEATURE, and the difference is load-bearing.**
-- `authz.retention_due_tombstones()` purges **tombstones**: rows an erasure has
-- already anonymised, where the person is gone and the row is what is left. A
-- privacy deletion REQUEST has no implementation anywhere in this tree — there is
-- no `rtbf` producer, no route, no audit write. A dormant LIVE account is a third
-- population again, and it is retention, not erasure: the account was never
-- asked to leave. Wiring this scan to a deletion request would make an unattended
-- hourly job answer a legal request nobody made, which is the opposite of the
-- separation `0011` was written to protect.
--
-- Reads: `0008_user_identity.sql` (users + FORCE RLS), `0009_anonymisation.sql`
-- (`deleted_at`, the `deleted_at` partial index, the anonymisation choke point),
-- `0011_privacy_purge_queue.sql` (the queue, the reason CHECK, the one-open-per-
-- target index), `0015_purge_user_cascade.sql` (what a purge actually deletes),
-- `0016_purge_machine_path.sql` (the seam this file widens).
-- =============================================================================


-- =============================================================================
-- 1. `users.last_activity_at` — NULLABLE, AND NULL IS A MEANING
-- =============================================================================
-- `timestamptz`, nullable, **no default**, and every existing row is NULL.
--
-- ## WHY NULL AND NOT `DEFAULT now()`, WHICH `docs/rebase.md` §9A.6 AND W65 ASKED FOR
--
-- `DEFAULT now()` looks harmless and is the reason this file could have destroyed
-- real accounts. It writes a value at INSERT time for every row the database
-- creates, and `ALTER TABLE … ADD COLUMN … DEFAULT now()` writes one for every
-- row that already exists. On this schema that is every pre-existing account,
-- stamped at the instant the migration ran — a six-year-old account used every
-- day becomes six years old in one statement, and the very next sweep sees a
-- population of dormant accounts that has been active all along.
--
-- `docs/rebase.md` §9A.6 calls that "a real grace period, not a rounding
-- artefact". It is not. A grace period is measured from something real; this one
-- is measured from the migration, which means **the migration's execution time
-- becomes a retention decision for every account in the repository**, taken by
-- nobody, reviewed by nobody, and different on every clone. That is `0011:222-228`
-- again — the published policy and the enforced one diverging — with a database
-- write instead of a `.env` line.
--
-- ## WHY NULL IS NOT `created_at` EITHER, AND NOT `'-infinity'`
--
-- Both were rejected for the same reason from opposite directions. `created_at`
-- backfill makes every pre-existing account look decades dormant (§9A.6's own
-- argument, inverted): a six-year-old account used daily is the MOST active
-- account in the installation and would be the first one destroyed.
--
-- `'-infinity'::timestamptz` is subtler and was the tempting fix, because it makes
-- NULL "the beginning of time" — which is a *value*, and a value is eligible. A
-- measurement that was never taken must not be destructible, and `-infinity` is
-- precisely the reading that turns "we do not know" into "as old as possible".
--
-- ## SO NULL MEANS "NEVER OBSERVED", AND NEVER-OBSERVED IS NOT ELIGIBLE
--
-- `authz.retention_due_accounts()` below requires `last_activity_at IS NOT NULL`.
-- A row whose activity was never measured is **not** a candidate for
-- destruction, in either direction: it is not dormant, and it is not proven
-- active. We do not destroy an account on the strength of a measurement we never
-- took.
--
-- The operational cost of that choice is real and is stated rather than
-- discovered later: **an account created before this migration, and never
-- authenticated again, is retained forever.** The alternative destroys live
-- accounts the day the migration lands. Retention of an unmeasured row is the
-- recoverable error; destruction of it is not. The next account to authenticate
-- gets its first observation and joins the normal population.
--
-- ## WHY IT IS WRITTEN, NOT DERIVED, AND WHY THE WRITER IS NOT THE CALLER
--
-- Derived (`MAX(created_at)` over some table) was rejected by §9A.6 with the
-- right argument and the wrong remedy: it says "read access should count" and
-- then proposes a table of a user's own actions, which is a tenant payload and
-- an unbounded store, and which nothing in this tree populates. There is no
-- `actions`-per-user table here, so that column would be permanently NULL and
-- would buy nothing.
--
-- `authz.record_user_activity()` writes it, and **the caller never supplies the
-- timestamp** — the function calls `now()` itself. A caller that could write an
-- arbitrary `last_activity_at` could write one in the past and accelerate its own
-- destruction, or one in the future and make an account immortal, and neither is
-- a decision any caller should be making.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

COMMENT ON COLUMN public.users.last_activity_at IS
  'When the application last OBSERVED activity for this account: NULL means never observed. '
  'Never backfilled and never defaulted — see 0017 §1. A NULL row is never eligible for the '
  'dormant-account purge (authz.retention_due_accounts requires IS NOT NULL), because a '
  'measurement that was never taken cannot show that an account is dormant.';

-- =============================================================================
-- 2. THE INDEX THE DORMANT SCAN SERVES, and why it is PARTIAL on BOTH halves
-- =============================================================================
-- §B1: index what you filter on. The predicate is
-- `deleted_at IS NULL AND last_activity_at IS NOT NULL AND last_activity_at < …`,
-- and the table is otherwise appended to forever by registrations.
--
-- Both conjuncts go into the predicate rather than being left to a sequential
-- scan, and the second one is the load-bearing one: it keeps **every unmeasured
-- account** — which is the entire pre-existing population of any real
-- installation — out of the index entirely. An index that contained those rows
-- would be mostly NULLs, and the scan would touch every account ever created on
-- its way to the dormant ones.
--
-- `last_activity_at` leads because the predicate is a range on it; `id` is the
-- tie-break `ORDER BY last_activity_at, id` needs to be stable across two
-- sweepers, exactly as `0009`'s `(deleted_at)` index serves the tombstone scan.
CREATE INDEX IF NOT EXISTS users_last_activity_at_idx
  ON public.users (last_activity_at, id)
  WHERE last_activity_at IS NOT NULL AND deleted_at IS NULL;


-- =============================================================================
-- 3. THE REASON VOCABULARY — ONE MORE CODE, AND WHY THE EXISTING ONE IS NOT REUSED
-- =============================================================================
-- `inactive_account_purge` joins the CHECK, and it is a DIFFERENT code rather
-- than a reuse of `inactivity_purge` for one reason: the operator-facing
-- requirement is ONE filterable list (`0011:242-250`), and a shared code makes
-- the two populations indistinguishable in it. An operator who filters
-- `reason = 'inactivity_purge'` is asking "what is being deleted and why?" — and
-- with one code the answer is "a row that has been inactive", which is true of
-- both populations and therefore tells them nothing. It is also how a
-- wrongly-configured window becomes "every account ever created": a window set to
-- 1 looks, in a shared code, like aggressive-but-plausible tombstone retention
-- rather than like the mass deletion of live accounts it is.
--
-- The drop and the add are in ONE statement group so the table is never without
-- a reason domain. `ALTER TABLE … ADD CONSTRAINT` validates every existing row,
-- and every existing row carries one of the four surviving codes, so the add
-- cannot fail on data; the drop cannot fail because the constraint is named by
-- `0011:92-96` and read back from `pg_constraint` in
-- `test/rls/privacy-purge-queue.spec.ts`.
--
-- `retention_login_attempts`, `retention_unverified_request` and
-- `retention_export_artefact` are untouched and still unimplemented: the CHECK
-- admits four codes the executor implements one, and a row for the other three
-- ends as `failed` with its reason attached rather than as `done` claiming zero
-- deletions. That is `0011:80-87`'s deliberate disagreement, not an oversight.
ALTER TABLE public.privacy_purge_queue
  DROP CONSTRAINT privacy_purge_queue_reason_check;

ALTER TABLE public.privacy_purge_queue
  ADD CONSTRAINT privacy_purge_queue_reason_check
  CHECK (reason IN (
    'inactivity_purge',            -- a TOMBSTONE: erased, anonymised, retained this long
    'inactive_account_purge',      -- a LIVE account whose last OBSERVED activity is this old
    'retention_login_attempts',
    'retention_unverified_request',
    'retention_export_artefact'
  ));


-- =============================================================================
-- 4. THE WRITER — `authz.record_user_activity()`
-- =============================================================================
-- ## WHY IT IS `SECURITY INVOKER` AND NOT `DEFINER`, WHICH IS THE OPPOSITE OF
--    EVERY OTHER FUNCTION IN `authz`
--
-- `0016` records the measurement that forces this: `users` is FORCE ROW LEVEL
-- SECURITY (`0008:326`), so inside a `SECURITY DEFINER` function `current_user`
-- IS THE OWNER, and the owner is bound by `users_read_scope` (`0009:229-241`),
-- whose branches are `current_user = 'app_admin'` and "my own, undeleted row".
-- A definer body therefore updates **zero rows, forever, with no error** — a
-- measured 0 against a table holding 1 row (`0016:393-398`). That is precisely
-- the "looks finished and isn't" failure `AGENTS.md` §2.1 exists to prevent, and
-- the only way this function can work is INVOKER.
--
-- Which raises the obvious question: is INVOKER here a privilege problem? No.
-- The write is a single indexed `UPDATE` on one row, guarded by
-- `users_update` (`current_user = 'app_admin'`) — and `app_admin` **already holds
-- table-level `UPDATE` on `users` outright** (`0008:455`). INVOKER grants this
-- function nothing that `app_admin` did not already have by grant. What INVOKER
-- costs is nothing, and what DEFINER would cost is a silent no-op.
--
-- ## WHY A FUNCTION AT ALL, RATHER THAN AN `UPDATE` IN `auth.service.ts`
--
-- Three things, all of which the statement text cannot do:
--
--   * the TIMESTAMP IS NOT THE CALLER'S. `now()` is called here. A caller that
--     could write an arbitrary `last_activity_at` could accelerate its own
--     destruction (`'-infinity'`) or make itself immortal (`'infinity'`), and
--     neither is a decision a request handler should be making about its own
--     retention.
--   * the WRITE IS NOT ANONYMOUS. A named seam is one line in the catalog and one
--     line in a test; `UPDATE users SET last_activity_at = now() WHERE id = $1`
--     pasted into three callers is three copies that drift, and none of them
--     is where a reader looks for "who may write this column".
--   * `app_anon` and `app_member` cannot reach it. `EXECUTE` is revoked from
--     PUBLIC and granted to `app_admin` alone, so "only the thin app's
--     escalation boundary may write this column" is a grant rather than a
--     convention. They could not have written the column anyway (`app_member`
--     holds no `UPDATE` on `users`, `0008:465-466`), so this is belt and braces
--     on a table that is already closed — but it is closed *narrowly*, and the
--     narrow grant is what names the one caller.
--
-- ## IT IS `VOLATILE`, AND IT RETURNS WHETHER IT LANDED
--
-- `STABLE` would be a lie (it writes), and the boolean return is what keeps a
-- caller from asserting `rows_deleted = 1` over a row that was not there: the
-- single `false` answer is an account soft-deleted concurrently with its own
-- login, which is a race with no correct handling other than "there was nothing
-- to record".
CREATE OR REPLACE FUNCTION authz.record_user_activity(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  written integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION
      'authz.record_user_activity: the user id is required; recording activity for nobody is not '
      'a measurement of anything.'
      USING ERRCODE = '22023';
  END IF;

  -- `deleted_at IS NULL` so a tombstone cannot be given activity: the person is
  -- gone and the row is what retention keeps, and a tombstone whose clock
  -- restarted on every touch is the failure §9A.6's first anchor exists to
  -- prevent ("the clock on a scrubbed row must not restart").
  UPDATE public.users
     SET last_activity_at = now()
   WHERE id = p_user_id
     AND deleted_at IS NULL;
  GET DIAGNOSTICS written = ROW_COUNT;

  RETURN written > 0;
END
$$;


-- =============================================================================
-- 5. THE TWO SCANS, EACH REFUSING ITS OWN FLOOR
-- =============================================================================
-- ## WHY THE FLOOR IS 1825 FOR TOMBSTONES AND 1095 FOR ACCOUNTS
--
-- These are the numbers the retention policy *is*, so a value below them is not a
-- more aggressive policy — it is a different, unnamed one. `docs/rebase.md` §9A.4
-- tabulates the tombstone row as **1825 days, a floor**; §9A.6 records the
-- decision on 2026-10-12. `0016`'s `1..36500` bound was the shape of a bound
-- without the substance of one: it caught `0` and `-1` and let `1` through, so
-- the single most damaging value in the key's range — "delete every tombstone in
-- the repository on the next sweep" — was **valid configuration**. A floor is
-- only worth the name if the number below it is refused, and this is where that
-- is proved rather than described.
--
-- 1825 for a tombstone and 1095 for a dormant account, and the difference is
-- not a gradient: a tombstone is an account whose erasure is already recorded, and
-- 0011's compliance argument requires the record to survive (§9A.6's first
-- bullet); a dormant live account is a person who is merely quiet, and no law
-- sets their floor. Three years is the shortest window that is defensible for
-- destroying a working account, and it is a FLOOR for the same reason 1825 is.
--
-- ## WHY THE FLOOR IS HERE AND NOT ONLY IN `retention-environment.ts`
--
-- Boot validation is **one process**. This function is `EXECUTE`-able by
-- anything granted the privilege, today `app_admin` and nothing else, and
-- `GRANT` is a statement somebody can run. A control that lives only in the boot
-- path is a control that a caller with a different reason to lie walks around —
-- and the caller with the most reason to lie here is a future migration or a
-- future operator with psql. Two copies of one bound is deliberate, not
-- duplicated (`AGENTS.md` §2.4): the loader refuses a misconfiguration before the
-- process can act on it, and the function refuses a malformed call from anywhere
-- else.
--
-- `p_window_days` remains a REQUIRED argument with no default. A default inside
-- the function would be a retention policy this file invented, and it would be
-- invented in the one place nobody reads for retention decisions.
--
-- ## WHY EVERY FUNCTION HERE IS `CREATE OR REPLACE` (or `DROP` + `CREATE`)
--
-- A migration in this tree is applied more than once: `test/rls/*.spec.ts`
-- provisions its database by piping every file through `psql` and then runs the
-- real `database/seed.ts`, whose runner applies the same files again — the ledger
-- is empty, because the first pass never wrote to it. `test/rls/rls.spec.ts`
-- applies `0001` twice on purpose. **A bare `CREATE FUNCTION` fails on the second
-- pass with `42723 function … already exists with same argument types`,** which is
-- what the first run of this file did before it was written this way.
--
-- That is not a detail of the test harness: a re-appliable migration is also what
-- makes `psql -f` a supported way to apply one (`0008` says so in as many words),
-- and an operator who re-runs a migration by hand is not doing something exotic.
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

  IF p_window_days < 1825 OR p_window_days > 36500 THEN
    RAISE EXCEPTION
      'authz.retention_due_tombstones: the retention window must be between 1825 and 36500 days, '
      'received % — below 1825 it is not a five-year retention policy anybody published, and a '
      'window of 1 hard-destroys every tombstone in the repository on the next sweep.',
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


-- The second anchor. `deleted_at IS NULL` is NOT redundant with the reason code:
-- it is what makes the two populations **disjoint**, so a row cannot be a
-- tombstone and a dormant account in the same sweep, and so an account that was
-- soft-deleted at 14:00 is purged on the TOMBSTONE clock from 14:00 rather than
-- being re-aged from whenever it last logged in.
--
-- `last_activity_at IS NOT NULL` is §1's whole safety property and it is the
-- conjunct worth arguing about: it is the difference between "this account has
-- been quiet for three years" and "we have never watched this account", and only
-- the first is evidence. A scan without it reports `retention that never
-- expires` and a scan with `created_at` in place of it destroys the most active
-- accounts in the installation — both of which this predicate was written to
-- make unrepresentable.
CREATE OR REPLACE FUNCTION authz.retention_due_accounts(p_window_days integer)
RETURNS TABLE (user_id uuid, last_activity_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_window_days IS NULL THEN
    RAISE EXCEPTION
      'authz.retention_due_accounts: the retention window is required. It is a decision that '
      'destroys personal data and it is not this function''s to invent.'
      USING ERRCODE = '22023';
  END IF;

  IF p_window_days < 1095 OR p_window_days > 36500 THEN
    RAISE EXCEPTION
      'authz.retention_due_accounts: the retention window must be between 1095 and 36500 days, '
      'received % — below 1095 it is not a three-year window, and a window of 1 would hard-destroy '
      'every account with an observed login within three years of now() on the next sweep.',
      p_window_days
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT u.id, u.last_activity_at
    FROM public.users u
   WHERE u.deleted_at IS NULL
     AND u.last_activity_at IS NOT NULL
     AND u.last_activity_at < now() - make_interval(days => p_window_days)
   ORDER BY u.last_activity_at, u.id;
END
$$;


-- =============================================================================
-- 6. THE ENQUEUE — ONE WRITER, TWO POPULATIONS, TWO REASON CODES IN THE DATABASE
-- =============================================================================
-- The signature changes from `(uuid[])` to `(uuid[], uuid[])`, which is a
-- `DROP`/`CREATE` and not an `OR REPLACE`, and the reason it changes at all is
-- that **the reason code is a literal in SQL rather than an argument the caller
-- supplies.** The rejected alternative is `enqueue_inactive_purges(uuid[],
-- text)` with the caller passing the reason: it is one argument instead of two,
-- and it lets a bug in the enqueuer label a live account `inactivity_purge`, at
-- which point the operator's filter says "tombstone" and the row is a person.
--
-- Two arrays, one per population, each with its own literal reason. The caller
-- cannot mislabel a row because it cannot name a reason at all — the mapping
-- from population to code is in this function, next to the CHECK that admits the
-- codes.
--
-- `NULL` is refused for BOTH arrays rather than read as an empty one, for the
-- reason `0016:359-363` gives: "there is nothing to enqueue" and "nobody said" are
-- different, and only the second is an error. A caller that has not computed one
-- population has a bug, and silently enqueuing the other is the bug.
-- BOTH arities are dropped, and the order is the one that makes a re-application
-- work: on the first run only the one-argument form exists, and on the second only
-- the two-argument form does. Dropping only the old signature leaves the new one
-- in place and the `CREATE` below fails with `42723` — which is exactly what the
-- second run of this file did before this line had both.
DROP FUNCTION IF EXISTS authz.enqueue_inactive_purges(uuid[], uuid[]);
DROP FUNCTION IF EXISTS authz.enqueue_inactive_purges(uuid[]);

CREATE FUNCTION authz.enqueue_inactive_purges(
  p_tombstone_ids        uuid[],
  p_inactive_account_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  written integer;
  total   integer := 0;
BEGIN
  IF p_tombstone_ids IS NULL OR p_inactive_account_ids IS NULL THEN
    RAISE EXCEPTION
      'authz.enqueue_inactive_purges: both target lists are required; an absent list is not an '
      'empty list, and a NULL here would silently purge one population while reporting on both.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_tombstone_ids) AS candidate(id) WHERE candidate.id IS NULL)
     OR EXISTS (SELECT 1 FROM unnest(p_inactive_account_ids) AS candidate(id) WHERE candidate.id IS NULL) THEN
    RAISE EXCEPTION
      'authz.enqueue_inactive_purges: a target list contains a NULL.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.privacy_purge_queue (
    target_kind, target_id, target_ref, reason, scheduled_for
  )
  SELECT 'user', candidate.id, NULL, 'inactivity_purge', now()
    FROM unnest(p_tombstone_ids) AS candidate(id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS written = ROW_COUNT;
  total := total + written;

  INSERT INTO public.privacy_purge_queue (
    target_kind, target_id, target_ref, reason, scheduled_for
  )
  SELECT 'user', candidate.id, NULL, 'inactive_account_purge', now()
    FROM unnest(p_inactive_account_ids) AS candidate(id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS written = ROW_COUNT;
  total := total + written;

  RETURN total;
END
$$;


-- =============================================================================
-- 7. GRANTS — revoked from PUBLIC and granted narrowly, in the same breath
-- =============================================================================
-- The same rule as `0016:455-482`, for the same reason: `EXECUTE` is granted to
-- `PUBLIC` on every new function by default, so the revoke is not optional, and
-- **a revoke is not a policy** — revoking from `PUBLIC` while granting to nobody
-- is strictly worse than doing nothing, because every legitimate caller then dies
-- with `permission denied for function` while every policy and comment still
-- looks correct.
--
-- `app_admin` ALONE, and `app_anon`/`app_member` DELIBERATELY ABSENT. Neither of
-- these functions is called by a POLICY, so the "every policy helper goes to
-- `app_anon`" rule does not apply, and a `SECURITY DEFINER` writer reachable
-- anonymously would be an escalation. They are reachable from exactly one place:
-- the escalation boundary the thin app connects through, which is not
-- addressable over HTTP because `authz` is outside `db-schemas`.
--
-- `retention_due_tombstones(integer)` is re-revoked and re-granted because
-- `CREATE OR REPLACE` **preserves** the existing privileges, and the re-grant is
-- written anyway so this file reads as the whole of the grant state rather than
-- relying on a reader having seen `0016`.
REVOKE EXECUTE ON FUNCTION authz.record_user_activity(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authz.retention_due_tombstones(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authz.retention_due_accounts(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authz.enqueue_inactive_purges(uuid[], uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION authz.record_user_activity(uuid) TO app_admin;
GRANT EXECUTE ON FUNCTION authz.retention_due_tombstones(integer) TO app_admin;
GRANT EXECUTE ON FUNCTION authz.retention_due_accounts(integer) TO app_admin;
GRANT EXECUTE ON FUNCTION authz.enqueue_inactive_purges(uuid[], uuid[]) TO app_admin;

-- `app_admin`'s `SELECT`, `INSERT`, `UPDATE` and `DELETE` on `public.users` are
-- UNCHANGED, and that is deliberate: §4's `record_user_activity` runs INVOKER
-- precisely because narrowing them would break authentication outright
-- (`0008:443-455`), and a new column on a table whose grants were already
-- decided needs no grant decision. `app_member`'s column list
-- (`0008:466`) does not name `last_activity_at`, so a member cannot read it —
-- which is correct: it is the subject's own signal, not a tenant payload, and
-- there is no reason for another member to hold it.
--
-- The narrow-grant table is asserted from the catalog, per role, in
-- `test/rls/purge-machine-path.spec.ts`; the absence of the column from
-- `app_member`'s readable set is a fact about `0008` and is not re-asserted here.


-- =============================================================================
-- 8. SCHEMA CACHE
-- =============================================================================
-- A NEW COLUMN ON A SERVED TABLE, so this one is load-bearing rather than
-- routine. PostgREST caches the schema it serves; a column added while the server
-- is up is absent from its `select=*` expansion and from `/` until it reloads.
-- `openapi.json` is generated from the live served spec (`docs/api-contract.md`),
-- so a stale cache would also make the committed contract disagree with the
-- database — and §B3/B4 make that a build failure, which is the correct outcome
-- and not something to work around.
NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0017_last_activity_at.down.sql. Kept as a separate file
-- so this one stays append-only, exactly as in 0001–0016.
--
-- The down script restores `0016`'s two functions **verbatim** rather than
-- merely dropping this file's: `retention_due_tombstones(integer)` keeps its
-- signature, so `OR REPLACE` restored it, and the 1..36500 bound came back with
-- it, which is the point — a down script that leaves the floor in place has not
-- reverted the migration.