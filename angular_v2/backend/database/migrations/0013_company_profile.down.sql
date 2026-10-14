-- Rollback for 0013_company_profile.sql.
--
-- Restores the state 0012 left behind, in full:
--   * `public.ccpa_applicable()` dropped, so `/rpc/ccpa_applicable` stops existing;
--   * `public.company_addresses` dropped, taking the FK and its index with it;
--   * `public.company_profile` dropped, taking the singleton index with it;
--   * the policies and the grants go with their tables, because a grant is an entry
--     in `pg_class.relacl` on the relation it names and there is no relation left to
--     hold it.
--
-- Kept as a psql script rather than folded into the migration above, because the
-- migration is also the file a runner applies forward and must stay append-only.
-- Apply with:  psql -v ON_ERROR_STOP=1 -d <db> -f 0013_company_profile.down.sql

-- The function first, while the table it reads still exists. The order is not
-- load-bearing for the DDL — a SQL-language function's body is not parsed at creation
-- time, so Postgres would happily drop the table first and then the function — but
-- doing it in dependency order means a failure anywhere leaves a state a reader can
-- reason about, rather than a schema where the statutory predicate is gone and the
-- addresses it read are still there looking authoritative.
DROP FUNCTION IF EXISTS public.ccpa_applicable();

-- The child before the parent, for the same reason and for one more: the FK is
-- `NO ACTION`, so dropping the parent first would fail with `23503` on any deployment
-- that has actually filled the table in. That refusal is the constraint working — it
-- is the mechanism 0013 chose so that the CCPA predicate cannot be switched off by a
-- careless delete — and this script is the deliberate deletion that satisfies it.
DROP TABLE IF EXISTS public.company_addresses;
DROP TABLE IF EXISTS public.company_profile;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- WHAT A ROLLBACK COSTS — READ BEFORE RUNNING THIS
-- =============================================================================
-- This script is a true reversal of 0013 and nothing else. It is not a routine
-- operation, and the reason is not that anything is technically broken afterwards —
-- it is that three classes of information stop existing, and two of them cannot be
-- recreated:
--
--   * THE COMPANY'S OWN RECORD OF WHERE IT IS. Legal name, registered office, trading
--     address, the postal address a letter of law goes to. The about page, the
--     contact footer and the terms of service render from these tables, and nothing
--     else in this tree holds a second copy — so after this script the site has no
--     address to render and no record of which address it used to publish.
--
--   * THE ANSWER TO A STATUTORY QUESTION AS OF A PAST DATE. `ccpa_applicable()` is
--     derived, which is its virtue and also its limitation: it answers from the
--     addresses that exist NOW. Dropping the tables makes the question unanswerable
--     retroactively. If a data-subject request was handled on the 3rd of March, the
--     evidence that the company held a California address on the 3rd of March goes
--     with this script. Re-applying the migration re-creates the TABLES; it cannot
--     re-create what they held.
--
--   * A DEPENDENCY ANY FRONTEND CODE ALREADY HAS. The generated client carries
--     `/rpc/ccpa_applicable` and both tables. After this script those calls fail, and
--     whether that is a visible 404 or a silent "no jurisdiction" depends entirely
--     on the caller's error handling — which is a client-side decision and not
--     something this script can enforce.
--
-- SAFE TO RUN WHILE NOTHING PUBLISHES THESE TABLES, which is the case on a
-- migrations-only database: the tables are empty, so the first cost above has not
-- been paid yet. The moment a fork fills in its profile, this rollback is a data
-- deletion and should be done deliberately, with the content exported first.
--
-- Verify the rollback from the catalog —
--
--   SELECT to_regclass('public.company_profile'), to_regclass('public.company_addresses');
--   SELECT proname FROM pg_proc WHERE proname = 'ccpa_applicable';
--
-- — NULLs and zero rows are the check, and a `migration:revert` exit code is not: it
-- reports that the script ran, not that the consequence was acceptable.
