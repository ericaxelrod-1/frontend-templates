-- =============================================================================
-- 0027_admin_notifications.sql
--
-- The generic, expiring, dismissible notification table, and the first source
-- materialised into it (`public.security_alerts`).
-- Target: PostgreSQL 18+, applied as the migration/owner role (`app`).
--
-- =============================================================================
-- WHY A TABLE AND NOT A VIEW — the constraint this schema is shaped by
-- =============================================================================
--
-- A view recomputes from its source on every read, and it cannot hold
-- `dismissed_at` or `expires_at`. Both facts are per-notification MUTABLE state,
-- and both are the reason this feature exists:
--
--   * a dismissed notification that still matches its source condition resurfaces
--     the instant the view is read again, so "dismiss" is a button that does
--     nothing;
--   * a five-year-old notification has nowhere to record that it is five years old,
--     so it surfaces forever.
--
-- Materialisation is the only shape that can hold either. Two further reasons from
-- this repository: v2 has no views at all (ADR-0022 — a superuser-created view
-- bypasses every policy on its base table, and `app` owns these tables), and the
-- `authz.*` `SECURITY DEFINER` functions are the established precedent for a
-- computed row set that is not a view.
--
-- =============================================================================
-- THE ADDRESSING QUESTION, AND WHY THE ANSWER IS THREE CASES AND NOT TWO
-- =============================================================================
--
-- "Is a notification addressed to one person or to everyone?" The honest answer is
-- that those two do not cover what this table has to hold, and the case the
-- two-case answer drops is a security regression.
--
-- A `security_alerts` row is admin-only today: `0022` grants it to `app_admin` and
-- to nobody else, behind `USING (current_user = 'app_admin')`. Most such rows carry
-- NO `user_id` — they are about an address, a subnet or a detected pattern, not
-- about a person. So "everyone" is the wrong home for them: a two-case
-- `user_id IS NULL OR user_id = actor()` policy would publish every unaddressed
-- security alert to every authenticated member, which is strictly more than the
-- table says today. That is not a generic panel, it is a data leak with a nicer
-- column layout.
--
-- So the addressing is a discriminator of its own:
--
--   audience = 'all',            user_id NULL   → every authenticated member
--   audience = 'all',            user_id set   → that member, and administrators
--   audience = 'administrators'  user_id NULL   → administrators only
--
-- `user_id` alone cannot say the third thing, and inventing a sentinel user to
-- carry it would put the row in a scope nobody chose. `audience` is that column,
-- and it is `NOT NULL` with a CHECK so the two can never disagree — an
-- `audience = 'administrators'` row that also named a person would be a
-- contradiction the policy would have to resolve by guessing.
--
-- The first materialiser uses the third case for exactly the rows that use it
-- today: a `security_alerts` row with no `user_id` becomes an administrators-only
-- notification, and one WITH a `user_id` becomes that person's — which is the
-- widening the design is FOR, and the reason the column exists. A row deliberately
-- broadcast to every member (`audience = 'all'`, `user_id NULL`) is the fourth
-- shape this substrate makes room for, and nothing writes it yet.
--
-- =============================================================================
-- WHY THERE IS NO `status` COLUMN, AND WHERE THE LIFECYCLE WENT
-- =============================================================================
--
-- `security_alerts` has `status IN ('active','acknowledged','resolved','dismissed')`
-- and the panel filters on it. This table does not, and that is deliberate: a status
-- that repeats what three timestamps already say is a second representation of one
-- fact, and two representations of one fact drift the first time somebody edits one
-- of them — a row that says `active` while carrying a `dismissed_at`, which is the
-- exact shape a resurrected alert has.
--
-- The three timestamps ARE the lifecycle, and they are the ones `security_alerts`
-- already had:
--
--   dismissed_at      set        → dismissed     (terminal)
--   resolved_at       set        → resolved      (terminal)
--   acknowledged_at   set        → acknowledged
--   none of them                   → active (unacknowledged)
--
-- The panel derives the same four labels it renders today, in the same precedence.
-- Acknowledgement and resolution are an OPERATOR's acts and keep their `_by`
-- columns; a dismissal is the addressed person's own act and is deliberately a
-- single timestamp — nothing renders a "dismissed by", and §B1 prefers keeping
-- columns out of the readable set from the outset over adding one and withholding it.
--
-- =============================================================================
-- WHY `source_ref` IS `text` AND CARRIES NO FOREIGN KEY
-- =============================================================================
--
-- It is the source row's own primary key, held as text so a source whose key is not
-- a UUID can still be materialised without a schema change to this table.
--
-- **There is no foreign key to the source, on purpose.** Referential-integrity
-- checks bypass RLS and fail OPEN (§B2): an FK to another table is an existence
-- oracle (`23503` against success reveals any id, including out-of-scope ones), and
-- the source tables are exactly the ones a member may not read. `security_alerts`
-- already holds `pattern_id` and `user_id` as nullable references because it is a
-- first-class record of its own; a notification is a *rendering* of a source row,
-- and a rendering must not be able to confirm the existence of a row the renderer
-- is not allowed to see. That is also why `user_id` — the one identifier a member
-- genuinely needs — is the one column that DOES carry an FK: it names the reader,
-- not the payload.
--
-- =============================================================================
-- `UNIQUE NULLS NOT DISTINCT` — WITHOUT IT THE WHOLE TABLE DOES NOT WORK
-- =============================================================================
--
-- `(source, source_ref, user_id)` identifies a notification: this source record,
-- rendered for this person, once. The default `UNIQUE` treats NULLs as distinct
-- from each other, so EVERY system-wide notification — `user_id IS NULL`, which is
-- most of them — would be insertable again on every run. The materializer's
-- `ON CONFLICT DO NOTHING` is what stops a dismissed notification being resurrected,
-- and against a default unique index it would silently do nothing at all.
--
-- `NULLS NOT DISTINCT` is core from PostgreSQL 15, and this floor is 18 (§B1).
-- It is also what lets `ON CONFLICT (source, source_ref, user_id)` infer the index
-- WITHOUT the `WHERE` clause a partial index would have required, so the statement
-- carries no predicate that a future change could forget to keep in step.
--
-- =============================================================================
-- THE INDEXES, AND WHICH PREDICATE EACH ONE IS FOR (§B1)
-- =============================================================================
--
--   identity_key      the ON CONFLICT target, and "everything for this source"
--   source_cursor_idx the watermark lookup: newest row for a source, by `id`
--   live_idx          the panel's real query: is_mock filter, created_at DESC sort
--   severity_idx      the severity filter
--   kind_idx          the notification-type filter, which is what `alert_type` was
--   user_idx          the RLS predicate `user_id = authz.actor()`, and "mine"
--   unexpired_idx     the expiry sweep, which reads only the outstanding set
--
-- `source_cursor_idx` is `(source, id DESC)` and not `(source, created_at DESC)`
-- because `id` is `uuidv7()` (§B1) and therefore already sorted by minting time:
-- the newest row for a source is the right-hand edge of the index rather than a sort
-- of everything the source has ever produced, and the ordering cannot tie the way
-- two rows stamped in the same millisecond can. §Watermark, in
-- `src/notifications/security-alert-materializer.ts`, is where that decision is
-- carried the rest of the way.
--
-- NO GIN INDEX ON `data`. The panel renders `data` and does not filter on it, and
-- §B1 indexes what you filter and sort on — an index nobody queries is a write
-- cost on every materialisation and nothing else.
-- =============================================================================

