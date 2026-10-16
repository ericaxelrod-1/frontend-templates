-- =============================================================================
-- 0018_auth_tokens.down.sql
--
-- Reverts migration 0018_auth_tokens.sql.
-- =============================================================================

DROP FUNCTION IF EXISTS authz.purge_expired_auth_tokens(timestamptz);
DROP FUNCTION IF EXISTS authz.invalidate_auth_tokens(bytea, text);
DROP FUNCTION IF EXISTS authz.redeem_auth_token(bytea, text);
DROP FUNCTION IF EXISTS authz.mint_auth_token(uuid, bytea, text, bytea, text, integer);

DROP TABLE IF EXISTS public.auth_tokens CASCADE;

NOTIFY pgrst, 'reload schema';
