-- DOWN: 0030_consent_purposes_seed
-- =============================================================================
-- See database/migrations/0030_consent_purposes_seed.sql.
--
-- ORDER IS LOAD-BEARING, AND THE SECOND STATEMENT IS THE ONE THAT SURPRISES.
--
-- `consent_records.purpose_key` is `ON DELETE RESTRICT` (`0028`): a record names
-- the purpose it was given about, and deleting a purpose that has history would
-- leave the export incoherent. So the seeded purposes cannot simply be deleted
-- while a decision names one of them — the delete is refused with `23503`, which
-- is the RESTRICT doing its job.
--
-- **So the records go FIRST.** A rollback restores the state the migration
-- FOUND, and that state had no seeded purpose and therefore no record naming
-- one. Leaving the records behind while removing the purpose they name would
-- leave a state that never existed, and would leave the export incoherent in
-- exactly the way `0028` named.
--
-- This destroys consent records, and it is worth saying so plainly: a rollback
-- of the SEED is a statement that the template's catalogue is being removed,
-- and a record of a decision about a purpose that no longer exists has nothing
-- left to be a record OF. A fork that has collected real decisions against
-- `necessary` and `consent_record` should ship a fork's own migration rather
-- than roll this one back.
--
-- Both statements run as the migration role, which OWNS `consent_records` — the
-- append-only guard (`0028`) refuses a `DELETE` whose `current_user` is not the
-- owner, and the owner is the one role `PostgREST` cannot be talked into
-- assuming.
-- =============================================================================

DELETE FROM public.consent_records
 WHERE purpose_key IN ('necessary', 'consent_record');

DELETE FROM public.consent_purposes
 WHERE key IN ('necessary', 'consent_record');

NOTIFY pgrst, 'reload schema';
