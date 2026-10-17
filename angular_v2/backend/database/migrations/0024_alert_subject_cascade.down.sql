-- =============================================================================
-- 0024_alert_subject_cascade.down.sql
--
-- Reverses `0024_alert_subject_cascade.sql`: `security_alerts.user_id` goes back
-- to `ON DELETE SET NULL`.
--
-- REVERTING THIS RE-INTRODUCES A KNOWN GAP, and it is stated here rather than
-- left to be discovered by an auditor:
--
--   With SET NULL, erasing a person nulls `security_alerts.user_id` and LEAVES
--   THE ALERT — with that person's `ip_address`, `ip_normalized`, `ip_subnet`
--   and `message` still on it. The pointer to the person is gone and the
--   personal data is not. An IP address is personal data.
--
--   The up file's reasoning is in `0024_alert_subject_cascade.sql`; the short
--   version is that a SUBJECT reference cascades and an ACTOR reference is set
--   null, and this constraint is a subject.
--
-- The other four foreign keys naming `users` are NOT touched here, because this
-- migration never touched them and a down must restore the state it found, not
-- a state some other migration left behind.
-- =============================================================================

ALTER TABLE public.security_alerts
  DROP CONSTRAINT IF EXISTS security_alerts_user_id_fkey;

ALTER TABLE public.security_alerts
  ADD CONSTRAINT security_alerts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
