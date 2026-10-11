-- UUIDv7 for every key, end to end.
-- Target: PostgreSQL 18+. `uuidv7()` is a core function from 18 onward; there is
-- no extension to install and nothing to backport.
--
-- Why every key and not only the primary keys: the id is also the value that gets
-- indexed, and `gen_random_uuid()` is a v4 — 122 random bits in random order, so
-- the btree gets a fresh random insertion point for every row. `uuidv7()` sorts by
-- minting time, so writes land at the right-hand edge of the index instead of
-- scattering across it. That is an index-locality and bloat win, not a correctness
-- one, which is exactly why it is worth taking but not worth a backfill.
--
-- Apply as the migration/owner role, the same way 0001 is applied.

-- =============================================================================
-- Fail before touching anything, and say what is wrong in a way an operator can act
-- on. Left to itself the first `SET DEFAULT uuidv7()` aborts the migration with a
-- bare "function uuidv7() does not exist", which reads as a broken migration rather
-- than an unsupported server.
-- =============================================================================
DO $$
BEGIN
  IF current_setting('server_version_num')::int < 180000 THEN
    RAISE EXCEPTION
      '0006_uuidv7 requires PostgreSQL 18 or newer for uuidv7(); this server is %',
      current_setting('server_version');
  END IF;
END $$;

-- =============================================================================
-- The nine primary keys whose defaults still mint a v4. Catalog-driven, so a table
-- added later is not silently left behind: see test/rls/uuid-keys.spec.ts, which
-- queries pg_attrdef for every uuid default in `public` — no table names hardcoded —
-- and fails if any of them is not `uuidv7()`.
-- =============================================================================
ALTER TABLE customers      ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE email_messages ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE groups         ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE login_attempts ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE permissions    ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE projects       ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE refresh_tokens ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE roles          ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE users          ALTER COLUMN id SET DEFAULT uuidv7();

-- =============================================================================
-- `refresh_tokens.jti` is a key too, and it was the one column left as `text`.
--
-- It could not simply take a default, because the `jti` claim lives inside the
-- access token and the refresh-token row is written afterwards — so the value has
-- to exist before the row does, and the database never gets to mint it.
-- `src/auth/uuidv7.ts` mints it instead, and the column is retyped so the database
-- can hold and validate it rather than trusting an arbitrary string.
--
-- The cast is deliberately unguarded. A `jti` that is not a UUID aborts this
-- migration instead of being silently rewritten, because the alternative — coercing
-- it to NULL under a NOT NULL column, or minting a replacement for a value that is
-- already inside a live token — is a wrong answer delivered quietly.
-- =============================================================================
ALTER TABLE refresh_tokens ALTER COLUMN jti TYPE uuid USING jti::uuid;
ALTER TABLE refresh_tokens ALTER COLUMN jti SET DEFAULT uuidv7();

-- Two indexes on one column: `refresh_tokens_jti_key` is UNIQUE, and a plain btree
-- on the same column is strictly a subset of what the unique index already provides.
-- It was redundant before this migration and this is where it goes.
DROP INDEX IF EXISTS refresh_tokens_jti_idx;

-- =============================================================================
-- No backfill, and no refresh of `authz.org_closure`.
--
-- A v4 and a v7 are both valid UUIDs; nothing in the schema, and nothing in the
-- policies, reads the version nibble. Rewriting existing keys would mean updating
-- every referencing row and rebuilding the closure matview, for the index-locality
-- gain above — a large, lock-taking, irreversible operation bought with the
-- smallest possible benefit. New rows are v7; existing rows stay v4 and age out on
-- their own.
-- =============================================================================

NOTIFY pgrst, 'reload schema';