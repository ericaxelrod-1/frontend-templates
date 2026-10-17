-- =============================================================================
-- 0022_security_telemetry.sql
--
-- The security-monitoring tables the admin pages read.
-- Target: PostgreSQL 18+, applied as the migration/owner role (`app`).
--
-- =============================================================================
-- WHY THESE TABLES ARE BEING ADDED NOW
-- =============================================================================
--
-- §B6 requires security alerts to persist to the database, IP reputation to exist
-- as a secondary signal, and captcha to be verified server-side against a stored
-- answer. None of that had a table: the shipped `public` schema held
-- `login_attempts` and nothing else, so all three requirements were documented
-- and unimplemented. The five `modules/admin/` pages had nothing to read.
--
-- These are the EVENT tables only — telemetry the system records. The other half
-- of the legacy schema is deliberately NOT recreated here; see the section on
-- what was left out and why.
--
-- =============================================================================
-- WHAT IS DELIBERATELY NOT CREATED, AND WHY
-- =============================================================================
--
-- `angular/docs/DATABASE_SCHEMA.md` is the SQLite design (its own line 35: "a
-- clear structure primarily for SQLite"). It contains eleven tables that have no
-- meaning in PostgreSQL, and adding them would be the exact §2.1 failure this
-- repository keeps hitting — a populated table that reads like a working
-- mechanism and is not one:
--
--   rls_rules, rls_join_paths, rls_join_conditions, rls_scope_templates
--     SQLite has no row-level security, so tenant isolation required keeping the
--     predicate AS DATA (`rls_rules.sql` = a WHERE clause) and having the
--     application append it to every query — RLS enforced in application code.
--     PostgreSQL enforces it in `0001_rls_foundation.sql`, below the application.
--     These tables would be a second, inert RLS mechanism beside the real one
--     (§2.4), and a mockable row here is worse than useless: a row in `rls_rules`
--     is a CLAIM about what governs a tenant's data. `is_mock = true` on it would
--     assert a predicate that governs nothing.
--
--   user_permissions, group_permissions
--     Both carry `is_granted boolean`, and `is_granted = false` IS a deny.
--     §B2 forbids denies, per-user grants and precedence rules outright.
--
--   ui_components, frontend_routes, api_endpoints, cache_components,
--   cache_routes, cache_endpoints (and their four permission join tables)
--     "Dynamic permission management for UI components, frontend routes and API
--     endpoints". Real table grants and real route guards replaced all of it; a
--     `frontend_routes` table listing which routes need which permission is the
--     application re-implementing its own router.
--
--   resources
--     Left empty by the document itself. `permissions.resource_name` carries it.
--
-- The legacy RLS *pages* are not thereby abandoned. They become the surfaces that
-- actually change enforcement — group membership (scope) and role assignment
-- (capability) — plus a read-only inspector over `pg_policies`.
--
-- =============================================================================
-- ACCESSIBILITY: ADMIN ONLY, ON EVERY TABLE HERE
-- =============================================================================
--
-- `login_attempts` set the precedent in `0002` and this migration follows it:
-- `GRANT SELECT, INSERT ON public.login_attempts TO app_admin`, with no
-- `app_member` at all, behind `USING (current_user = 'app_admin')`.
--
-- That is not an oversight to be tidied up later. These tables hold IP addresses,
-- the usernames people FAILED to log in as, and blocked-until timestamps. Grant a
-- member `SELECT` and they can enumerate which accounts exist by watching for
-- failed rows — an account-enumeration oracle built out of the security log. §B5
-- already refuses a policy suite that only asserts denials rather than a
-- capability this cheap.
--
-- Every policy below is therefore keyed on `current_user`, never on the `role`
-- claim: a caller who forges `"role": "app_admin"` into their own validly-signed
-- token reads nothing here.
--
-- =============================================================================
-- IP ADDRESSES ARE STORED THE WAY `0003` ALREADY ESTABLISHED
-- =============================================================================
--
-- Three columns, not one: the raw `ip` as received, `ip_normalized` (the canonical
-- host, so `1.2.3.4`, `::ffff:1.2.3.4` and `01.2.3.4` group as one host), and
-- `ip_subnet` (the /64 for IPv6, the normalized host for IPv4) for aggregation.
-- `0003_login_attempt_ip_keys.sql` introduced exactly this triple on
-- `login_attempts` because the brute-force counters group by the canonical
-- address. Reusing the shape is §2.4; a table that keyed on the raw string would
-- give the IP-reputation page a rotation-evading count the login counters already
-- refuse to produce.
--
-- The canonicalisation itself stays in the application (`src/auth/ip-address.ts`).
-- That is deliberate and it is why these columns are `text` and not `inet`:
-- PostgreSQL's `inet` treats `::ffff:1.2.3.4` and `1.2.3.4` as two DIFFERENT
-- addresses. So an `inet` column here would look like it was enforcing identity
-- while actually only validating syntax, and would reintroduce exactly the
-- IPv4-mapped ambiguity the triple exists to remove. The database must not be
-- asked to canonicalise identity here; it cannot, and it would fail silently.
--
-- =============================================================================
-- `is_mock` — TEST ROWS IN THE SAME TABLES, NOT A SEPARATE FIXTURE DATABASE
-- =============================================================================
--
-- One column, `NOT NULL DEFAULT false`, so the admin pages have data to render
-- and an operator can exclude synthetic rows in one predicate.
--
-- It is a DISPLAY FILTER, and that is the whole of its job. No policy and no
-- function in this migration reads it, and none may: a synthetic alert that
-- reached a risk score or a block decision would be an outage nobody could
-- explain. That is the same separation the breaker in `src/breaker/` keeps
-- between its meter and its dispatch gate.
--
-- There is deliberately no trigger preventing application code from writing one.
-- See the `is_mock` section at the end of this file for why, and for the test
-- that owes the invariant.
-- =============================================================================

-- =============================================================================
-- `ip_reputation` — per-address standing, the secondary signal of §B6
-- =============================================================================
--
-- One row per canonical host, so the score is a property of the host rather than
-- of whichever spelling arrived. `reputation_score` is a plain `numeric` left
-- deliberately unconstrained by a scale: §B6 requires every threshold to come from
-- config, and a CHECK here would put a hard-coded 0..100 boundary into the schema
-- that the configuration would then be free to contradict.
CREATE TABLE IF NOT EXISTS public.ip_reputation (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  ip                    text        NOT NULL,
  ip_normalized         text        NOT NULL,
  ip_subnet             text,
  status                text        NOT NULL DEFAULT 'good',
  reputation_score      numeric     NOT NULL DEFAULT 100,
  failed_attempts       integer     NOT NULL DEFAULT 0,
  captcha_required_count integer    NOT NULL DEFAULT 0,
  is_blocked            boolean     NOT NULL DEFAULT false,
  blocked_until         timestamptz,
  geo_location          jsonb,
  statistics            jsonb,
  block_history         jsonb,
  metadata              jsonb,
  is_mock               boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ip_reputation_status_check
    CHECK (status IN ('good', 'suspicious', 'bad')),
  CONSTRAINT ip_reputation_blocked_shape_check
    CHECK (is_blocked OR blocked_until IS NULL),
  CONSTRAINT ip_reputation_counts_nonneg_check
    CHECK (failed_attempts >= 0 AND captcha_required_count >= 0)
);

-- WHAT THIS UNIQUE DOES AND DOES NOT DO, because the first draft of this comment
-- got it wrong and testing caught it.
--
-- It guarantees ONE ROW PER CANONICAL VALUE **AS WRITTEN**. It does not enforce
-- canonicalisation, and cannot: measured, three un-normalised spellings of one
-- address (`1.2.3.4`, `::ffff:1.2.3.4`, `01.2.3.4`) all insert cleanly, because
-- they are three distinct strings.
--
-- Canonicalisation is the APPLICATION's contract, exactly as on `login_attempts`:
-- `backend/src/auth/ip-address.ts` writes the normalised host and the service
-- never hands this table an un-normalised one. That is the same trust arrangement
-- `0003_login_attempt_ip_keys.sql` established, and the database deliberately
-- does not duplicate it — see the note on `inet` in the IP ADDRESSES section
-- above for why the database could not do it correctly even if it tried.
CREATE UNIQUE INDEX IF NOT EXISTS ip_reputation_normalized_key
  ON public.ip_reputation (ip_normalized);
CREATE INDEX IF NOT EXISTS ip_reputation_blocked_idx
  ON public.ip_reputation (is_blocked, blocked_until);
CREATE INDEX IF NOT EXISTS ip_reputation_subnet_idx
  ON public.ip_reputation (ip_subnet);
CREATE INDEX IF NOT EXISTS ip_reputation_status_idx
  ON public.ip_reputation (status);

-- =============================================================================
-- `security_detected_patterns` — a detected shape over a time window
-- =============================================================================
--
-- `time_window_end >= time_window_start` is the CHECK that matters: the window is
-- the only thing that bounds the pattern, and an inverted window would make every
-- duration query over the table meaningless while still returning rows.
CREATE TABLE IF NOT EXISTS public.security_detected_patterns (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  pattern_type         text        NOT NULL,
  severity             text        NOT NULL DEFAULT 'medium',
  ip                   text,
  ip_normalized        text,
  ip_subnet            text,
  detection_timestamp  timestamptz NOT NULL DEFAULT now(),
  time_window_start    timestamptz NOT NULL,
  time_window_end      timestamptz NOT NULL,
  attempt_count        integer     NOT NULL DEFAULT 0,
  unique_email_count   integer     NOT NULL DEFAULT 0,
  evidence             jsonb       NOT NULL,
  status               text        NOT NULL DEFAULT 'active',
  resolved_at          timestamptz,
  resolved_by          uuid        REFERENCES public.users (id) ON DELETE SET NULL,
  resolution_notes     text,
  metadata             jsonb,
  is_mock              boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_detected_patterns_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT security_detected_patterns_status_check
    CHECK (status IN ('active', 'resolved', 'dismissed')),
  CONSTRAINT security_detected_patterns_window_check
    CHECK (time_window_end >= time_window_start),
  CONSTRAINT security_detected_patterns_counts_nonneg_check
    CHECK (attempt_count >= 0 AND unique_email_count >= 0),
  -- A pattern that is not active must say when it stopped being active. Without
  -- this, `status = 'dismissed'` with a NULL `resolved_at` is indistinguishable
  -- from one dismissed a moment ago, and a report of "open patterns" cannot be
  -- reconciled against the timeline.
  CONSTRAINT security_detected_patterns_resolution_check
    CHECK (status = 'active' OR resolved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS security_detected_patterns_type_idx
  ON public.security_detected_patterns (pattern_type);
CREATE INDEX IF NOT EXISTS security_detected_patterns_severity_idx
  ON public.security_detected_patterns (severity);
CREATE INDEX IF NOT EXISTS security_detected_patterns_status_idx
  ON public.security_detected_patterns (status, detection_timestamp DESC);
CREATE INDEX IF NOT EXISTS security_detected_patterns_subnet_idx
  ON public.security_detected_patterns (ip_subnet);

-- =============================================================================
-- `pattern_login_attempts` — the evidence behind a pattern
-- =============================================================================
--
-- The join is its own table because the forensic question is "which attempts
-- prove this pattern", and `is_primary_evidence` is a property of the PAIR, not
-- of either end. A column on `login_attempts` could not answer it.
CREATE TABLE IF NOT EXISTS public.pattern_login_attempts (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  pattern_id          uuid NOT NULL
    REFERENCES public.security_detected_patterns (id) ON DELETE CASCADE,
  login_attempt_id    uuid NOT NULL
    REFERENCES public.login_attempts (id) ON DELETE CASCADE,
  is_primary_evidence boolean     NOT NULL DEFAULT false,
  is_mock             boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pattern_login_attempts_pair_key
    UNIQUE (pattern_id, login_attempt_id)
);

CREATE INDEX IF NOT EXISTS pattern_login_attempts_attempt_idx
  ON public.pattern_login_attempts (login_attempt_id);
CREATE INDEX IF NOT EXISTS pattern_login_attempts_primary_idx
  ON public.pattern_login_attempts (pattern_id) WHERE is_primary_evidence;

-- =============================================================================
-- `security_alerts` — what an operator acts on (§B6: alerts persist)
-- =============================================================================
--
-- `pattern_id` is `ON DELETE SET NULL`, and this departs from the legacy schema's
-- `ON DELETE CASCADE` deliberately. An alert is the record of something an
-- operator was told; cascading would delete that record whenever the pattern it
-- derived from was pruned, which is precisely the row somebody would later need
-- to answer "why did we block this address on the 3rd?".
CREATE TABLE IF NOT EXISTS public.security_alerts (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  alert_type       text        NOT NULL,
  severity         text        NOT NULL DEFAULT 'medium',
  title            text        NOT NULL,
  message          text        NOT NULL,
  source           text        NOT NULL DEFAULT 'system',
  pattern_id       uuid        REFERENCES public.security_detected_patterns (id) ON DELETE SET NULL,
  ip               text,
  ip_normalized    text,
  ip_subnet        text,
  user_id          uuid        REFERENCES public.users (id) ON DELETE SET NULL,
  status           text        NOT NULL DEFAULT 'active',
  acknowledged_at  timestamptz,
  acknowledged_by  uuid        REFERENCES public.users (id) ON DELETE SET NULL,
  resolved_at      timestamptz,
  resolved_by      uuid        REFERENCES public.users (id) ON DELETE SET NULL,
  resolution_notes text,
  alert_data       jsonb,
  expires_at       timestamptz,
  is_mock          boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_alerts_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT security_alerts_source_check
    CHECK (source IN ('system', 'manual', 'api')),
  CONSTRAINT security_alerts_status_check
    CHECK (status IN ('active', 'acknowledged', 'resolved', 'dismissed')),
  -- Same reasoning as the pattern's resolution CHECK, and the same reason it is
  -- NOT `status <> 'active' OR acknowledged_at IS NOT NULL`: an alert can be
  -- RESOLVED without ever having been acknowledged, and demanding the
  -- acknowledgement stamp for a resolution would make that unrepresentable.
  CONSTRAINT security_alerts_resolution_check
    CHECK (status NOT IN ('resolved', 'dismissed') OR resolved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS security_alerts_status_created_idx
  ON public.security_alerts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS security_alerts_severity_idx
  ON public.security_alerts (severity);
CREATE INDEX IF NOT EXISTS security_alerts_type_idx
  ON public.security_alerts (alert_type);
CREATE INDEX IF NOT EXISTS security_alerts_pattern_idx
  ON public.security_alerts (pattern_id);
CREATE INDEX IF NOT EXISTS security_alerts_subnet_idx
  ON public.security_alerts (ip_subnet);
CREATE INDEX IF NOT EXISTS security_alerts_user_idx
  ON public.security_alerts (user_id);
-- The expiry sweep reads only the rows that have not expired. A partial index
-- makes that sweep proportional to the outstanding set rather than to the whole
-- alert history, which is the set that grows without bound.
CREATE INDEX IF NOT EXISTS security_alerts_unexpired_idx
  ON public.security_alerts (expires_at) WHERE expires_at IS NOT NULL;

-- =============================================================================
-- `captcha` — server-side challenge verification (§B6)
-- =============================================================================
--
-- DEVIATION FROM THE LEGACY SCHEMA, AND IT IS THE POINT OF THIS TABLE.
--
-- `angular/docs/DATABASE_SCHEMA.md` specifies `token`, `challenge` AND `solution`
-- as plaintext columns. That stores the answer next to the question in a table an
-- administrator can read, and it means a single read of this table is a captcha
-- oracle — the whole mechanism is defeated by whoever can `SELECT`.
--
-- This table stores NO answer and NO usable token:
--
--   * `token_hash` — SHA-256 of the token handed to the client. Verification
--     hashes the presented token and looks it up, so a dump of this table cannot
--     be replayed. This is the same shape `refresh_tokens.token_hash` already uses
--     in `0002`, and for the same reason.
--   * `solution_hash` — SHA-256 of the expected answer, with a per-row salt so two
--     challenges with the same answer do not share a digest. A challenge is
--     low-entropy by construction (a short code an unauthenticated person must
--     read off a screen), so an unsalted digest of it is itself crackable in
--     bulk; that is the reason for the salt rather than taste.
--
-- The plain `challenge` column from the legacy schema survives as the text shown
-- to the person, which is not a secret — it is the question.
--
-- THIS TABLE IS THE STORAGE HALF OF AN UNIMPLEMENTED REQUIREMENT. §B6 requires
-- that "captcha is validated server-side: the server issues a challenge, stores
-- the answer, and verifies it". The storage half is here. The logic half is NOT:
-- nothing in `backend/src/` issues a challenge or verifies one. This table must
-- not be read as §B6 being satisfied — the issuer and the verifier are owed, and
-- the columns below are shaped for them rather than proven against them.
--
-- `used_at` is separate from `is_used` because "used" alone cannot answer "used
-- when", and a single-use guarantee is unenforceable on a boolean that does not
-- record the moment it flipped: two replays in the same instant are
-- indistinguishable from one. The redemption path must be
-- `UPDATE … SET is_used = true, used_at = now() WHERE id = $1 AND is_used = false`
-- and assert one row, which is what makes single-use a property of the write
-- rather than a hope about the read.
CREATE TABLE IF NOT EXISTS public.captcha (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  type         text        NOT NULL DEFAULT 'text',
  token_hash   text        NOT NULL,
  challenge    text        NOT NULL,
  solution_salt text       NOT NULL,
  solution_hash text       NOT NULL,
  is_used      boolean     NOT NULL DEFAULT false,
  used_at      timestamptz,
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           text,
  ip_normalized text,
  ip_subnet    text,
  metadata     jsonb,
  is_mock      boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT captcha_type_check CHECK (type IN ('text', 'image')),
  CONSTRAINT captcha_window_check CHECK (expires_at > issued_at),
  -- Same single-use argument as `used_at` above, made structural.
  CONSTRAINT captcha_used_shape_check
    CHECK ((is_used AND used_at IS NOT NULL) OR (NOT is_used AND used_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS captcha_token_hash_key
  ON public.captcha (token_hash);
CREATE INDEX IF NOT EXISTS captcha_expiry_idx
  ON public.captcha (expires_at);

-- ROW-LEVEL SECURITY — ENABLE and FORCE on all five, without exception
-- =============================================================================
--
-- `FORCE` because a table owner bypasses its own policies and Postgres reports
-- nothing when it does (§B2). None of these five is in the `groups` /
-- `user_groups` exception list, and none should be: no refresh runs as their
-- owner and no request role owns them.
--
-- One policy per table, keyed on `current_user` — never on the `role` claim, which
-- a caller can forge into their own validly-signed token. Split per verb for the
-- reason `0013` gives: a `FOR ALL` policy beside a read policy would let the read
-- predicate govern writes, and `pg_policies` would then understate the table.
ALTER TABLE public.ip_reputation              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ip_reputation              FORCE ROW LEVEL SECURITY;
ALTER TABLE public.security_detected_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_detected_patterns FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pattern_login_attempts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pattern_login_attempts     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.security_alerts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_alerts            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.captcha                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.captcha                    FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS row_scope ON public.ip_reputation;
DROP POLICY IF EXISTS row_scope ON public.security_detected_patterns;
DROP POLICY IF EXISTS row_scope ON public.pattern_login_attempts;
DROP POLICY IF EXISTS row_scope ON public.security_alerts;
DROP POLICY IF EXISTS row_scope ON public.captcha;

CREATE POLICY row_scope ON public.ip_reputation              USING (current_user = 'app_admin');
CREATE POLICY row_scope ON public.security_detected_patterns USING (current_user = 'app_admin');
CREATE POLICY row_scope ON public.pattern_login_attempts     USING (current_user = 'app_admin');
CREATE POLICY row_scope ON public.security_alerts            USING (current_user = 'app_admin');
CREATE POLICY row_scope ON public.captcha                    USING (current_user = 'app_admin');

-- =============================================================================
-- GRANTS — default deny, then admin only. No `app_member`, no `app_anon`.
-- =============================================================================
--
-- `REVOKE ALL` FIRST, then the verbs: each grant narrows something the revoke has
-- already taken away, so deleting a grant later leaves no privilege behind.
--
-- `app_anon` GETS NOTHING, not even a read grant, and that is the point rather
-- than an oversight: §B2 warns that a policy which ERRORS instead of denying is a
-- DoS surface and an oracle. The cheapest way to be certain `app_anon` is refused
-- is for it to hold no grant at all, which is a `42501` at the grant rather than a
-- zero-row result computed through five policies.
--
-- WRITES ARE `app_admin` because the system itself writes these rows: detection
-- and the alert pipeline run as the superset principal, which owns nothing here.
-- The legacy `POST /alerts/:id/acknowledge` shape is an operator action on a row
-- an `app_admin` already has `UPDATE` on, so it needs no additional mechanism.
--
-- NO `TRUNCATE` FOR ANY SERVING ROLE. It is closed by the grants, not by a policy,
-- because `TRUNCATE` fires no row trigger and a policy cannot see it.
REVOKE ALL ON
  public.ip_reputation,
  public.security_detected_patterns,
  public.pattern_login_attempts,
  public.security_alerts,
  public.captcha
  FROM PUBLIC, app_anon, app_member, app_admin;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.ip_reputation,
  public.security_detected_patterns,
  public.pattern_login_attempts,
  public.security_alerts,
  public.captcha
  TO app_admin;

-- =============================================================================
-- `is_mock` — A DISPLAY FILTER, AND NOT A FABRICATION GUARD
-- =============================================================================
--
-- An earlier draft of this migration carried a `BEFORE INSERT OR UPDATE` trigger
-- that refused any row with `is_mock = true` unless the session had set the GUC
-- `app.allow_mock_rows`, so that only the seed could write one. It has been
-- REMOVED, and the reason is worth recording so the next agent does not helpfully
-- put it back:
--
--   * IT WAS A GUARD AND NOT A SECURITY BOUNDARY. It keyed on a custom GUC, and
--     §B2 F1 records that any role may `SET` one — so it stopped nothing
--     deliberate. Its own comment had to admit as much, which is the tell.
--   * IT GUARDED THE WRONG THING. The risk that actually mattered is a mock row
--     being READ by risk scoring or a block decision. The trigger did nothing
--     about that; it only stopped fabrication.
--   * IT ADDED A CONFUSING FAILURE. Any insert with `is_mock = true` died with
--     SQLSTATE 42501, which reads like a permissions problem at the worst
--     possible moment.
--
-- THE INVARIANT IS NOW OWED AS A TEST, not as a trigger: no POLICY and no FUNCTION
-- may read `is_mock`. That test is not written yet, and until it is, the
-- invariant holds only because nothing reads the column — which is the state
-- this migration leaves it in, deliberately stated rather than implied.
--
-- `is_mock` is a display filter. Nothing in this file reads it.

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0022_security_telemetry.down.sql. Kept as a separate
-- file so this one stays append-only, exactly as in 0001–0021.
