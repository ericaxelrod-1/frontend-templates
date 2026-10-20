-- DOWN — 0031_admin_membership_write.sql
--
-- Removes the administration of the scope axis: the administrator can no longer add
-- or remove a group membership through the API, and the grant state returns to what
-- `0001` left behind — a `SELECT` for every serving role and no write verb for any of
-- them.
--
-- WHAT THIS DOES NOT UNDO, and it is the one thing an operator needs to know: the
-- seed's own `grantSeedAccess()` still grants `SELECT, INSERT, UPDATE, DELETE` on
-- `user_groups` to `app_admin`, and that grant is cluster-independent and out of
-- band for this file. On a seeded database the membership write therefore SURVIVES
-- this revert. Removing it is the seed's hardening step
-- (`REVOKE INSERT, UPDATE, DELETE ON user_groups FROM app_admin`), and it is
-- deliberately not performed here: this file reverses what this file did.
--
-- `SELECT` is left alone for the same reason it was never revoked above — the scope
-- policy reads this table with the querying role's privileges, and a member with no
-- read on it cannot have a scoped read evaluated at all.

REVOKE INSERT, DELETE ON user_groups FROM app_admin;

NOTIFY pgrst, 'reload schema';
