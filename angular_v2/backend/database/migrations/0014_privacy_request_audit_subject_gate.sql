-- =============================================================================
-- 0014_privacy_request_audit_subject_gate.sql
--
-- CLOSES AN AUTHORIZATION HOLE IN `authz.append_privacy_request_audit()`.
--
-- WHAT WAS WRONG, in one sentence: the write function gated "may this caller act
-- on this subject?" on the `privacy_request:update` CAPABILITY ALONE, while the
-- `privacy_request_update` policy it says it mirrors gates the same question on
-- that capability AND on the subject being the caller. Because `has_permission()`
-- walks UP the role tree and `0010:373-374` confers `privacy_request:update` on
-- `member`, `manager` AND `admin`, an ordinary member satisfied the function's
-- gate. Two consequences, both of them integrity failures in the statutory
-- record:
--
--   1. A member could append a compliance record naming a COLLEAGUE as
--      `subject_user_id` — the same self-service rule the INSERT policy on
--      `privacy_requests` applies, stated here and enforced nowhere.
--   2. A member could append a `responded` / `fulfilled` event — i.e. certify
--      that a statutory obligation was discharged. `0010:552-556` names that
--      manufactured claim as the reason the UPDATE policy carries a `WITH CHECK`
--      at all; the audit path had no equivalent, and the table's CHECKs cannot
--      see who wrote the row.
--
-- `0010` is applied and correct as written; this is a NEW migration and does not
-- edit it (§B1). `CREATE OR REPLACE` keeps the signature, the return type and
-- the grants, so nothing that already calls this function stops resolving.
-- `test/rls/privacy-requests.spec.ts` carried the two assertions that document
-- the hole, deliberately red, and they are green against this.
--
-- =============================================================================
-- IDENTITY INSIDE A SECURITY DEFINER FUNCTION, AND WHY THIS FILE CANNOT REUSE
-- `current_user` THE WAY THE POLICY DOES
-- =============================================================================
-- `privacy_request_update` (`0010:567-576`) is:
--
--   USING       (current_user = 'app_admin'
--                OR (user_id = authz.actor() AND authz.can_update_privacy_request()))
--   WITH CHECK  (current_user = 'app_admin' OR status IN ('open', 'withdrawn'))
--
-- and the gate below is the same predicate conjunct for conjunct. It is NOT the
-- same EXPRESSION, and the difference is forced rather than stylistic:
--
-- INSIDE A `SECURITY DEFINER` FUNCTION `current_user` REBINDS TO THE OWNER.
-- Measured on this cluster (18.6), a probe owned by the migration role reporting
-- itself, called after `SET LOCAL ROLE`:
--
--   SET ROLE app_anon   -> current_user=app | current_setting(role)=app_anon
--   SET ROLE app_member -> current_user=app | current_setting(role)=app_member
--   SET ROLE app_admin  -> current_user=app | current_setting(role)=app_admin
--   no SET ROLE         -> current_user=app | current_setting(role)=none
--
-- So a body testing `current_user = 'app_admin'` answers `false` for EVERY
-- caller including `app_admin`, and the audit path would refuse every operator
-- event for the whole deployment — with no error anywhere, because a denial and a
-- success are both a returned row count. `0004_grant_subset.sql` records the same
-- measurement and keys its own superset-principal branch on `current_setting
-- ('role', true)` for exactly this reason; this file follows the precedent that
-- is already in the schema rather than inventing one.
--
-- The two spellings are the SAME FACT, not two answers. `current_user` in a policy
-- IS the role the escalation boundary's `SET ROLE` established, and the `role` GUC
-- is where that fact is stored; a definer function rebinds the former and not the
-- latter. And the `role` GUC is not a caller-writable custom GUC of the kind §B2
-- §F1 warns about: `SET ROLE x` succeeds only for a principal that is a member
-- of `x`, so a caller cannot name a role it is not. It is bound by exactly the
-- same boundary GRANT (`database/bootstrap/001_roles.sql`) that every
-- `current_user = 'app_admin'` branch in this schema already depends on.
--
-- =============================================================================
-- WHY THE PREDICATE IS NOT SHARED WITH THE POLICY AS A HELPER — MEASURED
-- =============================================================================
-- The rule this file wanted to follow is "one copy of a predicate, not two that
-- can drift", and the obvious spelling is a `STABLE SECURITY DEFINER` helper both
-- the policy and this function call. Measured on the shipped
-- `privacy_request_update` policy, one `UPDATE` over 1,200 rows as `app_member`,
-- read from `pg_stat_user_functions` (`track_functions = 'all'`):
--
--   can_update_privacy_request | 1200 calls
--   has_permission             | 1202 calls
--   actor                      | 2416 calls
--
-- A `STABLE` helper in a policy qual is evaluated ONCE PER CANDIDATE ROW. §B2 says
-- so and measures it, and the numbers above are that measurement on this policy:
-- `privacy_request_update`'s `USING` has no uncorrelated subquery, so there is
-- nothing for a shared helper to hide inside and be hoisted past. Pointing the
-- policy at a shared `authz.may_act_on_privacy_request(privacy_requests.user_id)`
-- would therefore ADD a second per-row resolution rather than remove a copy of a
-- predicate — the sharing would cost every UPDATE, to save one `OR`.
--
-- So the predicate is written once, HERE, and the drift this file does not accept
-- is the reverse direction: `privacy_request_update` stays as `0010` shipped it,
-- and this function is the copy that is changed to match it. The two still share
-- the pieces that carry the meaning — `authz.actor()` and
-- `authz.can_update_privacy_request()`, both no-argument helpers with one
-- definition each — and the two conjuncts are assembled from those same two calls
-- in the same order as the policy's. The one thing that is deliberately NOT
-- shared is the admin branch, because sharing it is impossible rather than
-- merely expensive: a helper that reads `current_user` answers about the OWNER
-- when called from in here, and one that reads the `role` GUC is not the shape the
-- policy writes. §B2's "if the two can ever disagree, that is the bug" is
-- answered by writing the comment on both sides rather than by a helper that
-- would have to be wrong in one of them.
-- =============================================================================

