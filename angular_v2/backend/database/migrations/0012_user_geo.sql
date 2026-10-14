-- Where the user is, and how sure anybody is of it.
-- Target: PostgreSQL 18+, applied as the migration/owner role like every migration.
--
-- SIX NULLABLE COLUMNS ON `users`, and NOTHING ELSE. No table, no policy, no
-- function, no capability row. That is deliberate and it is the whole design:
-- `users` is already UNSCOPED (AGENTS.md §B2), already FORCEd, already granted, and
-- this migration adds attributes to a row rather than creating a new kind of row.
-- Everything a serving role may do with these columns is therefore decided by the
-- grants `0008`/`0009` already installed, and the one that matters is re-issued
-- below — a member can READ its own geography and can WRITE none of it.
--
-- WHY THE COLUMNS ARE SEPARATE AND NOT A `jsonb` BLOB
--
-- `region_code` decides whether the CCPA reaches a given person, and `country_code`
-- decides which regime applies at all. Both are filtered on, and AGENTS.md §B1 says
-- index what you filter on. A blob would make every one of those questions a JSON
-- path scan, and would make the answer to "which rows are Californian" depend on
-- whether somebody spelled the key `region` or `region_code` in the ingest code.
--
-- WHY ALL SIX ARE NULLABLE, AND WHY THAT IS NOT INCOMPLETE
--
-- A NULL means "nobody has said where this person is". It is the correct value for
-- every user who has never resolved an address, has declined to state one, or whose
-- lookup returned nothing. A NOT NULL column with a `''` default would be worse than
-- no column: it would assert an answer nobody gave. The provenance column makes the
-- distinction legible — NULL `geo_source` is not "unknown source", it is "no
-- determination has been made".
--
-- WHY `geo_source` IS LOAD-BEARING RATHER THAN DOCUMENTARY
--
-- A GeoIP guess and a user assertion are NOT equivalent evidence. A lookup returns
-- the region some database believes an IP block belongs to, usually with a
-- confidence radius measured in tens of kilometres and a great many blocks whose
-- owner never declared anything. A user assertion is a claim, from a person, about
-- themselves. Collapsing the two into one string column is what makes a downstream
-- compliance decision unsound, because a decision that is right for one is wrong for
-- the other and nothing downstream can tell which it was looking at. So:
--
--   'geoip'           a machine's inference from an IP address. Carries a radius.
--   'user_declared'   the person said so. Carries NO radius.
--   'admin_verified'  an operator confirmed it out of band.
--
-- `geo_accuracy_km` is the GeoIP confidence radius and is constrained below to be
-- present ONLY for 'geoip'. A user-declared value has no radius: giving it one
-- would be manufacturing a precision the evidence does not have, which is the same
-- forgery the column set exists to prevent.
--
-- THE EMPTY-STRING TRAP, AND WHY IT IS A CONSTRAINT RATHER THAN A COMMENT
--
-- The rejected alternative, `geoip-lite@2.0.0`, returned `region: ""` rather than
-- null for most addresses, because its bundled data has no usable US state coverage
-- — measured, 9 of 10 well-known US hosts came back with an EMPTY region rather than
-- a wrong one. An empty string is worse than NULL here, and not by a little:
--
--   * it passes every `IS NOT NULL` test, so "we know this user's region" is true;
--   * it is not `'CA'`, so the California predicate quietly says no;
--   * it renders in a UI as a field with nothing in it, which a user reads as an
--     answer they gave.
--
-- So "unset" is made unrepresentable rather than discouraged. Every constraint here
-- is named and idempotent, and each rejects one shape the schema must not store.
-- The alternative considered and rejected is a BEFORE trigger that coerces '' to
-- NULL on the way in: it would make the data right and the BUG invisible, which is
-- §2.1's failure mode reached through the database rather than through a stub. A
-- failed INSERT names the column and the rule, and the ingest code that passed ''
-- through gets a 23514 it has to answer for.
--
-- THE GEOLOCATION PROVIDER IS NOT A DEPENDENCY OF THIS MIGRATION
--
-- The reader is `dbip-city-lite`: no account, no licence key, ~19 MB, CC BY 4.0,
-- monthly updates, MaxMind MMDB format. Two obligations ride on it and neither is
-- discharged by a schema:
--
--   * CC BY 4.0 requires VISIBLE ATTRIBUTION wherever results appear — "IP
--     Geolocation by DB-IP" — which is a frontend obligation, not a column.
--   * Its output is a GUESS. Showing it as a fact is a misrepresentation whatever
--     the schema says, which is precisely why `geo_source` exists and why the
--     provenance is stored rather than implied by the presence of a region.
--
-- =============================================================================
-- PREFLIGHT — `users` must exist, and the migration role must own it
-- =============================================================================
-- Copied from `0009:133-156` rather than re-derived, for the same reason 0009 copied
-- it from `0008:36-59`: this migration ALTERs the table and installs constraints and
-- grants on it. On a database where `users` predates the migrations and belongs to
-- somebody else, `ALTER TABLE … ADD CONSTRAINT` and the column grant below either
-- fail outright or — worse — succeed against a table whose policies were never
-- installed. It stops, and the message names the fix.
DO $$
DECLARE
  owner_name text;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION
      '0012 requires public.users, which 0002_refresh_tokens.sql creates; run the migrations in order';
  END IF;

  SELECT pg_get_userbyid(c.relowner) INTO owner_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'users' AND n.nspname = 'public';

  IF owner_name IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION
      'public.users is owned by %, not the migration role %; the geo columns, their constraints and '
      'the column grant below cannot be applied by a role that does not own the table, so 0012 would '
      'record an invariant nothing enforces. Take ownership (ALTER TABLE public.users OWNER TO %) '
      'before migrating, or recreate the database.',
      owner_name, current_user, current_user;
  END IF;
