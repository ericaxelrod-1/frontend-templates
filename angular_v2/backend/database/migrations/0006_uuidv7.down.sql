-- Rollback for 0006_uuidv7.sql.
--
-- Kept as a psql script rather than folded into the migration above, because the
-- migration is also the file a runner applies forward and must stay append-only.
-- Apply with:  psql -v ON_ERROR_STOP=1 -d <db> -f 0006_uuidv7.down.sql
--
-- This restores the DEFAULTS, not the values. Existing rows keep the ids they were
-- given, which after a forward migration are v7 — and a v7 in a `uuid` column is
-- still a valid uuid, so nothing below has to rewrite data. A forward migration
-- that backfilled would make this rollback lossy; that is the reason it does not
-- backfill.
--
-- The `jti` retype is reversed the same way, and the redundant plain index comes
-- back because dropping it was part of the change being reverted.

DO $$
BEGIN
  IF current_setting('server_version_num')::int < 180000 THEN
    RAISE EXCEPTION
      '0006_uuidv7.down requires PostgreSQL 18 or newer to reason about uuidv7(); this server is %',
      current_setting('server_version');
  END IF;
END $$;

ALTER TABLE customers      ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE email_messages ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE groups         ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE login_attempts ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE permissions    ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE projects       ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE refresh_tokens ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE roles          ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE users          ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE refresh_tokens ALTER COLUMN jti TYPE text USING jti::text;
ALTER TABLE refresh_tokens ALTER COLUMN jti DROP DEFAULT;

CREATE INDEX IF NOT EXISTS refresh_tokens_jti_idx ON refresh_tokens (jti);

NOTIFY pgrst, 'reload schema';