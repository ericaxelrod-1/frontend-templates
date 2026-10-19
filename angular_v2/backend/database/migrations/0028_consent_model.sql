-- =============================================================================
-- 0028: the consent data model — purposes, an append-only record, page groups,
--        tags
-- =============================================================================
--
-- WHAT THIS FILE IS, AND WHAT IT IS NOT
--
-- It is the model and the policies around it. **It builds no injector, no gate and
-- no UI**, and it hardcodes no tracking vendor: `consent_tags.snippet` is an
-- opaque string the next unit interprets, and `consent_purposes` is a catalogue a
-- fork fills in. Nothing here reads a configuration key, which is the strongest
-- possible form of "a fork that does not want analytics still starts".
--
-- FIVE TABLES AND A JOIN, and one of them is deliberately shaped unlike its four
-- neighbours:
--
--   consent_purposes     the CATALOGUE of kinds of processing. NO foreign key to
--                        `users`: a purpose describes what THIS APPLICATION does,
--                        it is not anybody's. A per-user FK here is the category
--                        error that would ship a schema where one user's purposes
--                        are their own.
--   consent_records      an APPEND-ONLY EVENT LOG. Not a state table.
--   consent_page_groups  which routes the gate applies to, and whether "outside
--                        the app" means "outside an authenticated session".
--   consent_tags         a configured snippet and the purposes it serves.
--   consent_tag_groups   the join between a tag and the page groups it runs on.
--
-- THE FOUR DECISIONS THIS FILE EXISTS TO EXPRESS
--
-- 1. A person's consent history is more than its current value. `consent_records`
--    is a log: a grant in March and a revocation in June are TWO facts, and
--    storing only the latest destroys the one that proves the revocation. Current
--    state is derived — `authz.effective_consent()` — and never stored twice.
--
-- 2. `consent_purposes.policy_version` is what makes a re-prompt detectable. A
--    tracker added tomorrow must not extend a consent given today to a purpose
--    that person was never asked about, and a version that never moved could not
--    tell the two apart.
--
-- 3. An anonymous visitor has a client-side decision only. No identity means no
--    server row, so `consent_records.user_id` is NULLABLE and every row in this
--    table belongs to somebody.
--
-- 4. The row is keyed to a PERSON, not to an ACCOUNT. Erasure drops the
--    identifier and keeps the fact; the retention sweep then runs on the row's
--    own `recorded_at` because nothing else ties it to a clock.
--
-- -----------------------------------------------------------------------------
-- APPEND-ONLY IS A PROPERTY OF THE DATABASE, NOT A CONVENTION
-- -----------------------------------------------------------------------------
--
-- `UPDATE` and `DELETE` are revoked from every serving role **including
-- `app_admin`**, and a `BEFORE UPDATE OR DELETE` trigger refuses them a second
-- time, by name, with `42501`. Grants alone would not be enough and the trigger
-- alone would not be enough, so both are here:
--
--   * THE GRANT is what makes the request-serving surface honest. Every verb is
--     taken away first and only `SELECT` is given back, so there is no day-to-day
--     way to rewrite history — not even by an administrator, who is the superset
--     principal and not a bypass (§B2).
--
--   * THE TRIGGER is what survives a widened grant. `0016` states the same two
--     halves for `privacy_purge_queue`: "A policy with no grant behind it is not
--     dead code, it is the reason a widened grant is still refused at the row
--     layer." A future migration that grants `UPDATE` to `app_admin` would be
--     caught here rather than quietly opening a rewrite of the statutory record.
--
-- WHY THE TRIGGER ADMITS THE OWNER RATHER THAN NAMING A ROLE
--
-- Two mutations are legitimate and both are performed by a `SECURITY DEFINER`
-- seam that runs as the table owner: pseudonymisation on erasure, and the
-- retention sweep. Hard-coding `'app'` would make this file wrong the moment a
-- fork named its owner differently, so the check reads `pg_class.relowner`. The
-- owner is the one role `PostgREST` cannot be talked into assuming — it is not a
-- member of `app_anon`/`app_member`/`app_admin` and it is `NOLOGIN` (§B5).
--
-- -----------------------------------------------------------------------------
-- THE TENSION IN "APPEND-ONLY" AND "RETENTION MUST STILL DELETE", RESOLVED
-- -----------------------------------------------------------------------------
--
-- A retention window that cannot delete is not a retention window, and the
-- requirement here is sharper than usual because the series is keyed to a PERSON:
-- after an erasure the rows are orphaned — they still carry their timestamp,
-- purpose, policy version and mechanism, and nothing points at anybody — so they
-- must be swept on their own `recorded_at`.
--
-- The resolution is that there is exactly ONE deleter, it is a function, and it
-- is unreachable except through a grant to `app_admin`:
--
--   authz.purge_expired_consent_records(p_window_days integer)
--
-- It refuses a missing or out-of-range window with `22023`, deletes only rows
-- whose `user_id IS NULL` (orphaned — a live person's consent history is not the
-- retention sweep's to destroy), and returns the count rather than `void`, so a
-- caller that ignored it would have nothing to ignore.
--
-- **THE WINDOW IS A PARAMETER AND NOT A NEW CONFIG KEY.** `RETENTION_TOMBSTONE_DAYS`
-- is already read, already floored at five years and already asserted at boot
-- (`src/purge/retention-environment.ts`), and this file adds no second clock: the
-- caller passes the value it already has. Which caller that is, and on what
-- schedule, belongs to the retention work item — the sweep job is NOT wired here
-- because `AGENTS.md` §2.4 forbids a second mechanism beside the existing purge
-- scheduler, and adding one would have been the wrong place to add it.
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PREFLIGHT: the trigger below is attached to `users` and the FKs name it
-- -----------------------------------------------------------------------------
--
-- Both need the ownership of `public.users`, and `0015` and `0009` both refuse to
-- continue without it rather than record an invariant nothing enforces.
DO $$
DECLARE
  owner_name text;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION
      '0028 requires public.users, which 0002_refresh_tokens.sql creates; run the migrations in order';
  END IF;

  SELECT pg_get_userbyid(c.relowner) INTO owner_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'users' AND n.nspname = 'public';

  IF owner_name IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION
      'public.users is owned by %, not the migration role %; consent_records_user_id_fkey and the '
      'anonymisation trigger cannot be applied by a role that does not own the table, so 0028 would '
      'record an invariant nothing enforces. Take ownership (ALTER TABLE public.users OWNER TO %) '
      'before migrating, or recreate the database.',
      owner_name, current_user, current_user;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 1. consent_purposes — THE CATALOGUE
-- -----------------------------------------------------------------------------
--
-- `IF NOT EXISTS` everywhere in this file, because that is the convention every
-- migration here follows and because it makes the file safe to apply twice: the
-- proof databases apply every migration twice on purpose, because "applies
-- cleanly" and "is idempotent" are different claims.
--
-- NO FOREIGN KEY TO `users`. This is the catalogue every visitor is asked about,
-- before anyone is signed in, and a purpose row that belonged to a person would
-- be a schema in which one user's purposes are their own.
CREATE TABLE IF NOT EXISTS public.consent_purposes (
  id               uuid        PRIMARY KEY DEFAULT uuidv7(),
  -- The stable, public identifier. `key`, not `id`, is what a `consent_tags`
  -- entry and a `consent_records` row name, because a uuid minted per
  -- environment would make configuration non-portable and a surrogate integer
  -- would make it unreadable. It is the natural key and it is UNIQUE.
  key              text        NOT NULL,
  label            text        NOT NULL,
  description      text        NOT NULL DEFAULT '',
  -- Art. 6(1) GDPR. A closed set rather than free text, because "Consent" and
  -- "consent " are the same word to a person and two values to a query, and a
  -- gate that cannot branch on the legal basis cannot be reasoned about at all.
  legal_basis      text        NOT NULL,
  -- FALSE for the processing the site cannot operate without (serving the request
  -- the visitor made). This is the column a gate reads and it is why the
  -- catalogue is a model and not a list of trackers.
  requires_consent boolean     NOT NULL DEFAULT true,
  -- See decision 2 in the header. Bumped when a tracker arrives, so a re-prompt
  -- becomes detectable rather than a matter of opinion.
  policy_version   integer     NOT NULL DEFAULT 1,
  sort_order       integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_purposes_key_key UNIQUE (key),
  CONSTRAINT consent_purposes_key_format_check CHECK (key ~ '^[a-z0-9][a-z0-9_]*$'),
  CONSTRAINT consent_purposes_legal_basis_check
    CHECK (legal_basis IN ('consent', 'contract', 'legitimate_interests', 'public_task')),
  CONSTRAINT consent_purposes_policy_version_check CHECK (policy_version >= 1)
);

-- The display order a consent control renders, and the only thing anyone sorts
-- this table by.
CREATE INDEX IF NOT EXISTS consent_purposes_sort_idx
  ON public.consent_purposes (sort_order, key);

COMMENT ON TABLE public.consent_purposes IS
  'The catalogue of kinds of processing this application does. Shared by every visitor; no FK to users.';

-- -----------------------------------------------------------------------------
-- 2. consent_page_groups — WHICH ROUTES, AND WHETHER INSIDE THE APP
-- -----------------------------------------------------------------------------
--
-- `authenticated_only` is what makes "not inside the app" survive a new route
-- added by a fork: a member-only route is named by being a member-only route, and
-- not by someone remembering to edit a configuration file when they add it.
CREATE TABLE IF NOT EXISTS public.consent_page_groups (
  id                 uuid        PRIMARY KEY DEFAULT uuidv7(),
  key                text        NOT NULL,
  -- A list of path globs. `jsonb` rather than a Postgres array because B1 asks
  -- for queryable JSON and because a fork will want `?` containment here.
  path_globs         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  authenticated_only boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_page_groups_key_key UNIQUE (key),
  CONSTRAINT consent_page_groups_key_format_check CHECK (key ~ '^[a-z0-9][a-z0-9_]*$'),
  -- The shape is checked and the CONTENT is not: a glob this model cannot verify
  -- is a glob the next unit's matcher owns. The check is here because
  -- `path_globs = '"/*"'` is a misconfiguration that reads as configured.
  CONSTRAINT consent_page_groups_path_globs_array_check CHECK (jsonb_typeof(path_globs) = 'array')
);

CREATE INDEX IF NOT EXISTS consent_page_groups_authenticated_idx
  ON public.consent_page_groups (authenticated_only, key);

COMMENT ON COLUMN public.consent_page_groups.authenticated_only IS
  'TRUE for groups that only exist inside an authenticated session, so a new route is covered by being a route rather than by being listed.';

-- -----------------------------------------------------------------------------
-- 3. consent_tags — A CONFIGURED SNIPPET
-- -----------------------------------------------------------------------------
--
-- `snippet` is opaque TEXT and stays opaque here. This file does not parse it,
-- does not recognise a vendor and does not decide what it does; the next unit
-- does, and hardcoding a vendor into a migration would make every fork that does
-- not use that vendor carry a policy for it.
--
-- `purposes` is a jsonb array of purpose KEYS rather than of ids, for the same
-- portability reason `consent_purposes.key` exists. It is NOT a foreign key —
-- a jsonb array cannot be one — which is precisely why the misconfiguration
-- reporter exists: a key that names no purpose is storable, and a storable
-- misconfiguration that nothing reports is the silent kind.
CREATE TABLE IF NOT EXISTS public.consent_tags (
  id         uuid        PRIMARY KEY DEFAULT uuidv7(),
  key        text        NOT NULL,
  snippet    text        NOT NULL DEFAULT '',
  -- Array of `consent_purposes.key`. Checked to be an array here; checked to be
  -- STRINGS that exist by `consent-config-materializer.ts`, because a CHECK may
  -- not contain a subquery.
  purposes   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  enabled    boolean     NOT NULL DEFAULT true,
  -- An ACTOR pointer, not a subject one, on `0024`'s own distinction: the tag is
  -- not a record about the administrator who typed it, so their erasure must not
  -- destroy it. SET NULL and never CASCADE — see `0024`'s `disabled_by` case.
  created_by uuid        REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_tags_key_key UNIQUE (key),
  CONSTRAINT consent_tags_key_format_check CHECK (key ~ '^[a-z0-9][a-z0-9_]*$'),
  -- NOT `CHECK (length(snippet) > 0)`. An empty snippet IS the misconfiguration
  -- the reporter exists to surface, and a CHECK would turn it into an opaque
  -- `23514` at the INSERT that nobody sees — a refusal in place of a report.
  CONSTRAINT consent_tags_purposes_array_check CHECK (jsonb_typeof(purposes) = 'array')
);

-- The materialiser's window column. Everything else about a tag is indexed by
-- `key`, which is already UNIQUE.
CREATE INDEX IF NOT EXISTS consent_tags_updated_idx
  ON public.consent_tags (updated_at);

CREATE INDEX IF NOT EXISTS consent_tags_enabled_idx
  ON public.consent_tags (enabled);

COMMENT ON COLUMN public.consent_tags.snippet IS
  'Opaque to this migration. No vendor is named, recognised or hardcoded anywhere in this file.';

-- -----------------------------------------------------------------------------
-- 4. consent_tag_groups — THE JOIN
-- -----------------------------------------------------------------------------
--
-- The `group_id` foreign key is the answer to the third misconfiguration in the
-- unit's brief ("names a page group that does not exist"): it is STRUCTURALLY
-- IMPOSSIBLE, and an INSERT that tries fails with `23503` naming the table. There
-- is deliberately no reporter check for it — a check that cannot fail is a
-- liability, not a control (§B8).
CREATE TABLE IF NOT EXISTS public.consent_tag_groups (
  tag_id   uuid NOT NULL REFERENCES public.consent_tags (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.consent_page_groups (id) ON DELETE CASCADE,
  PRIMARY KEY (tag_id, group_id)
);

-- The PRIMARY KEY covers "every group for this tag", which is the direction the
-- gate reads. This covers the other one.
CREATE INDEX IF NOT EXISTS consent_tag_groups_group_idx
  ON public.consent_tag_groups (group_id, tag_id);

-- -----------------------------------------------------------------------------
-- 5. consent_records — THE APPEND-ONLY EVENT LOG
-- -----------------------------------------------------------------------------
--
-- Every column here is either a fact about the decision or the moment it was
-- made. There is no `updated_at`, no `status` and no `is_current`, because a row
-- in this table is not a thing that changes.
--
-- `user_id` is NULLABLE and is NOT NULL for every row this schema creates
-- (decision 3: no identity, no row). It becomes NULL in exactly two ways, both of
-- which are the same act — the identifier is dropped and the fact is kept:
--   * the anonymisation trigger below, on an erasure;
--   * the foreign key's `ON DELETE SET NULL`, on a hard purge of the account.
CREATE TABLE IF NOT EXISTS public.consent_records (
  id             uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id        uuid        REFERENCES public.users (id) ON DELETE SET NULL,
  -- RESTRICT, not CASCADE: a record names the purpose it was given about, and
  -- deleting a purpose that has history would leave the export incoherent. This
  -- FK does not name `users`, so it is not in the purge census.
  purpose_key    text        NOT NULL REFERENCES public.consent_purposes (key) ON DELETE RESTRICT,
  granted        boolean     NOT NULL,
  -- The catalogue version at the moment of the decision. Copied, not joined: a
  -- later bump to `consent_purposes.policy_version` must not silently re-label
  -- a decision that was taken under the old one.
  policy_version integer     NOT NULL,
  -- HOW the person expressed it, free text. Free because the control that offers
  -- it does not exist yet and naming today's imagined surfaces in a CHECK would
  -- mean a migration for each of them. `NOT NULL` and non-blank is what matters,
  -- and it is retained by pseudonymisation.
  mechanism      text        NOT NULL,
  -- Which surface captured it. `app` is a person's own decision in the running
  -- application; `admin_api` is an administrator recording one on a subject's
  -- behalf, and it is in the export because an export that cannot say who took a
  -- decision is not defensible.
  source         text        NOT NULL DEFAULT 'app',
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_records_source_check CHECK (source IN ('app', 'admin_api')),
  CONSTRAINT consent_records_policy_version_check CHECK (policy_version >= 1)
);

-- `ENABLE` and deliberately NOT `FORCE`, and this is the one exception to §B2's
-- rule, for the reason `0010` gives for `privacy_request_audits`: the only
-- writer is a `SECURITY DEFINER` seam, and a seam runs as the owner — which
-- `FORCE` would bind to the policy below, where no branch may name the owner
-- without that branch becoming a candidate for every serving role. The serving
-- roles own nothing, so `ENABLE` alone binds every role that can reach this
-- table.
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

-- The series read, the current-state read and the export all take this path:
-- one subject, one purpose, newest first.
CREATE INDEX IF NOT EXISTS consent_records_subject_idx
  ON public.consent_records (user_id, purpose_key, recorded_at DESC, id DESC);

-- The retention sweep, and the index says what it sweeps. Orphaned rows ONLY —
-- a live person's consent history is not this table's to expire, and an index
-- over all rows would be an invitation to write the sweep that way.
CREATE INDEX IF NOT EXISTS consent_records_orphan_retention_idx
  ON public.consent_records (recorded_at)
  WHERE user_id IS NULL;

-- -----------------------------------------------------------------------------
-- THE APPEND-ONLY GUARD
-- -----------------------------------------------------------------------------
--
-- `RETURN COALESCE(NEW, OLD)` because a trigger function must return a row and
-- `NEW` is NULL on a DELETE. It never reaches that line for a refused operation.
CREATE OR REPLACE FUNCTION authz.guard_consent_records_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  owner_name text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO owner_name
    FROM pg_class c
   WHERE c.oid = 'public.consent_records'::regclass;

  -- The comparison is against the OWNER, found from the catalogue rather than
  -- written as a literal, so a fork that named its owner differently keeps the
  -- guard and loses nothing. Everything else — every serving role, every grant,
  -- every session — lands here and is refused by name.
  IF current_user <> owner_name THEN
    RAISE EXCEPTION
      'public.consent_records is append-only: % may not % it. A consent record is evidence, and '
      'evidence that can be rewritten is not evidence. The two writes that do exist are '
      'authz.pseudonymize_consent_series() and authz.purge_expired_consent_records().',
      current_user, tg_op
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$$;

-- EXECUTE goes to PUBLIC on every new function, so it is revoked. This one is
-- SECURITY INVOKER deliberately: it asks a question ABOUT THE CALLER, and a
-- DEFINER body would answer about the owner and refuse nothing (the trap
-- `protect_system_row` documents).
REVOKE EXECUTE ON FUNCTION authz.guard_consent_records_append_only() FROM PUBLIC;

-- Dropped before created, because `CREATE TRIGGER` has no `IF NOT EXISTS` and a
-- file that cannot be applied twice is a file whose second application fails on
-- a line nobody was looking at.
DROP TRIGGER IF EXISTS consent_records_append_only ON public.consent_records;
CREATE TRIGGER consent_records_append_only
  BEFORE UPDATE OR DELETE ON public.consent_records
  FOR EACH ROW
  EXECUTE FUNCTION authz.guard_consent_records_append_only();

-- -----------------------------------------------------------------------------
-- THE WRITE SEAM — AND ONLY THE WRITE SEAM
-- -----------------------------------------------------------------------------
--
-- `INSERT` is granted to nobody. A second writer is then not something a later
-- migration can create by widening a grant, and the append-only guard is the
-- only thing that would have to be reasoned about from then on.
--
-- The subject is `authz.actor()` and there is no `p_user_id` parameter, so the
-- function cannot be pointed at somebody else. That is the whole of the
-- authorization for this write: a request cannot record a decision for a person
-- who is not making it.
CREATE OR REPLACE FUNCTION authz.record_consent_decision(
  p_purpose_key   text,
  p_granted       boolean,
  p_mechanism     text,
  p_source        text DEFAULT 'app'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor  uuid;
  v_role   text;
  v_record uuid;
BEGIN
  v_role := authz.serving_role();
  IF v_role IS DISTINCT FROM 'app_member' AND v_role IS DISTINCT FROM 'app_admin' THEN
    RAISE EXCEPTION
      'authz.record_consent_decision: only a signed-in caller may record a consent decision, and this '
      'one is serving as %', coalesce(v_role, 'none')
      USING ERRCODE = '42501';
  END IF;

  v_actor := authz.actor();
  IF v_actor IS NULL THEN
    -- A null `sub` is a clean denial everywhere else in this schema
    -- (`authz.actor()` catches the cast and returns NULL), and it is one here
    -- rather than an append with a NULL subject — which decision 3 forbids and
    -- which the NOT NULL below would have to be widened to permit.
    RAISE EXCEPTION
      'authz.record_consent_decision: no usable `sub` in the claims, so there is nobody to record a '
      'decision for. An anonymous decision is the browser''s and never reaches this table.'
      USING ERRCODE = '42501';
  END IF;

  IF p_granted IS NULL THEN
    RAISE EXCEPTION 'authz.record_consent_decision: the decision is required; NULL is not one'
      USING ERRCODE = '22023';
  END IF;

  IF p_mechanism IS NULL OR btrim(p_mechanism) = '' THEN
    RAISE EXCEPTION
      'authz.record_consent_decision: the mechanism is required and is retained by pseudonymisation, so '
      'an empty one is a record that cannot say how the decision was taken'
      USING ERRCODE = '22023';
  END IF;

  -- The purpose's existence is left to the foreign key, which refuses with
  -- `23503` and names the constraint. A hand-written existence check here would
  -- be a second answer to the same question, and this file already has a
  -- question about consent purposes that only one thing asks.
  INSERT INTO public.consent_records (user_id, purpose_key, granted, policy_version, mechanism, source)
  SELECT v_actor, p_purpose_key, p_granted, p.policy_version, p_mechanism, p_source
    FROM public.consent_purposes p
   WHERE p.key = p_purpose_key
  RETURNING id INTO v_record;

  IF v_record IS NULL THEN
    RAISE EXCEPTION
      'authz.record_consent_decision: no consent_purposes row has key %', p_purpose_key
      USING ERRCODE = '22023';
  END IF;

  RETURN v_record;
END
$$;

REVOKE EXECUTE ON FUNCTION authz.record_consent_decision(text, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.record_consent_decision(text, boolean, text, text) TO app_member, app_admin;

-- -----------------------------------------------------------------------------
-- CURRENT STATE — THE LATEST EVENT PER (SUBJECT, PURPOSE)
-- -----------------------------------------------------------------------------
--
-- A FUNCTION and not a VIEW, and B1 is why: a view created by the owner bypasses
-- every policy on its base table, silently (ADR-0022). A `STABLE` function is the
-- shape B1 asks for and `/rpc/authz_effective_consent` is how it is reached.
--
-- `SECURITY INVOKER`, so RLS below applies with the CALLER's privileges. That is
-- the entire authorization: a member asking about somebody else gets zero rows,
-- because the policy only admits their own, and an administrator gets the whole
-- table. A `p_user_id`-shaped check inside would be a second mechanism for a
-- question the policy already answers, and it would answer it differently.
CREATE OR REPLACE FUNCTION authz.effective_consent(p_subject_id uuid)
RETURNS TABLE (
  purpose_key    text,
  granted        boolean,
  policy_version integer,
  mechanism      text,
  recorded_at    timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT ON (r.purpose_key)
         r.purpose_key, r.granted, r.policy_version, r.mechanism, r.recorded_at
    FROM public.consent_records r
   WHERE r.user_id = p_subject_id
   ORDER BY r.purpose_key, r.recorded_at DESC, r.id DESC;
$$;

REVOKE EXECUTE ON FUNCTION authz.effective_consent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.effective_consent(uuid) TO app_member, app_admin;

-- -----------------------------------------------------------------------------
-- ERASURE PSEUDONYMISES THE SERIES — a TRIGGER, not a code path
-- -----------------------------------------------------------------------------
--
-- Attached to the anonymisation of `users` rather than called from the erasure
-- route, for the reason `0009` gives for `revoke_subject_authority`: an erasure
-- that happened by any other path would leave the series identifying a person who
-- no longer exists, and a hook only somebody remembers to call is not a control.
--
-- The row keeps its timestamp, purpose key, policy version, mechanism and source.
-- Only the identifier goes. The result is exactly what requirement 10 asks for
-- and exactly the shape `0009` gives the statutory compliance record.
CREATE OR REPLACE FUNCTION authz.pseudonymize_consent_series() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Only the transition INTO anonymisation. Re-running the erasure must not
  -- rewrite anything, and the idempotency is in the predicate rather than in a
  -- branch that could be got wrong — the same argument `ANONYMISE_SUBJECT_SQL`
  -- makes for `AND deleted_at IS NULL`.
  IF NEW.deleted_at IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.consent_records
     SET user_id = NULL
   WHERE user_id = NEW.id;

  RETURN NEW;
END
$$;

-- SECURITY DEFINER, and it has to be: the UPDATE above is refused to every
-- serving role by the grant below AND by the append-only guard unless the caller
-- is the owner, and `0009` already showed that a half-privilege here leaves a
-- tombstone in a state nothing else can reach. DEFINER removes the split.
REVOKE EXECUTE ON FUNCTION authz.pseudonymize_consent_series() FROM PUBLIC;

DROP TRIGGER IF EXISTS users_pseudonymize_consent_series ON public.users;
CREATE TRIGGER users_pseudonymize_consent_series
  AFTER UPDATE OF deleted_at, deletion_reason ON public.users
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION authz.pseudonymize_consent_series();

-- -----------------------------------------------------------------------------
-- RETENTION — THE ONE LEGITIMATE DELETER
-- -----------------------------------------------------------------------------
--
-- `RETURNS integer`, never `void`, because a purge that reports nothing is
-- indistinguishable from a purge that found nothing (`0016` states the rule and
-- `purge-executor.ts` returns a count for the same reason).
--
-- `SECURITY DEFINER` for the reason the pseudonymisation trigger is: the append-
-- only guard refuses a `DELETE` whose `current_user` is not the table owner, and
-- this function is what has to be that owner for the window to be enforceable at
-- all. There is no grant on the table that could produce this write.
CREATE OR REPLACE FUNCTION authz.purge_expired_consent_records(p_window_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_window_days IS NULL THEN
    RAISE EXCEPTION
      'authz.purge_expired_consent_records: the retention window is required. Pass the value the '
      'operator already configured — RETENTION_TOMBSTONE_DAYS. This function deliberately does not '
      'read a second clock.'
      USING ERRCODE = '22023';
  END IF;

  IF p_window_days < 1 OR p_window_days > 36500 THEN
    RAISE EXCEPTION
      'authz.purge_expired_consent_records: the retention window must be between 1 and 36500 days, '
      'received %', p_window_days
      USING ERRCODE = '22023';
  END IF;

  -- ORPHANED ROWS ONLY. `user_id IS NULL` means the identifier is already gone —
  -- erased or purged — so what is being swept is a fact with no subject attached.
  -- A live person's consent history is NOT this sweep's to expire: erasing it on
  -- a clock would destroy the record while the person is still using the product,
  -- which is the opposite of what the append-only guard is protecting.
  DELETE FROM public.consent_records
   WHERE user_id IS NULL
     AND recorded_at < now() - make_interval(days => p_window_days);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END
$$;

REVOKE EXECUTE ON FUNCTION authz.purge_expired_consent_records(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.purge_expired_consent_records(integer) TO app_admin;

-- -----------------------------------------------------------------------------
-- updated_at — the materialiser's window column
-- -----------------------------------------------------------------------------
--
-- A stored timestamp that could drift from the row it describes would make the
-- reporter's window a question about two clocks, so it is derived by a trigger
-- exactly as `0027` does it, and it is SECURITY INVOKER with no grant at all: it
-- reads no table and asks nothing about the caller.
CREATE OR REPLACE FUNCTION authz.touch_consent_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION authz.touch_consent_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS consent_purposes_touch_updated_at ON public.consent_purposes;
CREATE TRIGGER consent_purposes_touch_updated_at
  BEFORE UPDATE ON public.consent_purposes
  FOR EACH ROW EXECUTE FUNCTION authz.touch_consent_updated_at();

DROP TRIGGER IF EXISTS consent_page_groups_touch_updated_at ON public.consent_page_groups;
CREATE TRIGGER consent_page_groups_touch_updated_at
  BEFORE UPDATE ON public.consent_page_groups
  FOR EACH ROW EXECUTE FUNCTION authz.touch_consent_updated_at();

DROP TRIGGER IF EXISTS consent_tags_touch_updated_at ON public.consent_tags;
CREATE TRIGGER consent_tags_touch_updated_at
  BEFORE UPDATE ON public.consent_tags
  FOR EACH ROW EXECUTE FUNCTION authz.touch_consent_updated_at();

-- -----------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- -----------------------------------------------------------------------------
--
-- FOUR CATALOGUE TABLES AND ONE POLICY EACH, and the catalogue predicate is NOT
-- `USING (true)`. It names the three serving roles instead, because a reader that
-- arrives as anything else is refused rather than shown the whole catalogue, and
-- because a bare `true` on a policy is indistinguishable from a leak to the next
-- reader — which is the reason B8 insists on reading the rows and not the shape.
--
-- `app_anon` READS THE CATALOGUE AND THIS IS DELIBERATE. The gate runs in the
-- BROWSER, before anyone is signed in, so an anonymous visitor must be able to
-- read what it is being asked about or the question is unanswerable. What is in
-- here is the application telling the visitor what the application does, which is
-- the same text the consent control renders and, for any tracker a fork adds, the
-- same identifier that appears in page source anyway.
--
-- `DROP POLICY IF EXISTS` first, because `CREATE POLICY` has no `IF NOT EXISTS`
-- and a file that cannot be applied twice is a file whose second application
-- fails on a line nobody was looking at.
DROP POLICY IF EXISTS row_scope ON public.consent_purposes;
CREATE POLICY row_scope ON public.consent_purposes USING (
    current_user IN ('app_anon', 'app_member', 'app_admin')
);

DROP POLICY IF EXISTS row_scope ON public.consent_page_groups;
CREATE POLICY row_scope ON public.consent_page_groups USING (
    current_user IN ('app_anon', 'app_member', 'app_admin')
);

DROP POLICY IF EXISTS row_scope ON public.consent_tags;
CREATE POLICY row_scope ON public.consent_tags USING (
    current_user IN ('app_anon', 'app_member', 'app_admin')
);

DROP POLICY IF EXISTS row_scope ON public.consent_tag_groups;
CREATE POLICY row_scope ON public.consent_tag_groups USING (
    current_user IN ('app_anon', 'app_member', 'app_admin')
);

-- `consent_records` is the fifth and the only one with a real scope. WHO MAY READ
-- A SERIES — the question the unit asks, answered:
--
--   the subject          `user_id = authz.actor()`
--   `app_admin`          every row, for support and for the compliance export
--   `app_anon`           NOTHING. No grant, no policy branch, no row.
--   any other member     NOTHING.
--
-- A series is more revealing than a current state: it says when a person said yes
-- and when they changed their mind, which is a behavioural history. So the answer
-- to "it's my own consent history" is an actual one — the subject, and an
-- administrator — and the export in the next unit is served from this same
-- predicate, so it cannot disclose more than this can.
DROP POLICY IF EXISTS row_scope ON public.consent_records;
CREATE POLICY row_scope ON public.consent_records USING (
    current_user = 'app_admin'
    OR user_id = authz.actor()
);

-- No `WITH CHECK`: Postgres reuses `USING` for the insert path, and the only
-- writer runs as the owner, which `ENABLE` without `FORCE` does not bind.

-- -----------------------------------------------------------------------------
-- GRANTS
-- -----------------------------------------------------------------------------
--
-- `REVOKE ALL ... FROM PUBLIC` first, always. Every grant below narrows
-- something that was taken away first.
REVOKE ALL ON public.consent_purposes, public.consent_page_groups,
                public.consent_tags, public.consent_tag_groups, public.consent_records
  FROM PUBLIC, app_anon, app_member, app_admin;

-- The catalogue, to everybody — see the policy comment for why `app_anon` is in
-- this list and why that is not a leak.
GRANT SELECT ON public.consent_purposes, public.consent_page_groups,
                public.consent_tags, public.consent_tag_groups
  TO app_anon, app_member, app_admin;

-- `app_admin` configures the catalogue. It is the superset principal and not a
-- bypass (§B2), and on these four tables the superset set is the whole verb list.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consent_purposes, public.consent_page_groups,
                public.consent_tags, public.consent_tag_groups
  TO app_admin;

-- `consent_records`. THE GRANT LIST IS THE APPEND-ONLY CONTROL, and it is one
-- verb long:
--
--   SELECT  the subject reads its own series; `app_admin` reads every row.
--   INSERT  nobody. Not `app_admin`. The only writer is
--           `authz.record_consent_decision()`, so a future migration cannot open
--           a second writer by widening a grant.
--   UPDATE  nobody. Not `app_admin`. Pseudonymisation and the referential action
--           both run as the OWNER, which no serving role is.
--   DELETE  nobody. Not `app_admin`. The retention sweep is the single deleter.
--   TRUNCATE nobody, for any role — closed here because `TRUNCATE` fires no row
--           trigger and a policy cannot see it.
GRANT SELECT ON public.consent_records TO app_member, app_admin;

-- The write seam is reachable by a member (their own decision) and by an
-- administrator. It is the only way a row is created.
--
-- Note what is NOT granted: nothing on `consent_records` beyond `SELECT`, for any
-- role, including `app_admin`.

NOTIFY pgrst, 'reload schema';

-- DOWN
-- See database/migrations/0028_consent_model.down.sql. Kept separate: a second
-- copy of one down script is the drift `test/unit/down-script.spec.ts` exists to
-- prevent.