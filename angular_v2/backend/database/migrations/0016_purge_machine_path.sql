-- Privacy/DSAR, part four: the retention machine's own write path.
-- Target: PostgreSQL 18+, applied as the migration/owner role like every migration.
--
-- Apply as the migration/owner role, the same way 0001–0015 are applied.
--
-- =============================================================================
-- WHAT IS BROKEN TODAY, MEASURED, AND WHY NOTHING BUT A SEAM FIXES IT
-- =============================================================================
-- `0011` built `privacy_purge_queue` and gave it TWO policies:
--
--   privacy_purge_read   FOR SELECT USING (authz.can_read_privacy_purge())
--   privacy_purge_write  FOR UPDATE  USING (current_user = 'app_admin')
--
-- and granted `SELECT, UPDATE` to `app_admin` because the shipped sweeper issues
-- four ordinary `UPDATE`s on it. That grant is what let the claim be attempted —
-- and the attempt matches nothing:
--
--     -- pgrst_authenticator, SET LOCAL ROLE app_admin, NO claims in scope,
--     -- exactly PurgeSweeper.sweepOne()'s session:
--     UPDATE privacy_purge_queue AS q SET status = 'claimed', … RETURNING q.id;
--     =>  UPDATE 0
--
-- because `CLAIM_DUE_PURGE_SQL`'s inner `SELECT … FOR UPDATE SKIP LOCKED` is a
-- plain SELECT and is therefore governed by `privacy_purge_read`, which is the
-- capability call ALONE. `authz.actor()` is NULL in a claimless session,
-- `has_permission(NULL, …)` is false, the sub-select is empty, and the retention
-- job drains nothing. The queue is inert, silently, with no error anywhere.
--
-- THE THREE ROUTES OUT, AND WHY TWO ARE CLOSED
--
--   1. A `current_user = 'app_admin'` branch on `privacy_purge_read`. CLOSED:
--      it contradicts the shipped rule that capability resolves from ROLE ROWS
--      and never from the database role, and
--      `test/rls/privacy-purge-queue.spec.ts` asserts AGAINST it (an admin
--      holding the table grant and lacking `privacy_purge:read` must read ZERO
--      rows). Satisfying it would mean weakening a security test.
--
--   2. Give the sweeper a `request.jwt.claims` document. CLOSED, and this is
--      the important one: §B2 F1 records that `request.jwt.claims` is a CUSTOM
--      GUC and THAT ANY ROLE MAY `SET` IT — verified exploitable, a member set
--      it and read another tenant's rows. The mitigation is architectural — "no
--      request-reachable SQL path may SET it" — and a scheduled job that writes
--      its own claims document is exactly such a path, promoted to a permanent
--      P0 so that a background job can drain a queue. `AGENTS.md` §B2 F1 names
--      a `db-pre-request` hook that can reach that SET a P0; this would be the
--      same defect with a cron expression. It is not taken, and no test in this
--      tree sets one.
--
--   3. A narrowly-granted `SECURITY DEFINER` function in `authz`. TAKEN, and it
--      is the seam the schema already has: `authz.append_privacy_request_audit()`
--      (`0010`) is the working precedent for a write through exactly this route,
--      and `0011:441` already named `authz.enqueue_inactive_purges` as the
--      enqueue writer — a function that did not exist until this file.
--
-- WHY `authz` AND NOT `public`: `db-schemas = "public"` (`postgrest.conf`), so
-- nothing in `authz` is reachable at `/rpc/…` and nothing in it appears in the
-- generated OpenAPI contract. A write seam that PostgREST can address is a
-- write seam a token can reach.
--
-- =============================================================================
-- THE CONSEQUENCE THAT MAKES THE SEAM THE ONLY WRITER: `UPDATE` IS REVOKED
-- =============================================================================
-- Below, `REVOKE UPDATE ON public.privacy_purge_queue FROM app_admin`.
--
-- It is not a tidy-up. With `app_admin` still holding `UPDATE`, the four
-- statements in `src/purge/purge-claim.ts` remain a SECOND, WORKING way to do
-- the same job — and the one that is inert (§2.4: one mechanism per concern).
-- Worse, the one that is inert fails SILENTLY: a claim written as a bare UPDATE
-- returns `UPDATE 0` and the sweeper reports "nothing due", which is
-- indistinguishable from a queue that is genuinely empty. Revoking the grant
-- turns that silent failure into `permission denied for table`, names the
-- defect at the statement that caused it, and leaves the seam as the only
-- writer — which is the shape `0010` already gives `privacy_request_audits`,
-- where no serving role holds any verb at all.
--
-- `privacy_purge_write` is KEPT. It is now unreachable by every serving role,
-- and that is deliberate: it is the second half of the control, so a future
-- table-level `GRANT UPDATE` cannot open a write by itself. A policy with no
-- grant behind it is not dead code, it is the reason a widened grant is still
-- refused at the row layer.
--
-- WHAT THIS DOES NOT CHANGE: `privacy_purge_read` is untouched, so the admin
-- list is still capability-gated, and `SELECT` is still granted to `app_admin`
-- because that is how an operator reads the queue.
--
-- =============================================================================
-- THE FIVE WRITES, AND WHY EACH IS ITS OWN FUNCTION
-- =============================================================================
--
-- `claim_due_purge`   FOR UPDATE SKIP LOCKED + the UPDATE that marks the claim,
--                     still ONE statement, so the select and the lock cannot
--                     disagree. The concurrency property the N-sweeper design
--                     rests on is preserved, not traded for reachability.
-- `complete_purge`    status/attempt/completed_at/rows_deleted, ownership-predicate'd.
-- `fail_purge`        the poison pill: terminal, keeps its error.
-- `requeue_purge`     below the attempt limit: back to `pending`, keeps its error.
-- `enqueue_inactive_purges`  the only INSERT, and the only producer.
--
-- Four functions rather than one `settle_purge(id, instance, status, …)`: a
-- status PARAMETER turns a closed set of transitions into an open one at the
-- function boundary, and `done` without a count or `failed` without a reason are
-- exactly the two shapes the table's CHECKs exist to refuse (§2.3's
-- success-shaped value, expressible one argument away).
--
-- `claimed_by` IS STILL THE OWNERSHIP KEY ON EVERY READ AFTER THE CLAIM. All
-- four writes carry `status = 'claimed' AND claimed_by = p_instance` and return
-- the number of rows they matched, so a sweeper that no longer owns a row gets
-- `0` and `PurgeSweeper` throws rather than reporting success for work that did
-- not happen. Returning the row count rather than `void` is what lets the caller
-- tell those two apart.
--
-- `SECURITY DEFINER` IDENTITY IS NOT `current_user` AND NOT A CLAIM. None of
-- these five functions reads `authz.actor()` or `current_user`: identity is not
-- their business. They are reached by an IDENTIFICATION of the machine — the
-- escalation boundary `pgrst_authenticator` + `SET LOCAL ROLE app_admin`, which
-- §B2 names as the same boundary `database/seed.ts` and `AuthService` use, and
-- which a token can only assume if the signature verifies. The defect being
-- fixed here is a claim that no identity could satisfy; reintroducing one would
-- be the same defect wearing a different hat.
--
-- THE RESIDUAL, STATED RATHER THAN ASSUMED: inside a `SECURITY DEFINER`
-- function `current_user` is the OWNER, and the owner bypasses this table's RLS
-- because `0011` deliberately did not FORCE it (`0011:344-375`). So these five
-- functions are the table's write path with no policy applied to them at all.
-- That is bounded by the fact `0011` names — the migration/owner role never
-- receives a request — and it is why the narrowness is carried entirely by
-- `EXECUTE`. `privacy_purge_queue` is unchanged in that respect by this file.

