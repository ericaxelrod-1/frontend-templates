-- DOWN: 0029_consent_write_endpoint
-- =============================================================================
-- See database/migrations/0029_consent_write_endpoint.sql.
--
-- ONE FUNCTION GOES. That is the whole reversal, and it is the whole reversal
-- because this migration added exactly one object: the `public` wrapper.
--
-- WHAT IS DELIBERATELY NOT TOUCHED
--
--   * `authz.record_consent_decision` is NOT dropped. It is `0028`'s, and it is
--     still the only writer of `consent_records` after this migration is reverted.
--     Dropping it here would take the write seam with it.
--   * The `EXECUTE` grant on `authz.record_consent_decision` is NOT revoked. It
--     was already in force before this migration — `0028` granted it — and this
--     migration only re-affirmed it. Revoking it here would leave the database in
--     a state `0028` did not create, which is the rule `0027.down.sql` and
--     `0028.down.sql` both state: a down script restores what the migration FOUND,
--     and puts back nothing that an earlier migration owns.
--   * No table, policy, trigger or grant on `consent_records` is touched. This
--     migration changed none of them.
--
-- After this script, `POST /rpc/record_consent_decision` is a 404 again — which is
-- the state `0028` left behind, and the state the frontend's `catchError` used to
-- hide. The failure is visible in the served contract again, which is the point.
-- =============================================================================

DROP FUNCTION IF EXISTS public.record_consent_decision(text, boolean, text, text);

NOTIFY pgrst, 'reload schema';
