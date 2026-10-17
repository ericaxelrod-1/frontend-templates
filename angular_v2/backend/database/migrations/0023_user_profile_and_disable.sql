-- =============================================================================
-- 0023_user_profile_and_disable.sql
--
-- The member's own name, and an account that can be switched off with a record of
-- who decided and why.
-- Target: PostgreSQL 18+, applied as the migration/owner role (`app`).
--
-- =============================================================================
-- WHAT THIS FILE IS: SEVEN COLUMNS, FIVE CONSTRAINTS, ONE TRIGGER, ONE INDEX,
-- ONE GRANT CHANGE, AND NOT ONE POLICY
-- =============================================================================
--
-- `users` is the identity table and it is UNSCOPED (AGENTS.md §B2), FORCEd, and
-- granted column-by-column to `app_member` (`0008:465-466`, extended by `0012`). Two
-- things were missing from it, and they are different in kind:
--
--   * NOTHING to render a member's own name. `email` and `username` are login
--     credentials, not a person's name, and `0012`'s six geography columns answer
--     where somebody is — not what they are called. The self-service profile page
--     has nothing to display and the client must invent it, which is the shape
--     AGENTS.md §2.1 forbids.
--   * NOTHING to say an account is disabled. There is a login-attempt ledger
--     (`0002`) and a detection surface (`0022`), and no place in the schema that
--     records that an operator looked at a row and closed the account. A decision
--     with no row is a decision nobody can audit, and "who turned this account off
--     and why" is the first question an incident review asks.
--
-- These are seven NULLABLE columns. Nothing is backfilled and nothing is defaulted,
-- and the reason is the same one `0009` and `0017` give: a value nobody supplied must
-- not be asserted. NULL first_name is "nobody has stated their name", which is the
-- correct value for every existing row and for every member who declines to give one.
--
-- =============================================================================
-- WHAT THIS FILE DOES NOT DO — READ THIS BEFORE TRUSTING THE COLUMN NAMES
-- =============================================================================
--
--   * IT ENFORCES NOTHING. `disabled_at` records a decision; it does not enforce
--     one. No policy reads it, because RLS decides ROWS (§ the policies section
--     below), and nothing in `src/` reads it either — `backend/src` contains no
--     reference to `disabled_at`, `disabled_reason` or `last_login_at` at the time
--     this migration is written. The enforcement half is a check in the login path
--     (`src/auth/auth.service.ts` refusing an account whose `disabled_at IS NOT
--     NULL`), and until that check exists these columns are a RECORD, not a
--     CONTROL. Stated here rather than left to be discovered, because a column
--     named `disabled_at` in a schema is the most expensive kind of unfinished
--     thing: it reads as enforcement and is not (§2.1).
--   * IT WRITES NOTHING. Nothing writes `last_login_at` on a successful login yet,
--     so it is NULL for every row and will stay NULL until the login path writes
--     it. The login path should write it the way `authz.record_user_activity()`
--     writes `last_activity_at` (`0017:248`) — from the function's own `now()`,
--     never from a caller, so a caller cannot backdate or postdate its own sign-in.
--   * IT DOES NOT EMAIL ANYBODY. `disabled_reason = 'user_request'` records that
--     somebody asked to be disabled; it does not send a notification, and no
--     channel is stubbed here to pretend otherwise. §B6's notification channels are
--     opt-in application work, not a column.

-- =============================================================================
-- THE COLUMNS — TWO GROUPS, AND THE GROUPING IS THE DESIGN
-- =============================================================================
--
--   PROFILE DISPLAY DATA, which the SUBJECT may read:
--     first_name, last_name, last_login_at
--
--   ENFORCEMENT AND AUDIT STATE, which only an ADMINISTRATOR may read:
--     disabled_at, disabled_by, disabled_reason, disabled_until
--
-- The split is drawn in the grants below and nowhere else, and it is drawn because
-- `last_login_at` is the one column of the three that is NOT displayed on a profile
-- page — it is an audit fact about when a credential was last used, and §B6 counts
-- unproven credential pressure, which is exactly the population it belongs to. It
-- travels with the `disabled_*` group rather than with the name, and the reason it
-- is not in the member's column list is written out at the grant rather than left
-- to be inferred from the SQL.

-- THE NAME COLUMNS. `text`, not `varchar(n)`: the blank rule below is the whole of
-- the quality bar, a length limit would be a second, weaker, differently-shaped
-- rule, and a truncated name is a name that is silently wrong rather than refused.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_name  text;