-- =============================================================================
-- 1. THE CLAIM — one statement, still
-- =============================================================================
-- `RETURNS SETOF public.privacy_purge_queue` rather than a named column list:
-- the queue's own row type IS the claim's shape, so a column added to the queue
-- is a column this returns with no second declaration to update. The caller
-- narrows the row to the fields it acts on (`toPurgeClaim`).
--
-- `LIMIT 1` and not a batch: the sweeper runs ONE transaction per purge, so
-- claim, delete and mark-done are the same transaction and there is no window in
-- which a row is stranded in `claimed` with nothing to reclaim it.
--
-- `RETURN QUERY` over a DML command appends the `RETURNING` rows and appends
-- NOTHING when the UPDATE matches none, so "nothing is due" arrives as zero rows
-- rather than as a zero-row result dressed as a claim.
--
-- `p_instance` is refused when it is NULL or empty. `claimed_by` is `text` and
-- the table's CHECK only requires it to be non-NULL, so an empty ownership key
-- would pass every constraint while making "this sweeper still owns the row" a
-- question two sweepers answer the same way.
CREATE OR REPLACE FUNCTION authz.claim_due_purge(p_instance text)
RETURNS SETOF public.privacy_purge_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_instance IS NULL OR p_instance = '' THEN
    RAISE EXCEPTION
      'authz.claim_due_purge: the ownership key is required. A claim with no owner is a row that '
      'no sweeper can be shown to still hold.'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.privacy_purge_queue AS q
     SET status     = 'claimed',
         claimed_at = now(),
         claimed_by = p_instance,
         attempt    = q.attempt + 1
    FROM (
          SELECT id
            FROM public.privacy_purge_queue
           WHERE status = 'pending'
             AND scheduled_for <= now()
           ORDER BY scheduled_for, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         ) AS due
   WHERE q.id = due.id
  RETURNING q.*;
