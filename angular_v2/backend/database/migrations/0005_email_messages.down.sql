-- W26 slice — rollback for 0005_email_messages.sql.
-- DESTRUCTIVE: recorded email history does not come back.
--
-- Kept as a psql script rather than folded into the migration above, because the
-- migration is also the file a runner applies forward and must stay append-only.
-- Apply with:  psql -v ON_ERROR_STOP=1 -d <db> -f 0005_email_messages.down.sql
--
-- ORDER IS THE WHOLE OF THIS FILE, and the dependency is not obvious. Verified:
-- dropping the table while a policy references a function raises a dependency
-- error naming the policy, so the policies come off first, then the functions
-- they call, then the table. The two granted role_permissions rows come off
-- BEFORE the permission row they point at, or the delete leaves a dangling
-- reference.

-- Policies first: a policy is a dependent object, and dropping the table while
-- one references authz.can_read_email() / authz.visible_user_ids() fails with
-- "cannot drop … because other objects depend on it".
DROP POLICY IF EXISTS email_read_scope ON public.email_messages;
DROP POLICY IF EXISTS email_write ON public.email_messages;

-- Functions before the table, same reason.
DROP FUNCTION IF EXISTS authz.can_read_email();
DROP FUNCTION IF EXISTS authz.visible_user_ids();

-- The capability rows this migration added. Scoped to ('email','read') on
-- purpose: a DELETE with a broader predicate would strip capabilities this
-- migration never granted.
DELETE FROM public.role_permissions
 WHERE permission_id IN (
   SELECT id FROM public.permissions WHERE resource = 'email' AND action_id = 'read'
 );
DELETE FROM public.permissions WHERE resource = 'email' AND action_id = 'read';

-- Table and its indexes. Dropping the table drops every grant on it, so no grant
-- state is left behind; the up revoked PUBLIC/app_anon/app_member/app_admin before
-- granting, and there is nothing to undo here.
DROP TABLE IF EXISTS public.email_messages;

NOTIFY pgrst, 'reload schema';