COMMENT ON COLUMN public.users.first_name IS
  'The member''s given name as THEY state it. NULL means nobody has stated one — it is '
  'never derived from username or email and never defaulted. Blank and untrimmed values are '
  'refused by users_first_name_not_blank, because '' '' is an absent answer dressed as one and '
  '''CA '' is a right answer that will never compare equal to ''CA'' in the predicate that '
  'depends on it (the users_city_not_blank argument, 0012:151-157).';

COMMENT ON COLUMN public.users.last_name IS
  'The member''s family name, as THEY state it. Same rules and same CHECK shape as first_name: '
  'NULL when unstated, never defaulted, never blank, never untrimmed.';

-- WHEN A CREDENTIAL WAS LAST USED. Distinct from `last_activity_at` (`0017`), and the
-- distinction is not redundant: `last_activity_at` is what the application OBSERVED
-- (any authenticated request) and drives the dormant-account retention scan;
-- `last_login_at` is when the CREDENTIAL CHECK succeeded, which is the number a human
-- reads when asking "was this account in use last Tuesday?". One is written by a
-- broad observation hook, the other by the authentication path, and collapsing them
-- would let a broad activity signal overwrite an authentication fact.
--
-- NEVER BACKFILLED, and never indexed — see the index section for why.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

COMMENT ON COLUMN public.users.last_login_at IS
  'When this account last passed a CREDENTIAL check: NULL means no successful authentication has '
  'ever been recorded, which is NOT the same as never having signed in. Distinct from '
  'users.last_activity_at (0017), which is any observed activity. Never backfilled and never '
  'defaulted; the writing path supplies it from its own now(), never from a caller.';

-- =============================================================================
-- THE FOUR `disabled_*` COLUMNS — A DECISION, AND THE EVIDENCE FOR IT
-- =============================================================================
--
-- Four columns rather than one boolean, because "this account is off" and "who turned
-- it off, when, why, and until when" are four questions and a boolean answers one of
-- them while leaving the other three to a log somebody may rotate:
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

-- THE SELF-REFERENCE, AND WHY IT IS `ON DELETE SET NULL`
--
-- `disabled_by` names the ADMINISTRATOR who made the decision, which makes it a
-- pointer at another row of this same table. `ON DELETE SET NULL`, not CASCADE and
-- not NO ACTION, and the difference is a category rather than a preference:
--
--   * NOT `CASCADE`. This column is not a child row owned by the disabled account;
--     it is a pointer AT a person, and cascading would delete the disabled account
--     itself the moment the administrator's own row went away. Deleting the
--     administrator must not disable — or un-disable — anybody.
--   * NOT `NO ACTION` / `RESTRICT`. That refuses the DELETE of the administrator and
--     moves the guarantee into the erase path's code ("remember to clear
--     `disabled_by` first, in that order, in the same transaction") — the same
--     ordering contract `0008:130-148` rejects, for the same reason: it exists in
--     one place, in code nobody has read yet.
--
-- `SET NULL` is the third option and it is the correct one: deleting the
-- administrator leaves the disable standing and the actor unnamed. That is the
-- honest outcome — the decision still happened, the person who made it is gone — and
-- the constraint below is written to accept exactly that shape rather than to
-- refuse a delete in order to preserve an audit pointer.
--
-- The same `REFERENCES public.users (id) ON DELETE SET NULL` shape is what `0022`
-- already uses for `security_alerts.acknowledged_by`, `resolved_by` and `user_id`
-- (`0022:273-278`), for the same reason. Reusing it is AGENTS.md §2.4.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS disabled_by uuid REFERENCES public.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.users.disabled_by IS
  'The administrator row that made this decision, or NULL for an automated block. ON DELETE SET '
  'NULL: this is a pointer AT a person, not a row owned by the disabled account, so deleting an '
  'administrator must not cascade into anybody''s account — and must not be refused either, since '
  'an erasure that cannot complete leaves the erasure half-done. NULL actor is legal only when '
  'disabled_reason explains the decision (users_disabled_requires_actor_or_reason).';

-- THE REASON. `text` and CONSTRAINED, and the constraint is the load-bearing part:
-- a row carrying a value nothing matches is invisible to every reader of the column
-- and nothing anywhere reports it — the failure is silent, not loud, which is
-- precisely why the vocabulary belongs in a CHECK and not in a comment. This is the
-- `login_attempts_attempt_kind_check` argument (`0019:54-58`) applied to an audit
-- column: an unknown reason means "disabled by nobody, for no recorded reason", and
-- the query that would have noticed is the one that does not exist yet.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS disabled_reason text;

COMMENT ON COLUMN public.users.disabled_reason IS
  'WHY the account was disabled, from the closed vocabulary (''admin'', ''security'', ''compliance'', '
  '''user_request'') enforced by users_disabled_reason_check. The four are distinguishable '
  'deliberately: a temporary operator action, an automated security block, a statutory obligation, '
  'and a request by the data subject are four different conversations with the account holder, and a '
  'free-text field would collapse them into one indistinguishable string.';

-- THE END OF A TEMPORARY SUSPENSION. `timestamptz`, and NULL means "not temporary" —
-- the same NULL-is-a-real-answer rule the `deleted_at` pair uses (`0009:192-212`).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS disabled_until timestamptz;

COMMENT ON COLUMN public.users.disabled_until IS
  'When a TEMPORARY disable expires; NULL means the disable is not temporary and lasts until somebody '
  'lifts it. Nothing expires it automatically — a column with a timestamp in it is a record of when a '
  'suspension was meant to end, and a sweeper that acts on it is application work this file does not '
  'pretend to do. users_disabled_until_after_disabled_at keeps the two timestamps ordered.';

