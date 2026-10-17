-- =============================================================================
-- 0022_security_telemetry.down.sql
--
-- Reverses `0022_security_telemetry.sql`. Order matters in two places, each of
-- which is a dependent object rather than a preference:
--
--   1. POLICIES BEFORE TABLES. A policy is owned by its table, so dropping the
--      table first takes the policy with it and leaves the statement that was
--      meant to be explicit having done nothing legible.
--   2. THE FUNCTION BEFORE NOTHING — there is no function left to drop. The
--      `authz.guard_mock_rows()` trigger and its `REVOKE EXECUTE` were removed
--      from the up migration, so there is deliberately no `DROP FUNCTION` here.
--      If a future draft reinstates a trigger, its down must drop the trigger
--      before the function, or the drop fails on a dependent trigger.
--
-- No data is preserved and none can be: every object here is created by this
-- migration. That is stated rather than left to be discovered, because "down
-- lost my alerts" should be a decision someone made deliberately.
-- =============================================================================

DROP POLICY IF EXISTS row_scope ON public.captcha;
DROP POLICY IF EXISTS row_scope ON public.security_alerts;
DROP POLICY IF EXISTS row_scope ON public.pattern_login_attempts;
DROP POLICY IF EXISTS row_scope ON public.security_detected_patterns;
DROP POLICY IF EXISTS row_scope ON public.ip_reputation;

DROP TABLE IF EXISTS public.captcha;
DROP TABLE IF EXISTS public.security_alerts;
DROP TABLE IF EXISTS public.pattern_login_attempts;
DROP TABLE IF EXISTS public.security_detected_patterns;
DROP TABLE IF EXISTS public.ip_reputation;

NOTIFY pgrst, 'reload schema';
