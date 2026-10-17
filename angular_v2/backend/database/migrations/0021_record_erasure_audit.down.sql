-- =============================================================================
-- 0021_record_erasure_audit.down.sql
-- =============================================================================

DROP FUNCTION IF EXISTS authz.record_erasure_audit(uuid, bytea, text, uuid);

NOTIFY pgrst, 'reload schema';