-- =============================================================================
-- THE CHECKS — ONE `DO` BLOCK EACH, AND WHY ONE BLOCK IS THE ATOMIC UNIT
-- =============================================================================
--
-- Two rules from `0019:111-131`, applied to each of the five constraints:
--
--   1. **An inline `CHECK` inside `ADD COLUMN IF NOT EXISTS` is skipped wholesale
--      whenever the column already exists.** The statement succeeds, the constraint
--      is never created, and the database looks disciplined. So every constraint is its
--      own statement.
--   2. **Add and validate share one block.** A `DO` block is a single statement, so
--      an exception escaping it rolls back everything it did. Split, the `ADD
--      CONSTRAINT … NOT VALID` would commit on its own and leave the table carrying a
--      constraint that is enforced for new writes and never validated against the
--      rows that already exist — enforced *looking*, verified by nothing.
--
-- Idempotent by conname AND conrelid, following `0008` and `0012`: matching on the
-- name alone would be wrong the moment a second table grew an identically named
-- constraint, which is exactly the "constraint already exists" failure on a database
-- that does not have one.
--
-- `NOT VALID` SKIPS THE SCAN AND `VALIDATE CONSTRAINT` PERFORMS IT, and on THIS
-- table the scan is cheap for a reason worth recording: all seven columns are NULL in
-- every pre-existing row, and every constraint below is written so that NULL passes.
-- The validation is therefore near-free here and still run — `NOT VALID` is about
-- not holding a lock for the scan, not about skipping it.
--
-- THE RESIDUAL THAT COMES WITH `ADD COLUMN IF NOT EXISTS`, stated rather than
-- hidden: the inline `REFERENCES` on `disabled_by` has the SAME fate as an inline
-- CHECK. On a database where `disabled_by` already existed WITHOUT the foreign key,
-- the `ADD COLUMN IF NOT EXISTS` skips the whole column specification and no foreign
-- key is created. Nothing in this file adds one separately, because the column is new
-- in this migration and is therefore created with its FK on every database that runs
-- it once. The state is only reachable on a database hand-edited outside the ledger,
-- and on such a database `pg_constraint` is where you would find out.

-- 1a. THE NAME IS NOT BLANK — the `users_city_not_blank` shape, character for character.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_first_name_not_blank'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_first_name_not_blank
      -- `= btrim(x) AND x <> ''` rejects '', ' ' and 'CA ' together: the first two
      -- are an absent answer dressed as one, and the third is a right answer that
      -- will never compare equal to 'CA' in the predicate that depends on it. NULL
      -- is accepted because NULL means "nobody stated a name" and the column is
      -- nullable on purpose.
      CHECK (first_name IS NULL OR (first_name = btrim(first_name) AND first_name <> '')) NOT VALID;
    ALTER TABLE public.users
      VALIDATE CONSTRAINT users_first_name_not_blank;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_last_name_not_blank'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_last_name_not_blank
      CHECK (last_name IS NULL OR (last_name = btrim(last_name) AND last_name <> '')) NOT VALID;
    ALTER TABLE public.users
      VALIDATE CONSTRAINT users_last_name_not_blank;
  END IF;
END
$$;

-- 2. A SUSPENSION ENDS AFTER IT BEGINS.
--
-- `users_disabled_until_after_disabled_at`, and the honest caveat is the reason this
-- comment is longer than the constraint: this predicate is only MEANINGFULLY
-- EVALUATED when `disabled_at` is also set. `disabled_until > disabled_at` where
-- `disabled_at IS NULL` yields NULL — and a CHECK passes on NULL, because a CHECK
-- constrains the rows that are FALSE, not the rows it cannot evaluate. So a row with
-- `disabled_until` set and `disabled_at` NULL satisfies this constraint and says
-- nothing. It is not redundant, it is the ordering that is checkable: the case it
-- catches is a typo in the other direction (an expiry stamped BEFORE the suspension
-- began, which would make a temporary disable already over before it was applied).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_disabled_until_after_disabled_at'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_disabled_until_after_disabled_at
      CHECK (disabled_until IS NULL OR disabled_until > disabled_at) NOT VALID;
    ALTER TABLE public.users
      VALIDATE CONSTRAINT users_disabled_until_after_disabled_at;
  END IF;
END
$$;

-- 3. A DISABLE CARRIES AN ACTOR OR A REASON. The same argument as
-- `0009`'s `users_deletion_reason_requires_deleted_at` (0009:211-214), and the
-- `OR` is deliberate and load-bearing:
--
-- An ADMINISTRATOR disable has a person; an AUTOMATED security block has none — there
-- is no row to point `disabled_by` at. If this demanded an actor, the automated path
-- would have to invent one, and inventing an administrator id to satisfy a CHECK is
-- how a fabricated audit trail gets written. So the disjunction: an unexplained
-- disable (neither actor nor reason) is refused, and a reason alone is a complete
-- explanation. `disabled_reason = 'security'` with no actor is a machine decision with
-- a stated cause; a disable with neither is a row nobody can explain later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_disabled_requires_actor_or_reason'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_disabled_requires_actor_or_reason
      CHECK (disabled_at IS NULL OR disabled_by IS NOT NULL OR disabled_reason IS NOT NULL) NOT VALID;
    ALTER TABLE public.users
      VALIDATE CONSTRAINT users_disabled_requires_actor_or_reason;
  END IF;
