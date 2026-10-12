-- Rollback for 0007_resource_ceilings.sql.
--
-- Kept as a psql script rather than folded into the migration above, because the
-- migration is also the file a runner applies forward and must stay append-only.
-- Apply with:  psql -v ON_ERROR_STOP=1 -d <db> -f 0007_resource_ceilings.down.sql
--
-- Every ceiling is reset to its PostgreSQL default, which is 0 = UNLIMITED.
-- That is a true reversal, and it is also the state the template shipped in: the
-- audit that produced this migration found `statement_timeout`, `lock_timeout`
-- and `idle_in_transaction_session_timeout` all unset. Rolling back therefore
-- restores unbounded behaviour, which is deliberate -- an operator who rolls this
-- back is choosing to remove the ceilings, not to return to a safer default.
--
-- `temp_file_limit` is NOT reset here because it was never set here: it is
-- `PGC_SUSET` (superuser context), so a migration cannot set it. See the up file.

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I RESET statement_timeout', current_database());
  EXECUTE format('ALTER DATABASE %I RESET lock_timeout', current_database());
  EXECUTE format('ALTER DATABASE %I RESET idle_in_transaction_session_timeout', current_database());
END $$;