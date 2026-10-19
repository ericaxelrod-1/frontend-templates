-- DOWN: 0028_consent_model
-- =============================================================================
-- See database/migrations/0028_consent_model.sql.
--
-- ORDER IS LOAD-BEARING HERE, three times over.
--
-- FIRST THE TRIGGERS, THEN THE FUNCTIONS, THEN THE TABLES. Dropping a table drops
-- the triggers attached to it, so the table drop would cover the consent tables —
-- but NOT the one trigger this script cannot drop that way:
-- `users_pseudonymize_consent_series` is attached to `public.users`, a table this
-- migration did not create. It goes first of all, or this script leaves a `users`
-- table carrying a trigger whose function no longer exists, and the NEXT
-- anonymisation raises `42883` naming a function nobody can find.
--
-- `consent_records_append_only` is dropped by hand for the same reason: its
-- function is dropped above the table, and a `DROP FUNCTION` with a live trigger
-- on it is refused with `2BP01`.
--
-- SECOND THE TABLES, DEPENDANTS FIRST. `consent_records` names
-- `consent_purposes.key`, and `consent_tag_groups` names both `consent_tags` and
-- `consent_page_groups`. Dropping `consent_purposes` first raises, and a script
-- that aborts half-way has left the database in neither the old state nor the
-- new one.
--
-- There is NO GRANT BLOCK to re-issue, and that is deliberate rather than
-- forgotten: every grant this migration made was preceded by a `REVOKE ALL`, and
-- a table that no longer exists holds no privileges. Restoring the state this
-- migration FOUND means putting back nothing that `0027` or earlier owned — the
-- rule `0027.down.sql` states, and the reason a rollback here cannot break
-- something this file does not mention.
-- =============================================================================

DROP TRIGGER IF EXISTS users_pseudonymize_consent_series ON public.users;
DROP TRIGGER IF EXISTS consent_records_append_only ON public.consent_records;
DROP TRIGGER IF EXISTS consent_purposes_touch_updated_at ON public.consent_purposes;
DROP TRIGGER IF EXISTS consent_page_groups_touch_updated_at ON public.consent_page_groups;
DROP TRIGGER IF EXISTS consent_tags_touch_updated_at ON public.consent_tags;

DROP FUNCTION IF EXISTS authz.pseudonymize_consent_series();
DROP FUNCTION IF EXISTS authz.guard_consent_records_append_only();
DROP FUNCTION IF EXISTS authz.record_consent_decision(text, boolean, text, text);
DROP FUNCTION IF EXISTS authz.effective_consent(uuid);
DROP FUNCTION IF EXISTS authz.purge_expired_consent_records(integer);
DROP FUNCTION IF EXISTS authz.touch_consent_updated_at();

DROP TABLE IF EXISTS public.consent_tag_groups;
DROP TABLE IF EXISTS public.consent_records;
DROP TABLE IF EXISTS public.consent_tags;
DROP TABLE IF EXISTS public.consent_page_groups;
DROP TABLE IF EXISTS public.consent_purposes;

NOTIFY pgrst, 'reload schema';