-- THE SERVING ROLE, AS A NAMED CONCEPT. No argument, so a caller can only ever ask
-- about ITSELF, and `search_path` pinned for the reason every other `authz`
-- helper pins it (`0010:390-406`). `coalesce(nullif(…, ''), 'none')` so an unset
-- or empty setting is a NAME that compares false against `'app_admin'` rather
-- than a NULL that would propagate through the `OR` below — §B2: a predicate
-- must be total, because `OR` does not short-circuit past a raising or null
-- operand and a null here would silently answer "may act" as NULL rather than
-- no.
CREATE OR REPLACE FUNCTION authz.serving_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT coalesce(nullif(current_setting('role', true), ''), 'none') $$;

-- `EXECUTE` IS GRANTED TO `PUBLIC` ON EVERY NEW FUNCTION BY DEFAULT, so the revoke
-- is not optional. `app_anon` is ABSENT and the reason is `0001:633-646`: the
-- "grant it to app_anon too" rule is stated as "does a POLICY call it", and no
-- policy on any table in this schema calls this one. It is granted to the two
-- authenticated serving roles for the same reason `has_permission` is — it is
-- reachable by a caller that is already authenticated — and to nobody else.
REVOKE EXECUTE ON FUNCTION authz.serving_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.serving_role() TO app_member, app_admin;

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
  actor      uuid;
  is_operator boolean;
  may_act    boolean;
  written    uuid;