-- `IF NOT EXISTS` everywhere in this file, because that is the convention every
-- migration here follows and because it makes the file safe to apply twice: the RLS
-- proof applies `0001` twice on purpose, and a file that only ever runs once has
-- been shown to do neither "applies cleanly" nor "is idempotent".
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id               uuid        PRIMARY KEY DEFAULT uuidv7(),
  -- The discriminator PAIR: which data source produced this row, and which of that
  -- source's kinds it is. Neither is CHECKed against a closed list, and that is the
  -- point of a generic table: adding a source must be a code change in
  -- `src/notifications/`, never a migration of this file.
  source           text        NOT NULL,
  kind             text        NOT NULL,
  severity         text        NOT NULL DEFAULT 'medium',
  title            text        NOT NULL,
  message          text        NOT NULL,
  -- Everything the source knows that the four columns above do not. `jsonb` and NOT
  -- NULL with an empty default, so a consumer never branches on "was it set" for a
  -- payload that simply has no keys.
  data             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- The source row's own primary key. The identity of a notification.
  source_ref       text        NOT NULL,
  -- Addressing. See the section at the top of this file.
  audience         text        NOT NULL DEFAULT 'all',
  user_id          uuid        REFERENCES public.users (id) ON DELETE CASCADE,
  -- The lifecycle, as timestamps and nothing else. See "WHY THERE IS NO `status`".
  acknowledged_at  timestamptz,
  acknowledged_by  uuid        REFERENCES public.users (id) ON DELETE SET NULL,
  resolved_at      timestamptz,
  resolved_by      uuid        REFERENCES public.users (id) ON DELETE SET NULL,
  resolution_notes text,
  dismissed_at     timestamptz,
  -- A display filter and nothing else, exactly as on the `0022` tables: no policy
  -- and no function in this file reads it, and none may (§B2). The materialiser
  -- copies it from the source row so a synthetic source record stays identifiable
  -- after it has been rendered.
  is_mock          boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- NOT NULL: "how long this notification stays visible" is a decision every
  -- materialiser has to make, and a default of NULL would let a source ship a row
  -- that never expires — which is the five-year-old-alert failure this table exists
  -- to prevent, arriving through the simplest possible omission.
  expires_at       timestamptz NOT NULL,
  CONSTRAINT admin_notifications_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT admin_notifications_audience_check
    CHECK (audience IN ('all', 'administrators')),
  -- The addressing cannot contradict itself: an administrators-only notification
  -- names nobody, because a row that is both private to administrators AND
  -- addressed to a person is a row two policies would have to arbitrate.
  CONSTRAINT admin_notifications_addressing_check
    CHECK (audience = 'all' OR user_id IS NULL),
  CONSTRAINT admin_notifications_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT admin_notifications_identity_key
    UNIQUE NULLS NOT DISTINCT (source, source_ref, user_id)
);

