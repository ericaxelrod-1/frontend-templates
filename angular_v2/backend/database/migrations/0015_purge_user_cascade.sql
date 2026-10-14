-- =============================================================================
-- 0015_purge_user_cascade.sql
--
-- MAKES `SqlPurgeExecutor.deleteUser()` ABLE TO COMPLETE FOR A REAL USER.
--
-- Migrations `0001`–`0014` are applied and correct; this is a NEW file and
-- edits none of them (§B1). Nothing here creates a table, a role, a policy or
-- a permission. It changes exactly two things: the `ON DELETE` action of two
-- foreign keys.
--
-- =============================================================================
-- THE DEFECT, AS A CONCRETE STATEMENT
-- =============================================================================
-- `src/purge/purge-executor.ts`'s `deleteUser()` issues:
--
--     DELETE FROM users WHERE id = $1
--
-- Before this file that statement CANNOT SUCCEED for any user who has ever
-- authenticated, because two of the five foreign keys naming `users.id` were
-- `NO ACTION`:
--
--     refresh_tokens_user_id_fkey   NO ACTION   ← auth material
--     email_messages_user_id_fkey   NO ACTION   ← the blocker this file exists for
--
-- Measured on a real provisioned database (bootstrap + all fourteen migrations +
-- the real `database/seed.ts`), purging a user carrying one role row, one
-- membership row, one `privacy_requests` row, one `email_messages` row and two
-- `refresh_tokens` rows, through `pgrst_authenticator` + `SET LOCAL ROLE
-- app_admin`:
--
--     ERROR:  update or delete on table "users" violates foreign key constraint
--             "refresh_tokens_user_id_fkey" on table "refresh_tokens"
--     DETAIL:  Key is still referenced from table "refresh_tokens".
--
-- and, with the token rows removed, the same statement then raised the
-- email_messages constraint in the same shape. So the two blockers are
-- independent and both real.
--
-- WHAT THAT MEANT. The sweeper is a working drain over a queue whose only
-- implemented operation is structurally incapable of completing. Every attempt
-- raised `23503`, `sweepOne()` unwound to `PURGE_WORK_SAVEPOINT`, and the row
-- was requeued until `RETENTION_PURGE_MAX_ATTEMPTS` wrote it off as `failed`.
-- The `failed` was correct; nothing was ever `done`. That is §2.1's "looks
-- finished and isn't" reached through a correct error report: a control that
-- reports its own failure faithfully and can never report success.
--
-- IT STAYED HIDDEN BECAUSE NO TEST PURGED A USER WITH EITHER ROW SET.
-- `test/rls/user-identity.spec.ts` proves the cascade for `user_roles` and
-- `user_groups` — against `purgeVictim`, a user the fixture deliberately gives
-- no `refresh_tokens` and no `email_messages`. Every user who has ever signed in
-- has both. `test/unit/purge/**` drives a structural port that cannot see FK
-- behaviour at all.
-- `test/rls/user-purge-end-to-end.spec.ts` closes that gap and is the test that
-- goes red if either constraint below is reverted to `NO ACTION`.
--
-- =============================================================================
-- EVERY TABLE THAT REFERENCES `users`, AND WHAT HAPPENS TO IT
-- =============================================================================
-- Read from `pg_constraint` on the shipped schema, not from this list, and
-- re-asserted by the suite so a sixth referencing table cannot appear
-- unaccounted:
--
--   TABLE                       ACTION BEFORE   ACTION AFTER   FATE
--   --------------------------  --------------  -------------  -------------------
--   user_roles                  CASCADE         CASCADE        deleted
--   user_groups                 CASCADE         CASCADE        deleted
--   privacy_requests            CASCADE         CASCADE        deleted
--   refresh_tokens              NO ACTION       CASCADE  (new) deleted
--   email_messages              NO ACTION       CASCADE  (new) deleted
--
-- And one table that is NOT in that list, because the compliance record has to
-- outlive its subject:
--
--   privacy_request_audits      no FK at all    no FK at all    RETAINED
--
-- Transitive: `privacy_request_regulations` carries `ON DELETE CASCADE` on its
-- own `request_id` (`0010:130-135`), so it goes with `privacy_requests` in the
-- same statement. Two levels, both schema properties.
--
-- `login_attempts` references NO user and carries no foreign key at all, by the
-- `0011:41-48` decision (a retention sweep over it has no subject). It is
-- therefore outside this change: it is not blocked here and it is not purged
-- here, and `retention_login_attempts` still has no executor, which
-- `SqlPurgeExecutor` raises on rather than reporting `rows_deleted = 0`.
--
-- =============================================================================
-- WHY CASCADE AND NOT AN EXPLICIT ORDERED CHILD-DELETE
-- =============================================================================
-- `AGENTS.md` §B2 warns that `ON DELETE CASCADE` CROSSES RLS, and this section
-- is the argument that the warning was considered rather than skipped. The
-- question was "can the sweeper delete the children itself, in a defined order,
-- inside the transaction?" and the answer is measured, not assumed.
--
-- **THE EXECUTOR RUNS AS `app_admin`, AND `app_admin` CANNOT DELETE EITHER
-- ROW SET.**
--
--     DELETE FROM refresh_tokens WHERE user_id = …   → ERROR: permission denied for table refresh_tokens
--     DELETE FROM email_messages WHERE user_id = …   → ERROR: permission denied for table email_messages
--
-- Both measured as `pgrst_authenticator` + `SET LOCAL ROLE app_admin`, which is
-- exactly the identity `src/purge/purge-sweeper.service.ts` establishes before
-- it claims a row. `0011:427-451` and `0002` withhold DELETE from `app_admin`
-- on both tables, and that withholding is a control in its own right — the
-- `privacy_purge:delete` capability does not exist precisely so no purge row can
-- be removed by a person.
--
-- **AND NO OTHER NON-SUPERUSER IDENTITY CAN EITHER — NOT EVEN THE OWNER.**
-- This is the half that decides it, and it is a property of the SCHEMA rather
-- than of any grant:
--
--   * `email_messages` is `FORCE ROW LEVEL SECURITY` (`0005:262-263`), and it
--     carries exactly two policies: `email_read_scope` (`FOR SELECT`) and
--     `email_write` (`FOR INSERT`, `WITH CHECK (current_user = 'app_admin')`).
--     There is NO `FOR UPDATE` and NO `FOR DELETE` policy. `FORCE` binds the
--     TABLE OWNER too — that is what it is for — so the owner is subject to the
--     same two policies and can satisfy neither an UPDATE nor a DELETE.
--     Measured, as `app` (the owner, NOSUPERUSER, NOBYPASSRLS):
--
--         DELETE FROM email_messages WHERE user_id = …  →  DELETE 0
--         UPDATE email_messages SET subject = …        →  UPDATE 0
--         SELECT count(*) FROM email_messages WHERE …  →  0
--
--     Note what that is: not an error. `email_messages` rows are currently
--     **undeletable by every role on this cluster except a superuser**, and the
--     owner cannot even see them in a claimless session. §2.3 calls a zero-row
--     success-shaped value for work that did not happen a defect; this is the
--     schema's existing answer to it for this table.
--   * `SECURITY DEFINER` does not rescue it. A definer function runs as the
--     owner, and `FORCE` binds the owner. `SET row_security = off` would rescue
--     it, and `0009` and `test/rls/user-identity.spec.ts` both forbid exactly
--     that as "the owner bypass, reopened" — seeding goes THROUGH the escalation
--     boundary, not around it. Removing `FORCE` from `email_messages` would be a
--     far larger change than this file is permitted to make, and would unbind
--     the table's own policies from its owner.
--
-- So the set of mechanisms that can remove a purged user's child rows is:
-- `ON DELETE CASCADE`, or a superuser session. The sweeper is not a superuser
-- and must not become one. **The referential action is not the convenient
-- choice here; it is the only one that exists.**
--
-- THE ORDER OF THE DECISION WAS: explicit child-delete → cascade. Not the other
-- way round. The explicit route was pursued first and measured out of existence,
-- and the argument for keeping the cascade rests on that measurement rather than
-- on being fewer lines.
--
-- WHAT AN EXPLICIT DELETE WOULD HAVE COST, had it been available: a `GRANT
-- DELETE` on `email_messages` to `app_admin`, reachable from PostgREST at
-- `DELETE /email_messages`, which destroys the invariant `0005:353-357` states
-- in its own words — "Email history is an audit trail: it is appended to and
-- read, and it is not edited or removed" — and does so for a table whose whole
-- grant state is designed around nobody being able to erase the trail. That is
-- the shape this file avoids.
--
-- =============================================================================
-- WHICH ROLE'S PRIVILEGES GOVERN THE CASCADE — §B2, ANSWERED
-- =============================================================================
-- NOT `app_admin`'s, and not the deleting statement's. The referential action is
-- an AFTER ROW trigger on `users` marked `RI_Trigger` / internal, and it runs
-- with the privileges of the **owner of the table the constraint is declared on
--** — here `users`, owned by the migration role `app` (`NOSUPERUSER NOBYPASSRLS`
-- — `0008`'s preflight is what guarantees the migration role owns `users`).
-- It is additionally exempt from row-level security: PostgreSQL marks these
-- triggers `no-force`, so the `FORCE` on `email_messages` and `refresh_tokens`
-- does not bind them. `0010:75-80` records the same fact for
-- `privacy_requests` and `0008:146-175` for the membership tables.
--
-- STATED AS A CONSEQUENCE RATHER THAN LEFT IMPLIED — this is the widening, and it
-- is real:
--
--   **`app_admin` gains, through the cascade, the ability to destroy
--   `email_messages` rows and `refresh_tokens` rows, which it cannot destroy by
--   any other route.** After this file, `DELETE /users?id=eq.<uuid>` issued as
--   `app_admin` empties that user's mail history and session table, without
--   `app_admin` holding DELETE on either, and without any row of either appearing
--   in the admin view.
--
-- WHAT BOUNDS IT, and the bounding is what makes this acceptable rather than
-- merely tolerable:
--
--   * WHO CAN TRIGGER IT. Only a principal holding `DELETE` on `users`. The
--     grant gives that to `app_admin` and to the owner, and the `users_delete`
--     policy admits `current_user = 'app_admin'` and nothing else. `app_member`
--     and `app_anon` hold no `DELETE` on `users`, so neither can reach the
--     cascade at all — asserted per role, not left here.
--   * WHAT IT REACHES. Only rows whose `user_id` equals the id being deleted.
--     The action is not a table sweep; it is driven by the deleted row's own key.
--     It cannot reach another user's mail or another user's sessions, and it
--     cannot reach a group-scoped table at all: neither of these two is
--     group-scoped, so §B2's "a cascade that reaches rows the deleting actor
--     could not otherwise write" is bounded to two unscoped reference tables
--     that are the deleted principal's own rows.
--   * WHAT IT IS NOT. It is not an escalation of the erasing actor's reach over
--     data it could otherwise read or change: `app_admin` already holds DELETE on
--     `users`, on `user_roles` and on `user_groups`, and already destroys three
--     tables' worth of the principal's rows by deleting the account. This adds
--     two more tables to a deletion that `app_admin` can already perform. It is
--     the same shape of widening `0008:146-175` accepted for the membership
--     tables and `0010:66-80` for the request tables.
--   * WHAT IT COSTS. The trail is still un-erasable *ad hoc*: no grant, no
--     policy and no permission row anywhere lets a caller remove a single
--     `email_messages` row on its own, and none ever will without a migration
--     that says so in these words. What changed is that erasing the whole
--     account — a queued, claimed, counted, single-transaction operation — takes
--     the mail with it.
--
-- THE RESIDUAL THAT IS NOT BOUNDED, stated because a reader will find it:
-- `privacy_purge_queue.rows_deleted` counts the TARGET rows the executor
-- deleted, which is `DELETE FROM users WHERE id = $1` — one row — and NOT the
-- child rows the cascade removed with it. A purge that removes six rows across
-- five tables records `rows_deleted = 1`. That is unchanged from what the column
-- always meant ("the claim bounds and the delete bounds are the same predicate",
-- `src/purge/purge-executor.ts:44-51`) and it is not a number the executor can
-- widen honestly: as shown above, `app_admin` cannot even COUNT the mail rows
-- (`email_read_scope` needs `authz.actor()`, which is NULL in the sweeper's
-- claimless session), so any total would be a guess. The per-table fate is
-- therefore asserted by COUNT, by the suite, in both directions — which is what
-- `test/rls/user-purge-end-to-end.spec.ts` exists for.
--
-- =============================================================================
-- `refresh_tokens` — DELETED WITH THE USER. No conflict, and the reasoning is short.
-- =============================================================================
-- A refresh token is a bearer credential for a session. GDPR Art. 17 erasure and
-- any sane identity provider's own rules both require that a credential
-- belonging to an erased account stop existing; keeping it would mean keeping a
-- working secret for a person the system has declared gone. There is no statutory
-- retention claim over a session token — the 24-month figure in `0010:298-307`
-- attaches to the RECORD OF A CONSUMER REQUEST, which is
-- `privacy_request_audits`, and that table is untouched below.
--
-- It is UNSCOPED global reference data (`0002:63`), the same category as
-- `user_roles` and `user_groups`, so §B2's group-scoped FK rule does not bind it
-- — the same reasoning `0008:213-232` records for the membership tables.
--
-- The self-referencing `refresh_tokens.rotated_to` is unaffected, and this was
-- checked rather than assumed because a `NO ACTION` self-FK inside a cascading
-- delete is exactly where a rotation chain would break the purge. Measured with
-- a real two-token rotation chain (`token A .rotated_to = token B`, both owned by
-- the victim): `DELETE FROM users` succeeds and both token rows are gone. A
-- cascade removes the referencing and referenced rows in one statement, so the
-- `NO ACTION` check has nothing left to find.
--
-- =============================================================================
-- `email_messages` — DELETED WITH THE USER, AND THE 24-MONTH QUESTION ANSWERED
-- =============================================================================
-- The workstream has already decided, in `0010:298-307`, that the record of a
-- consumer request is RETAINED for at least 24 months under CPRA
-- §1798.105(c)(2) and 11 CCR §7101(a), and that `privacy_request:delete`
-- deliberately does not exist as a capability. The question this section has to
-- answer is whether `email_messages` falls under that or is genuinely different.
--
-- **IT IS GENUINELY DIFFERENT, AND THE ANSWERS CONFLICT ENOUGH TO BE WORTH
-- RECORDING.**
--
-- WHAT 24 MONTHS GOVERNS: the record that a person made a request and what the
-- answer was. In this schema that record is `privacy_request_audits` — six
-- 11 CCR §7101(b) fields per row, keyed by `request_key` and NOT by
-- `request_id` precisely so it outlives the working copy (`0010:169-177`), with
-- NO foreign key anywhere and no serving role holding INSERT, UPDATE, DELETE or
-- TRUNCATE on it (`0010:250-258`). `privacy_requests` is the working copy and
-- `0010:307` already says it is "allowed to be cascade-deleted with its
-- subject". `0011:230-237` says the same again for the whole question. NEITHER
-- IS `email_messages`.
--
-- WHAT `email_messages` ACTUALLY IS: a per-message delivery log of OUTBOUND
-- transactional mail — did the reset message send, did it fail, when, to which
-- address. Its own migration calls it an audit trail (`0005:353-357`) but of the
-- SEND, not of a request. Its content is personal data with no statutory
-- retention claim: `recipient` is an email address, `subject` is the subject
-- line, and `body` holds message content whenever a template is allowed to store
-- one.
--
-- SO THE TWO RULES POINT IN OPPOSITE DIRECTIONS, and neither wins silently:
--
--   * RETAIN, because `0005` declares mail unerasable and the sweep must not
--     quietly override a stated invariant.
--   * DELETE, because GDPR Art. 5(1)(e) storage limitation and Art. 17 erasure
--     both require that a person's data does not outlive their erasure, and
--     because `0011:225-229` names the exact harm of getting this wrong:
--     retention that never expires means "the retention policy the template
--     PUBLISHES is one it does not ENFORCE, and an auditor reads the policy."
--
-- DELETE WINS, and the repository itself is what settles it — there is no need
-- to weigh two statutes against each other here. `0008:117-123` names the
-- consequence of leaving the rows behind as the DEFECT THIS WHOLE WORKSTREAM
-- EXISTS TO CLOSE:
--
--     "`user_groups` orphans keep the purged user's scope resolvable …
--      and their `email_messages` history stays readable by colleagues."
--
-- That is an in-repo statement that a purged user's mail history must NOT
-- survive the purge. Retaining it would make the purge a partial purge by
-- construction, and would leave `email_messages` rows whose `user_id` names a
-- principal that no longer exists — which is also the orphan that
-- `authz.visible_user_ids()` could still resolve for a colleague.
--
-- WHAT IS LOST BY DELETING, stated rather than glossed: the ability to answer
-- "did we send this person a password-reset mail on 3 March" after the account
-- is erased. That question is answerable from the delivery provider's own logs
-- for whatever window that provider keeps, and the subject whose right to erasure
-- is being honoured is the one who cannot be answered it. Where an operator
-- needs that history for a longer period, the answer is the 24-month retention
-- that ALREADY EXISTS on the correct table — `privacy_request_audits` — not a
-- second, quieter retention on the mail log.
--
-- =============================================================================
-- WHAT THIS FILE DOES NOT DO — AND IT IS THE LIST THE NEXT READER WILL ASK FOR
-- =============================================================================
--   * IT DOES NOT ENQUEUE ANYTHING. `privacy_purge_queue` is still filled by
--     nothing in this tree: there is no `enqueue_inactive_purges` scan, no route,
--     no seed row and no RPC, and `0011:441-450` records exactly that. A purge
--     therefore happens only for a row somebody wrote, and an EMPTY admin list is
--     still not evidence that retention is running. That gap is unchanged by this
--     file and is deliberately not papered over here: building the scan needs a
--     retention window — the number of days a tombstone survives before its
--     `users` row is destroyed — and that number does not exist in any `.env`
--     file. It is a compliance decision an operator has to make and record, not a
--     number a migration or an agent should choose, and the two alternatives are
--     both worse than the gap: hard-coding a window destroys real accounts on a
--     figure nobody chose, and defaulting one is exactly §2.3's "a default nobody
--     chose silently applies" for the one decision in this schema that is not a
--     scheduling fact.
--   * IT DOES NOT FIX THE CLAIM. `CLAIM_DUE_PURGE_SQL`'s sub-select is governed by
--     `privacy_purge_read`, which is capability-only with no `current_user`
--     branch, and the sweeper runs claimless — so the claim matches zero rows.
--     Measured, and recorded at the statement in `src/purge/purge-claim.ts`. This
--     file's effect is therefore real but currently unreachable from the shipped
--     sweeper, and saying that here is better than letting a green suite imply
--     otherwise.
--   * IT DOES NOT CHANGE A GRANT, A POLICY OR A `FORCE` SETTING. See the section
--     above.
-- =============================================================================

-- =============================================================================
-- IDEMPOTENCE — NAMED, NOT `ADD CONSTRAINT IF NOT EXISTS`
-- =============================================================================
-- `ALTER TABLE … ADD CONSTRAINT` has no `IF NOT EXISTS` form, so the existence
-- check reads `pg_constraint` by conname AND conrelid — by name alone would be
-- wrong the moment a second table grows an identically named constraint, which is
-- the failure that produces "constraint already exists" on a database where it
-- does not. `0008:236-247` records the same choice for the same reason.
--
-- ONE `DO` BLOCK, so an exception escaping it rolls back everything the block
-- did: a failed second constraint must not leave the first one already changed.
-- Split into two blocks and a half-applied migration commits half of itself.
--
-- DROP + ADD rather than `ALTER TABLE … DROP CONSTRAINT` / re-`ADD`, so the
-- validation runs against the rows that already exist. If this file is applied
-- to a database that somehow carries an orphan, the `ADD CONSTRAINT` fails and
-- the migration stops rather than recording an invariant nothing enforces.
-- =============================================================================

DO $$
DECLARE
  referencing text;
BEGIN
  FOREACH referencing IN ARRAY ARRAY[
    'public.refresh_tokens',
    'public.email_messages'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = split_part(referencing, '.', 2) || '_user_id_fkey'
         AND conrelid = referencing::regclass
    ) THEN
      RAISE EXCEPTION
        '0015 requires % to carry the foreign key it changes; run the migrations in order',
        referencing;
    END IF;
  END LOOP;

  -- `users` must be owned by the migration role, for the reason stated above: the
  -- cascade's privileges are the OWNER's, and a database where `users` belongs to
  -- somebody else would make this file's central claim about them false. Copied
  -- from `0009:133-156` rather than re-derived, for that file's reason — a
  -- migration that ALTERs a table it does not own records an invariant it cannot
  -- enforce.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'users'
       AND n.nspname = 'public'
       AND pg_get_userbyid(c.relowner) = current_user
  ) THEN
    RAISE EXCEPTION
      'public.users is not owned by the migration role %, so the cascade privileges 0015 documents '
      'would not be the ones that actually govern the delete',
      current_user;
  END IF;

  ALTER TABLE public.refresh_tokens
    DROP CONSTRAINT refresh_tokens_user_id_fkey,
    ADD CONSTRAINT refresh_tokens_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;

  ALTER TABLE public.email_messages
    DROP CONSTRAINT email_messages_user_id_fkey,
    ADD CONSTRAINT email_messages_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;
