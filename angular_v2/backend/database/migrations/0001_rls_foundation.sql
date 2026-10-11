-- W26 — the two-axis authorization schema: SCOPE in RLS, CAPABILITY in OLS.
-- Target: PostgreSQL 15+, verified on 15.19.
--
-- Apply as the migration/owner role: a non-superuser that owns the database and
-- every object in it, with no table grants to the request-serving roles and no
-- membership in them.
--
-- ROLES ARE NOT HERE. `CREATE ROLE` needs CREATEROLE, a cluster-level privilege,
-- so role bootstrap lives in database/bootstrap/001_roles.sql and runs once as a
-- superuser. Everything below is database-scoped, except one statement that
-- cannot be: the escalation boundary `GRANT app_anon, app_member, app_admin TO
-- pgrst_authenticator` needs ADMIN OPTION and is therefore a superuser statement
-- living in the bootstrap. Verified: running it here fails with
-- `must have admin option on role "app_anon"`.
--
-- ---------------------------------------------------------------------------
-- SUPERSEDED NOTE — everything the previous revision of this file implemented is
-- gone and must not be copied back. That revision created a `sites` table, read a
-- `site_id` claim out of the token through `claim_site_id()`, read the raw claims
-- through `request_claims()`, and walked the site tree once per candidate row with
-- a recursive `site_tree_ids()` helper. It is wrong on both halves: a token claim
-- cannot express a membership that changes mid-session, and a per-row walk is not
-- hoisted (measured: 400,001 calls over 400,000 rows, against `loops = 1` for the
-- closure-join policy below). It also carried no capability axis at all.
--
-- Replacements, both proved by execution (ADR-0023, rebase.md §5.3):
--   SCOPE     groups + user_groups, joined to the org_closure materialized view
--   CAPABILITY actions + permissions + roles + role_permissions + user_roles,
--              resolved by has_permission()
-- ---------------------------------------------------------------------------
--
-- The proof that all of this works is backend/test/rls/ and runs in `npm run verify`.

-- =============================================================================
-- PREFLIGHT — the four serving roles must already exist
-- =============================================================================
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name)
    INTO missing
    FROM unnest(ARRAY['app_anon', 'app_member', 'app_admin', 'pgrst_authenticator']) AS name
   WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = name);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing role(s) [%] — run database/bootstrap/001_roles.sql as a superuser first', missing;
  END IF;
END
$$;