END
$$;

-- =============================================================================
-- CHANGE 1 — THE SIX COLUMNS
-- =============================================================================
-- `ADD COLUMN IF NOT EXISTS` rather than a plain `ADD COLUMN`, because a migration
-- is applied to databases that may already carry them and "applies cleanly" and "is
-- idempotent" are different claims — the distinction `0008` argues at length. On an
-- existing install every statement here is a no-op, and each constraint below is
-- guarded by name, so a second `migration:run` changes nothing.
--
-- `ADD COLUMN` without a default is INSTANT on 18 and takes no lock beyond the one
-- the ALTER itself needs, so this is safe to run against a live database — which
-- matters more than usual here, because every column is one an existing request path
-- will start reading.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS country_code   text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS region_code    text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS city           text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS geo_source     text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS geo_accuracy_km integer;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS geo_updated_at timestamptz;

-- =============================================================================
-- CHANGE 2 — THE CONSTRAINTS, each named, each guarding one wrong shape
-- =============================================================================
-- Named rather than inline, and added inside one `DO` block, because
-- `ALTER TABLE … ADD CONSTRAINT` has no `IF NOT EXISTS` form and a migration runs
-- against databases that may already carry them. Existence is checked by conname AND
-- conrelid: by name alone would be wrong the moment a second table grows an
-- identically named constraint, which is the failure that produces "constraint
-- already exists" on a database that does not have one.
--
-- One block rather than several, and that is load-bearing for the same reason
-- `0008` argues it: a `DO` block is a single statement, so a failure rolls the whole
-- set back and the database is never left carrying three of the six rules. That
-- matters most under `psql -f`, which does not wrap the file in a transaction and is
-- how both `test/rls/uuid-keys.spec.ts` and a developer apply migrations.
DO $$
BEGIN
  -- THE BLANK RULE, which is the empty-string trap above, on the three free-text
  -- columns. `= btrim(x) AND x <> ''` rejects '', ' ' and 'CA ' together: the first
  -- two are an absent answer dressed as one, and the third is a right answer that
  -- will never compare equal to 'CA' in the predicate that depends on it. Under-
  -- applying a statutory obligation because of a stray space is the failure mode
  -- this whole migration exists to make impossible.
  --
  -- `geo_source` needs no blank rule and gets none: it is an enumeration and ''
  -- fails the IN list below, which is the same outcome by a different route.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_country_code_canonical'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_country_code_canonical
      -- `^[A-Z]{2}$` and not a length check, so the violation message is the shape
      -- itself. Alpha-2 by contract: ISO 3166-1 alpha-3 ('USA'), a country NAME
      -- ('United States') and the untrimmed ' US' are all rejected at the boundary
      -- rather than becoming a filter that silently matches nothing.
      CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_region_code_canonical'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_region_code_canonical
      -- Uppercase and trimmed, with NO vocabulary list. The set of real region
      -- codes is ISO 3166-2 — 'CA', 'ON', 'NSW', 'ENG', '11' — and it grows, and a
      -- hand-maintained list in a CHECK is a list that is wrong the day a country
      -- reorganises its provinces. Canonical FORM is enforced; the vocabulary is
      -- somebody else's data. The consequence is stated rather than hidden: a query
      -- written against this column may compare against a code this database has
      -- never heard of, and it will compare correctly, because the form is uniform.
      CHECK (region_code IS NULL OR (region_code = btrim(region_code)
                                     AND region_code <> ''
                                     AND region_code = upper(region_code)));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_city_not_blank'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_city_not_blank
      CHECK (city IS NULL OR (city = btrim(city) AND city <> ''));
  END IF;

  -- THE PROVENANCE VOCABULARY, closed. A free-text source would make "was this
  -- verified or guessed" unanswerable, which is the entire question the column is
  -- for. It is the smallest list that keeps the three kinds of evidence apart, and
  -- widening it is a migration rather than an INSERT because a new member of this
  -- list is a new statement about what counts as evidence.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_geo_source_check'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_geo_source_check
      CHECK (geo_source IS NULL OR geo_source IN ('geoip', 'user_declared', 'admin_verified'));
  END IF;

  -- A CONFIDENCE RADIUS IS A DISTANCE. Negative would be a sign error, and it would
  -- be read downstream as "very sure".
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_geo_accuracy_non_negative'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_geo_accuracy_non_negative
      CHECK (geo_accuracy_km IS NULL OR geo_accuracy_km >= 0);
  END IF;

  -- AND ONLY A GeoIP LOOKUP HAS ONE. This is the constraint that makes
  -- `geo_accuracy_km` mean what its name says: a radius attached to a
  -- user-declared or admin-verified region would be a fabricated precision, and it
  -- would be indistinguishable from a real one to every reader downstream. The
  -- asymmetry is intentional in the other direction too — an 'admin_verified' row
  -- with NO radius is fine, because an operator confirmed the region out of band
  -- and no radius was produced.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_geo_accuracy_requires_geoip_source'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_geo_accuracy_requires_geoip_source
      CHECK (geo_accuracy_km IS NULL OR geo_source = 'geoip');
  END IF;

  -- PROVENANCE WITHOUT AN INSTANT IS A RECORD OF A DECISION NOBODY TOOK. The same
  -- argument `0009` makes for `deletion_reason_requires_deleted_at`, applied here:
  -- a row claiming to be 'admin_verified' with no timestamp cannot be audited,
  -- cannot expire, and cannot be distinguished from a value written by a bug.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_geo_source_requires_updated_at'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_geo_source_requires_updated_at
      CHECK (geo_source IS NULL OR geo_updated_at IS NOT NULL);
  END IF;
