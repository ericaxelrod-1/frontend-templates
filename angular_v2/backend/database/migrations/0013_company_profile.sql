-- The company itself: who we are, where we are, and whether the CCPA reaches us.
-- Target: PostgreSQL 18+, applied as the migration/owner role like every migration.
--
-- =============================================================================
-- WHY THESE TABLES EXIST — THE HONEST ANSWER, STATED FIRST
-- =============================================================================
-- They exist for the WEBSITE. The about page, the contact footer, the "where we're
-- based" line, the registered-office block that most terms of service put in a
-- footer, and the postal address a letter-of-law has to go to. Every one of those is
-- public, unauthenticated, and embarrassing to get wrong: a template that ships a
-- placeholder address has shipped a bug that only surfaces when a regulator or a
-- courier is involved.
--
-- Privacy then READS them. `ccpa_applicable()` at the foot of this file is derived
-- from `company_addresses`, so the statutory predicate is a consequence of the
-- content the site already needs to publish — not a second hand-maintained list of
-- where the company might be, which is the thing that rots.
--
-- That order matters and it is the argument for these tables existing at all. The
-- dishonest version of this migration is "we need a compliance flag", which produces
-- a column nobody keeps current and a predicate that answers from a value no one
-- updates. The useful version is "the site must publish where we are", and the
-- compliance answer falls out of it for free.
--
-- =============================================================================
-- THE SHAPE, AND WHY IT IS TWO TABLES
-- =============================================================================
-- `company_profile` is a SINGLETON: one row, one company, this template is forked
-- into one deployment at a time. `company_addresses` is a CHILD TABLE because a
-- business has several addresses — a registered office, a trading address, a
-- billing address, a mailing address — and because the statutory predicate is an
-- `EXISTS` over them, which is only correct if "several" is representable.
--
-- A SINGLE `region_code` COLUMN ON `company_profile` WOULD BE WRONG, and the way it
-- would be wrong is the interesting part: it forces a choice between recording one
-- address honestly and recording all of them falsely. A company with an office in
-- California and a head office in Delaware has to write down one of them, and
-- whichever it writes down is a statement about the whole company that is not true.
-- The child table makes "any one of these is in California" a question the schema
-- can answer correctly.
--
-- BOTH TABLES ARE UNSCOPED (AGENTS.md §B2's category table). They carry no
-- `group_id`, because they are not tenant data — they are global reference data
-- about the operator of this deployment, in the same class as `permissions` and
-- `actions`. The consequence is a simple `PRIMARY KEY (id)` rather than
-- `PRIMARY KEY (group_id, id)`, and it is stated here rather than left for a reader
-- to infer from the absence of a column.
--
-- =============================================================================
-- WHY THESE ARE PUBLIC TABLES AND `public.ccpa_applicable()` IS ANON-REACHABLE
-- =============================================================================
-- Both halves of this are the same decision, and it is a deliberate one.
--
-- A contact address and a company name are not secrets. They are printed on a
-- letterhead. Granting `SELECT` to `app_anon` is therefore not a hole, it is the
-- feature: it is what lets the server render an about page and a footer from the
-- database instead of from a hardcoded string in a component, which is the version
-- that goes stale and is wrong within a year.
--
-- And the disclosure is OWED TO ANYBODY, INCLUDING SOMEONE WHO IS NOT SIGNED IN. A
-- 401 on a public privacy-policy page is not a security control, it is a denial of
-- the disclosure itself — the person asking is asking precisely because they have no
-- account. So `ccpa_applicable()` is executable by `app_anon`.
--
-- An anon-reachable `SECURITY DEFINER` function is normally a red flag in this schema
-- (`0001` measured 63 unauthenticated probes recovering an administrator's whole
-- permission set through one). It is safe HERE, and the reason is specific rather
-- than general: the function takes NO ARGUMENT, reads NO caller identity, and its
-- answer is a function of table content that is public anyway. There is nothing in it
-- for a caller to be talked into — no `who` parameter to launder an identity through,
-- no GUC to set, no grant to reach past. It is a predicate over two columns.
-- =============================================================================

-- =============================================================================
-- PREFLIGHT — one warning, and it is about this file's own table
-- =============================================================================
-- NO ROLE CHECK, and the absence is deliberate rather than forgotten: `0001` opens
-- with a preflight that raises `missing role(s) […] — run
-- database/bootstrap/001_roles.sql as a superuser first`, and migrations run in
-- directory order, so by the time this file is applied the three serving roles exist
-- or the chain stopped two hundred lines earlier. A second copy of that check would
-- be a second implementation of one control, which is how the controls start to
-- disagree (§2.4).
--
-- What IS checked here is the one thing `0001`'s preflight cannot know: whether
-- `CREATE TABLE IF NOT EXISTS` below is about to SKIP a table whose shape is not
-- the one below. That statement is idempotent, which is what makes
-- `migration:run` safe on an existing install — and it does not converge, so a
-- `company_profile` that predates this file is left exactly as it is while this
-- migration reports success. A warning is the honest middle: not fatal, because
-- re-running an applied migration must be a no-op, and loud enough that the operator
-- learns about it from the run rather than from a missing column six months later.
DO $$
BEGIN
  IF to_regclass('public.company_profile') IS NOT NULL THEN
    RAISE WARNING
      'public.company_profile already exists — 0013 will not alter its shape; if it predates this '
      'migration its columns are not the ones described below, and the correct remedy is to drop and '
      'recreate it deliberately rather than to let this file report success';
  END IF;
END
$$;

-- =============================================================================
-- CHANGE 1 — `company_profile`, the singleton
-- =============================================================================
-- `CREATE TABLE IF NOT EXISTS` for the reason every other migration here uses it:
-- "applies cleanly" and "is idempotent" are different claims. Note what it does NOT
-- give: it does not converge. A table that predates this file with a different shape
-- is left exactly as it is and the migration reports success — which is why the
-- preflight above warns about it rather than staying silent.
--
-- `uuidv7()` and not `gen_random_uuid()` (AGENTS.md §B1): a v4 scatters index
-- insertions across the whole btree, and the catalog gate in
-- `test/rls/uuid-keys.spec.ts` reads `pg_attrdef` for EVERY uuid default in `public`
-- with no table names hardcoded — so a new table minted the old way fails a test that
-- has never heard of this file.
--
-- THE COLUMNS, and each one is here because a page needs it.
--   legal_name            the registered entity — the name on a court order
--   display_name          the trading name, which is what the header renders
--   registration_number   company number; terms of service identify the entity by it
--   website_url           canonical, so a page does not hardcode its own origin
--   support_email         the contact footer
--   privacy_contact_email where a data-subject request goes; a privacy policy that
--                         points at a support queue is a policy nobody exercises
--   created_at            when the record was published, which a privacy notice and
--                         an auditor both want and which nothing else can supply
--
-- NOT HERE, DELIBERATELY: a `country_code` / `region_code` pair. Those live on the
-- ADDRESS rows, for the reason in the header — a company with several addresses has
-- no single one, and a single one on the profile would be a claim about the company
-- that is false whenever the second address exists.
CREATE TABLE IF NOT EXISTS public.company_profile (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  legal_name            text NOT NULL,
  display_name          text NOT NULL,
  registration_number   text,
  website_url           text,
  support_email         text,
  privacy_contact_email text,
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- A legal name is not a string with whitespace in it. These two rules are the
  -- whole of the validation: a company profile is one row written by an
  -- administrator through a form, and the failure mode of skipping validation is a
  -- privacy policy that names "  Example Corp " in a legally-operative document.
  CONSTRAINT company_profile_legal_name_not_blank
    CHECK (legal_name = btrim(legal_name) AND legal_name <> ''),
  CONSTRAINT company_profile_display_name_not_blank
    CHECK (display_name = btrim(display_name) AND display_name <> ''),
  -- An email with no `@` is not an email address, and this column's entire purpose
  -- is that a request sent there is received. A cheap shape check, not a validator:
  -- it rejects the mistake that actually happens (a name pasted into an email field)
  -- and does not pretend to implement RFC 5322.
  --
  -- `[[:space:]]` AND NOT `\s`, because POSIX bracket expressions do not reliably
  -- support backslash classes inside the brackets — `[^@\s]` is a class whose meaning
  -- depends on the regex engine's mood, and a portability trap in a constraint is not
  -- a constraint. The POSIX class inside the bracket is the spelling that means one
  -- thing everywhere.
  CONSTRAINT company_profile_privacy_contact_email_shape
    CHECK (privacy_contact_email IS NULL OR privacy_contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT company_profile_support_email_shape
    CHECK (support_email IS NULL OR support_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

-- THE SINGLETON IS ENFORCED BY THE INDEX, NOT BY CONVENTION.
--
-- The alternative is a `CHECK (id = '<the one id>')`, which needs a constant to be
-- maintained and is arithmetically the same thing with a worse error message. This
-- form says what it means: a unique index over the constant `true`, so a second row
-- cannot exist whatever its id. One company per deployment, enforced by the database,
-- because a second profile row is a state no UI can render and no reader of
-- `ccpa_applicable()` would know to expect.
--
-- It does not stop an UPDATE of the existing row, which is the operation the site
-- actually performs, and that is the correct trade: the thing to prevent is a second
-- company appearing, not an edit to the first.
CREATE UNIQUE INDEX IF NOT EXISTS company_profile_singleton_idx
  ON public.company_profile ((true));

-- =============================================================================
-- CHANGE 2 — `company_addresses`, the child table the predicate reads
-- =============================================================================
-- `company_profile_id NOT NULL` — a child row with no parent is not an address of
-- anything, and `NULL` here would be a fourth state the `EXISTS` below would
-- silently skip.
--
-- THE FOREIGN KEY IS `NO ACTION`, AND THAT IS A DECISION ABOUT THE STATUTE
--
-- The obvious choice is `ON DELETE CASCADE` and it is wrong here. A cascade would
-- let an administrator delete the profile row and leave `ccpa_applicable()`
-- answering FALSE — the company's addresses would be gone with the record, and the
-- predicate would switch itself off with no signal, at exactly the moment the
-- deletion looks like routine housekeeping. `NO ACTION` refuses the delete with
-- `23503` while addresses remain, so the obligation cannot be switched off by
-- accident and the operator has to remove the addresses on purpose.
--
-- The second reason is the one `AGENTS.md §B2` records about this clause everywhere:
-- `ON DELETE CASCADE` CROSSES RLS. The referential action runs with the constraint
-- trigger's owner's rights, writing rows the deleting actor's policies would not
-- otherwise admit. Avoiding the clause avoids the whole question rather than arguing
-- that the blast radius happens to be small.
--
-- The residual is the direction that is safe: a database that somehow held an
-- orphaned address would still answer TRUE, because the predicate reads the ADDRESS
-- table and does not need its parent. Over-applying costs an operator an afternoon;
-- under-applying costs statutory damages.
CREATE TABLE IF NOT EXISTS public.company_addresses (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  company_profile_id uuid NOT NULL REFERENCES public.company_profile (id),
  line1              text NOT NULL,
  line2              text,
  city               text NOT NULL,
  region_code        text,
  country_code       text NOT NULL,
  postal_code        text,
  is_registered      boolean NOT NULL DEFAULT false,
  kind               text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  -- `line1` NOT NULL and `city` NOT NULL because an address without them is not an
  -- address; `line2` and `postal_code` are nullable because plenty of valid
  -- international addresses have neither.
  CONSTRAINT company_addresses_line1_not_blank
    CHECK (line1 = btrim(line1) AND line1 <> ''),
  CONSTRAINT company_addresses_city_not_blank
    CHECK (city = btrim(city) AND city <> ''),

  -- THE SAME CANONICAL-FORM RULES AS `0012`, and for the same reason plus a harder
  -- one: `ccpa_applicable()` compares `region_code = 'CA'` EXACTLY. A stored 'ca'
  -- or 'CA ' therefore reads as NOT California, and the failure direction is the one
  -- that ends in a lawsuit. Making the form canonical at the boundary is what makes
  -- an exact equality comparison sound — the alternative, `upper(btrim(x))` in the
  -- predicate, papers over data that is still wrong everywhere else.
  CONSTRAINT company_addresses_country_code_canonical
    CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT company_addresses_region_code_canonical
    CHECK (region_code IS NULL
           OR (region_code = btrim(region_code)
               AND region_code <> ''
               AND region_code = upper(region_code))),

  -- A US ADDRESS MUST CARRY ITS STATE. This is the one place 0012's rule is DELIBERATELY
  -- STRICTER than on `users`, and the asymmetry is the point: a GeoIP lookup returning
  -- a country and no state is an ordinary, expected partial answer, so `users` must
  -- tolerate it; an address typed into an administrator's form for a US company and
  -- left without a state is a mistake, and it is the mistake that silently switches
  -- the CCPA predicate off. Fail at the boundary, with a named constraint.
  CONSTRAINT company_addresses_us_address_requires_region
    CHECK (country_code <> 'US' OR region_code IS NOT NULL),

  -- `kind` IS CLOSED, and it is a separate axis from `is_registered` because they
  -- answer different questions: `is_registered` says whether this is the company's
  -- registered office (a legal fact), `kind` says what the address is used for (a
  -- publishing fact). An address can be the registered office AND a billing address.
  -- Left unconstrained, `kind` becomes a free-text field that a template fills with
  -- "HQ", "hq", "Head Office" and "headquarters" over four forks, and a consumer
  -- filtering on it gets an empty list for a reason nobody can see.
  --
  -- NO DEFAULT. An address with no declared kind is one nobody has decided how to
  -- publish, and defaulting it to 'office' would be a guess about how the address
  -- appears on a public page. A NOT NULL column with no default makes the writer
  -- choose, and the INSERT that omits it fails naming this constraint.
  CONSTRAINT company_addresses_kind_check
    CHECK (kind IN ('registered', 'headquarters', 'office', 'mailing', 'billing', 'other'))
);

-- THE FK INDEX. Every read of a company's addresses filters on the parent — the
-- page renders one company, and `ccpa_applicable()` is about one company — and an
-- unindexed FK means a sequential scan of the child for every lookup.
CREATE INDEX IF NOT EXISTS company_addresses_company_profile_id_idx
  ON public.company_addresses (company_profile_id);

-- NOT INDEXED ON `region_code`, and the absence is a decision rather than an
-- oversight. `ccpa_applicable()` filters on it, and §B1 says index what you filter
-- on — but this table is bounded by the number of addresses of ONE company. That is
-- single digits, on a table that changes when a company moves. An index here would
-- add a write cost, a second structure to keep in step with the CHECK constraints,
-- and a planner decision about which of two tiny scans to use, in exchange for
-- turning a scan that never misses into a scan that uses an index. The rule exists
-- for tables where the filter is selective; here it would be obeyed for its own sake.
-- `users.region_code` IS indexed, by the same rule applied honestly: that table has
-- millions of rows and the filter decides a statutory obligation per person.

-- =============================================================================
-- CHANGE 3 — ROW-LEVEL SECURITY: public to read, admin to write
-- =============================================================================
-- ENABLE and FORCE on both, without exception, because `app_anon` reaches them and a
-- table owner bypasses its own policies with nothing erroring (AGENTS.md §B2). The
-- exception list is `groups` and `user_groups`, and neither belongs here.
ALTER TABLE public.company_profile    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_profile    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.company_addresses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_addresses  FORCE ROW LEVEL SECURITY;

-- THE READ POLICY IS `USING (true)`, AND IT IS THE WHOLE POINT OF THE TABLES
--
-- This is the one place in this schema where a policy admits every row, so it is
-- written as a NAMED policy with a comment rather than folded into a generic
-- `row_scope`. Two things make it correct rather than careless:
--
--   * THE CONTENT IS PUBLIC BY LAW AND BY PRACTICE. A company name and a trading
--     address are on a letterhead. There is no column here that a person did not
--     already publish about themselves in a company filing.
--   * `openapi-mode = "ignore-privileges"` cannot express "restricted", so the served
--     spec advertises these columns to everyone anyway; the policy and the grant are
--     the control, not the spec.
--
-- THE TRADE, STATED RATHER THAN HIDDEN: a company that later needs a private address
-- — a home address of a sole trader, a registered office it is not obliged to publish
-- — cannot put it in this table. The fix for that is a separate table, not a policy
-- edit, because the moment this policy is narrowed the about page stops rendering and
-- nobody remembers why.
DROP POLICY IF EXISTS row_scope                  ON public.company_profile;
DROP POLICY IF EXISTS company_profile_public_read ON public.company_profile;
DROP POLICY IF EXISTS company_profile_insert      ON public.company_profile;
DROP POLICY IF EXISTS company_profile_update      ON public.company_profile;
DROP POLICY IF EXISTS company_profile_delete      ON public.company_profile;

CREATE POLICY company_profile_public_read ON public.company_profile FOR SELECT USING (true);

-- WRITES ARE `current_user = 'app_admin'`, NEVER A TOKEN FIELD. A caller who forges
-- `"role": "app_admin"` into their own validly-signed token changes nothing, because
-- nothing here reads that claim. Split per verb for the reason `0008` gives: a
-- `FOR ALL` write policy beside the read policy would make a reader's predicate
-- govern writes, and `pg_policies` would then show the public read as the whole
-- truth about the table.
CREATE POLICY company_profile_insert ON public.company_profile FOR INSERT WITH CHECK (current_user = 'app_admin');
CREATE POLICY company_profile_update ON public.company_profile FOR UPDATE USING (current_user = 'app_admin');
CREATE POLICY company_profile_delete ON public.company_profile FOR DELETE USING (current_user = 'app_admin');

DROP POLICY IF EXISTS row_scope                    ON public.company_addresses;
DROP POLICY IF EXISTS company_addresses_public_read ON public.company_addresses;
DROP POLICY IF EXISTS company_addresses_insert      ON public.company_addresses;
DROP POLICY IF EXISTS company_addresses_update      ON public.company_addresses;
DROP POLICY IF EXISTS company_addresses_delete      ON public.company_addresses;

CREATE POLICY company_addresses_public_read ON public.company_addresses FOR SELECT USING (true);
CREATE POLICY company_addresses_insert ON public.company_addresses FOR INSERT WITH CHECK (current_user = 'app_admin');
CREATE POLICY company_addresses_update ON public.company_addresses FOR UPDATE USING (current_user = 'app_admin');
CREATE POLICY company_addresses_delete ON public.company_addresses FOR DELETE USING (current_user = 'app_admin');

-- =============================================================================
-- CHANGE 4 — GRANTS: default deny, then one read grant and one write grant
-- =============================================================================
-- `REVOKE ALL` FIRST, then the verbs. The order is the same one 0008 states and for
-- the same reason: each grant narrows something the revoke has already taken away,
-- so a grant that is later deleted does not leave a privilege behind.
--
-- `app_anon` IS IN THE READ GRANT, and it is not a concession — it is the feature.
-- The about page, the contact footer and the privacy notice are served to people
-- with no account, and without this grant they render from a hardcoded constant
-- instead of from the database, which is the shape that is wrong within a year.
REVOKE ALL ON public.company_profile, public.company_addresses
  FROM PUBLIC, app_anon, app_member, app_admin;

GRANT SELECT ON public.company_profile, public.company_addresses
  TO app_anon, app_member, app_admin;

-- WRITES: `app_admin` only, and full, because editing the text of a privacy policy
-- is exactly what the superset principal is for. There is no member-facing write
-- path here and none is proposed: a member changing the company's registered address
-- would be a member editing a legal document.
GRANT INSERT, UPDATE, DELETE ON public.company_profile, public.company_addresses
  TO app_admin;

-- NO `TRUNCATE` FOR ANY SERVING ROLE. It is closed by the grants above rather than
-- by a policy, because `TRUNCATE` fires no row trigger and a policy cannot see it.
-- `test/rls/geo-profile.spec.ts` asserts it per role, since a future table-level
-- `TRUNCATE` grant is precisely the change that would reopen it.

-- =============================================================================
-- CHANGE 5 — `ccpa_applicable()`
-- =============================================================================
-- `STABLE`: the answer depends on table content and nothing else. It is a promise to
-- the planner that one statement sees one answer, which is true here because the
-- function reads only tables and no volatile input.
--
-- `SECURITY DEFINER`: so that `app_anon` can be answered without being granted
-- anything on the address table to ask the question. That is the same reason
-- `has_permission()` is DEFINER — a policy helper must be evaluable by the role that
-- triggers it.
--
-- `search_path` PINNED, so a schema searched later cannot shadow `company_addresses`
-- — and every column is schema-qualified as well, because pinning the path and
-- qualifying the reference are two independent defences and this is a statutory
-- predicate.
--
-- IN `public`, NOT IN `authz`. `authz` is deliberately outside `db-schemas`, which is
-- what stops PostgREST from addressing it; a function nobody can call over HTTP is
-- the wrong home for the one value the frontend needs in order to decide whether to
-- render the CCPA notice. In `public` it is `/rpc/ccpa_applicable` and it appears in
-- the generated OpenAPI, so the client cannot hand-write the URL (§B4).
CREATE OR REPLACE FUNCTION public.ccpa_applicable() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.company_addresses a
     WHERE a.region_code = 'CA'
       AND a.country_code = 'US'
  )
$$;

-- `EXECUTE` IS GRANTED TO `PUBLIC` ON EVERY NEW FUNCTION BY DEFAULT, so the revoke is
-- not optional — and it is written WITH THE SIGNATURE, because a revoke spelled with
-- parameter names instead of types matches no function and fails silently.
REVOKE EXECUTE ON FUNCTION public.ccpa_applicable() FROM PUBLIC;

-- Revoke AND grant, always together. Revoking from `PUBLIC` while granting to nobody
-- is strictly worse than doing nothing: every call becomes `42501`, and the privacy
-- page loses its jurisdiction with no error a user could act on.
--
-- `app_anon` IS HERE DELIBERATELY, and it is the one place in this schema where the
-- general rule ("`app_anon` needs every POLICY helper, never an RPC surface") does
-- not apply. `has_permission()` is withheld from `app_anon` because it answers about
-- an arbitrary `who` and is therefore a disclosure oracle. This function has no
-- argument, reads no identity, and returns a fact about the operator that is already
-- published on the about page. A denial here is a denial of the disclosure.
GRANT EXECUTE ON FUNCTION public.ccpa_applicable() TO app_anon, app_member, app_admin;

-- WHY THE READ POLICY IS `true` AND NOT `current_user = 'app_admin'` — THE SUBTLE
-- DEPENDENCY, AND THE FAILURE IT CAUSES IF SOMEBODY CHANGES IT
--
-- `ccpa_applicable()` is `SECURITY DEFINER`, so `current_user` inside its body is the
-- FUNCTION OWNER — the migration role — and never `app_admin`, whoever called it. Both
-- tables are `FORCE ROW LEVEL SECURITY`, which binds the owner to the policies as well.
-- So the read policy is what decides whether this function can see anything at all.
--
-- `USING (true)` admits it, which is why the function works for every caller including
-- `app_anon`. Had the read policy been written `current_user = 'app_admin'` — the shape
-- every other table in this schema uses — then `ccpa_applicable()` would return `false`
-- FOR EVERYONE, with no error, on every deployment, and the privacy notice would never
-- render. This is the same failure the schema already records for a `SECURITY DEFINER`
-- function that reads `current_user` instead of its argument: the answer is identical
-- for all callers, which in practice means it denies everyone while every policy,
-- grant and comment still looks correct.
--
-- So the two statements are one decision. If a future migration narrows the read policy
-- on either table, this function must be re-read in the same change; the suite asserts
-- both halves together precisely so that the dependency fails loudly.

-- =============================================================================
-- THE PREDICATE, AND WHY IT IS DELIBERATELY WRONG ABOUT THE STATUTE
-- =============================================================================
--     EXISTS (SELECT 1 FROM company_addresses a
--             WHERE a.region_code = 'CA' AND a.country_code = 'US')
--
-- MULTIPLE ADDRESSES IS WHY THIS IS A CHILD TABLE AND AN `EXISTS`. A business may
-- have several addresses, and any ONE of them in California triggers it. `EXISTS` is
-- therefore correct where `country_code = (SELECT … )` on a single profile row would
-- not be: there is no "the" address to read.
--
-- THE DELIBERATE OVER-APPLICATION, STATED PLAINLY
--
-- The statutory test is NOT about the address. CCPA §1798.140 covers a "business",
-- and a business is one that meets revenue, consumer-count and data-selling
-- thresholds — thresholds that have nothing to do with where its office is. A
-- California address on a company with $200k of revenue and eleven employees is not
-- a covered business, and this function will answer TRUE for it.
--
-- It answers TRUE ANYWAY, and that is a considered trade with the asymmetry spelled
-- out:
--
--   * OVER-APPLYING COSTS AN OPERATOR OCCASIONALLY HANDLING A REQUEST. They receive
--     a CCPA-flavoured data-subject request, look at the thresholds, and reply that
--     the business is not covered. The cost is an afternoon, once, and it is visible
--     to a human who can make that decision.
--   * UNDER-APPLYING COSTS STATUTORY DAMAGES. The failure is invisible: no request
--     arrives that could have revealed it, and the exposure is discovered by the
--     regulator or the plaintiff's counsel. Under-applying is the failure mode with
--     no signal.
--
-- And there is a second-order reason that is worth more than the first: over-applying
-- BUILDS THE MUSCLE MEMORY. A team that has already handled the request once knows
-- what it takes to handle it, and the day the thresholds ARE met the machinery is
-- already running. A team that has never run it is discovering a statutory deadline
-- under one.
--
-- THERE IS DELIBERATELY NO `CCPA_COVERED_BUSINESS` CONFIG FLAG, and the absence is
-- the load-bearing part of that paragraph. A flag would be a hand-maintained column
-- or environment variable answering a question that is not ours to answer from this
-- repository: the threshold data lives in Stripe, QuickBooks or an ERP, it changes
-- four times a year, and whoever set the flag last is gone. Worse, a flag turns a
-- statutory determination into an operator preference, and an operator who is wrong
-- is not detectable by anything in the system — `ccpa_applicable()` would return
-- `false` and the notice would not render and no test would fail. No config can talk
-- us out of getting this wrong in the direction that matters, so nothing here tries.
--
-- WHEN THE THRESHOLD TEST ACTUALLY LANDS, it is not a boolean on this table. It is a
-- decision made from a system of record that holds the numbers, recorded with a date
-- and a reason, so that "why did we think we were covered on the 3rd of March" has an
-- answer. That is a different table with a different owner, and pretending a column
-- here is that table is how it gets done wrong quietly.
--
-- WHY `= 'CA'` IS AN EXACT COMPARISON AND NOT `upper(...) = 'CA'`
--
-- Because the CHECK constraints above make the stored form canonical, so an exact
-- comparison is sound. `upper(btrim(...))` in the predicate would be belt-and-braces
-- that hides a data-quality bug rather than surfacing it: the same 'ca' would then
-- work here and break every other query written against the column. The dependency
-- is real and it is stated: if a future migration ever lowercases these values, it
-- must update `ccpa_applicable()` in the same change. The suite asserts the
-- constraint, the function and the two together, so the dependency fails loudly
-- rather than silently under-applying.
--
-- WHAT THIS DOES NOT COVER — THE GDPR EXTRATERRITORIAL LEG, AND IT IS NOT AN
-- ADDRESS CHECK
--
-- GDPR Art. 3(2) reaches a controller outside the Union that OFFERS GOODS OR
-- SERVICES TO PERSONS IN THE UNION. A company with no EU address at all is still in
-- scope, and NO predicate over `company_addresses` can detect it — there is no row
-- to find. That case closes through the USER'S OWN DECLARATION leg: the person says
-- where they are, `users.region_code` and `users.geo_source` record it, and the
-- assessment is made from that row rather than from the operator's.
--
-- Stated here because the failure mode of a compliance table is that somebody later
-- reads `ccpa_applicable()` and concludes that geographic scope is a solved problem
-- in this schema. It is not. This file answers exactly one question — "does the
-- company hold an address in California" — and the extraterritorial question is
-- answered by a different leg that does not exist yet and must not be faked by
-- widening this one.
-- =============================================================================

-- =============================================================================
-- WHAT THIS MIGRATION DOES NOT DELIVER — AND IT IS THE WHOLE LIST
-- =============================================================================
--   * It does not seed a company. `database/seed.ts` is the other owner of this data
--     and this file writes none, because a seed row with a placeholder legal name is
--     a placeholder that ships (§2.1). A fork fills it in through the admin path, or
--     `ccpa_applicable()` answers `false` because there is no address — which is a
--     correct answer to the question the database can actually answer.
--   * It does not grant any capability. CRUD over these two tables is a GRANT, which
--     is what §B2 §Operation ships for `projects`, `customers` and
--     `email_messages`; no policy here calls `has_permission()`, so no permission row
--     is needed and none is invented. The day a page gate needs one, it is a new
--     `resource:action` row AND a grant in `database/seed.ts`, in both.
--   * It does not render anything. The about page, the footer and the privacy
--     notice read these tables; writing those components is frontend work that
--     consumes the generated client.
--   * It does not decide whether GDPR applies, and the paragraph above says why it
--     cannot.

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
-- PostgREST caches the schema. Two tables and an RPC function created after startup
-- are invisible to a server started before this file ran, and the symptom is a 404
-- with nothing in it — "the template is broken", reported by the first person to run
-- it.
--
-- The served spec (`openapi-mode = "ignore-privileges"`) gains both tables AND
-- `/rpc/ccpa_applicable`, so the generated Angular types carry the columns and the
-- call. `npm run generate:client` is a separate step this migration cannot perform:
-- it needs a live database and a PostgREST, neither of which a migration may assume.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0013_company_profile.down.sql. Kept as a separate file so
-- this one stays append-only, exactly as in 0001–0012.
--
-- ROLLING THIS BACK MAKES A STATUTORY QUESTION UNANSWERABLE, which is the one thing
-- to read first. The down script drops `ccpa_applicable()` and both tables, so
--
--   * `/rpc/ccpa_applicable` 404s, and a frontend still calling it either fails the
--     request or — worse, depending on the client's error handling — renders nothing
--     and reports success;
--   * the addresses are gone, so even a re-application cannot reconstruct WHERE the
--     company was on the day a request was handled;
--   * the about page, the contact footer and the terms of service lose their
--     content, and nothing in this tree holds a second copy of it.
--
-- Verify the rollback from the catalog —
--
--   SELECT to_regclass('public.company_profile'), to_regclass('public.company_addresses');
--   SELECT proname FROM pg_proc WHERE proname = 'ccpa_applicable';
--
-- — returning NULLs and zero rows is the check, and a `migration:revert` exit code is
-- not: it reports that the script ran, not that losing the record was acceptable.