CREATE INDEX IF NOT EXISTS admin_notifications_source_cursor_idx
  ON public.admin_notifications (source, id DESC);
CREATE INDEX IF NOT EXISTS admin_notifications_live_idx
  ON public.admin_notifications (is_mock, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_notifications_severity_idx
  ON public.admin_notifications (severity);
CREATE INDEX IF NOT EXISTS admin_notifications_kind_idx
  ON public.admin_notifications (kind);
CREATE INDEX IF NOT EXISTS admin_notifications_user_idx
  ON public.admin_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_notifications_unexpired_idx
  ON public.admin_notifications (expires_at);

-- =============================================================================
-- `updated_at` — MAINTAINED, NOT DECLARED AND HOPED FOR
-- =============================================================================
--
-- Every `0022` table has an `updated_at` that nothing sets. Copying that here would
-- be a column that claims to record a row's last write and never does, which is
-- §2.3's silent degradation in its quietest form: the value stays plausible and
-- nothing reports that it is stale.
--
-- The trigger is `SECURITY INVOKER` and belongs to nobody. It reads no table and
-- asks no question about the caller, so there is no identity for a `DEFINER` body
-- to get wrong — and granting it to nobody IS the correct end state for a trigger
-- function, because it never runs outside the table it is attached to (§B2).
CREATE OR REPLACE FUNCTION authz.touch_admin_notifications_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION authz.touch_admin_notifications_updated_at() FROM PUBLIC;

-- Dropped before created, because `CREATE TRIGGER` has no `IF NOT EXISTS` and a
-- file that cannot be applied twice is a file whose second application fails on a
-- line nobody was looking at.
DROP TRIGGER IF EXISTS admin_notifications_touch_updated_at ON public.admin_notifications;
CREATE TRIGGER admin_notifications_touch_updated_at
  BEFORE UPDATE ON public.admin_notifications
  FOR EACH ROW
  EXECUTE FUNCTION authz.touch_admin_notifications_updated_at();

-- =============================================================================
-- ROW-LEVEL SECURITY — ENABLE and FORCE
-- =============================================================================
--
-- ENABLEd and FORCEd: this table is not in the `groups` / `user_groups` exception,
-- nothing refreshes a matview as its owner, and no serving role owns it. A table
-- owner bypasses its own policies and Postgres reports NOTHING when it does (§B2).
--
-- ONE policy, and it is TOTAL: every `OR` branch is evaluated, so a cast in any
-- branch takes the whole query down rather than denying. `authz.actor()` is the
-- guarded three-argument accessor that catches its own cast and returns NULL for a
-- malformed `sub` (§B2), so `user_id = authz.actor()` is NULL — not a 500 — for an
-- unauthenticated or hostile caller, and the branch simply fails.
--
-- The `current_user = 'app_admin'` branch is the escalation boundary every writer
-- crosses, and it keys on `current_user` rather than the `role` claim because the
-- claim is caller-supplied: a member who forges `"role": "app_admin"` into their own
-- validly-signed token matches nothing here.
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS row_scope ON public.admin_notifications;
CREATE POLICY row_scope ON public.admin_notifications USING (
    current_user = 'app_admin'
    OR (audience = 'all' AND (user_id IS NULL OR user_id = authz.actor()))
);

-- =============================================================================
-- GRANTS — default deny, then the narrowest write that is actually needed
-- =============================================================================
--
-- ORDER IS LOAD-BEARING (§B2): a column privilege can only NARROW a table grant
-- that has already been taken away, so the table-level `REVOKE UPDATE` comes after
-- the verb grants and before the column list. Issued the other way round it is
-- accepted, exits 0, and changes nothing — and `dismissed_at` would stay writable
-- by a member who had been meant to be read-only on it.
REVOKE ALL ON public.admin_notifications
  FROM PUBLIC, app_anon, app_member, app_admin;

-- A member READS what is addressed to them or broadcast, and DISMISSES it. The
-- policy above is what narrows the read; the grant below is only what makes the
-- read possible at all.
--
-- `app_anon` GETS NOTHING, not even `SELECT`. A policy that ERRORS instead of
-- denying is a denial-of-service surface and an oracle (§B2), and the cheapest
-- certainty that an anonymous reader is refused is that it holds no grant at all.
GRANT SELECT ON public.admin_notifications TO app_member;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_notifications TO app_admin;

-- THE MEMBER'S WRITE IS ONE COLUMN, and it is the whole dismissal. `resolved_at`
-- and `acknowledged_at` are the operator's workflow, so the addressed person
-- cannot acknowledge on their behalf or close an issue they do not own. Because the
-- policy's `USING` governs `WITH CHECK` too (Postgres reuses it for inserts and
-- updates), a member cannot reach a row that is not theirs or broadcast, so this
-- one column cannot be used to close somebody else's notification either.
REVOKE UPDATE ON public.admin_notifications FROM app_member;
GRANT UPDATE (dismissed_at) ON public.admin_notifications TO app_member;

-- NO `TRUNCATE` FOR ANY SERVING ROLE. It is closed by the grants above, not by a
-- policy, because `TRUNCATE` fires no row trigger and a policy cannot see it.

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0027_admin_notifications.down.sql. Kept as a separate file
-- so this one stays append-only, exactly as in 0001-0026.
-- `test/unit/down-script.spec.ts` fails if this section ever grows a body again.