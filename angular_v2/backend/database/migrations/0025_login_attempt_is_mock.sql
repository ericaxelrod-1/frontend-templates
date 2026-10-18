-- =============================================================================
-- 0025_login_attempt_is_mock.sql
--
-- One column on `login_attempts`.
-- Target: PostgreSQL 18+, applied as the migration/owner role (`app`).
--
-- =============================================================================
-- WHY THIS COLUMN, AND WHY IT IS NOT OPTIONAL
-- =============================================================================
--
-- `0022` gave `is_mock` to the five tables it created — `ip_reputation`,
-- `security_alerts`, `security_detected_patterns`, `pattern_login_attempts` and
-- `captcha` — and `login_attempts`, which predates all of them, did not get one.
-- The admin pages that read it then had to work out whether an attempt was
-- synthetic by a route that does not work:
--
--   "an attempt is synthetic IF it is referenced by a `pattern_login_attempts` row
--    whose own `is_mock` is true".
--
-- That is an accidental property of how the rows happen to be linked, not a
-- property of the attempt. Two things follow, and both are wrong:
--
--   * A SYNTHETIC ATTEMPT THAT IS NOT LINKED TO A PATTERN IS INDISTINGUISHABLE
--     FROM A REAL ONE. The seed happened to link every synthetic attempt to a
--     pattern, so the page appeared to work; the mechanism itself is a JOIN, and a
--     join is not a property of the row.
--   * THE FILTER WAS CLIENT-SIDE. Every other telemetry page asks the database
--     for `is_mock = eq.false` and the database returns the real rows. For
--     `login_attempts` the page fetched EVERY attempt and filtered in the
--     browser, so "synthetic rows are hidden by default" was a property of that
--     page's JavaScript rather than of the API — and a direct request to
--     `/rest/login_attempts` returned the synthetic rows regardless.
--
-- A display filter that a caller can bypass by asking the database a different
-- question is not a filter. So the column moves to where the row is, and the
-- predicate becomes one server-side `is_mock = eq.false` like every other
-- telemetry table — which is the property that makes it hold for the API and not
-- only for the page.
--
-- =============================================================================
-- WHAT IT IS AND IS NOT
-- =============================================================================
--
-- `NOT NULL DEFAULT false`, so the auth path's existing inserts are unaffected
-- and every row written from now on is real by default.
--
-- It is a LABEL and not an input to any decision. No policy and no function in
-- the schema reads it: a synthetic row must never reach a risk score or a block
-- decision, and the way to guarantee that is for nothing to consume it. The
-- display filter is the whole of its job.
--
-- `0018` holds the reasoning for why the token tables store only HMACs, and it
-- is why this column is a boolean rather than anything that could carry a
-- secret: there is nothing secret about "this row is synthetic".
-- =============================================================================

ALTER TABLE public.login_attempts
  ADD COLUMN IF NOT EXISTS is_mock boolean NOT NULL DEFAULT false;

-- The synthetic seed rows are the only rows the admin pages hide, and they are
-- now findable with one predicate on the table itself.
CREATE INDEX IF NOT EXISTS login_attempts_is_mock_idx
  ON public.login_attempts (is_mock);

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0025_login_attempt_is_mock.down.sql. Kept as a separate
-- file so this one stays append-only, exactly as in 0001–0024.
