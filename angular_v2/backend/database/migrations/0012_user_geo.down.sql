-- Rollback for 0012_user_geo.sql.
--
-- Restores the state 0009 left behind, in full:
--   * the partial index on `users.region_code` dropped;
--   * the six geo columns dropped, which takes their CHECK constraints with them;
--   * the `app_member` column grant on `users` returned to the four columns 0008
--     listed, so a member can no longer read their own jurisdiction.
--
-- Kept as a psql script rather than folded into the migration above, because the
-- migration is also the file a runner applies forward and must stay append-only.
-- Apply with:  psql -v ON_ERROR_STOP=1 -d <db> -f 0012_user_geo.down.sql

-- The grants first, then the columns: restoring the narrower column list while the
-- geo columns still exist would leave `app_member` holding a privilege over columns
-- that are about to disappear, which is a smaller problem than the reverse order and
-- is avoided anyway because it costs one statement.
REVOKE SELECT ON public.users FROM app_member;
GRANT SELECT (id, username, email, created_at) ON public.users TO app_member;

-- The index goes with its column, but it is named explicitly first so that a failure
-- here names the index rather than surfacing later as a missing index on a column
-- that no longer exists. `IF EXISTS` because a database that was never given the
-- index has nothing to drop, and a rollback that fails on an absent object is a
-- rollback that stops half-done.
DROP INDEX IF EXISTS public.users_region_code_idx;

-- Dropping a column drops the CHECK constraints defined on it, so none is named
-- here: a `DROP CONSTRAINT IF EXISTS users_geo_source_check` that ran AFTER the
-- column was gone would succeed and change nothing, and one that ran BEFORE on a
-- database where the column was already absent would raise
-- `column "geo_source" does not exist` — because the constraint expression is
-- parsed against the table. The column drop is therefore both necessary and
-- sufficient, and naming the constraints here would only add a way to fail.
ALTER TABLE public.users DROP COLUMN IF EXISTS geo_accuracy_km;
ALTER TABLE public.users DROP COLUMN IF EXISTS geo_updated_at;
ALTER TABLE public.users DROP COLUMN IF EXISTS geo_source;
ALTER TABLE public.users DROP COLUMN IF EXISTS city;
ALTER TABLE public.users DROP COLUMN IF EXISTS region_code;
ALTER TABLE public.users DROP COLUMN IF EXISTS country_code;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- WHAT A ROLLBACK COSTS — READ BEFORE RUNNING THIS
-- =============================================================================
-- This script is a true reversal of 0012 and nothing else, and that is exactly why
-- it is not a routine operation:
--
--   * IT DESTROYS EVIDENCE, irreversibly. Every provenance record goes with the
--     columns: which rows were GeoIP inferences rather than assertions, how large a
--     confidence radius each one carried, and when it was written. None of it can be
--     reconstructed — the provider's answer for an address is not stored anywhere
--     else, and the next lookup may return a different answer. If a data-subject
--     request or an audit ever asks "how did you conclude this person was in
--     California, and how sure were you", the answer after this script is "there is
--     no longer any record", which is a worse answer than an imperfect one.
--
--   * IT LOSES THE ABILITY TO DISTINGUISH A GUESS FROM AN ASSERTION. That
--     distinction is the reason the columns exist; after this script every region
--     in the database is simply a region, and a future compliance decision cannot
--     tell which evidence it would be acting on.
--
--   * IT NARROWS A MEMBER'S READ OF ITS OWN DATA. The grant returns to 0008's four
--     columns, so a signed-in person can no longer see the geography held about them
--     — the disclosure of personal data becomes unavailable to the subject of it.
--
-- Nothing else breaks: no policy, function or capability in this tree reads these
-- columns, because the geolocation reader and the endpoint that writes them are
-- later work. So the safe rule is the same one 0008's down script states: if the
-- geo feature exists, roll this back only together with it. Verify the rollback from
-- the catalog —
--
--   SELECT attname FROM pg_attribute
--    WHERE attrelid = 'public.users'::regclass
--      AND attname IN ('country_code', 'region_code', 'city',
--                      'geo_source', 'geo_accuracy_km', 'geo_updated_at');
--
-- — returning zero rows is the check, and a `migration:revert` exit code is not: it
-- reports that the script ran, not that the consequence was acceptable.