END
$$;

-- =============================================================================
-- NO GRANT CHANGE, AND WHY THAT IS THE POINT
-- =============================================================================
-- `email_messages` keeps `GRANT SELECT, INSERT, UPDATE … TO app_admin` and no
-- DELETE; `refresh_tokens` keeps `GRANT SELECT, INSERT, UPDATE … TO app_admin`
-- and no DELETE; neither gains a `FOR DELETE` policy and neither loses its
-- `FORCE ROW LEVEL SECURITY`. A referential action needs no privilege on the
-- referencing table, which is precisely why this file changes a constraint and
-- not a grant — and why the cascade's reach, argued at length above, is the one
-- place where a table is emptied without a grant or a policy saying so.
--
-- No permission row is added. `privacy_purge` still carries `read` and `update`
-- and still carries neither `create` nor `delete` (`0011:265-288`), and
-- `privacy_request` still carries no `delete` (`0010:298-307`). Nothing here is
-- reachable by a person.

-- =============================================================================
-- SCHEMA CACHE
-- =============================================================================
-- A referential action does not appear in the OpenAPI document PostgREST emits,
-- so `openapi.json` and the generated Angular types are unchanged by this file.
-- The `NOTIFY` is here anyway for the same reason every other migration sends
-- one: it costs nothing, and a constraint installed without it leaves the next
-- schema-cache reload reading a catalog nobody re-read.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DOWN
-- =============================================================================
-- See database/migrations/0015_purge_user_cascade.down.sql. Kept as a separate
-- file so this one stays append-only, exactly as in 0001–0014.
--
-- REVERTING THIS RESTORES THE DEFECT, and it is not a neutral rollback: with the
-- two constraints back at `NO ACTION`, every `DELETE FROM users` for a user who
-- has ever authenticated raises `23503` again and the retention queue can never
-- reach `done`. The down script says so at the foot, in the words an operator
-- reading it at three in the morning needs.