END
$$;

-- 4. THE CLOSED VOCABULARY. Named like its siblings (`users_deletion_reason_check`,
-- `users_geo_source_check`) so `pg_constraint` reads as one vocabulary family.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_disabled_reason_check'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_disabled_reason_check
      -- 'admin'         — an operator action, administrative rather than automatic.
      -- 'security'      — an automated block from the §B6 pipeline (0022 has no
      --                    person to name, which is what constraint 3 anticipates).
      -- 'compliance'    — a statutory obligation, and the only one of the four that
      --                    may survive the data subject asking to be forgotten.
      -- 'user_request'  — the account holder asked. Recorded as its own value because
      --                    "the subject requested erasure" and "an operator disabled
      --                    the account" are different facts with different
      --                    consequences, and a single 'admin' value would merge them.
      CHECK (disabled_reason IS NULL OR disabled_reason IN ('admin', 'security', 'compliance', 'user_request')) NOT VALID;
    ALTER TABLE public.users
      VALIDATE CONSTRAINT users_disabled_reason_check;
  END IF;
END
$$;

-- =============================================================================
-- THE TRIGGER — `username` IS IMMUTABLE, AND WHAT DEPENDS ON THAT
-- =============================================================================
--
-- NOT "usernames shouldn't change". Two things in this tree break, and one of them
-- silently:
--
--   * `login_attempts.username` IS A PLAIN `text` COLUMN WITH NO `user_id`. That is
--     deliberate and it is the right design: an attempt against a username that does
--     not exist must still be recorded, because an invalid username is both an
--     attack signal (something is guessing your accounts) and a debugging aid. A
--     `user_id NOT NULL` foreign key would make the ledger un-writable for exactly
--     the rows that matter most — the guesses — so the table is UNSCOPED
--     (`0002:86-99`), keyed by username, with an index on it (`0002:101`).
--     That design makes `username` the STABLE KEY for a VALID user's attempts: for
--     every row that corresponds to a real account, the username is the only thing
--     that joins the ledger to the person. A rename therefore splits one person's
--     login history across two keys — the pre-rename rows become unattributable and
--     the post-rename counter starts from zero, which is to say the §B6 per-account
--     failure counter is silently reset by a rename, and the reset is invisible
--     because both halves of it are valid rows in a table nobody reconciled.
--   * The self-service profile page reads a member's OWN login attempts by matching
--     their username, so a rename makes the page show an empty history for an
--     account with a long one — the worst possible answer, because it is a correct
--     answer to the question the wrong question was asked.
--
-- `IS DISTINCT FROM`, never `<>`. `<>` yields NULL when either side is NULL, and
-- NULL is not TRUE, so a `username` that went NULL — impossible today, since the
-- column is NOT NULL, but a future nullable change must not silently open the hole —
-- would pass an `<>` guard. `IS DISTINCT FROM` is NULL-safe and asks the question
-- this trigger means: "is the value different, including one of them being NULL".
--
-- `SECURITY INVOKER`, and it must stay that way: the function is a question about
-- the row being written and reads no table, so a DEFINER body would grant it
-- nothing and would only widen its surface (`0001:535-538`).
--
-- IT RETURNS `NEW`, NEVER `NULL`. A BEFORE row trigger that returns NULL causes the
-- operation to be SKIPPED for that row — so a guard written as `RETURN NULL` on the
-- refusal path would not refuse the write, it would silently drop it. This is the
-- quietest version of §2.3 available in trigger form: the UPDATE reports success and
-- the column is unchanged, with no error anywhere.
--
-- `SQLSTATE 55000`, NOT `42501`. `0022:474-476` records the objection to the other
-- choice on a non-permission refusal: "any insert with `is_mock = true` died with
-- SQLSTATE 42501, which reads like a permissions problem at the worst possible
-- moment." This refusal is not a permissions problem — the caller holds every verb on
-- this table — and an operator who reads 42501 will go looking at grants instead of
-- at the statement that rewrote a login key.
CREATE OR REPLACE FUNCTION authz.guard_username_immutable() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- THE ONE EXEMPTION, AND IT IS NOT A LOOPHOLE: a username may change as part of
  -- going INTO anonymisation and at no other time.
  --
  -- `ANONYMISE_SUBJECT_SQL` in `src/privacy/erasure.service.ts:83-93` rewrites
  -- `email`, `username` and `password_hash` together with `deleted_at` in ONE
  -- statement. A guard with no exemption fires on it and aborts RTBF erasure
  -- outright — verified, not hypothesised: the DSAR path is the single most
  -- consequential write in the system and this trigger would have broken it.
  --
  -- The exemption is the SAME transition test `0009:273-275` already uses in
  -- `authz.revoke_subject_authority`: the row must be entering anonymisation
  -- (`deleted_at` was NULL and is now set). So:
  --
  --   * erasure is permitted, because it is that transition;
  --   * a rename is refused, because it is not;
  --   * an UNDELETE (`deleted_at` set -> NULL) does NOT permit a rename, so a
  --     tombstone cannot be resurrected under a chosen name.
  --
  -- Rewriting username at erasure is what keeps `login_attempts` attributable:
  -- the tombstone name still matches the username the attempts recorded. That is
  -- why the exemption is narrower than "the erasure service may rename".
  IF NEW.username IS DISTINCT FROM OLD.username
     AND NOT (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION
      'users.username is immutable: % attempted to change it on user % (% -> %)',
      current_user, OLD.id, OLD.username, NEW.username
      USING ERRCODE = '55000',
            HINT = 'the only permitted writer is the DSAR anonymisation rewrite in
src/privacy/erasure.service.ts, recognised by the deleted_at IS NULL -> NOT NULL transition';
  END IF;

  RETURN NEW;
END
$$;

-- A trigger function is granted to NOBODY: it runs attached to the table as the
-- table owner and is never called directly. EXECUTE goes to PUBLIC on every new
-- function, so it is revoked — the same two lines `0009:284-288` uses, for the same
-- reason.
--
-- The general rule is "revoke AND grant, always together", because revoking from
-- PUBLIC while granting to nobody turns every scoped request into a `42501`
-- (`0008:338-342`). That rule does not apply here: no policy calls this function, so
-- there is no request whose evaluation can fail on a missing EXECUTE. Revoking and
-- granting to nobody IS the correct end state for a trigger function.
REVOKE EXECUTE ON FUNCTION authz.guard_username_immutable() FROM PUBLIC;

-- BEFORE, and not `UPDATE OF username`: `UPDATE OF username` fires when a statement
-- NAMES the column, and the erasure rewrite and any future client call are not the
-- only things that could carry a new value — a statement that sets the whole row
-- (`SELECT … INTO`, an upsert, a dump restore) would not name it and would sail
-- past. The cost of checking on every UPDATE is one NULL-safe comparison of two
-- values already in the row, on a table whose write rate is one row per sign-in
-- plus one per observed activity (`0017:248`).
--
-- `DROP TRIGGER IF EXISTS` first and `CREATE OR REPLACE FUNCTION` above, which is
-- what makes a second application a no-op rather than
-- `trigger "users_guard_username_immutable" for relation "users" already exists`.
DROP TRIGGER IF EXISTS users_guard_username_immutable ON public.users;

CREATE TRIGGER users_guard_username_immutable
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION authz.guard_username_immutable();

-- =============================================================================
-- VERIFIED AGAINST 0009: `authz.revoke_subject_authority` DOES NOT REWRITE USERNAME
-- =============================================================================
--
-- Checked rather than assumed, because the whole justification above is "this
-- trigger does not fight anything that already works". Read `0009_anonymisation.sql`
-- directly:
--
--   * `authz.revoke_subject_authority()` — the function body is `0009:267-281`: a
--     NULL-guard on `NEW.deleted_at` (`IF NEW.deleted_at IS NULL THEN RETURN NEW`)
--     and then exactly two `DELETE`s, `FROM public.user_groups` and
--     `FROM public.user_roles`. It assigns to nothing. There is no `SET username`,
--     no `NEW.username :=`, no reference to the column at all.
--   * Its trigger is `BEFORE UPDATE OF deleted_at, deletion_reason` (`0009:302-304`).
--     Column-scoped, so it is not even attached to a statement whose target list
--     mentions `username`.
--
-- So the anonymisation choke point and this guard do not overlap: 0009 removes
-- authority, this file forbids renaming. Neither writes the other's column.
--
-- =============================================================================
-- BUT THE THIRD WRITER IS NOT IN A MIGRATION, AND IT IS A COLLISION — READ THIS
-- =============================================================================
--
-- The DSAR erasure rewrites `username`, and it rewrites it from application code:
-- `ANONYMISE_SUBJECT_SQL` in `backend/src/privacy/erasure.service.ts:83-93` is
--
--     UPDATE users SET email = $2, username = $3, password_hash = $4,
--                      deleted_at = now(), deletion_reason = 'rtbf'
--      WHERE id = $1 AND deleted_at IS NULL
--
-- and `$3` is the tombstone username from `src/privacy/tombstone.ts`. That rewrite is
-- CORRECT and load-bearing: `login_attempts` is keyed by username, so the tombstone
-- is written to BOTH (`ANONYMISE_LOGIN_ATTEMPTS_SQL`, `erasure.service.ts:113-117`)
-- to preserve the forensic pairing of an erased subject's attempts.
--
-- **The trigger as specified above REFUSES that statement.** One `BEFORE UPDATE` on
-- `users` with no exemption fires on the erasure UPDATE, sees `username` change, and
-- raises — so an RTBF erasure aborts, and it aborts as an exception rather than as a
-- silent no-op, which is the good half of the news. This is recorded here, in the
-- file that causes it, because a migration that breaks the erasure path and does not
-- say so is exactly the "looks finished and isn't" shape reached through the schema.
--
-- There are two resolutions and this file does NOT pick one, because both are
-- security decisions about who may rename whom and neither belongs to a file that
-- does not own `src/`:
--
--   (a) Exempt the anonymisation transition. The shape already exists in this tree:
--       `0009:273-275` opens its own trigger with `IF NEW.deleted_at IS NULL THEN
--       RETURN NEW`, i.e. "only the transition INTO anonymisation does anything". The
--       equivalent here permits a `username` change exactly when `OLD.deleted_at IS
--       NULL AND NEW.deleted_at IS NOT NULL`. That is narrow — no ordinary profile
--       update may set `deleted_at`, and no rename may ride in on one — but it is a
--       write path that changes a login key, so it needs an owner who says so.
--   (b) Make the erasure path stop rewriting `username`. That breaks the tombstone
--       design: the ledger has no other join to the subject, so the attempts of an
--       erased person would keep the original username while the account carries the
--       tombstone, and `erasure.service.ts:96-117`'s stated purpose — "a reader can
--       still tell that these two rows belonged to one erased subject" — would be
--       gone. Rejected on the evidence, recorded so it is not re-proposed.
--
-- The blast radius, so the choice is made with the right weight: `app_member` holds
-- NO `UPDATE` on `users` (`0008:457-466`), so the only identities that can reach this
-- trigger are `app_admin` and the migration/owner role. That makes it a guard against
-- ACCIDENT on a trusted path, not a boundary against an attacker — which is exactly
-- what the `login_attempts` key needs, and exactly what makes resolution (a)
-- tolerable.

-- =============================================================================
-- THE INDEX — ONE, PARTIAL, ON THE ONLY COLUMN ANYBODY FILTERS
-- =============================================================================
--
-- §B1 says index what you filter or sort on. Exactly one predicate in this file
-- qualifies: "which accounts are disabled" reads `WHERE disabled_at IS NOT NULL`,
-- and it is the read the admin pages and any suspension sweeper will make.
--
-- PARTIAL, because `disabled_at IS NULL` is the overwhelming majority of rows
-- forever — an installation disables a handful of accounts out of millions — so a
-- full index would be almost entirely NULLs and every scan of it would walk the rows
-- that are NOT the answer. The disabled set is the set worth indexing, and the
-- partial predicate is what makes the structure proportional to it. This is the same
-- shape and the same argument as `users_deleted_at_idx` (`0009:230-232`) and
-- `users_last_activity_at_idx` (`0017:131-133`).
--
-- A filter on `disabled_until > now()` does not need its own index: it is always
-- ANDed with `disabled_at IS NOT NULL`, so it is resolved inside a structure that is
-- already only the disabled set. A second index would be write amplification bought
-- for a lookup that has one.
CREATE INDEX IF NOT EXISTS users_disabled_at_idx
  ON public.users (disabled_at)
  WHERE disabled_at IS NOT NULL;

-- =============================================================================
-- WHAT IS DELIBERATELY NOT INDEXED, AND WHY THAT IS A DECISION
-- =============================================================================
--
--   * `last_login_at` — DISPLAY-ONLY AND UNFILTERED. It is rendered on a profile or
--     an admin detail page for ONE account, which the primary key already reaches in
--     one lookup. Nothing sorts by it, nothing ranges over it, and no sweeper reads
--     it (unlike `last_activity_at`, which `0017` indexes precisely because the
--     retention scan filters on it). An index here would be write amplification on
--     the hottest write in the table — the login path — with no reader. If a
--     "dormant credentials" report ever lands, THAT is the migration that adds it,
--     and it must add the partial predicate with it.
--   * `first_name`, `last_name` — DISPLAY-ONLY AND UNFILTERED, and not indexable for
--     search in any case: there is no trigram extension and no `ILIKE` plan to serve.
--     A name is not a key; it is a label rendered beside a username.
--   * `disabled_by` — a self-reference on an UNSCOPED table, and the read that would
--     want it ("who disabled this account") is `WHERE disabled_by = $1`, which
--     returns at most the accounts one administrator closed. That set is bounded by
--     the administrator's own actions, and it is admin-only; an index on it would be
--     a write cost paid by every disable for a lookup that is already a scan of a
--     partial index on `disabled_at`.

-- =============================================================================
-- GRANTS — 0008's ORDER, REPEATED, AND THE ORDER FAILS OPEN
-- =============================================================================
--
-- Verified and recorded at `0001:1021` and restated at `0008:427-432`: revoking a
-- column while a table-level `SELECT` grant exists is ACCEPTED, EXITS 0, and CHANGES
-- NOTHING — the column comes back at HTTP 200 with its value intact. So the shape is
--
--   REVOKE ALL  ->  verb grants  ->  table-level REVOKE SELECT  ->  column list
--
-- and any other order is the one that fails OPEN rather than loudly. `0012` took the
-- last two steps; the two extra statements below are what make the sequence correct
-- on a database where `app_member` may still be carrying a standing table-level
-- `SELECT`, and they are the same two `0008` writes.
--
-- The `REVOKE ALL` at the top is what makes this correct on a database that ALREADY
-- carries the 0002/0008 grants: it is the only statement in this file that can
-- remove a standing table-level `SELECT` from `app_member`, so the `REVOKE SELECT`
-- that follows is a second removal of something already gone. It is written anyway
-- because it is the statement that makes the intent legible.
REVOKE ALL ON public.users FROM PUBLIC, app_anon, app_member, app_admin;

-- `app_admin` KEEPS TABLE-LEVEL `SELECT, INSERT, UPDATE, DELETE`, and therefore needs
-- NO GRANT CHANGE FOR ANY OF THE SEVEN NEW COLUMNS. This is stated explicitly rather
-- than left to be inferred, because the inference a reader will make is the dangerous
-- one: "no GRANT line names these columns, so they must be unreachable". They are
-- reachable. A table-level grant covers every column the table has now and every
-- column it acquires later, which is the whole reason `0008:443-455` keeps the admin
-- at table level — `src/auth/auth.service.ts:425,433` reads
-- `id, username, password_hash` on the login and refresh paths, and an admin
-- narrowed to a column list would break authentication outright.
--
-- It is also the right answer for these seven: §B2 says "app_admin is a superset, not
-- a bypass: all rows (RLS), all tables (grants)", and an administrator that cannot
-- see who disabled an account, or when, cannot administer one. The audit columns
-- exist to be read by exactly this principal.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO app_admin;

-- `app_member` GETS A COLUMN LIST, EXTENDED BY EXACTLY TWO COLUMNS. The self-service
-- profile page must show a member their own name; without `first_name`/`last_name` in
-- the list the page is blank and the client must invent a name, which is the §2.1
-- shape. The disclosure is about the member's OWN data, which is the one case where
-- a member reads a column nobody else may (`0008:457`, `0012:284-289`).
--
-- `last_login_at` AND ALL FOUR `disabled_*` COLUMNS STAY ADMIN-ONLY, and the reason
-- is a category rather than a preference:
--
--   * `last_login_at` is an AUDIT FACT, not profile data. It answers "when was this
--     credential last used", which is a question for an investigator, and the §B6
--     brute-force counter is the other reader. A member reading their own value is
--     harmless in isolation — but the column is on the same row as `disabled_at`,
--     and a member who can read one timestamp on a security row can start reading
--     the shape of the security surface by watching what a `select=` list is refused.
--   * The `disabled_*` FOUR ARE ENFORCEMENT STATE, and a member who can read them
--     learns the vocabulary, the actor's id and the expiry shape of the accounts
--     around them. `app_member` holds NO `INSERT`/`UPDATE`/`DELETE` on `users` at
--     all, so these four are read-only — which is exactly the shape of the
--     enumeration oracle `0022:63-72` refuses in stronger form: there, a member
--     granted `SELECT` on the login ledger could enumerate WHICH ACCOUNTS EXIST by
--     watching for failed rows. Here, one readable `disabled_at` turns the members
--     table into a list of who is under security action.
--
-- THE ABSENCE OF WRITE VERBS IS THE POINT, unchanged from `0008:457-464` and
-- `0012:305-310`: no INSERT, no UPDATE, no DELETE for `app_member` on `users`.
-- Writing a name or an email goes through the thin Nest app, which owns password
-- hashing and email re-verification, and a member with `UPDATE` here would need a
-- per-column grant AND a `WITH CHECK` pinning `id` so they could not rewrite their
-- own `created_at` or repoint `id` at another row. That is a separate change with its
-- own argument, and it would be a much larger decision than this migration makes.
--
-- =============================================================================
-- THE `REVOKE ALL` ABOVE ALSO REMOVED `0012`'s SIX GEOGRAPHY COLUMNS — READ THIS
-- =============================================================================
--
-- The column list below names SIX columns and none of them is geographic. The
-- `REVOKE ALL` at the top of this section took away EVERY privilege `app_member` held
-- on this table — including the six columns `0012_user_geo.sql:300-303` added for
-- `country_code`, `region_code`, `city`, `geo_source`, `geo_accuracy_km` and
-- `geo_updated_at` — and the `GRANT` that follows re-issues only the six named here.
-- So applying this file as written leaves a signed-in member unable to read their own
-- geography:
--
--     GET /users?select=id,country_code,region_code,city,geo_source,…  →  403
--
-- That REVERSES a decision `0012` made deliberately and argued in writing: "a person
-- who cannot read their own jurisdiction cannot contest it" (`0012:284-289`). And it
-- is not hypothetical — `test/rls/geo-profile.spec.ts:756-770` is written as a member
-- reading exactly those columns and asserts HTTP 200 with the values intact, so that
-- test goes red on the first `verify` after this migration.
--
-- This is recorded rather than quietly fixed, because the member column list for this
-- migration was specified explicitly and enumerating it is what made the collision
-- visible. Two resolutions, and neither is made unilaterally here:
--
--   (a) APPEND THE SIX to the list below. That restores `0012`, keeps this migration
--       additive (its own two columns, plus what was already there), and is what a
--       migration that only means to ADD profile fields should do.
--   (b) KEEP THE NARROWING and treat it as the decision it is: update
--       `0012`'s comment, update `test/rls/geo-profile.spec.ts`, and record that a
--       member may no longer see the geography held about them. That is a
--       disclosure-of-personal-data change, so it belongs to whoever owns that feature
--       and must not arrive as a side effect of a grant list.
--
-- RESOLUTION (a) IS TAKEN: the six geography columns are APPENDED, so this
-- migration is purely additive and `0012`'s deliberate decision survives. It does
-- not survive by accident — a column-level grant is NOT cumulative, so this file
-- REPLACES the member's whole list, and every column that list is meant to contain
-- has to be written out here. The list is therefore the union of three sources:
-- `0008`'s four, `0012`'s six, and this migration's two. It is checked against the
-- live catalog rather than remembered, because a remembered grant list is how
-- `0012`'s columns would have been dropped here.
--
-- Verified against the running database before this file was written: the columns
-- `app_member` could read on `users` were exactly
--
--     id, username, email, created_at,
--     country_code, region_code, city, geo_source, geo_accuracy_km, geo_updated_at
--
-- and the list below is those ten plus `first_name` and `last_name`. The two
-- `disabled_*`-era columns and `last_login_at` are deliberately absent.
REVOKE SELECT ON public.users FROM app_member;
GRANT SELECT (
    id, username, email, created_at,
    country_code, region_code, city, geo_source, geo_accuracy_km, geo_updated_at,
    first_name, last_name
  )
  ON public.users TO app_member;

-- `app_anon` gets NO table grant at all, unchanged. An unauthenticated read is
-- refused at the grant layer with `permission denied for table` and never reaches
-- the policy — the denial that names nothing about the schema behind it.

-- =============================================================================
-- POLICIES — NONE ADDED, AND WHY NONE IS NEEDED
-- =============================================================================
--
-- `users` already carries `users_read_scope`, `users_insert`, `users_update` and
-- `users_delete` from `0008:399-422` (with `users_read_scope` rewritten by `0009:329`
-- so a tombstone is not readable by its own subject). Nothing in this file adds one,
-- and the reason is a single fact about what RLS is:
--
-- **RLS decides ROWS. It has no vocabulary for columns.** There is no `CREATE POLICY`
--   that can say "this caller may see this row but not `disabled_reason`", and a
--   policy that tried — by filtering the row away — would hide the whole account
--   instead of one field, which is not a smaller disclosure, it is a broken page.
--
-- THE SAME FACT IS WHAT MAKES THE COLUMN GRANT ABOVE THE ONLY MECHANISM THAT CAN
-- HIDE A COLUMN, and that is worth stating because it is easy to assume the two axes
-- overlap. A member's read of their own `users` row is admitted by a POLICY; what
-- comes back inside that row is decided by the GRANT. Nothing else in this schema
-- can withhold a column — not a trigger, not a `WITH CHECK` on another table, not the
-- generated OpenAPI spec, which with `openapi-mode = "ignore-privileges"` advertises
-- every column of every relation in `db-schemas` REGARDLESS OF GRANTS (`0008:489-495`).
-- So the grant above is the control, and the spec is documentation.
--
-- Adding a fifth PERMISSIVE policy here would also be the recorded escalation shape:
-- PERMISSIVE policies are OR-ed, so a new one could admit an operation on its own.
-- One policy per table, per verb, as `0008` settled it.

-- =============================================================================
-- WHAT THIS COSTS THE CLIENT — AND WHAT THE COORDINATOR OWES
-- =============================================================================
--
--   * THE COMMITTED SPEC IS NOW STALE. `openapi.json` is generated by PostgREST from
--     the live schema and committed (AGENTS.md §B3), and
--     `test/smoke/openapi-contract.smoke-spec.ts` compares it against the CATALOG:
--     seven new columns on `users` and a red run until it is regenerated with
--     `npm run generate:client` (which also regenerates
--     `frontend/src/app/api/schema.ts`). The seven COMMENT ON COLUMN statements above
--     land in that spec as descriptions, so the regenerated types are not identical to
--     the current ones even though the wire shape only grows.
--   * A COLUMN-RESTRICTED ROLE CANNOT USE `select=*` (`0008:475-481`). `GET /users`
--     with no `select` parameter defaults to `select=*` and Postgres refuses it per
--     column. The FIRST client that calls `/users` must name its columns, and that
--     list now has to include `first_name, last_name` explicitly or the profile page
--     reads as unnamed.
--   * The `disabled_*` and `last_login_at` columns appear in the spec and are
--     unreadable at runtime by `app_member`. That is the documented consequence of
--     `ignore-privileges` — "restricted" is not a state PostgREST can represent — and
--     it is why the grant, not the spec, is the control.

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0023_user_profile_and_disable.down.sql. Kept as a separate
-- file so this one stays append-only, exactly as in 0001-0022.
-- `test/unit/down-script.spec.ts` fails if this section ever grows a body again.
--
-- ROLLING THIS BACK COSTS THE AUDIT TRAIL, irreversibly, and that is worth saying
-- before somebody runs it: the four `disabled_*` columns are the only record that an
-- account was disabled, by whom and why. Dropping them does not re-enable anything —
-- nothing in `src/` reads them (see the header) — it DELETES THE EVIDENCE that the
-- account was ever switched off, and it removes the blank rules on the two name
-- columns, after which `''` and `'  '` are acceptable names. If a disable feature
-- exists, roll this back only together with it, and verify the rollback from the
-- catalog rather than by the absence of an error.