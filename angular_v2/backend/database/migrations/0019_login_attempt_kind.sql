-- =============================================================================
-- 0019_login_attempt_kind.sql
--
-- Which route produced a `login_attempts` row.
-- Target: PostgreSQL 18+, applied as the migration/owner role (`app`).
--
-- =============================================================================
-- WHY THIS COLUMN EXISTS — THE DEFECT IT CLOSES
-- =============================================================================
--
-- `0002` created `login_attempts` as "one row per login POST, pass or fail". That
-- was true, and it stopped being true the moment a SECOND unauthenticated route
-- needed the same brute-force gate: a password-reset request, a registration, a
-- verification resend. Every one of those routes answers the same question the
-- table was built to answer — *how much unproven credential pressure is this
-- requester exerting?* — and the table had no way to say whose attempts it was
-- counting.
--
-- The two ways that gap closes are both bad:
--
--   * **One shared counter, undivided.** Then five reset requests from one subnet
--     delay that subnet's LOGINS, and five failed logins delay that subnet's
--     reset requests. An unauthenticated party spends one budget in two currencies
--     and can therefore lock out an office's sign-in page with five HTTP requests
--     that never touch a credential. §B6 accepts IP-subnet delay as the cost of
--     the login gate; it does not accept the cost being payable in a currency the
--     victim never spent.
--
--   * **A second table.** Two counters, two sets of queries, two places a
--     threshold is read, and nothing stopping them drifting apart. §2.4: duplicated
--     mechanisms are the main source of drift in this codebase's history.
--
-- So the answer is one column: the SAME rows, the SAME pure decision functions
-- (`delayForFailures` / `isBlocked`), the SAME `SECURITY_*` thresholds, and a
-- discriminator that makes each counter see only its own rows.
--
-- =============================================================================
-- THE VALUE VOCABULARY, AND WHY IT IS CONSTRAINED
-- =============================================================================
--
--   'login'        — a `POST /auth/login`. The historical meaning.
--   'token_request' — a request for a one-time-token link:
--                      `POST /auth/password-reset/request` OR
--                      `POST /auth/email-verification/request`.
--
-- **ONE value for both routes, on purpose.** A reset link and a verification link
-- are the same act aimed at the same mailbox: "send this address something". If
-- they drew on separate budgets then bombing a victim took two budgets instead of
-- one, and the limit that matters — how many mails one address can pull out of
-- this service in a window — would be set by the attacker choosing which endpoint
-- to call. One counter answers one question: how much mail is this requester
-- having sent.
--
-- The CHECK is the load-bearing part, and it exists because the dangerous failure
-- is **fail-open, not fail-closed**: a row carrying a value nothing matches is
-- invisible to every counter, so an unknown value means *no rate limit at all* and
-- nothing anywhere reports it. A typo in this vocabulary would silently turn the
-- email-bombing control off, which is why it is a constraint and not a comment.
--
-- =============================================================================
-- WHAT `status` MEANS ON A NON-LOGIN ROW, STATED RATHER THAN GLOSSED
-- =============================================================================
--
-- `status` is `CHECK (status IN ('failed', 'succeeded'))` since `0002`, and it is
-- a CREDENTIAL vocabulary: it records whether a password check passed. A reset
-- request has no credential to get wrong, so neither value is literally true.
--
-- Every `token_request` row therefore carries `'failed'`, for a reason
-- that is a property of the counting rule and not of the request:
--
--   * the counter reads `attempt_kind = 'token_request' AND status = 'failed'`; and
--   * the counter must count ATTEMPTS, because a request that is admitted has to
--     count against the next one or the limit is never reached.
--
-- Had admitted rows been written as `'succeeded'`, the counter's own
-- `created_at > last 'succeeded'` reset would clear itself on every request and
-- the gate would never trip — a rate limit that passes everything. `'failed'` is
-- the only value in the CHECK that keeps the count monotonic, and
-- `attempt_kind` is what keeps the two populations from meeting.
--
-- `status` is NOT widened. A third value would push the same decision into every
-- reader of the table and buy nothing: the discriminator that answers "whose
-- attempt is this?" is the column this migration adds.
--
-- =============================================================================
-- THE COLUMN ITSELF
-- =============================================================================
--
-- `NOT NULL DEFAULT 'login'`: every row that exists today is a login attempt, so
-- the default backfills the historical population correctly and an INSERT from an
-- old caller — including the `succeeded` row the brute-force suite writes to reset
-- a penalty — is classified without being touched. `ADD COLUMN IF NOT EXISTS`
-- rather than a plain `ADD COLUMN`, because a migration is applied to databases
-- that may already carry it.
--
-- NO INDEX. The counter's leading predicate is `attempt_kind`, but every query
-- that reads it is already bounded by `ip_subnet` (indexed by `0003`) or by
-- `username` (indexed by `0002`) plus a `created_at` window. A ninth index on the
-- hot table is a write cost bought for a lookup that already has one.
--
-- NO GRANT CHANGES. `app_admin` holds `SELECT, INSERT, UPDATE` on the table
-- (`0002`, widened by `0003`); a new column on an existing table needs no new
-- verb, and no serving role may read these rows at all.
--
-- NO RLS CHANGES. Same posture, same policy, same reason: the thin app reaches
-- this table only as `pgrst_authenticator` + `SET LOCAL ROLE app_admin`.

ALTER TABLE public.login_attempts
  ADD COLUMN IF NOT EXISTS attempt_kind text NOT NULL DEFAULT 'login';

-- =============================================================================
-- THE CHECK — ONE `DO` BLOCK, BECAUSE ONE BLOCK IS THE ATOMIC UNIT
-- =============================================================================
--
-- Two rules, both learned the hard way in this repository:
--
--   1. **An inline `CHECK` inside `ADD COLUMN IF NOT EXISTS` is skipped whenever the
--      column already exists.** The statement succeeds, the constraint is never
--      created, and the database looks disciplined. So the constraint is its own
--      statement.
--   2. **Add and validate share one block.** A `DO` block is a single statement,
--      so an exception escaping it rolls back everything it did. Split, the
--      `ADD CONSTRAINT … NOT VALID` would commit on its own and leave the table
--      carrying a constraint that is enforced for new writes and never validated
--      against the rows that already exist — enforced *looking*, verified by
--      nothing.
--
-- Idempotent by conname AND conrelid, following `0008`: matching on the name alone
-- would be wrong the moment a second table grew an identically named constraint,
-- which is exactly the "constraint already exists" failure on a database that does
-- not have one.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'login_attempts_attempt_kind_check'
       AND conrelid = 'public.login_attempts'::regclass
  ) THEN
    ALTER TABLE public.login_attempts
      ADD CONSTRAINT login_attempts_attempt_kind_check
      CHECK (attempt_kind IN ('login', 'token_request')) NOT VALID;
    ALTER TABLE public.login_attempts
      VALIDATE CONSTRAINT login_attempts_attempt_kind_check;
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0019_login_attempt_kind.down.sql. Kept as a separate
-- file so this one stays append-only, exactly as in 0001–0018.