-- =============================================================================
-- 0018_auth_tokens.sql
--
-- One-time token primitive: mint, store, redeem, expire.
-- Target: PostgreSQL 18+, applied as the migration/owner role (`app`).
--
-- Single primitive shared across three purposes:
--   1. password_reset
--   2. email_verification
--   3. account_deletion
--
-- =============================================================================
-- 1. TABLE DESIGN & DECISIONS
-- =============================================================================
--
-- A. WHAT IDENTIFIES THE SUBJECT
--
--   `user_id` is a NULLABLE foreign key referencing `public.users(id) ON DELETE CASCADE`.
--   It is nullable because the subject may not exist in `users` yet — specifically
--   registration verification where an unverified registrant has no user row.
--   When the subject does have an account, `user_id` is populated.
--   `ON DELETE CASCADE` is mandatory: `test/rls/user-purge-end-to-end.spec.ts`
--   asserts that EVERY foreign key referencing `users(id)` cascades on delete.
--
--   `subject_hmac bytea NOT NULL` + `pepper_kid text NOT NULL`:
--   Matches the working precedent in `privacy_request_audits` (0010:216-235).
--   Identifies the subject via a keyed HMAC digest under `AUTH_TOKEN_PEPPER`
--   without persisting raw PII (such as plaintext email addresses).
--   `pepper_kid` records which key minted the HMAC to support pepper rotation.
--
-- B. HOW THE TOKEN ITSELF IS STORED
--
--   `token_hash bytea NOT NULL UNIQUE`:
--   Raw tokens are bearer credentials and are NEVER stored in plaintext.
--   A database dump or backup leak containing plaintext tokens would hand an
--   attacker instant account takeover. Storing only the HMAC-SHA256 digest
--   ensures preimage resistance: even with full database access, raw tokens
--   cannot be derived without brute-forcing a 256-bit CSPRNG secret.
--
-- C. SINGLE USE: `consumed_at timestamptz` (NOT a boolean flag)
--
--   `consumed_at timestamptz` records the exact instant a token was redeemed.
--   A boolean `is_consumed` destroys temporal audit evidence.
--   Knowing *when* a token was used allows forensic distinction between immediate
--   user redemption and replay attacks. Matches schema precedents:
--   `refresh_tokens.revoked_at`, `users.deleted_at`, `privacy_requests.responded_at`.
--
-- D. EXPIRY
--
--   `expires_at timestamptz NOT NULL`:
--   Enforced atomically at redemption time: `expires_at > clock_timestamp()`.
--   Redeeming an expired, already-consumed, wrong-purpose, or non-existent token
--   produces identical 0-row results from `authz.redeem_auth_token`.
--
-- E. PURPOSE SEPARATION: STRUCTURALLY ENFORCED
--
--   `purpose text NOT NULL CHECK (purpose IN ('password_reset', 'email_verification', 'account_deletion'))`
--   Enforced in SQL CHECK constraint and in function signatures.
--   A token minted for password reset cannot be redeemed for account deletion.
--
-- =============================================================================
-- 2. RLS POSTURE & THE SEAM
-- =============================================================================
--
--   `ENABLE ROW LEVEL SECURITY`, deliberately NOT `FORCE ROW LEVEL SECURITY`.
--   Follows `privacy_purge_queue`: the thin app connects as `pgrst_authenticator`
--   with `SET LOCAL ROLE app_admin` and never sets `request.jwt.claims`.
--   `authz.actor()` is NULL for thin app requests.
--   Adding `current_user = 'app_admin'` to read policies is forbidden in this codebase.
--
--   Therefore, `public.auth_tokens` has NO privileges granted to `app_anon`,
--   `app_member`, or `app_admin`. PostgREST exposes no endpoints for it.
--   All mutations and redemptions occur through narrow `SECURITY DEFINER`
--   functions in the `authz` schema, granted strictly to `app_admin`.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.auth_tokens (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id      uuid REFERENCES public.users(id) ON DELETE CASCADE,
  subject_hmac bytea NOT NULL,
  pepper_kid   text NOT NULL,
  token_hash   bytea NOT NULL UNIQUE,
  purpose      text NOT NULL CHECK (purpose IN ('password_reset', 'email_verification', 'account_deletion')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz
);

-- Indexes for lookups and maintenance
CREATE INDEX IF NOT EXISTS auth_tokens_user_id_idx
  ON public.auth_tokens (user_id);

CREATE INDEX IF NOT EXISTS auth_tokens_subject_idx
  ON public.auth_tokens (subject_hmac, purpose, created_at);

-- RLS: Enabled, not forced. Revoke all from serving roles.
ALTER TABLE public.auth_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.auth_tokens FROM PUBLIC, app_anon, app_member, app_admin;

-- =============================================================================
-- 3. authz SECURITY DEFINER FUNCTIONS
-- =============================================================================

-- Mint a new token
CREATE OR REPLACE FUNCTION authz.mint_auth_token(
  p_user_id      uuid,
  p_subject_hmac bytea,
  p_pepper_kid   text,
  p_token_hash   bytea,
  p_purpose      text,
  p_ttl_seconds  integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_ttl_seconds <= 0 THEN
    RAISE EXCEPTION 'p_ttl_seconds must be positive, received %', p_ttl_seconds;
  END IF;

  IF p_purpose NOT IN ('password_reset', 'email_verification', 'account_deletion') THEN
    RAISE EXCEPTION 'invalid token purpose %', p_purpose;
  END IF;

  INSERT INTO public.auth_tokens (
    user_id,
    subject_hmac,
    pepper_kid,
    token_hash,
    purpose,
    expires_at
  ) VALUES (
    p_user_id,
    p_subject_hmac,
    p_pepper_kid,
    p_token_hash,
    p_purpose,
    clock_timestamp() + (p_ttl_seconds || ' seconds')::interval
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION authz.mint_auth_token(uuid, bytea, text, bytea, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.mint_auth_token(uuid, bytea, text, bytea, text, integer) TO app_admin;

-- Redeem a token atomically. Single-use and concurrency safe.
-- Concurrent redemptions of the same token race for row lock; exactly one updates
-- consumed_at and returns the row. Subsequent updates see consumed_at IS NOT NULL
-- and return 0 rows.
CREATE OR REPLACE FUNCTION authz.redeem_auth_token(
  p_token_hash bytea,
  p_purpose    text
) RETURNS TABLE (
  id           uuid,
  user_id      uuid,
  subject_hmac bytea,
  pepper_kid   text,
  purpose      text,
  created_at   timestamptz,
  expires_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.auth_tokens t
     SET consumed_at = clock_timestamp()
   WHERE t.token_hash = p_token_hash
     AND t.purpose = p_purpose
     AND t.consumed_at IS NULL
     AND t.expires_at > clock_timestamp()
  RETURNING
    t.id,
    t.user_id,
    t.subject_hmac,
    t.pepper_kid,
    t.purpose,
    t.created_at,
    t.expires_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION authz.redeem_auth_token(bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.redeem_auth_token(bytea, text) TO app_admin;

-- Invalidate all active tokens for a given subject and purpose
CREATE OR REPLACE FUNCTION authz.invalidate_auth_tokens(
  p_subject_hmac bytea,
  p_purpose      text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.auth_tokens
     SET consumed_at = clock_timestamp()
   WHERE subject_hmac = p_subject_hmac
     AND purpose = p_purpose
     AND consumed_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION authz.invalidate_auth_tokens(bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.invalidate_auth_tokens(bytea, text) TO app_admin;

-- Retention purge for expired tokens
CREATE OR REPLACE FUNCTION authz.purge_expired_auth_tokens(
  p_older_than timestamptz
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.auth_tokens
   WHERE expires_at < p_older_than;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION authz.purge_expired_auth_tokens(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.purge_expired_auth_tokens(timestamptz) TO app_admin;

NOTIFY pgrst, 'reload schema';