END
$$;

-- =============================================================================
-- CHANGE 3 — THE INDEX, and only the index that earns its place
-- =============================================================================
-- `region_code` is the filter that decides CCPA applicability for a person, so it is
-- indexed (`AGENTS.md §B1`: index what you filter on). Two details:
--
--   * PARTIAL, `WHERE region_code IS NOT NULL`. Every column here is nullable and
--     most rows will carry no geography at all, so a full index would be mostly NULLs
--     — the case `0009` already handles for `deleted_at`. A query of the form
--     `region_code = 'CA'` can still use it, because a strict operator on the column
--     implies `region_code IS NOT NULL` to the planner.
--   * NOT `country_code`. Nothing filters on it today, it has two distinct values per
--     index entry and is not selective enough to pay for a second structure. If a
--     country-level report lands, that is the migration that adds it.
CREATE INDEX IF NOT EXISTS users_region_code_idx
  ON public.users (region_code)
  WHERE region_code IS NOT NULL;

-- =============================================================================
-- CHANGE 4 — THE GRANT: a member reads its own geography and writes none of it
-- =============================================================================
-- `0008` gave `app_member` a COLUMN list on `users` with `password_hash` absent and
-- no write verb of any kind. Six columns later, that list is stale in a way that
-- matters: without this, a signed-in person cannot read their own `region_code`,
-- cannot see that a lookup guessed wrong, and cannot be shown a correction for a
-- value they never supplied. The disclosure is about THEIR data; a person who cannot
-- read their own jurisdiction cannot contest it.
--
-- THE ORDER IS REPEATED FROM `0008` AND IT IS LOAD-BEARING. A column privilege can
-- only narrow a table-level grant that has already been taken away — `REVOKE SELECT
-- (col)` on top of a standing table-level `SELECT` is accepted, exits 0, and changes
-- nothing (measured, recorded at `0001:1021`). So the sequence is: revoke the table
-- grant, then grant the columns. On any database where `0008` ran the revoke is
-- already a no-op; it is written anyway because it is the statement that makes the
-- intent legible and because the wrong order is the one that fails OPEN rather than
-- loudly.
REVOKE SELECT ON public.users FROM app_member;
GRANT SELECT (id, username, email, created_at,
              country_code, region_code, city,
              geo_source, geo_accuracy_km, geo_updated_at)
  ON public.users TO app_member;

