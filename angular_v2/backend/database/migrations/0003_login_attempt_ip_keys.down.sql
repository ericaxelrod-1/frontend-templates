-- W11 slice 3 — rollback for 0003_login_attempt_ip_keys.sql.
DROP INDEX IF EXISTS public.login_attempts_username_created_idx;
DROP INDEX IF EXISTS public.login_attempts_ip_subnet_idx;
REVOKE UPDATE ON public.login_attempts FROM app_admin;
ALTER TABLE public.login_attempts DROP COLUMN IF EXISTS ip_subnet;
ALTER TABLE public.login_attempts DROP COLUMN IF EXISTS ip_normalized;
NOTIFY pgrst, 'reload schema';
