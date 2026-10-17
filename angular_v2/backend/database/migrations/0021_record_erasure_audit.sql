-- =============================================================================
-- 0021_record_erasure_audit.sql
--
-- GAP B: STATUTORY COMPLIANCE RECORD FOR ACCOUNT ERASURE (11 CCR §7101(b))
--
-- Appends the 'responded' / 'fulfilled' record to `privacy_request_audits` upon
-- account erasure.
--
-- 1. SECURITY DEFINER WRITER:
--    `privacy_request_audits` is an un-FORCEd append-only table (0010:449-462).
--    `authz.record_erasure_audit` runs as the table owner (`app`) and appends
--    the statutory record.
--
-- 2. OPERATOR GATE:
--    Only `app_admin` (the superset principal) may call this seam.
--    Revoked from PUBLIC and granted strictly to `app_admin`.
--
-- 3. INTEGRITY & KEY ROTATION:
--    `subject_hmac` is computed application-side from `PRIVACY_HMAC_PEPPER`
--    and passed in (the pepper is never stored in or sent to PostgreSQL).
--    `pepper_kid` is recorded alongside the HMAC to maintain verifiability
--    across key rotations.
-- =============================================================================

CREATE OR REPLACE FUNCTION authz.record_erasure_audit(
  p_subject_id   uuid,
  p_subject_hmac bytea,
  p_pepper_kid   text,
  p_request_key  uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key      uuid;
  v_audit_id uuid;
BEGIN
  IF authz.serving_role() <> 'app_admin' AND session_user <> 'app_admin' THEN
    RAISE EXCEPTION
      'authz.record_erasure_audit: only app_admin may record an erasure compliance audit'
      USING ERRCODE = '42501';
  END IF;

  v_key := coalesce(p_request_key, uuidv7());

  INSERT INTO public.privacy_request_audits (
    event_type,
    request_key,
    requested_at,
    request_nature,
    request_channel,
    responded_at,
    response_nature,
    subject_hmac,
    pepper_kid,
    subject_user_id
  ) VALUES (
    'responded',
    v_key,
    now(),
    'deletion',
    'in_app',
    now(),
    'fulfilled',
    p_subject_hmac,
    p_pepper_kid,
    p_subject_id
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION authz.record_erasure_audit(uuid, bytea, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.record_erasure_audit(uuid, bytea, text, uuid) TO app_admin;

NOTIFY pgrst, 'reload schema';
