-- W07 — PostgreSQL row-level security, schema, policies and grants.
-- Target: PostgreSQL 15+, verified on 15.19.
--
-- Apply as the migration/owner role (a non-superuser that owns the database).
--
-- ROLES ARE NOT HERE. `CREATE ROLE` needs CREATEROLE, a cluster-level privilege,
-- so role bootstrap lives in database/bootstrap/001_roles.sql and runs once as a
-- superuser. Verified: applying this file as a non-superuser fails with
-- "permission denied to create role". Everything below is database-scoped.
--
-- Every pattern here was corrected after live execution. The comments marked
-- CORRECTED record what the earlier version did and why it was wrong.
--
-- The proof that all of this works is backend/test/rls/ and runs in `npm run verify`.

-- =============================================================================
-- GRANTS — the four roles must already exist
-- =============================================================================
-- app_anon / app_member / app_admin / pgrst_authenticator / app_migrator.
-- All NOSUPERUSER NOBYPASSRLS: FORCE ROW LEVEL SECURITY does not bind a
-- superuser or a BYPASSRLS role, so this is the only thing preventing them
-- from reading every row. Asserted by the test suite, not assumed here.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_anon') THEN
    RAISE EXCEPTION 'role app_anon is missing — run database/bootstrap/001_roles.sql as a superuser';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_anon, app_member, app_admin;

-- =============================================================================
-- SCHEMA
-- =============================================================================

