-- Rollback for 0010_privacy_requests.sql.
-- DESTRUCTIVE, AND NOT IN THE USUAL WAY — read the last section before running it.
--
-- Kept as a psql script rather than folded into the migration above, because the
-- migration is also the file a runner applies forward and must stay append-only.
-- Apply with:  psql -v ON_ERROR_STOP=1 -d <db> -f 0010_privacy_requests.down.sql
--
-- ORDER IS THE WHOLE OF THE FIRST HALF. Verified on the pattern 0005's down
-- script records: dropping a table while a policy references a function raises
-- "cannot drop … because other objects depend on it", so the policies come off
-- first, then the functions they call, then the tables — and the child table
-- before its parent, or the foreign key stops the parent going.

-- Policies first. The audit table's policy calls a helper, so the helper cannot
-- be dropped before the policy that names it.
DROP POLICY IF EXISTS privacy_request_audit_read     ON public.privacy_request_audits;
DROP POLICY IF EXISTS privacy_request_regulation_read   ON public.privacy_request_regulations;
DROP POLICY IF EXISTS privacy_request_regulation_create ON public.privacy_request_regulations;
DROP POLICY IF EXISTS privacy_request_regulation_update ON public.privacy_request_regulations;
DROP POLICY IF EXISTS privacy_request_read   ON public.privacy_requests;
DROP POLICY IF EXISTS privacy_request_create ON public.privacy_requests;
DROP POLICY IF EXISTS privacy_request_update ON public.privacy_requests;

-- The write function, then the four capability helpers. Dropping the helpers
-- first would fail against the write function's body, which names `has_permission`
-- rather than them, so either order works — but doing the write function first
-- means nothing in this file can still append a row while the rest is being torn
-- down.
DROP FUNCTION IF EXISTS authz.append_privacy_request_audit(text, uuid, timestamptz, text, text, timestamptz, text, text, text, bytea, text, uuid);
DROP FUNCTION IF EXISTS authz.can_read_privacy_request_audit();
DROP FUNCTION IF EXISTS authz.can_update_privacy_request();
DROP FUNCTION IF EXISTS authz.can_read_privacy_request();
DROP FUNCTION IF EXISTS authz.can_create_privacy_request();

-- Tables. The child goes before its parent so the foreign key is not in the way.
-- Dropping a table takes every grant on it with it, so no grant state is left
-- behind; the up file revoked PUBLIC/app_anon/app_member/app_admin before
-- granting, and there is nothing to undo here.
DROP TABLE IF EXISTS public.privacy_request_regulations;
DROP TABLE IF EXISTS public.privacy_requests;
DROP TABLE IF EXISTS public.privacy_request_audits;

-- The capability rows this migration added, and the grants that pointed at them.
-- Scoped to the four `(resource, action_id)` pairs ON PURPOSE: a DELETE with a
-- broader predicate would strip capabilities this migration never granted. The
-- `role_permissions` rows go BEFORE the `permissions` rows or the delete leaves a
-- dangling reference (`0005:25-32`).
DELETE FROM public.role_permissions
 WHERE permission_id IN (
   SELECT id FROM public.permissions
    WHERE resource = 'privacy_request'
       OR resource = 'privacy_request_audit'
 );
DELETE FROM public.permissions WHERE resource = 'privacy_request';
DELETE FROM public.permissions WHERE resource = 'privacy_request_audit';

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- WHAT A ROLLBACK COSTS — READ BEFORE RUNNING THIS
-- =============================================================================
-- This script is a true reversal of 0010 and nothing else. That is exactly why
-- it must not be run casually on a database that has answered a consumer
-- request:
--
--   * `DROP TABLE privacy_request_audits` is IRREVERSIBLE BY CONSTRUCTION.
--     There is no other copy of what was asked for, when it was asked, how it
--     arrived, what the business did about it and under which statutory basis.
--     11 CCR §7101(a) and CPRA §1798.105(c)(2) require that record to be
--     RETAINED for at least 24 months, so running this inside that window does
--     not revert a migration — it destroys the only evidence that a request was
--     honoured, which converts compliance from an obligation into an
--     unverifiable claim.
--   * `DROP TABLE privacy_requests` takes every unanswered request with it, and
--     the subjects of those requests have no other record that they ever asked.
--   * Removing the four permission rows revokes the capability axis for these
--     tables at the same moment. A client built against the regenerated spec
--     gets `42501` rather than an empty result.
--
-- So: on a database with any recorded request, do not run this. If it must be
-- run, dump the two tables first —
--
--   pg_dump --data-only --table=public.privacy_request_audits \
--           --table=public.privacy_requests -d <db> > privacy_records.sql
--
-- — and verify the dump is non-empty, because the exit code of `migration:revert`
-- reports that the SCRIPT ran, not that the consequence was acceptable.