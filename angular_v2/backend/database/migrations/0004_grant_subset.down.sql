-- W08b — rollback for 0004_grant_subset.sql.
--
-- Kept as a psql script rather than folded into the migration above, because
-- the migration is also the file a runner applies forward and must stay
-- append-only.
-- Apply with:  psql -v ON_ERROR_STOP=1 -d <db> -f 0004_grant_subset.down.sql
--
-- Triggers come off before their function, so a partial rollback fails on the
-- object that is actually wrong rather than on a dependency error. Data is
-- untouched: the trigger refuses writes, it writes nothing itself.

DROP TRIGGER IF EXISTS role_permissions_grant_subset ON role_permissions;
DROP TRIGGER IF EXISTS user_roles_grant_subset ON user_roles;

DROP FUNCTION IF EXISTS assert_grant_subset();

NOTIFY pgrst, 'reload schema';