CREATE TABLE IF NOT EXISTS sites (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name    text NOT NULL,
  parent_id uuid REFERENCES sites (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Hierarchy traversal is the hot path of every policy below.
CREATE INDEX IF NOT EXISTS sites_parent_id_idx ON sites (parent_id);

CREATE TABLE IF NOT EXISTS customers (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id  uuid NOT NULL REFERENCES sites (id),
  name     text NOT NULL,
  -- Present so the column-grant test has something to hide.
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id  uuid NOT NULL REFERENCES sites (id),
  name     text NOT NULL,
  budget_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- CLAIMS ACCESSORS
-- =============================================================================
-- CORRECTED. The first version read current_setting(...,'...')::json directly.
-- That RAISES rather than denying: once anything has been SET LOCAL in the
-- session, current_setting(...,true) returns '' (not NULL), and ''::json is an
-- invalid cast. Verified — the policy errored instead of returning zero rows.

CREATE OR REPLACE FUNCTION request_claims() RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

-- CORRECTED. A malformed site_id is a denial-of-service on every request, not a
-- harmless edge case. `nullif(claims->>'site_id','')::uuid` raises
-- `invalid input syntax for type uuid: "garbage"` — verified for BOTH an admin
-- and a member token.
--
-- The previously documented reasoning ("the admin branch is TRUE, so the failing
-- cast on the right never matters") is WRONG. `OR` does not short-circuit past an
-- expression that raises; both operands are evaluated and the error wins. An
-- exception-guarded accessor is the only thing that makes the policy total.
--
-- Returns NULL — not an error — for absent, empty, or malformed. NULL flows into
-- site_tree_ids(NULL), which walks no rows, so the row is not visible.
CREATE OR REPLACE FUNCTION claim_site_id() RETURNS uuid
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
DECLARE
  raw text;
BEGIN
  raw := request_claims()->>'site_id';
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END
$$;

-- CORRECTED. The original was SETOF uuid. Postgres rejects set-returning
-- functions in policy expressions outright: "set-returning functions are not
-- allowed in policy expressions". The policy below therefore never compiled.
--
-- uuid[] scalar, not SETOF. PARALLEL UNSAFE is deliberate: PARALLEL SAFE forced
-- single-threaded evaluation and cost ~170x on a 400k-row scan.
--
-- CORRECTED, and this is the subtle one. The tree walk READS `sites`, and the
-- `sites` policy below calls this function. With SECURITY INVOKER (the documented
-- default) that is unbounded recursion: verified, any query as a non-superuser
-- role aborts with `stack depth limit exceeded` after ~100 frames. The function
-- therefore MUST be SECURITY DEFINER, and `sites` must NOT be FORCEd — see the
-- ALTER TABLE sites comment for why those two facts are one decision.
--
-- SECURITY DEFINER is safe here only because the function reads no caller-supplied
-- table and returns no caller-supplied data: it walks the tree from `root` and
-- returns ids. It is not a general licence to make helpers privileged.
CREATE OR REPLACE FUNCTION site_tree_ids(root uuid) RETURNS uuid[]
LANGUAGE sql STABLE PARALLEL UNSAFE SECURITY DEFINER
AS $$
  WITH RECURSIVE t AS (
    SELECT id, parent_id FROM sites WHERE id = root
    UNION ALL
    SELECT s.id, s.parent_id FROM sites s JOIN t ON s.parent_id = t.id
  )
  SELECT coalesce(array_agg(id), '{}'::uuid[]) FROM t
$$;

-- CORRECTED. Postgres grants EXECUTE on new functions to PUBLIC by default.
-- 7 of 9 test functions had NULL proacl. Without this, request_claims() and
-- site_tree_ids() are anonymously callable.
--
-- CORRECTED, and the revoke alone was worse than useless: it revoked EXECUTE from
-- PUBLIC and granted it to nobody, so every scoped request died with
-- `403 permission denied for function request_claims`. A revoke is not a policy.
-- Both halves are required — deny the world, then admit the serving roles.
REVOKE EXECUTE ON FUNCTION request_claims() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_site_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION site_tree_ids(uuid) FROM PUBLIC;

-- The serving roles need EXECUTE to evaluate the policy at all. Verified absent
-- from the original, which left row scoping 100% non-functional.
--
-- CORRECTED: app_anon needs it too. A policy expression is evaluated for EVERY
-- role that reaches the table, including the anonymous one, and the expression
-- calls site_tree_ids(). Without the grant, an unauthenticated SELECT fails with
-- `permission denied for function site_tree_ids` — a 42501 on a read that should
-- have returned zero rows. A denial must be a denial, not an error: an erroring
-- policy is a denial-of-service surface and an oracle for anyone reading the
-- message. Verified.
GRANT EXECUTE ON FUNCTION request_claims() TO app_anon, app_member, app_admin;
GRANT EXECUTE ON FUNCTION claim_site_id()  TO app_anon, app_member, app_admin;
GRANT EXECUTE ON FUNCTION site_tree_ids(uuid) TO app_anon, app_member, app_admin;

-- =============================================================================
-- POLICIES
-- =============================================================================
-- Every policy is TOTAL: each OR branch must evaluate without raising, because
-- OR does not short-circuit across a raising expression. request_claims() never
-- raises, and claim_site_id() swallows the uuid cast failure.

ALTER TABLE sites    ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects  ENABLE ROW LEVEL SECURITY;

-- CORRECTED. FORCE is required on the DATA tables because Postgres exempts a
-- table's owner from RLS. Verified: without FORCE the owner read 5 of 5 rows that
-- policy should have limited to 2, with no error at all.
--
-- CORRECTED, and `sites` is deliberately NOT forced. site_tree_ids() is SECURITY
-- DEFINER and reads `sites`; if `sites` were also FORCEd, the owner inside that
-- function would be subject to the `sites` policy, which calls site_tree_ids(),
-- which reads `sites` — and every request dies with `stack depth limit exceeded`.
-- Verified both ways: FORCE on `sites` recurses and fails; ENABLE without FORCE
-- resolves, because the owner is exempt from `sites` RLS inside the DEFINER
-- function, so the walk terminates.
--
-- This is a real trade, not a free win, and it is the weakest link in this file:
-- an owner can read `sites` unrestricted. `sites` is the tree itself and holds no
-- tenant payload — no names, contacts or records — so the blast radius is the
-- shape of the org chart. A deployment that cannot accept even that must move the
-- tree into a SECURITY DEFINER-only function over a table with RLS disabled, and
-- re-derive scope from a signed claim instead.
--
-- FORCE does NOT bind a superuser or a BYPASSRLS role. Verified: a postgres
-- session still read 5 of 5 from a FORCE'd table. That is why every serving role
-- above is NOSUPERUSER NOBYPASSRLS, asserted by the test suite — not assumed here.
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
ALTER TABLE projects  FORCE ROW LEVEL SECURITY;

-- CORRECTED. The admin branch keyed on `request_claims()->>'role' = 'admin'`, but
-- the role claim PostgREST actually receives is `app_admin` — the two role
-- vocabularies in ADR-0023 are different things, and this policy had collapsed
-- them. The branch was therefore DEAD: verified over HTTP, a valid `app_admin`
-- token got `200 []` and saw nothing at all.
--
-- The discriminator is `current_user`, which Postgres sets from the SET ROLE that
-- PostgREST already performed and the escalation boundary already constrained.
-- A member who forges `"role":"admin"` into their own validly-signed token gets
-- zero rows — verified — because a claim is caller-supplied and `current_user` is
-- not. Reading the admin tier out of the token would have re-opened the
-- privilege-escalation hole this policy exists to close.
DROP POLICY IF EXISTS row_scope ON projects;
CREATE POLICY row_scope ON projects USING (
    current_user = 'app_admin'
    OR site_id = ANY (site_tree_ids(claim_site_id()))
);

DROP POLICY IF EXISTS row_scope ON customers;
CREATE POLICY row_scope ON customers USING (
    current_user = 'app_admin'
    OR site_id = ANY (site_tree_ids(claim_site_id()))
);

DROP POLICY IF EXISTS row_scope ON sites;
CREATE POLICY row_scope ON sites USING (
    current_user = 'app_admin'
    OR id = ANY (site_tree_ids(claim_site_id()))
);

-- =============================================================================
-- GRANTS
-- =============================================================================
-- Order matters and the wrong order fails OPEN. Verified: revoking a column
-- while a table-level SELECT grant exists silently does nothing, and `internal_notes`
-- came back fully readable at HTTP 200. So: revoke table-level FIRST.

REVOKE ALL ON projects, customers, sites FROM PUBLIC;
REVOKE ALL ON projects, customers, sites FROM app_anon, app_member, app_admin;

-- Operation-level: app_member cannot UPDATE or DELETE anything.
GRANT SELECT, INSERT                 ON projects, customers, sites TO app_member;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects, customers, sites TO app_admin;

-- CORRECTED. The column grants below were added straight on top of the
-- table-level SELECT above, and the table-level grant won:
-- has_column_privilege('app_member','customers','internal_notes','SELECT') was
-- `t`, so internal_notes was fully readable. A column grant can only narrow a
-- table grant that has already been taken away; it cannot subtract from one.
-- Verified: `t` before the revoke, `f` after.
REVOKE SELECT ON projects, customers, sites FROM app_member;
REVOKE SELECT ON projects, customers, sites FROM app_admin;

-- Column-level: internal_notes is unreadable to app_member.
GRANT SELECT (id, site_id, name, created_at) ON customers TO app_member;
GRANT SELECT (id, site_id, name, budget_cents, created_at) ON projects TO app_member;
GRANT SELECT (id, name, parent_id, created_at)           ON sites     TO app_member;

GRANT SELECT (id, site_id, name, created_at) ON customers TO app_admin;
GRANT SELECT (id, site_id, name, budget_cents, created_at) ON projects TO app_admin;
GRANT SELECT (id, name, parent_id, created_at)           ON sites     TO app_admin;

-- app_anon gets nothing. W07's test asserts an unauthenticated request cannot read
-- a row — the denial arrives as 401 because there is no grant at all.

-- =============================================================================
-- AUTHENTICATOR
-- =============================================================================
-- The escalation boundary. CORRECTED: earlier docs claimed that validating the
-- role claim when minting the token was the mitigation. That protects only the
-- issuer. Verified escalation: a validly-signed token whose role claim named a
-- table-owning role got HTTP 200 with a full read, and its DELETE returned 204
-- and removed the row.
--
-- The control is the GRANT, and nothing else: pgrst_authenticator is a member of
-- app_anon, app_member and app_admin and of nothing else. It is enforced by
-- Postgres, so it holds regardless of which code path issued the token. With that
-- grant alone, a token naming the table owner is refused with 403 and no row is
-- read or deleted.
--
-- The GRANT itself lives in database/bootstrap/001_roles.sql, not here, because
-- `GRANT <role> TO <role>` needs ADMIN OPTION on each granted role and this file
-- runs as an ordinary role — verified: `must have admin option on role "app_anon"`.
--
-- NOT a boundary: REVOKE SET ON PARAMETER role (inert on PG15) and
-- REVOKE <owner> FROM authenticator (a denylist, bypassed by any unlisted role).

REVOKE ALL ON SCHEMA public FROM pgrst_authenticator;
GRANT USAGE ON SCHEMA public TO pgrst_authenticator;

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0001_rls_foundation.down.sql. Kept as a separate file so
-- this one stays append-only for the runner that W09 will add. The down script is
-- destructive and does not reverse the role bootstrap, because roles are
-- cluster-scoped and this file is database-scoped.