-- =============================================================================
-- THE authz SCHEMA — authorization internals, outside the API surface
-- =============================================================================
-- `db-schemas = "public"`. PostgREST serves every relation and every function in
-- the schemas it is given, and under `openapi-mode = "ignore-privileges"` it
-- advertises them REGARDLESS of grants — so "restricted" is not a state PostgREST
-- can represent. Anything that must be readable by a request-serving role but must
-- not be reachable over HTTP lives here instead.
--
-- Two objects qualify, for two different reasons, and both are forced rather than
-- chosen:
--   authz.org_closure   the closure matview. Its SELECT grant is not optional —
--                       a policy expression's subquery runs with the QUERYING
--                       role's privileges, so without it no scoped read can be
--                       evaluated at all ("permission denied for materialized
--                       view", measured on every insert, select and update).
--   authz.actor()       the identity accessor. In `public` PostgREST publishes it
--                       as an RPC, which is an API resource nobody asked for; it
--                       is a policy helper. Exposing it costs nothing and buys
--                       nothing, so it is not exposed.
--
-- has_permission() deliberately stays in `public`: it IS an API resource, called
-- over RPC for capabilities that are not table verbs (pages, exports, workflow
-- actions).
CREATE SCHEMA IF NOT EXISTS authz;
REVOKE ALL ON SCHEMA authz FROM PUBLIC;
GRANT USAGE ON SCHEMA authz TO app_anon, app_member, app_admin;

-- =============================================================================
-- CAPABILITY AXIS (OLS) — unscoped reference data
-- =============================================================================
-- Every table in this file is declared in one of three scoping categories, and the
-- category determines its primary key and its foreign-key discipline. The
-- declaration is in the comment above the table; it is a design constraint, not a
-- description.
--
--   GROUP-SCOPED  projects, customers      PRIMARY KEY (group_id, id)
--   HIERARCHY     groups                   PRIMARY KEY (id)
--   UNSCOPED      actions, permissions, roles, role_permissions, user_roles,
--                 user_groups              simple primary keys
--
-- Capability is `resource` + `action` over a TABLE, so a new capability is one
-- inserted row and no migration. It is never keyed on a PostgreSQL role name:
-- capability rows keyed by `current_setting('role')` left the `roles` table
-- referenced by nothing, so no query, no constraint and no migration could answer
-- "what can this role do?".

CREATE TABLE IF NOT EXISTS actions (
  name text PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS permissions (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource  text NOT NULL,
  action_id text NOT NULL REFERENCES actions (name),
  -- What makes a capability addressable: ('project', 'delete') is two columns,
  -- not a string every call site has to parse.
  UNIQUE (resource, action_id)
);

CREATE TABLE IF NOT EXISTS roles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL UNIQUE,
  -- A child role holds everything its parent holds, so the resolver walks UP from
  -- the caller's roles. This is application data in a table, NOT PostgreSQL
  -- GRANT-based role inheritance: every serving role is NOINHERIT, and database
  -- inheritance can only add privileges, never subtract them.
  parent_id      uuid REFERENCES roles (id),
  -- Marks rows the application may not UPDATE or DELETE: they are the administrative
  -- floor, and they are what the superset role is recognised by — not by its name.
  -- That sentence is a claim about ENFORCEMENT, so the enforcement is here and not
  -- merely in this comment: see protect_system_row() below. An earlier revision of
  -- this file carried the column with this comment and nothing else, and app_admin
  -- deleted a system role over HTTP with a 204 and no error.
  is_system_role boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS roles_parent_id_idx ON roles (parent_id);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       uuid NOT NULL REFERENCES roles (id),
  permission_id uuid NOT NULL REFERENCES permissions (id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  -- No foreign key to `users`: the authentication tables are a later work item
  -- and this migration must not invent them. When `users` lands this becomes
  -- `REFERENCES users (id)`, which the referential-integrity rule permits —
  -- user_roles is unscoped and members hold no write grant on it, so an FK from
  -- there terminates at a table members cannot write to.
  user_id       uuid NOT NULL,
  role_id       uuid NOT NULL REFERENCES roles (id),
  PRIMARY KEY (user_id, role_id)
);

-- =============================================================================
-- SCOPE AXIS (RLS) — the hierarchy, then the membership, then the closure
-- =============================================================================

-- HIERARCHY. `groups` IS the group: it has no group_id column, so it cannot take
-- the composite key the scoped tables take, and its self-FK is the only cycle the
-- closure depends on.
--
-- ENABLEd but deliberately NOT FORCEd. The reason is measured, not inherited:
-- REFRESH MATERIALIZED VIEW evaluates the view's query with the privileges of the
-- view owner, and RLS applies to the owner under FORCE. Verified on 15.19: a
-- FORCE'd `groups` plus a working policy, refreshed by the owner, wrote a closure
-- containing ZERO rows — not "half the tree". The failure is TOTAL, and the
-- half-loss figure is the lucky case, because the owner's own policy admits nothing
-- without claims: the anchors are self-inclusive (`SELECT id FROM groups`), so the
-- row every ancestor/descendant pair starts from is itself filtered out, and a
-- closure of zero pairs is what a two-node tree produces. It still raises nothing.
-- There is no non-superuser role in this database that can read `groups`
-- unrestricted, because FORCE binds the owner and NOSUPERUSER NOBYPASSRLS binds
-- everyone else. The owner is the only reader the closure refresh can use, so the
-- owner must be exempt here.
--
-- The trade, stated rather than buried: an owner can read the group tree
-- unrestricted. It is the shape of the org chart and holds no tenant payload — no
-- names, contacts or records — so the blast radius is the hierarchy, not the data.
-- Every REQUEST-serving role is still bound by the policy below. The owner never
-- receives a request; it exists to apply migrations.
--
-- This replaces the withdrawn justification for the same decision, which was that
-- FORCE caused policy recursion through a per-row walk. That walk is gone.
-- The hierarchy. `is_system_group` is the scope axis's half of the administrative
-- floor and is enforced by exactly the same trigger as `roles.is_system_role` — see
-- protect_system_row() below. Deleting the groups floor would unparent the subtree
-- every scope decision in this file is resolved through.
CREATE TABLE IF NOT EXISTS groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       uuid REFERENCES groups (id),
  name            text NOT NULL UNIQUE,
  is_system_group boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The closure joins on parent_id for every generation, so this index is what the
-- refresh reads.
CREATE INDEX IF NOT EXISTS groups_parent_id_idx ON groups (parent_id);

-- Membership. NOT member-writable: no INSERT/UPDATE/DELETE is granted to any
-- request-serving role, including the admin one, and there is no policy to
-- substitute for the grant. This is the single control that fails OPEN if it is
-- forgotten, because a member who can write their own membership row widens their
-- own scope by one statement. The owner role writes these rows (seeding, and an
-- operator); see the grants section for why the admin is refused too.
CREATE TABLE IF NOT EXISTS user_groups (
  user_id  uuid NOT NULL,
  group_id uuid NOT NULL REFERENCES groups (id),
  PRIMARY KEY (user_id, group_id)
);

-- =============================================================================
-- GROUP-SCOPED TABLES
-- =============================================================================
-- PRIMARY KEY (group_id, id), and a secondary index on `id` alone so a single-key
-- lookup still uses an index.
--
-- The composite key is doing security work, not cosmetics: "this row belongs to a
-- group" is part of the row's identity, so a UNIQUE violation is itself
-- group-scoped and a cross-group insert cannot collide with — or probe — another
-- group's rows.
--
-- THE SECONDARY INDEX IS UNIQUE, and that is a deliberate trade with a documented
-- cost. It makes `id` a globally unique key, so `WHERE id = $1` is unambiguous from
-- outside the group. In exchange, inserting a row with an id that exists in
-- ANOTHER group raises 23505, which is a cross-group existence signal. It is not
-- exploitable in practice — the database generates the id, and since 0006 it is a
-- v7: a 48-bit timestamp prefix over 74 random bits, so a caller has to already
-- know the value it is probing for — but the cost is
-- real and it is the reason the row-scoped PK exists. Drop `UNIQUE` here if you
-- would rather have no cross-group signal than a single-column index.
CREATE TABLE IF NOT EXISTS projects (
  group_id       uuid NOT NULL REFERENCES groups (id),
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  budget_cents   bigint NOT NULL DEFAULT 0,
  -- Present so the column-grant test has something to hide.
  internal_notes text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_id_uniq ON projects (id);

CREATE TABLE IF NOT EXISTS customers (
  group_id       uuid NOT NULL REFERENCES groups (id),
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  internal_notes text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_id_uniq ON customers (id);

-- =============================================================================
-- IDENTITY
-- =============================================================================
-- actor() reads `sub` out of the verified token. It is the ONLY thing in this
-- schema that reads the claims setting, and both accessors the withdrawn revision
-- used are gone with it.
--
-- PRECEDENCE, and it is the whole trap in this function: `::` binds tighter than
-- `->>`, so `(claims ->> 'sub')::uuid` is required and `claims ->> 'sub'::uuid`
-- casts the LITERAL 'sub' instead of the extracted text. Parenthesise the
-- extraction, then cast.
--
-- THE CAST IS CAUGHT, and that is a deliberate deviation from the one-line snippet
-- in ADR-0023 §Row scope. The snippet as written raises on a malformed `sub` and
-- a policy that raises is a 500 on every request: fail-closed, but an internal
-- error rather than an authorization decision, and an operator reading the log
-- investigates the wrong thing. ADR-0023 records this as a residual defect and
-- says the fix is to catch the cast here; AGENTS.md B2 requires the same. So the
-- guarded form is preserved exactly and the exception handler is added.
--
-- SECURITY DEFINER is declared because the shape calls for it, and the honest
-- reason it is safe is narrow: this function reads no table and returns nothing
-- but the caller's own identifier. It is not a general licence to make helpers
-- privileged. search_path is pinned so nothing in this schema can be shadowed by
-- an object in a later-searched schema.
CREATE OR REPLACE FUNCTION authz.actor() RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  raw text;
BEGIN
  raw := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub');
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
EXCEPTION
  WHEN others THEN
    -- Fail closed. A caller that cannot name itself has no scope.
    RETURN NULL;
END
$$;

-- =============================================================================
-- CAPABILITY RESOLVER
-- =============================================================================
-- has_permission(who, resource, action) resolves through user_roles ->
-- role_permissions -> permissions -> actions, walking UP roles.parent_id so a
-- child role holds everything its ancestors hold.
--
-- IDENTITY IS THE `who` ARGUMENT, never current_user. Inside a SECURITY DEFINER
-- function current_user rebinds to the function OWNER, so a body that read it
-- returned the same answer for every caller — an unconditional false that looks
-- exactly like a working check. The previous capability resolver did precisely
-- that and returned false for the administrator WHILE HOLDING the row. Every
-- member of the denial-only kind of test passed against it, which is why the
-- positive case is asserted: an actor who HOLDS the permission must return true.
--
-- SECURITY DEFINER, AND IT MUST STAY THAT WAY. Two reasons, both load-bearing:
--   1. RECURSION. Reading `roles` from inside a policy on `roles` is the
--      documented policy-recursion trap. A SECURITY INVOKER resolver would be
--      subject to that policy and re-enter it for every row. DEFINER runs with the
--      owner's privileges and the policy does not apply to it, so the trap cannot
--      be armed — and it cannot be armed later by adding a policy to the
--      capability tables.
--   2. PUBLICATION. Under INVOKER this function would need SELECT on
--      role_permissions and permissions for every serving role, which publishes
--      the entire permission matrix — exactly what capability is meant to keep
--      private. DEFINER is what keeps those tables ungranted.
--
-- IDENTITY IS AN ARGUMENT HERE, NOT `current_setting('role')`. Measured inside a
-- DEFINER function: current_user/current_role/session_user all track the OWNER.
-- Only the claims setting and the role GUC track the caller.
--
-- CYCLE SAFETY: the recursive term uses UNION, not UNION ALL, and carries no
-- accumulator column, so a cyclic role graph reaches a fixed point instead of
-- running forever. `assert_role_acyclic()` below stops one arriving.
--
-- PERFORMANCE, and the one thing not to do here: a STABLE function appearing in a
-- qual alongside a column reference is evaluated once per CANDIDATE ROW (measured
-- 400,001 calls over 400,000 rows), not once per statement. STABLE means "the same
-- answer for the duration of this statement", not "called once". Precomputing the
-- role ancestor set into a closure view would make the plan show a hashed SubPlan
-- with loops = 1, which is the same argument that decided org_closure. At a role
-- count in the tens that is not worth a second denormalised view; measure before
-- adding it.
--
-- TWO DEFECTS IN THE OBVIOUS SPELLING, both SILENT, both found by executing it.
-- Read them before rewriting this body, because both produce an answer rather than
-- an error.
--
--   1. THE PARAMETER NAMES SHADOW COLUMNS. In a SQL function an unqualified name
--      that also names a column in scope resolves to the COLUMN. The natural body
--      writes `p.resource = resource`, which parses as `p.resource = p.resource` —
--      always true — so the resolver answers "does this actor hold this action in
--      SOME resource". Measured on the seeded fixture: project/read answered true
--      for a member whose role held only customer/read. `$1`/`$2`/`$3` are the only
--      unambiguous reference, which is why they are used below.
--   2. THE ANCESTOR LIST MUST NOT SIT ON TOP OF AN ALREADY-JOINTED COLUMN. Joining
--      role_permissions to the caller's own roles and then filtering
--      `rp.role_id IN (<ancestors>)` caps inheritance at the caller's own roles,
--      because the join has already discarded every ancestor's rows — the filter is
--      a no-op and the resolution is silently one level deep. Measured: a manager
--      two levels below a role holding project/read was denied it. The ancestor set
--      belongs in the CTE that seeds the walk, which is what this does.
CREATE OR REPLACE FUNCTION has_permission(who uuid, resource text, action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
    JOIN public.actions a     ON a.name = p.action_id
    WHERE p.resource = $2
      AND a.name     = $3
      AND rp.role_id IN (
        -- Walk UP: a child role holds everything its ancestors hold. The anchor is
        -- the caller's OWN role rows, so this CTE is uncorrelated with the outer
        -- query — which is also what lets it be a plain hash membership test.
        WITH RECURSIVE up (id) AS (
          SELECT ur.role_id
          FROM public.user_roles ur
          WHERE ur.user_id = $1
          UNION
          SELECT r.parent_id
          FROM public.roles r
          JOIN up ON up.id = r.id
          WHERE r.parent_id IS NOT NULL
        )
        SELECT id FROM up
      )
  )
$$;

-- =============================================================================
-- CYCLE SAFETY
-- =============================================================================
-- Three layers, in this order:
--
--   1. THIS TRIGGER. The primary control, and the only one that stops the bad data
--      from existing. `parent_id REFERENCES groups(id)` does not enforce acyclicity
--      — a self-referencing FK happily admits A -> B -> A, so the guard cannot be a
--      constraint.
--   2. UNION with no accumulator in the closure query. Bounds the damage if the
--      trigger is disabled. On an ACYCLIC tree the two variants are
--      indistinguishable, which is exactly how this gets got wrong: the
--      cycle-safety property is invisible in every healthy database and appears as
--      a hang in the one that is broken.
--   3. temp_file_limit ON THE REFRESHING SESSION. Without it, a non-terminating
--      closure exhausts the filesystem, and the failure is not a slow query, it is
--      a full disk. Set it in postgresql.conf, or per session:
--        SET temp_file_limit = '256MB';
--      This is not something a migration can enforce, which is why it is written
--      down here.
--
-- A tolerated cycle is fail-closed on the query and fail-OPEN on the data: the
-- closure still resolves, and each cycle member inherits the whole cycle's scope.
-- An undetected cycle is an authorization bug wearing a data-integrity costume.
--
-- THE TWO GUARDS BELOW ARE `SECURITY INVOKER`, AND THAT ASYMMETRY IS A TRAP THAT
-- MUST STAY DOCUMENTED. `refresh_org_closure()` is `SECURITY DEFINER` because
-- REFRESH requires ownership and because the refresh must see the WHOLE tree. The
-- guards are the opposite, deliberately: their recursive walk reads `groups` and
-- `roles` with the CALLER's privileges, so under a narrowed policy — or simply under
-- an RLS policy added to either table later — their walk is RLS-filtered and can
-- UNDER-DETECT a cycle. In other words: the guards are only as complete as the
-- caller's visibility of the tree, and nothing in this file guarantees that
-- visibility today.
--
-- It is not exploitable at the moment, and the reason is a second control rather
-- than a property of the guards: app_member holds no INSERT or UPDATE on either
-- hierarchy, so a member is refused by the grant before a trigger ever runs. That is
-- the mitigation, not the guards' completeness. Both facts are asserted in the suite
-- (`prosecdef` is false on both guards, and the grants withhold the hierarchy from
-- the member) so neither can drift silently.
--
-- WHAT WOULD MAKE THE GUARDS COMPLETE: making them `SECURITY DEFINER` owned by the
-- table owner, the way `has_permission` and `authz.visible_group_ids()` already are.
-- That is not done here because it is a second escalation surface (a DEFINER trigger
-- function that a caller can reach) and because the control that actually holds is
-- the grant. If either hierarchy ever becomes member-writable, this trigger becomes
-- the ONLY cycle control and MUST be promoted to `SECURITY DEFINER` in the same
-- change. The reason `prosecdef` is asserted false is to make that promotion a
-- deliberate, visible edit rather than something that happens by accident.
CREATE OR REPLACE FUNCTION assert_group_acyclic() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  cycle_member uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Reject a parent that is NEW itself or one of NEW's descendants. Walking down
  -- from NEW.id covers both: on INSERT the walk is a single row, so this also
  -- rejects the trivial self-parent, and on UPDATE it finds any re-parenting that
  -- would close a loop through the subtree being moved.
  WITH RECURSIVE descendant (id) AS (
    SELECT NEW.id
    UNION
    SELECT g.id FROM public.groups g JOIN descendant d ON g.parent_id = d.id
  )
  SELECT id INTO cycle_member FROM descendant WHERE id = NEW.parent_id;

  IF cycle_member IS NOT NULL THEN
    RAISE EXCEPTION
      'group cycle: % cannot be parented to %, which is itself or a descendant of %', NEW.id, NEW.parent_id, NEW.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

-- The same rule, on the capability hierarchy. Not optional: a cyclic role graph
-- makes each role in the cycle inherit the entire cycle's permissions, which is
-- the same fail-open on the data the group cycle is.
--
-- `SECURITY INVOKER` for the same reason as assert_group_acyclic, and with the same
-- documented caveat: the walk sees the caller's visibility of `roles`, not the whole
-- table. See the SECURITY INVOKER paragraph above — the two guards must stay
-- symmetric, and `prosecdef = false` on both is asserted so they cannot drift apart.
CREATE OR REPLACE FUNCTION assert_role_acyclic() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  cycle_member uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  WITH RECURSIVE descendant (id) AS (
    SELECT NEW.id
    UNION
    SELECT r.id FROM public.roles r JOIN descendant d ON r.parent_id = d.id
  )
  SELECT id INTO cycle_member FROM descendant WHERE id = NEW.parent_id;

  IF cycle_member IS NOT NULL THEN
    RAISE EXCEPTION
      'role cycle: % cannot be parented to %, which is itself or a descendant of %', NEW.id, NEW.parent_id, NEW.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

-- =============================================================================
-- THE ADMINISTRATIVE FLOOR — the is_system_* columns, enforced
-- =============================================================================
-- `roles.is_system_role` and `groups.is_system_group` exist to mark rows the
-- application may not remove. Before this function they were DECORATIVE: `app_admin`
-- holds DELETE on both tables, `DELETE FROM roles WHERE is_system_role = true`
-- returned HTTP 204, the row was gone, and nothing in the tree read either column.
-- A column documented as a control and enforced by nothing is worse than no column,
-- because the comment tells a reader the control is there.
--
-- So it is enforced here, in the database, below the application.
--
-- THE RULE, in one line: a row that IS a floor row may not be UPDATEd or DELETEd by
-- anyone except a superuser session. INSERT is deliberately NOT covered, because the
-- floor has to be creatable — the bootstrap inserts the initial system roles, and the
-- fixture inserts them through the escalation boundary as `app_admin`. Adding a floor
-- row is not the risk; removing or rewriting one is, since the floor is what a
-- deployment's capability resolution rests on.
--
-- WHY A TRIGGER AND NOT A GRANT. The obvious alternative — withhold DELETE from
-- `app_admin` — fails twice. It breaks "app_admin is a superset, not a bypass", which
-- is asserted over every table in `pg_tables`. And it is the wrong shape: the floor
-- is per-ROW, and grants are per-TABLE, so withholding DELETE deletes the capability
-- from 99 ordinary rows to protect one. A `BEFORE` row trigger is the only mechanism
-- that can express "this row, this call".
--
-- `SECURITY INVOKER`, and it MUST stay that way: the whole function is a question
-- about the caller, so a DEFINER body would answer about the owner and every check
-- would pass. It reads no table — the row's own JSON is the input — so INVOKER costs
-- it nothing here.
--
-- HOW THE SUPERUSER PATH IS RECOGNISED. `current_setting('is_superuser')`, NOT
-- `current_user`. `is_superuser` is derived from SESSION_USER and is not changed by
-- `SET ROLE`, which is precisely what is wanted: the check must survive the
-- escalation boundary, or the provisioning path (`SET ROLE app_admin` from the
-- authenticator) would be indistinguishable from a request. Measured on 15.19 —
-- 'on' for a postgres session, 'off' for `app`, `pgrst_authenticator`, and every
-- serving role after `SET ROLE app_admin`.
--
-- WHAT THIS DOES NOT COVER, stated rather than left to be discovered: `TRUNCATE` does
-- not fire a row trigger. It is closed by the grants instead — no serving role holds
-- TRUNCATE on either table, and the suite asserts it. A future table-level TRUNCATE
-- grant is the change that would reopen this, so the assertion is per-role rather
-- than a comment.
CREATE OR REPLACE FUNCTION protect_system_row() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  column_name text;
  was_system  boolean;
  row_id      uuid;
BEGIN
  -- The column is derived from the table rather than passed in, so this function has
  -- one shape on both hierarchies and cannot be attached to a table where the
  -- question does not exist. A misattachment raises instead of silently permitting.
  column_name := CASE TG_TABLE_NAME
    WHEN 'roles'  THEN 'is_system_role'
    WHEN 'groups' THEN 'is_system_group'
  END;

  IF column_name IS NULL THEN
    RAISE EXCEPTION 'protect_system_row is attached to %, which has no is_system_* column', TG_TABLE_NAME
      USING ERRCODE = '42P01';
  END IF;

IF current_setting('is_superuser', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  was_system := (to_jsonb(OLD) ->> column_name)::boolean;
  row_id := (to_jsonb(OLD) ->> 'id')::uuid;

  IF was_system THEN
    RAISE EXCEPTION
      '%: % % is a system row and may not be % by %', TG_TABLE_NAME, column_name, row_id, TG_OP, current_user
      USING ERRCODE = '42501',
            HINT = 'the administrative floor is removed out of band, by a superuser';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION protect_system_row() FROM PUBLIC;

-- =============================================================================
-- FUNCTION PRIVILEGES
-- =============================================================================
-- Postgres grants EXECUTE on a new function to PUBLIC by default. 7 of 9
-- functions in the earlier spike had NULL proacl, which made every helper
-- anonymously callable — and a SECURITY DEFINER helper is then an anonymous
-- privilege escalation, not merely a read leak.
--
-- A REVOKE IS NOT A POLICY. Revoking from PUBLIC and granting to nobody is
-- strictly worse than doing nothing: every scoped request then dies with
-- `permission denied for function ...` and row scoping is 100% non-functional
-- while every policy, grant and comment still looks correct. Revoke and grant,
-- always together, in that order.
REVOKE EXECUTE ON FUNCTION authz.actor() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION has_permission(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION assert_group_acyclic() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION assert_role_acyclic() FROM PUBLIC;

-- WHICH helpers need app_anon, AND WHY. Not all of them, and getting this wrong is
-- how an anonymous capability-matrix reader ships:
--
--   app_anon is required on EXACTLY the two functions a POLICY EXPRESSION calls:
--   authz.actor() and authz.visible_group_ids(). A policy expression is evaluated
--   for EVERY role that reaches the table, the anonymous one included, so a helper
--   a policy calls must be executable by app_anon too. Without this grant an
--   unauthenticated read fails with `permission denied for function actor` — a
--   42501 on a request that should have returned zero rows. A denial must arrive as
--   a denial: an erroring policy is a denial-of-service surface and an oracle that
--   tells an anonymous caller a policy exists and which function to look for.
--
--   Verified against pg_policies rather than assumed: these two are the only
--   functions any policy in this file calls. has_permission is called by NO policy.
--
-- app_anon is NOT required on has_permission, and an earlier revision of this file
-- granted it there anyway, justified by the paragraph above. That justification is
-- about a different function: it was true of actor() and false of has_permission().
-- The grant was pure exposure, and it defeated the goal stated further down — that
-- app_member holds no SELECT on roles/role_permissions/permissions/actions, which is
-- what keeps the permission matrix private. See the grant below.
--
-- The trigger functions are granted to nobody. They run as the table owner (they
-- are attached as triggers, not called).
GRANT EXECUTE ON FUNCTION authz.actor() TO app_anon, app_member, app_admin;

-- has_permission is executable by the AUTHENTICATED roles and by nobody else.
--
-- It is an API resource: PostgREST serves it as an RPC, and the thin app uses it for
-- capabilities that are not table verbs (pages, exports, workflow actions).
--
-- It takes `who` as an ARGUMENT, so a caller may ask what somebody ELSE holds. That
-- is a disclosure by construction: a sweep of (who, resource, action) recovers any
-- user's entire capability set. Measured on the grant this replaces: 63 probes,
-- unauthenticated, recovered the administrator's complete permission set — and
-- turned the function into an oracle for "does this uuid hold any role at all".
--
-- So app_anon is EXCLUDED, and the file's own stated reason for including it does not
-- apply: no policy calls this function, so no anonymous read needs it to be
-- executable. `app_member` still holds it, so the per-user capability surface this
-- file describes is unchanged; what is gone is the anonymous half of it. An
-- authenticated member can still read somebody else's capabilities, which is a
-- deliberate and documented trade: capability is DATA, not a secret, and the
-- alternative — a self-only wrapper — cannot express "may this user do X" without
-- the caller being the user. Narrower still (app_admin alone) is possible and is
-- noted here rather than chosen, because it removes the per-user capability surface
-- the application needs.
GRANT EXECUTE ON FUNCTION has_permission(uuid, text, text) TO app_member, app_admin;

-- =============================================================================
-- TRIGGERS
-- =============================================================================
-- A write-time trigger, because nothing in the DDL can reject a cycle.
--
-- A PROPERTY OF `FOR EACH ROW` THAT NOBODY PLANNED AND EVERYTHING DEPENDS ON. A
-- multi-row write is refused as a unit only because of how a BEFORE ROW trigger's own
-- SELECT sees the command it is part of. Postgres advances the command counter between
-- trigger firings, so the second and later rows of one statement observe the rows the
-- earlier rows wrote, and the recursive walk sees the partially built tree.
--
-- Measured, and the SHAPE is the whole of it. A FORWARD chain — (a, parent b),
-- (b, parent c), (c, parent a), every parent written later in the same statement — is
-- refused: the third row's walk finds the first two. A BACKWARD chain — (a, no
-- parent), (b, parent a), (c, parent b) — is ADMITTED, and correctly so, because it is
-- genuinely acyclic at the moment each row is checked and no cycle exists afterwards.
-- So the property that matters is not "multi-row writes are caught" but "a row can
-- see the rows written earlier in its own command", and the forward chain is the only
-- way to exercise it. Both shapes are asserted, because a test that used only the
-- backward one would pass against a guard that had lost the property entirely.
--
-- If that ever stops holding, these two triggers stop seeing intra-command writes and
-- a bulk group load whose source data is a cycle becomes a way to install a cyclic
-- closure. Nothing else in the schema would notice: the closure would still answer,
-- still terminate, and be wrong. The tests that cover it are the forward-chain cycle
-- cases and they must not be deleted as redundant with the single-row ones.
DROP TRIGGER IF EXISTS groups_no_cycle ON groups;
CREATE TRIGGER groups_no_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON groups
  FOR EACH ROW EXECUTE FUNCTION assert_group_acyclic();

DROP TRIGGER IF EXISTS roles_no_cycle ON roles;
CREATE TRIGGER roles_no_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON roles
  FOR EACH ROW EXECUTE FUNCTION assert_role_acyclic();

-- The administrative floor. UPDATE as well as DELETE, because flipping the flag off
-- is the same act as deleting the row: it is the way to get the row back to being
-- removable, and an UPDATE guard that only checked the NEW value would permit exactly
-- that in one statement.
DROP TRIGGER IF EXISTS roles_no_system_row ON roles;
CREATE TRIGGER roles_no_system_row
  BEFORE UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION protect_system_row();

DROP TRIGGER IF EXISTS groups_no_system_row ON groups;
CREATE TRIGGER groups_no_system_row
  BEFORE UPDATE OR DELETE ON groups
  FOR EACH ROW EXECUTE FUNCTION protect_system_row();

-- =============================================================================
-- THE CLOSURE
-- =============================================================================
-- org_closure is the precomputed ancestor/descendant relation. The policy below
-- joins it instead of walking the tree, which is what buys once-per-statement
-- evaluation (loops = 1, measured at 305 and at 3305 rows).
--
-- THREE DETAILS IN THIS STATEMENT ARE LOAD-BEARING:
--   * UNION, not UNION ALL. This is what terminates on a cycle.
--   * NO ACCUMULATOR COLUMN in the recursive row. An accumulator is exactly what
--     makes UNION unable to deduplicate, so `UNION` silently degenerates to
--     `UNION ALL` and the recursion never reaches a fixed point.
--   * the trailing SELECT. `CREATE MATERIALIZED VIEW ... AS WITH RECURSIVE t AS
--     (...) SELECT ...` is a SYNTAX ERROR on PostgreSQL 15 when the CTE is the
--     whole query. Without the trailing SELECT the statement below does not parse.
--
-- IF NOT EXISTS rather than CREATE OR REPLACE: this migration must be idempotent,
-- and REPLACE would drop the view that three policies depend on and the unique
-- index CONCURRENTLY needs.
--
-- THE SCHEMA IS THE POINT, and it is load-bearing rather than tidiness. `authz` is
-- created at the top of this file, before any object in it, and the reason it is
-- not `public` is recorded there: the closure needs a SELECT grant for every role
-- whose requests evaluate the scope policy, and PostgREST would publish a relation
-- in `public` with that grant — the whole org tree, one GET away. Measured before
-- the schema existed: an INSERT as app_admin failed with `permission denied for
-- materialized view org_closure`, which is the honest shape of the contradiction —
-- "granted to nobody" is unimplementable for a relation a policy reads.
CREATE MATERIALIZED VIEW IF NOT EXISTS authz.org_closure AS
WITH RECURSIVE t AS (
    SELECT id AS ancestor, id AS descendant FROM groups
  UNION
    SELECT t.ancestor, g.id FROM t JOIN groups g ON g.parent_id = t.descendant
)
SELECT ancestor, descendant FROM t;

-- Required by REFRESH ... CONCURRENTLY, and free: the closure is unique by
-- construction. Verified — without it the refresh fails with
-- `cannot refresh materialized view "authz.org_closure" concurrently`.
CREATE UNIQUE INDEX IF NOT EXISTS authz_org_closure_uniq ON authz.org_closure (ancestor, descendant);

-- The grant the policy needs, and the reason it is not a leak. app_anon is
-- included because a policy expression is evaluated for every role that reaches
-- the table; without this an unauthenticated read would fail with
-- `permission denied for materialized view` — a 42501 on a request that should
-- have returned zero rows, which is a denial-of-service surface and an oracle.
REVOKE ALL ON authz.org_closure FROM PUBLIC;
GRANT SELECT ON authz.org_closure TO app_anon, app_member, app_admin;

-- The one accessor that is NOT a plain closure join, and the reason is a
-- measured Postgres restriction rather than taste.
--
-- REFRESH MATERIALIZED VIEW CONCURRENTLY refuses to run "because it is being used
-- by active queries in this session". A group write fires this trigger from inside
-- the writing statement, so ANY query the writing statement itself is holding on
-- this matview blocks the refresh. The `groups` read policy is exactly such a
-- query — its WITH CHECK reuses USING, so an INSERT evaluates the closure join and
-- the statement is still holding it when the AFTER STATEMENT trigger fires.
-- Verified: `cannot REFRESH MATERIALIZED VIEW "org_closure" because it is being
-- used by active queries in this session`, on every insert, update and delete.
--
-- Moving the join behind a SECURITY DEFINER function is what breaks the deadlock:
-- the function's internal scan is closed when it returns, so by the time the
-- trigger runs there is no active query on the matview. It reads the same rows and
-- enforces the same scope.
--
-- It takes NO argument and calls actor() itself, deliberately. A `who` parameter
-- would let any caller enumerate another user's group ids; this way a caller can
-- only ever ask about itself.
--
-- WHY THE TENANT POLICIES DO NOT USE THIS SHAPE. A STABLE function in a qual is
-- evaluated once per candidate row (measured 400,001 calls over 400,000 rows), and
-- the whole reason scope is denormalised into the closure is the hashed SubPlan
-- with loops = 1. `groups` is a hierarchy table of tens of rows, so per-row
-- evaluation is irrelevant there; `projects` and `customers` are the tables that
-- scale, and they keep the plain join.
CREATE OR REPLACE FUNCTION authz.visible_group_ids() RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(array_agg(c.descendant), '{}'::uuid[])
  FROM public.user_groups ug
  JOIN authz.org_closure c ON c.ancestor = ug.group_id
  WHERE ug.user_id = authz.actor()
$$;

REVOKE EXECUTE ON FUNCTION authz.visible_group_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.visible_group_ids() TO app_anon, app_member, app_admin;

-- Refreshed CONCURRENTLY from a STATEMENT-level trigger, not on a schedule and not
-- incrementally.
--
--   * CONCURRENTLY, because a plain REFRESH holds an AccessExclusiveLock for the
--     whole rebuild and blocks every tenant read behind it. (The earlier
--     revision quoted per-refresh milliseconds for this fixture; those figures
--     do not reproduce. The argument is the lock, not the timing.)
--   * INSIDE the writing transaction, so there is NO STALENESS WINDOW. A reader
--     sees either the pre-write closure or the post-write closure and never an
--     intermediate state. That is strictly better than any refresh schedule, and it
--     is why no blue/green swap is needed — a swap is also impossible, because
--     DROP MATERIALIZED VIEW is refused while policies depend on it.
--   * STATEMENT-level, so N group changes cost one rebuild instead of N.
--
-- SECURITY DEFINER is required, not stylistic: REFRESH MATERIALIZED VIEW requires
-- ownership, and the writer is app_admin. Running it as the owner is also what
-- makes the refresh see the whole tree — see the `groups` comment above for why
-- that only works because `groups` is not FORCEd.
--
-- CORRECTION TO THE RECORD: the documented justification for statement-level was
-- that CONCURRENTLY "cannot run inside a transaction block that has already
-- written". That does not reproduce on PostgreSQL 15.19 — verified, CONCURRENTLY
-- succeeds from a row-level trigger inside a transaction that has written, and
-- the only two restrictions that do bite are a read-only transaction and a missing
-- unique index. Statement-level is still the right choice; the reason is one
-- rebuild per statement rather than one per row, not legality.
CREATE OR REPLACE FUNCTION refresh_org_closure() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY authz.org_closure;
  RETURN NULL;
END
$$;

REVOKE EXECUTE ON FUNCTION refresh_org_closure() FROM PUBLIC;

DROP TRIGGER IF EXISTS groups_refresh_closure ON groups;
CREATE TRIGGER groups_refresh_closure
  AFTER INSERT OR UPDATE OR DELETE ON groups
  FOR EACH STATEMENT EXECUTE FUNCTION refresh_org_closure();

-- =============================================================================
-- ROW-LEVEL SECURITY
-- =============================================================================
-- ENABLE on every table a serving role can reach. FORCE on every table a serving
-- role can reach EXCEPT `groups`, for the measured reason recorded above.
ALTER TABLE projects  ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups    ENABLE ROW LEVEL SECURITY;

-- FORCE because a table's owner is exempt from its own policies, and nothing
-- errors when it is: an owner read returns every row the policy should have
-- hidden, with no warning. FORCE binds the owner — and nothing else. It does not
-- bind a superuser or a BYPASSRLS role (verified: a postgres session read 5 of 5
-- rows from a FORCE'd table), so every serving role is NOSUPERUSER NOBYPASSRLS and
-- that is asserted in the suite rather than assumed here.
ALTER TABLE projects  FORCE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;

-- ONE POLICY PER TABLE. Never two permissive policies on one operation: they are
-- OR-ed, so a scope policy covering DELETE admits it on its own and a second
-- policy can only widen the set. Measured — a member holding ZERO capabilities
-- deleted a row and inserted one, no error and no warning. Capability is a GRANT
-- here, not a competing USING, so the arrangement cannot arise.
--
-- Omitting WITH CHECK is deliberate: Postgres reuses USING for inserts when no
-- WITH CHECK is written, and re-checks it on UPDATE. One expression therefore
-- governs both visibility and insertability, which is verified by a refused
-- out-of-scope INSERT rather than by reading pg_policies.
--
-- The admin branch keys on current_user, which Postgres sets from the SET ROLE
-- the escalation boundary has already constrained to three roles — never from a
-- token field. A member who forges `"role":"app_admin"` into their own
-- validly-signed token gets zero rows, because nothing reads that field. app_admin
-- is a SUPERSET, not a bypass: this branch plus its wider grants plus its role rows
-- are four separate mechanisms that all have to be removed for it to stop working,
-- which is the point of a superset over a bypass.
--
-- The subquery is UNCORRELATED. That is what produces a hashed SubPlan evaluated
-- once per statement (loops = 1 at 305 and at 3305 rows; a correlated variant gives
-- loops = 305). Assert on `loops`, not on the SQL's apparent shape — an
-- EXISTS-shaped variant is simplified back into a hashed SubPlan by the planner.
DROP POLICY IF EXISTS row_scope ON projects;
CREATE POLICY row_scope ON projects USING (
    current_user = 'app_admin'
    OR group_id IN (
        SELECT c.descendant FROM public.user_groups ug
        JOIN authz.org_closure c ON c.ancestor = ug.group_id
        WHERE ug.user_id = authz.actor()
    )
);

DROP POLICY IF EXISTS row_scope ON customers;
CREATE POLICY row_scope ON customers USING (
    current_user = 'app_admin'
    OR group_id IN (
        SELECT c.descendant FROM public.user_groups ug
        JOIN authz.org_closure c ON c.ancestor = ug.group_id
        WHERE ug.user_id = authz.actor()
    )
);

-- `groups` is ENABLEd and read-scoped on exactly the same terms, so a member sees
-- their own subtree's shape and not the whole org chart. Not FORCEd, and the join
-- goes through authz.visible_group_ids() rather than being inlined — see that
-- function for the measured reason (an inline join here holds an active query on
-- the closure for the duration of the writing statement, which makes the refresh
-- trigger fail on every group write).
DROP POLICY IF EXISTS row_scope ON groups;
CREATE POLICY row_scope ON groups USING (
    current_user = 'app_admin'
    OR id = ANY (authz.visible_group_ids())
);

-- user_groups carries a policy, and it is the reason the policy below can read
-- membership at all.
--
-- A policy expression's subquery runs with the QUERYING role's privileges, not the
-- table owner's. Verified: with no SELECT grant on user_groups, a member's scoped
-- read failed with `permission denied for table user_groups` — and so did every
-- unscoped read, because the policy could not be evaluated. The two obvious fixes
-- are both wrong: granting members SELECT on the whole table discloses EVERY
-- user's membership across EVERY group, and moving the subquery behind a SECURITY
-- DEFINER function turns a hashed SubPlan (loops = 1) back into a per-candidate-row
-- STABLE call (measured: 400,001 calls over 400,000 rows).
--
-- So membership is READABLE and self-scoped instead: a member reads their own rows
-- and nothing else, which is exactly the set the scope subquery asks for, so the
-- subquery's answer is unchanged and the disclosure does not exist. An
-- unauthenticated reader reads zero membership rows, which is why the denial stays
-- a denial.
--
-- ENABLEd, NOT FORCEd, for the same reason as `groups`: the owner writes these rows
-- (there is no serving-role write grant at all, see the grants section) and FORCE
-- would bind the owner to this policy and refuse its own INSERTs.
ALTER TABLE user_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS row_scope ON user_groups;
CREATE POLICY row_scope ON user_groups USING (
    current_user = 'app_admin'
    OR user_id = authz.actor()
);

-- actions, permissions, roles, role_permissions and user_roles carry NO policy.
-- They are unscoped reference data: there is no group dimension on them for RLS to
-- filter, and inventing one would put the two axes on one row, which is the
-- arrangement that produced the recorded escalation. Capability is enforced by the
-- grants below, and there is no policy to fall back on — so a capability system
-- that silently denies everyone looks exactly like one that works. Hence the
-- positive test: an actor who HOLDS a permission must return true.

-- =============================================================================
-- GRANTS
-- =============================================================================
-- Order matters and the wrong order fails OPEN. Verified: revoking a column while
-- a table-level SELECT grant exists silently does nothing, and the column came back
-- fully readable at HTTP 200 with its value intact. So the shape is:
--   REVOKE ALL  ->  verb grants  ->  table-level REVOKE SELECT  ->  column list
REVOKE ALL ON SCHEMA public FROM PUBLIC;
-- CREATE on the schema is a search_path attack against every SECURITY DEFINER
-- function in this file, even though each one pins search_path.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_anon, app_member, app_admin;

REVOKE ALL ON projects, customers, groups, user_groups,
                actions, permissions, roles, role_permissions, user_roles
  FROM PUBLIC, app_anon, app_member, app_admin;

-- app_member: read and create tenant rows. No UPDATE, no DELETE.
GRANT SELECT, INSERT ON projects, customers TO app_member;
-- `groups` is READABLE by a member and WRITABLE only by the admin. The read is not a
-- disclosure: the groups policy returns the caller's own subtree and nothing else, so
-- the grant exposes the shape of the groups the caller already belongs to. The
-- privileges that are NOT granted are the ones that would let a member widen their
-- own scope: a member who could insert a group could add their own child, and a
-- member who could UPDATE one could re-parent a subtree they hold and inherit rows
-- through it. DELETE is allowed for the admin as part of the superset and is bounded
-- by the foreign keys — parent_id and user_groups both RESTRICT, and no CASCADE is
-- declared anywhere, because ON DELETE CASCADE is a write across RLS.
GRANT SELECT ON groups TO app_member;
GRANT SELECT, INSERT, UPDATE, DELETE ON groups TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects, customers TO app_admin;

-- THE CAPABILITY AXIS IS ADMIN-ONLY AT THE TABLE LEVEL. app_member holds no SELECT
-- on roles, role_permissions, permissions or actions, which is what keeps the
-- permission matrix private — has_permission() is SECURITY DEFINER precisely so
-- that serving roles need not hold these reads. has_permission() answers "may this
-- actor"; reading role_permissions directly would answer "may anyone".
--
-- The matrix has exactly ONE reader, and that reader is a role, not a person:
-- app_anon cannot execute the resolver at all (see the function-privileges section),
-- so an unauthenticated caller has no path to the matrix by table grant OR by RPC.
-- Asserted over the whole cluster in the suite, because "no SELECT" alone was the
-- claim that the erroneous resolver grant quietly defeated.
GRANT SELECT, INSERT, UPDATE, DELETE ON actions, permissions, roles, role_permissions, user_roles TO app_admin;

-- user_groups: READ-ONLY for every serving role, and NO WRITE FOR ANY OF THEM.
-- This is the one that fails open if forgotten — a member who can write their own
-- membership row widens their own scope in one statement, and the scope policy is
-- happy to honour it, because the policy reads the table the caller just wrote.
-- Membership changes therefore go through the owner role (seeding, or an operator
-- with a privileged connection), not through the API.
--
-- The read is required, not optional: the scope policy reads this table with the
-- querying role's privileges, and its own policy limits what that read can return
-- to the caller's own membership rows.
GRANT SELECT ON user_groups TO app_anon, app_member, app_admin;

-- Column hiding. Table-level SELECT is revoked FIRST; a column privilege can only
-- narrow a table grant that has already been taken away, it cannot subtract from
-- one. app_admin keeps table-level SELECT and so reads every column.
REVOKE SELECT ON projects, customers FROM app_member;
GRANT SELECT (group_id, id, name, budget_cents, created_at) ON projects TO app_member;
GRANT SELECT (group_id, id, name, created_at)              ON customers TO app_member;

-- app_anon gets no table grant at all. An unauthenticated read is refused at the
-- grant layer, which is a 401 with `permission denied for table` — and never a
-- `permission denied for function`, which would mean the policy could not be
-- evaluated.

-- The authenticator. It connects as this role and reaches everything else with
-- SET ROLE, so it needs schema usage and nothing else. It owns no table.
REVOKE ALL ON SCHEMA public FROM pgrst_authenticator;
GRANT USAGE ON SCHEMA public TO pgrst_authenticator;

-- org_closure needs no defence here that the `authz` schema does not already
-- provide: it is outside db-schemas, so PostgREST cannot address it and
-- openapi-mode = "ignore-privileges" cannot advertise it. The grant that lets the
-- policy read it is made at its creation, with the reasoning attached there.

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
-- PostgREST caches the schema, and a table created after startup 404s with no
-- message explaining why. This is the single highest-likelihood "the template is
-- broken" report from a fork, so it is a migration step rather than a note in a
-- README. Reloading is per-change and cheap; a stale cache fails the build in the
-- smoke check instead of confusing a developer.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0001_rls_foundation.down.sql. Kept as a separate file so
-- this one stays append-only for the runner that W09 will add. The down script is
-- destructive and does not reverse the role bootstrap, because roles are
-- cluster-scoped and this file is database-scoped.