END
$$;

-- =============================================================================
-- 2. COMPLETE — with the ownership predicate
-- =============================================================================
-- Not `WHERE id = p_id`. `status = 'claimed' AND claimed_by = p_instance` is the
-- predicate that makes a write safe when there are N sweepers, and it is the
-- same predicate every read after the claim carries.
--
-- ZERO ROWS IS NOT AN ERROR HERE and the function says so by returning 0 rather
-- than raising: it means this sweeper no longer owns the row (reclaimed,
-- cancelled, or completed), and `PurgeSweeper` treats it as the §2.3 failure it
-- is — an error thrown, not a success reported.
--
-- `p_rows_deleted` is refused when it is NULL or negative. NULL would write a
-- `done` row the table's own CHECK refuses anyway, but a `CHECK` failure names
-- a constraint rather than the argument that caused it.
CREATE OR REPLACE FUNCTION authz.complete_purge(p_id uuid, p_instance text, p_rows_deleted integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  written integer;
BEGIN
  IF p_instance IS NULL OR p_instance = '' THEN
    RAISE EXCEPTION
      'authz.complete_purge: the ownership key is required; without it the predicate below cannot '
      'distinguish this sweeper from any other.'
      USING ERRCODE = '22023';
  END IF;

  IF p_rows_deleted IS NULL OR p_rows_deleted < 0 THEN
    RAISE EXCEPTION
      'authz.complete_purge: rows_deleted must be the real count the executor removed, not %',
      coalesce(p_rows_deleted::text, 'NULL')
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.privacy_purge_queue
     SET status       = 'done',
         completed_at = now(),
         rows_deleted = p_rows_deleted,
         error        = NULL
   WHERE id = p_id
     AND status = 'claimed'
     AND claimed_by = p_instance;
  GET DIAGNOSTICS written = ROW_COUNT;

  RETURN written;
END
$$;

-- =============================================================================
-- 3. FAIL — the poison pill
-- =============================================================================
-- Terminal, keeps its `error`, and stays visible to an operator. Same ownership
-- predicate, for the same reason.
--
-- IT RUNS INSIDE THE CLAIM'S TRANSACTION, immediately after
-- `ROLLBACK TO SAVEPOINT purge_work`, and that is the only reason its predicate
-- can match at all: a whole-transaction rollback un-does the claim with the
-- delete, leaving the row `pending` with `claimed_by = NULL` — a `failed` row
-- that was recorded nowhere, an `attempt` counter that never advances, and a
-- poison pill that is unreachable code.
--
-- `p_error` is refused when NULL: a terminal `failed` row with no reason is the
-- one shape an operator cannot act on.
CREATE OR REPLACE FUNCTION authz.fail_purge(p_id uuid, p_instance text, p_error text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  written integer;
BEGIN
  IF p_instance IS NULL OR p_instance = '' THEN
    RAISE EXCEPTION
      'authz.fail_purge: the ownership key is required; without it the predicate below cannot '
      'distinguish this sweeper from any other.'
      USING ERRCODE = '22023';
  END IF;

  IF p_error IS NULL OR p_error = '' THEN
    RAISE EXCEPTION
      'authz.fail_purge: a failed purge with no reason is a row nobody can act on.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.privacy_purge_queue
     SET status = 'failed',
         error  = p_error
   WHERE id = p_id
     AND status = 'claimed'
     AND claimed_by = p_instance;
  GET DIAGNOSTICS written = ROW_COUNT;

  RETURN written;
END
$$;

-- =============================================================================
-- 4. REQUEUE — below the attempt limit, error KEPT
-- =============================================================================
-- `fail_purge` minus the terminal status. Clearing `claimed_at` and `claimed_by`
-- together is what keeps the table's `pending ⇒ unowned` CHECK true, and a
-- `pending` row that still named a sweeper would let that sweeper's next write
-- match a row it no longer holds.
CREATE OR REPLACE FUNCTION authz.requeue_purge(p_id uuid, p_instance text, p_error text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  written integer;
BEGIN
  IF p_instance IS NULL OR p_instance = '' THEN
    RAISE EXCEPTION
      'authz.requeue_purge: the ownership key is required; without it the predicate below cannot '
      'distinguish this sweeper from any other.'
      USING ERRCODE = '22023';
  END IF;

  IF p_error IS NULL OR p_error = '' THEN
    RAISE EXCEPTION
      'authz.requeue_purge: a requeued purge with no reason loses the reason on the next attempt.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.privacy_purge_queue
     SET status     = 'pending',
         claimed_at = NULL,
         claimed_by = NULL,
         error      = p_error
   WHERE id = p_id
     AND status = 'claimed'
     AND claimed_by = p_instance;
  GET DIAGNOSTICS written = ROW_COUNT;

  RETURN written;
END
$$;

-- =============================================================================
-- 5. THE ENQUEUE SCAN — two halves, and the split is forced, not chosen
-- =============================================================================
-- `0011:441` named `authz.enqueue_inactive_purges` as the enqueue writer. This
-- is it, and it is the ONLY producer of a queue row in this tree.
--
-- `reason = 'inactivity_purge'` for EVERY tombstone, anonymised or not, because
-- `0011` makes anonymisation a STATUS and not a second population: the two
-- populations differ by one boolean (`users.email_anonymized`), and a reason
-- code naming a population implies that population has its own lifecycle, which
-- it does not have.
--
-- `ON CONFLICT DO NOTHING` is the polite way to be quiet about the partial
-- UNIQUE index from `0011`, which is the real control: it makes "one open purge
-- per target" a property of the schema rather than of an enqueue function
-- remembering to check. Without it, a scan that runs twice inside one retention
-- window queues every tombstone twice, the second attempt finds nothing to
-- delete, writes `rows_deleted = 0`, and the admin view reads that as a
-- successful purge.
--
-- `scheduled_for = now()` — the scan decides what is DUE, so a row it enqueues
-- is due now. `0011` deliberately gave this column no default, because "when a
-- purge is due" is a decision and not a constant.
CREATE OR REPLACE FUNCTION authz.enqueue_inactive_purges(p_target_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  written integer;
BEGIN
  IF p_target_ids IS NULL THEN
    RAISE EXCEPTION
      'authz.enqueue_inactive_purges: p_target_ids is required; an absent list is not an empty list.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_target_ids) AS candidate(id) WHERE candidate.id IS NULL) THEN
    RAISE EXCEPTION
      'authz.enqueue_inactive_purges: the list of targets contains a NULL.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.privacy_purge_queue (
    target_kind, target_id, target_ref, reason, scheduled_for
  )
  SELECT 'user', candidate.id, NULL, 'inactivity_purge', now()
    FROM unnest(p_target_ids) AS candidate(id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS written = ROW_COUNT;

  RETURN written;
END
$$;

-- =============================================================================
-- 5b. THE SCAN ITSELF — `SECURITY INVOKER`, AND THE MEASUREMENT THAT FORCED IT
-- =============================================================================
-- This is the half that is NOT a `SECURITY DEFINER` function, and the reason is
-- a measurement rather than a preference.
--
-- `public.users` is FORCE ROW LEVEL SECURITY (`0008:326`), so the owner is
-- bound by `users_read_scope` (`0009:229-241`) — whose branches are
-- `current_user = 'app_admin'` and "my own, undeleted row". Inside a
-- `SECURITY DEFINER` function `current_user` IS THE OWNER, so a definer scan
-- would read ZERO tombstones. Measured on this schema, as the migration role:
--
--     CREATE FUNCTION authz.probe() RETURNS bigint …
--       SELECT count(*) INTO n FROM public.users; RETURN n; END $$;
--     SELECT authz.probe();          =>  0        (against a table holding 1 row)
--     SELECT count(*) FROM users     =>  1        (as app_admin)
--
-- So a single definer function doing the whole scan would be a scan that finds
-- nothing, forever, with no error — `0011`'s defect in a new file. The split is
-- forced by the schema, and each half runs as the only identity that can:
--
--   the READ of tombstones   →  `app_admin`, the superset principal, for which
--                               `users_read_scope` keeps the admin branch FIRST
--                               precisely so the inactivity scan can see
--                               tombstones (`0009:214-226`).
--   the INSERT of queue rows  →  the owner, through the definer above, because
--                               NO serving role holds INSERT and that refusal is
--                               a control `privacy-purge-queue.spec.ts` asserts.
--
-- `p_window_days` is a REQUIRED argument with no default, and it is refused
-- outside 1..36500. It is a decision that destroys personal data, not a
-- scheduling fact: `RETENTION_TOMBSTONE_DAYS` is required at boot with no
-- default for the same reason `BREAKER_MEMORY_GREEN` is
-- (`src/breaker/breaker-environment.ts:19-24`), and a window of zero would make
-- every tombstone that has ever existed due for deletion on the next sweep.
--
-- `ORDER BY deleted_at, id` so two scans over the same set take the same order,
-- and the `(deleted_at)` partial index from `0009` serves the predicate.
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

  IF p_window_days < 1 OR p_window_days > 36500 THEN
    RAISE EXCEPTION
      'authz.retention_due_tombstones: the retention window must be between 1 and 36500 days, '
      'received % — zero deletes every tombstone that has ever existed and a large value is a '
      'retention policy nobody reads as one.',
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

-- =============================================================================
-- GRANTS — revoked from PUBLIC and granted narrowly, in the same breath
-- =============================================================================
-- `EXECUTE` is granted to `PUBLIC` on every new function by default, so the
-- revoke is not optional. **A revoke is not a policy**: revoking from `PUBLIC`
-- while granting to nobody is strictly worse than doing nothing, because every
-- legitimate caller then dies with `permission denied for function` while every
-- policy, grant and comment still looks correct.
--
-- `app_admin` ALONE, and `app_anon` and `app_member` DELIBERATELY ABSENT — the
-- same reasoning `0010` gives for `authz.append_privacy_request_audit()`: no
-- POLICY calls these functions, so the "every policy helper goes to `app_anon`"
-- rule does not apply, and a `SECURITY DEFINER` writer reachable anonymously is
-- an escalation. It is reachable from exactly one place: the escalation
-- boundary the sweeper connects through, which is not addressable over HTTP
-- because `authz` is outside `db-schemas`.
REVOKE EXECUTE ON FUNCTION authz.claim_due_purge(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authz.complete_purge(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authz.fail_purge(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authz.requeue_purge(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authz.enqueue_inactive_purges(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authz.retention_due_tombstones(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION authz.claim_due_purge(text) TO app_admin;
GRANT EXECUTE ON FUNCTION authz.complete_purge(uuid, text, integer) TO app_admin;
GRANT EXECUTE ON FUNCTION authz.fail_purge(uuid, text, text) TO app_admin;
GRANT EXECUTE ON FUNCTION authz.requeue_purge(uuid, text, text) TO app_admin;
GRANT EXECUTE ON FUNCTION authz.enqueue_inactive_purges(uuid[]) TO app_admin;
GRANT EXECUTE ON FUNCTION authz.retention_due_tombstones(integer) TO app_admin;

-- =============================================================================
-- THE GRANT THAT IS TAKEN AWAY
-- =============================================================================
-- `app_admin` keeps `SELECT` — that is the admin list, and it is still gated by
-- `privacy_purge_read`, so an admin whose role lacks `privacy_purge:read` reads
-- zero rows despite the grant. It loses `UPDATE`: from here the queue is
-- writable by no serving role at all, and every write in this file's five
-- functions is the only way one happens.
--
-- The sweeper is unaffected, and it is worth saying why in the order that makes
-- it true: it established `SET LOCAL ROLE app_admin` to run
-- `DELETE FROM users WHERE id = $1` (only `app_admin` holds `DELETE`) and it
-- now calls four functions it has `EXECUTE` on. It never needed the table
-- grant; the grant existed only because the claim was a bare UPDATE, and the
-- claim is no longer one.
REVOKE UPDATE ON public.privacy_purge_queue FROM app_admin;

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
-- Six functions and one narrower grant. PostgREST 404s a relation created after
-- startup with no message explaining why, and although nothing here is in
-- `db-schemas` the reload is what keeps a served schema cache honest about the
-- privileges of the relations it does serve.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0016_purge_machine_path.down.sql. Kept as a separate
-- file so this one stays append-only, exactly as in 0001–0015.
--
-- The down script drops the five definer functions and the scan, and RESTORES
-- `GRANT UPDATE ON public.privacy_purge_queue TO app_admin` — which is to say it
-- restores the inert state, and says so at length.
