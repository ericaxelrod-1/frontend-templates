-- W11 slice 3 — canonical IP keys on login_attempts.
-- Target: PostgreSQL 15+, verified on 15.19.
--
-- The counters that drive the brute-force gate need to group by the
-- *canonical* address, not the caller's string: `1.2.3.4`,
-- `::ffff:1.2.3.4` and `01.2.3.4` are one host. The service writes the
-- normalised host (`ip_normalized`) and the subnet key (`ip_subnet` — the
-- /64 for IPv6, the normalised host for IPv4) alongside the raw `ip`, so
-- the grouping is queryable and indexable rather than re-derived per read.
--
-- Rows written before this migration (slice 1/2 era) keep NULL keys: they
-- predate the canonical form, and a counter built on un-normalised strings
-- would be exactly the rotation-vulnerable count this migration exists to
-- replace. They remain in the table for audit; they count for nothing.
--
-- Requests from an allowlisted address carry their keys as NULL *on
-- purpose*: the counters must never see them ("allowlisted IPs skip
-- counting entirely"), and NULL is the marker. The raw `ip` stays, so the
-- row is still accounted for.
--
-- Both columns are added with IF NOT EXISTS so a database where the
-- alteration already ran (dev databases migrated by hand) is not an error.

ALTER TABLE public.login_attempts ADD COLUMN IF NOT EXISTS ip_normalized text;
ALTER TABLE public.login_attempts ADD COLUMN IF NOT EXISTS ip_subnet text;

CREATE INDEX IF NOT EXISTS login_attempts_ip_subnet_idx ON public.login_attempts (ip_subnet);
CREATE INDEX IF NOT EXISTS login_attempts_username_created_idx ON public.login_attempts (username, created_at);

-- Phase 2 of the login handler flips the optimistic 'failed' row to
-- 'succeeded' on a real success, which a column-limited GRANT would refuse.
GRANT UPDATE ON public.login_attempts TO app_admin;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0003_login_attempt_ip_keys.down.sql. Kept as a
-- separate file so this one stays append-only, exactly as in 0002.
