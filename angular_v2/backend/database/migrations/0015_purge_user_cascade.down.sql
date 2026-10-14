-- =============================================================================
-- 0015_purge_user_cascade.down.sql
--
-- REVERTS 0015 — AND THEREFORE RESTORES A RETENTION QUEUE THAT CAN NEVER
-- REACH `done`.
-- =============================================================================
--
-- This is a working down script (§B1), not a stub: it restores the exact
-- `ON DELETE` action both constraints had before, `NO ACTION`, and it is
-- verified by an executed down/up cycle rather than by reading it.
--
-- IT IS NOT A NEUTRAL ROLLBACK. With these two constraints at `NO ACTION`,
-- every `DELETE FROM users` for a user who has ever authenticated raises:
--
--     ERROR:  update or delete on table "users" violates foreign key constraint
--             "refresh_tokens_user_id_fkey" on table "refresh_tokens"
--     DETAIL:  Key is still referenced from table "refresh_tokens".
--
-- — measured, verbatim, on a provisioned database. The other two blockers
-- behave the same way once the token rows are gone. The consequence is that the
-- sweeper can only ever write `failed`: the queue drains, the errors are
-- recorded honestly, and no purge ever completes. Roll this back only to a
-- database you have stopped relying on for retention, and verify the outcome
-- from `pg_constraint` rather than from the absence of an error.
--
-- ORDER IS THE SAME AS UP, inside one block, for `0008:249-256`'s reason: a
-- single statement unit means an exception rolls back everything the block did,
-- so a half-reverted pair of constraints cannot be committed.
--
-- THE OWNERSHIP PREFLIGHT IS REPEATED rather than trusted, because it is the one
-- statement that decides whether the cascade privileges documented in 0015 are
-- the privileges that actually govern the delete. If the role no longer owns
-- `users`, this file stops instead of restoring an `ON DELETE` action whose
-- behaviour nobody in this repository can then describe.
--
-- NOTHING ELSE IS TOUCHED. No table, policy, grant, function or permission row
-- is added or removed here, so there is no second thing for a revert to get
-- wrong. The queue rows, the queue itself and the sweeper are exactly as 0015
-- left them — which is to say, still non-functional for a real user, which is
-- the whole of what reverting this file means.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'users'
       AND n.nspname = 'public'
       AND pg_get_userbyid(c.relowner) = current_user
  ) THEN
    RAISE EXCEPTION
      'public.users is not owned by the migration role %, so 0015 cannot be reverted by a role '
      'that does not own the table whose referential action is being restored',
      current_user;
  END IF;

  ALTER TABLE public.refresh_tokens
    DROP CONSTRAINT refresh_tokens_user_id_fkey,
    ADD CONSTRAINT refresh_tokens_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users (id);

  ALTER TABLE public.email_messages
    DROP CONSTRAINT email_messages_user_id_fkey,
    ADD CONSTRAINT email_messages_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users (id);
END
$$;

-- The schema cache, for the same reason 0015 sends one: a restored constraint
-- that no server has re-read is a constraint that exists in the catalog and in
-- nobody's memory.
NOTIFY pgrst, 'reload schema';