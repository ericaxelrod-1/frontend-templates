-- =============================================================================
-- 0014_privacy_request_audit_subject_gate.down.sql
--
-- REVERTS 0014 — AND THEREFORE REOPENS THE HOLE 0014 CLOSED.
-- =============================================================================
--
-- The exact inverse of 0014 is `authz.append_privacy_request_audit()` as `0010`
-- shipped it, plus the removal of the helper 0014 introduced. That body is the
-- one whose "may this caller act on this subject?" gate is
-- `has_permission(actor, 'privacy_request', 'update')` ALONE — so reverting this
-- file restores a state in which an ordinary `member`, who demonstrably holds
-- that permission (`0010:373-374`), may append a compliance record naming a
-- colleague as the subject and may certify that their own statutory obligation
-- was discharged.
--
-- It is reproduced here verbatim rather than summarised, because a down script
-- that paraphrases the state it restores is a down script that restores a
-- different one, and this particular state is a hole. The duplication of the body
-- across two files is the unavoidable cost of an append-only migration history
-- (§B1: never edit an applied migration); the two copies have opposite
-- directions, so they cannot drift into the same wrong answer — one is the fix and
-- one is the defect, and `test/rls/privacy-requests.spec.ts` says which is which.
--
-- DO NOT RUN THIS ON A DATABASE THAT HOLDS A COMPLIANCE RECORD. `0010` is the
-- same trade its own down file refuses to make for a different reason, and this
-- one is smaller: nothing here destroys a row, and everything here reopens the
-- ability to write one falsely.
--
-- ORDER MATTERS. The function is replaced FIRST, because the replacement body is
-- the one that stops calling `authz.serving_role()`; dropping the helper first
-- would leave a live function with a dangling reference and abort the revert.
-- =============================================================================

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

-- The one helper 0014 added. `IF EXISTS` because a revert of a revert is a normal
-- thing for an operator to attempt and must not fail on an absent object; the
-- surrounding statements are not guarded, because a missing FUNCTION here means
-- the ledger and the schema have already diverged and that is worth stopping for.
DROP FUNCTION IF EXISTS authz.serving_role();

NOTIFY pgrst, 'reload schema';