BEGIN
  actor := authz.actor();

  IF actor IS NULL THEN
    RAISE EXCEPTION
      'append_privacy_request_audit: no caller identity in request.jwt.claims; a compliance record '
      'cannot be written by a caller that cannot be named'
      USING ERRCODE = '42501';
  END IF;

  -- THE SUPERSET PRINCIPAL, ONCE. It is the admin branch of BOTH halves of
  -- `privacy_request_update` and of nothing else, so it is resolved a single time
  -- and reused rather than asked twice.
  is_operator := authz.serving_role() = 'app_admin';

  -- ---------------------------------------------------------------------
  -- THE SUBJECT GATE — `privacy_request_update`'s `USING`, conjunct for conjunct
  -- ---------------------------------------------------------------------
  -- `is_operator OR (the subject is me AND I hold privacy_request:update)`.
  --
  -- The capability conjunct alone is the defect this migration closes: it is
  -- satisfied by an ordinary `member`, so on its own it answered "yes" to a
  -- colleague. The self conjunct is what makes the member's reach their own row
  -- and nothing else, exactly as it does for the UPDATE.
  --
  -- `p_subject_user_id IS NOT NULL` is written out rather than left to NULL
  -- arithmetic. `p_subject_user_id = actor` on a NULL subject is NULL, `NULL OR
  -- …` is NULL, and `IF NOT NULL` does not fire — so the predicate would admit
  -- every subjectless row for every caller by accident rather than by decision.
  -- A record with no subject is a statutory claim about a person who is not
  -- named, and `subject_user_id` is nullable (`0010:226-231`) only so a row can
  -- be written for a subject whose `users` row is already gone — which is the
  -- operator's act, not the subject's. The explicit form answers the question
  -- instead of leaking it.
  may_act := is_operator
             OR (p_subject_user_id IS NOT NULL
                 AND p_subject_user_id = actor
                 AND authz.can_update_privacy_request());

  IF NOT may_act THEN
    RAISE EXCEPTION
      'append_privacy_request_audit: % is not permitted to write a privacy record about %',
      actor, p_subject_user_id
      USING ERRCODE = '42501';
  END IF;

  -- ---------------------------------------------------------------------
  -- THE OPERATOR GATE — `privacy_request_update`'s `WITH CHECK`
  -- ---------------------------------------------------------------------
  -- `received` is the subject's own act. Everything past intake is the business's
  -- answer ABOUT somebody, and the business is the superset principal — the same
  -- split `0010:561-566` states for the UPDATE, where a member may take their own
  -- row to `withdrawn` and nothing further, and only `app_admin` may move it to
  -- `responded`/`fulfilled`/`denied`.
  --
  -- Note what this conjunct is NOT: it is not `has_permission(actor, …)`. That is
  -- the conjunct `0010` used here, and it is why a member could certify that
  -- their own obligation had been discharged — `privacy_request:update` is
  -- conferred on all three tiers precisely so that WITHDRAWAL is self-service,
  -- and re-reading it as "the operator's capability" is what turned the subject
  -- into the responder. A member recording their own intake is still permitted
  -- (the gate above), which is the positive control that proves this is a
  -- restriction and not a lockout.
  --
  -- `app_admin` here is the DATABASE role, so an `app_admin` session whose token
  -- holds no `privacy_request:update` role row may still write an operator event.
  -- That is not a divergence introduced here: `privacy_request_update`'s admin
  -- branch is the bare principal too, and narrowing it is a change to the POLICY
  -- rather than to the copy of it that this file is fixing.
  IF p_event_type <> 'received' AND NOT is_operator THEN
    RAISE EXCEPTION
      'append_privacy_request_audit: % attempted to write the % event, which is an operator''s to make',
      actor, p_event_type
      USING ERRCODE = '42501';
  END IF;

  -- THE SHAPE IS STILL THE TABLE'S BUSINESS. An unknown `event_type`, a
  -- `responded` row with no response, a denial with no statutory basis and a
  -- response that predates its own request all raise 23514 from the CHECKs in
  -- `0010:261-278`. Duplicating that vocabulary here would be a second copy of
  -- one rule and would drift from the constraints the compliance claim rests on
  -- (§2.4).
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

-- `CREATE OR REPLACE` preserves the function's ACL, so these are not strictly
-- necessary. They are re-issued because a reader of this file should not have to
-- open `0010` to learn who may write the compliance record, and because a
-- revoke-without-a-grant is strictly worse than neither: every audit write would
-- die with `permission denied for function` and the compliance record would be
-- unwritable by construction.
REVOKE EXECUTE ON FUNCTION authz.append_privacy_request_audit(text, uuid, timestamptz, text, text, timestamptz, text, text, text, bytea, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.append_privacy_request_audit(text, uuid, timestamptz, text, text, timestamptz, text, text, text, bytea, text, uuid) TO app_member, app_admin;

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0014_privacy_request_audit_subject_gate.down.sql. Kept
-- as a separate file so this one stays append-only, exactly as in 0001–0013.
--
-- REVERTING THIS REOPENS THE HOLE. That is what a revert of a security fix means
-- and the down file says so at length: it restores the `0010` body, in which the
-- capability conjunct stands alone. Do not revert `0014` on a database that holds
-- a compliance record.