-- NO `UPDATE`, AND THE ABSENCE IS THE POINT. `app_member` holds no INSERT, UPDATE,
-- DELETE or TRUNCATE on `users` — unchanged from `0008` — and that is the control
-- which stops a member from setting their own `geo_source` to 'admin_verified', which
-- would be forging evidence about themselves into the one column whose entire purpose
-- is to record who made a determination and how. It is asserted per privilege and per
-- role in `test/rls/geo-profile.spec.ts`, rather than left to this comment.
--
-- `app_admin` needs nothing here: it holds TABLE-level SELECT on `users` (`0008`), so
-- the six columns arrive with it. The superset stays a superset, and this migration
-- does not narrow the admin on a column it has no reason to hide.

-- =============================================================================
-- WHAT A MEMBER MAY DO WITH THESE COLUMNS — AND WHERE THE BOUNDARY IS NOT
-- =============================================================================
-- There is no DB capability in this file, and there is a reason for each absence:
--
--   * NO NEW PERMISSION ROW. `geo` is not a resource. Capability in this schema is
--     `(resource, action)` over a TABLE, and these columns live on `users`, whose
--     verbs are already decided by grants (`AGENTS.md §B2 §Operation). A
--     `('geo', 'read')` row would be a permission that gates nothing, and giving a
--     new capability its own row is only right when it gates something.
--   * NO POLICY. `users` carries `users_read_scope` and the three write policies
--     from `0008`, as rewritten by `0009` so a tombstone is not readable by its own
--     subject. Adding a fifth policy here would split one operation's requirements
--     across two PERMISSIVE policies — which are OR-ed, so the new one could admit
--     on its own. That is the recorded escalation shape; it is not something this
--     migration does.
--
-- THE RESIDUAL, STATED PLAINLY RATHER THAN LEFT TO BE DISCOVERED
--
-- Every write to these columns arrives as `app_admin` — the thin app connects as
-- `pgrst_authenticator` with `SET LOCAL ROLE app_admin`, which is the only write
-- path `users` has. The database therefore CANNOT distinguish
--
--   (a) an operator who verified a user's region out of band and wrote
--       'admin_verified', from
--   (b) an endpoint that copied a client-supplied `geo_source` straight into the
--       UPDATE.
--
-- Both are the same statement from the same principal. The schema can forbid the
-- vocabulary and the forged radius; it cannot forbid (b), and pretending otherwise
-- would be a comment claiming a control that does not exist (§2.1). The control for
-- (b) is in the endpoint: `geo_source` is derived by the server — 'geoip' when the
-- lookup produced the value, 'user_declared' when the person stated it, and
-- 'admin_verified' only on a path that a human operator took and that no request body
-- can reach. A trigger keyed on `current_setting('is_superuser')` would close (b) at
-- the database, at the cost of making 'admin_verified' unwritable by the application
-- at all; that is a trade worth making deliberately, by whoever owns the endpoint,
-- and it is NOT made unilaterally in a migration that does not own `src/`.
--
-- THE ERASURE INTERACTION, RECORDED FOR THE NEXT AGENT WHO TOUCHES `0009`
--
-- `0009` anonymises a user in place and the anonymisation UPDATE lives in `src/`,
-- not here. `city` and `region_code` are personal data — a city is frequently
-- identifying on its own — so an erasure that scrubs the email and leaves the
-- jurisdiction behind is a partial erasure that still answers "where was this
-- person". This migration does not add a trigger to enforce that, because the
-- anonymisation path is a statement written elsewhere and a trigger here would be a
-- second mechanism for one decision (§2.4). It is recorded here so that whoever next
-- edits the anonymisation UPDATE reads this before adding a column to the SET list.

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
-- PostgREST caches the schema, and six columns added after startup are invisible to
-- a server started before this file ran. The served spec
-- (`openapi-mode = "ignore-privileges"`) advertises every column of every relation in
-- `db-schemas` regardless of grants, so the generated types for `users` gain six
-- properties here — which is why the reload belongs in this file and not in a note.
--
-- One consequence for whoever regenerates the client: `openapi-mode` also means the
-- spec will advertise these columns to a role that cannot read some of them, and a
-- COLUMN-RESTRICTED role cannot use `select=*` at all (`0008`, "what this costs the
-- client"). A client that wants the geography must NAME these columns; one that sends
-- `select=*` against `users` is refused, and that was already true before this
-- migration.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0012_user_geo.down.sql. Kept as a separate file so this
-- one stays append-only, exactly as in 0001–0011.
--
-- ROLLING THIS BACK DESTROYS EVIDENCE, which is the one thing to read before running
-- it. The down script drops the six columns, so every provenance record — which rows
-- were GeoIP guesses, with what radius, as of when — is gone, and there is no way to
-- reconstruct it: the provider's answer is not stored anywhere else and the next
-- lookup may return a different one. It also restores the `0008` column grant, so a
-- member can no longer read their own jurisdiction.
--
-- Nothing downstream breaks: no policy, function or capability in this tree reads
-- these columns yet, because the reader (`dbip-city-lite`) and the endpoint that
-- writes them are later work. Verify the rollback from the catalog —
--
--   SELECT attname FROM pg_attribute
--    WHERE attrelid = 'public.users'::regclass
--      AND attname IN ('country_code', 'region_code', 'city',
--                      'geo_source', 'geo_accuracy_km', 'geo_updated_at');
--
-- — returning zero rows is the check. A `migration:revert` exit code is not: it
-- reports that the script ran, not that the provenance was acceptable to lose.
