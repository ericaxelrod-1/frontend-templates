-- W08b — the grant-subset invariant: a writer may not confer a capability it
-- does not hold.
-- Target: PostgreSQL 15+, verified on 15.19.
--
-- Apply as the migration/owner role, the same way 0001 is applied.
--
-- =============================================================================
-- THE GAP THIS CLOSES
-- =============================================================================
-- 0001 grants app_admin full INSERT, UPDATE and DELETE on role_permissions and
-- user_roles with nothing filtering them, so any principal holding those grants
-- confers ANY capability — including one it does not hold. The scope half of
-- least privilege ("an account manager cannot create a user outside their own
-- RLS scope") is enforced free by the policy's WITH CHECK; the capability half
-- ("they cannot grant a capability they themselves do not have") had nothing:
-- these tables are UNSCOPED, so there is no group dimension for RLS to filter
-- and no policy to fall back on. A BEFORE row trigger is the mechanism, for the
-- same reason the administrative floor is one: the rule is per-ROW and
-- per-CALL, and a check in application code is bypassed by the next service,
-- by the seed, and by anyone with psql.
--
-- THE RULE. On INSERT or UPDATE of role_permissions or user_roles, the set
-- being conferred — the permission itself, or the effective permission closure
-- of the role being assigned — must be a subset of the actor's own effective
-- set, computed by the same upward role-hierarchy walk has_permission() uses
-- (UNION, not UNION ALL; no accumulator column; the ancestor set seeded in the
-- CTE). On violation the trigger raises with ERRCODE 42501. A grant that
-- quietly does nothing is how the capability axis ends up silently absent; a
-- refused grant is an authorization decision and reads as one.
--
-- BEFORE INSERT OR UPDATE, both: a BEFORE UPDATE that repoints a row to a
-- different permission_id or role_id is the same escalation with a different
-- verb. OLD is NULL on INSERT, so the check reads NEW on both paths.
--
-- TRUNCATE does not fire a row trigger, exactly as for protect_system_row().
-- It stays closed by the grants — no serving role holds TRUNCATE on either
-- table — and the suite asserts that per role, because a future table-level
-- TRUNCATE grant is the change that would reopen it.
--
-- =============================================================================
-- TWO DEFECTS THE DOCS RECORD, NOT FIXED BY THIS TRIGGER
-- =============================================================================
-- Stated here so no reader mistakes this trigger for more than it is. Both are
-- recorded in ADR-0023 (§Least privilege, §F1) and rebase.md W08b; neither is
-- made worse by landing the trigger, and neither is resolved by it.
--
--   (i) DEFENSE IN DEPTH, NOT A SUBSTITUTE. A caller who already holds the
--   permission they confer makes the check non-vacuous only via the boundary
--   GRANT. In the shipped grants only app_admin holds INSERT on these tables,
--   and app_admin is the superset principal, so the subset path below is not
--   reachable from the request surface today: the check fires for the state in
--   which a narrower principal is granted writes, and for the tamper case that
--   proves it can fail. The trigger is defense in depth — it does not replace
--   the boundary GRANT, and it is vacuous by construction for a grantor
--   conferring exactly what it holds. The separation-of-duty rule pinned to a
--   non-grantable row (the fix for that vacuity) remains future work.
--
--   (ii) THE ACTOR IS ONLY AS TRUSTWORTHY AS F1'S MITIGATION. The actor is read
--   from request.jwt.claims via authz.actor(), and request.jwt.claims is a
--   caller-writable custom GUC: any role may SET it, so a writer with direct
--   SQL access can name any actor and the subset check answers about the named
--   identity. The only control is the architectural one — no request-reachable
--   SQL path may SET it — and this trigger inherits that limitation rather
--   than removing it.
--
-- =============================================================================
-- IDENTITY INSIDE A SECURITY DEFINER FUNCTION — measured, not assumed
-- =============================================================================
-- Measured on 15.19 with a probe function owned by the migration role:
-- current_user, current_role and is_superuser all rebind to the function OWNER
-- (is_superuser answered 'off' for a superuser session); the `role` GUC and
-- session_user track the CALLER ('app_admin' after the boundary's SET ROLE;
-- the login role otherwise). The identity paragraph in
-- 0001_rls_foundation.sql's has_permission comment says session_user also
-- rebinds to the owner; for this function on 15.19 that does not reproduce —
-- session_user reported the login role — so the superuser branch below keys on
-- session_user, not on is_superuser.
--
-- The three branches, in order:
--
--   1. SUPERUSER SESSION. The out-of-band operator path, the same exception
--      protect_system_row() makes — a superuser can DROP the trigger outright,
--      so the branch grants no power that does not already exist.
--   2. NO CALLER IDENTITY + THE SUPERSET PRINCIPAL. Provisioning writes (the
--      fixture seed, database/seed.ts, an operator) go through the escalation
--      boundary as app_admin with no request claims in scope, so actor() is
--      NULL. The branch keys on the `role` GUC — the same fact the policies
--      key on with current_user, because SET ROLE app_admin is exactly what
--      the boundary GRANT constrains and the claim is never read. This mirrors
--      the policies' admin branch, which likewise admits app_admin with a
--      malformed sub. Any OTHER write carrying no identity is REFUSED: fail
--      closed, because a request path always carries claims.
--   3. THE SUBSET CHECK. The actor's effective permission set against the
--      conferred set. An app_admin request whose sub holds a subset role is
--      checked and can be refused — capability follows the role rows, not the
--      database role, which is the invariant.
--
-- SECURITY DEFINER, for the same reason has_permission() is: the check reads
-- the permission matrix (roles, role_permissions, user_roles), and INVOKER
-- would need SELECT on all three for every principal that can write the grant
-- tables — publishing the entire matrix to exactly the writers the rule
-- constrains. These tables carry no policy, so the policy-recursion trap that
-- rules DEFINER out elsewhere cannot be armed here. The function is a trigger
-- function and is granted to NOBODY: it runs attached to the tables, never
-- called directly.
CREATE OR REPLACE FUNCTION assert_grant_subset() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  grantor   uuid;
  conferred uuid[];
  held      uuid[];
  missing   uuid;
BEGIN
  -- Branch 1. session_user is the login role and survives both SET ROLE and the
  -- DEFINER context; SET SESSION AUTHORIZATION is itself superuser-only, so the
  -- answer cannot be forged upward.
  IF (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = session_user) THEN
    RETURN NEW;
  END IF;

  grantor := authz.actor();

  -- Branch 2.
  IF grantor IS NULL THEN
    IF current_setting('role', true) = 'app_admin' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'grant-subset: write to % carries no caller identity and is not the superset principal', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  -- Branch 3. The conferred set: the permission itself for role_permissions,
  -- or the effective permission closure of the role being assigned for
  -- user_roles — the role's own rows plus everything it inherits, because a
  -- child role holds everything its ancestors hold. The walk is the one the
  -- capability axis documents: UNION, no accumulator, seeded in the CTE.
  IF TG_TABLE_NAME = 'role_permissions' THEN
    conferred := ARRAY[NEW.permission_id];
  ELSIF TG_TABLE_NAME = 'user_roles' THEN
    WITH RECURSIVE up (id) AS (
      SELECT NEW.role_id
      UNION
      SELECT r.parent_id
      FROM public.roles r
      JOIN up ON up.id = r.id
      WHERE r.parent_id IS NOT NULL
    )
    SELECT coalesce(array_agg(DISTINCT rp.permission_id), '{}'::uuid[])
      INTO conferred
      FROM public.role_permissions rp
     WHERE rp.role_id IN (SELECT id FROM up);
  ELSE
    -- A misattachment raises rather than silently permitting, the same shape as
    -- protect_system_row().
    RAISE EXCEPTION 'assert_grant_subset is attached to %, which is not a grant table', TG_TABLE_NAME
      USING ERRCODE = '42P01';
  END IF;

  -- The actor's effective set: the actor's own role rows, then up the
  -- hierarchy. Seeding the ancestor set in the CTE is load-bearing — joining
  -- role_permissions to the actor's roles and filtering caps inheritance at
  -- one level, silently.
  WITH RECURSIVE up (id) AS (
    SELECT ur.role_id
    FROM public.user_roles ur
    WHERE ur.user_id = grantor
    UNION
    SELECT r.parent_id
    FROM public.roles r
    JOIN up ON up.id = r.id
    WHERE r.parent_id IS NOT NULL
  )
  SELECT coalesce(array_agg(DISTINCT rp.permission_id), '{}'::uuid[])
    INTO held
    FROM public.role_permissions rp
   WHERE rp.role_id IN (SELECT id FROM up);

  -- The empty set is a subset of everything; a NULL `held` cannot occur because
  -- of the coalesce above, so ANY over an empty array is the only false-shape
  -- and it is handled by the unnest driving the NOT-ANY test.
  SELECT c INTO missing
    FROM unnest(conferred) AS c
   WHERE NOT (c = ANY (held))
   LIMIT 1;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'grant-subset: % confers permission %, which the actor % does not hold', TG_TABLE_NAME, missing, grantor
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

-- Trigger functions are granted to nobody: they run attached to the tables as
-- the table owner, never called directly. EXECUTE goes to PUBLIC by default on
-- every new function, so it is revoked — a DEFINER function anonymously
-- callable is an escalation, not a read leak.
REVOKE EXECUTE ON FUNCTION assert_grant_subset() FROM PUBLIC;

DROP TRIGGER IF EXISTS role_permissions_grant_subset ON role_permissions;
CREATE TRIGGER role_permissions_grant_subset
  BEFORE INSERT OR UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION assert_grant_subset();

DROP TRIGGER IF EXISTS user_roles_grant_subset ON user_roles;
CREATE TRIGGER user_roles_grant_subset
  BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION assert_grant_subset();

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0004_grant_subset.down.sql. Kept as a separate file
-- so this one stays append-only, exactly as in 0001–0003.
