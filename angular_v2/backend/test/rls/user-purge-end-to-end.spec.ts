import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqlPurgeExecutor } from '../../src/purge/purge-executor.js';
import type { PurgeClaim, PurgeClaimRow } from '../../src/purge/purge-claim.js';
import { CLAIM_DUE_PURGE_SQL, COMPLETE_PURGE_SQL, writtenRows } from '../../src/purge/purge-claim.js';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * A REAL user purge, end to end — the gap that hid the defect.
 *
 * ## Why this suite exists
 *
 * `SqlPurgeExecutor.deleteUser()` issues `DELETE FROM users WHERE id = $1`. Before
 * migration `0015`, that statement could not succeed for **any** user who had ever
 * authenticated: `refresh_tokens.user_id` and `email_messages.user_id` were both
 * `NO ACTION`, so the statement raised `23503`, `sweepOne()` unwound to
 * `PURGE_WORK_SAVEPOINT`, and the queue row was requeued until
 * `RETENTION_PURGE_MAX_ATTEMPTS` wrote it off as `failed`. The `failed` was
 * correct; nothing was ever `done`. A control that reports its own failure
 * faithfully and can never report success is `AGENTS.md` §2.1's "looks finished and
 * isn't".
 *
 * It stayed hidden because nothing purged a user who had both of those rows:
 *
 *   - `test/rls/user-identity.spec.ts` proves the cascade for `user_roles` and
 *     `user_groups` against `purgeVictim`, a user the fixture deliberately gives
 *     no `refresh_tokens` and no `email_messages`;
 *   - `test/unit/purge/**` drives a structural port that cannot observe FK
 *     behaviour at all.
 *
 * Every user who has ever signed in has both row sets. So the fixture here is a
 * user who has signed in, and the assertion is on ROW COUNTS (§B8: assert on
 * bodies and counts, never on the absence of an error — "no exception thrown" is
 * true of a purge that deleted nothing and of one that deleted everything).
 *
 * ## What is executed, and by what
 *
 * The SHIPPED `SqlPurgeExecutor`, driven over a real `pg` client connected as
 * `pgrst_authenticator` — the escalation boundary PostgREST itself uses — with
 * `SET LOCAL ROLE app_admin`, inside `BEGIN` / `SAVEPOINT purge_work` /
 * `RELEASE` / `COMMIT` in the exact order `PurgeSweeper.sweepOne()` uses them.
 *
 * **That session is now the whole of it.** This file used to add
 * `set_config('request.jwt.claims', …)` on top, because the bare-`UPDATE` claim it
 * drove could not see a row without an identity to be capability-checked as. Since
 * `0016` the claim is `authz.claim_due_purge()` and needs none, so the fixture's
 * session is byte-for-byte the sweeper's — which upgrades what this file proves from
 * "the executor can delete a real user" to "the sweeper's transaction completes a
 * real user purge". The removal is argued at `SWEEPER_INSTANCE`, below.
 *
 * There is no stand-in for `pg.PoolClient` anywhere in this file and no fake in
 * application code (§2.2). A double for a pg client is exactly the shape that hid
 * this defect: it cannot see a foreign key. The fixture writes through
 * `superuserExec` because `users` is FORCE RLS'd and the owner is bound by its own
 * policies; every ASSERTION about what a purge removed is read the same way, so a
 * filtered count can never be mistaken for "the row is gone".
 *
 * `PurgeSweeper.sweepOne()` is not called, and that is deliberate rather than
 * convenient: it is private, and it takes five constructor dependencies the
 * fixture would have to fabricate — and a fabricated breaker gate is a fake of a
 * real control. The four statements that matter are issued here in the order
 * `test/unit/purge/purge-transaction.spec.ts` already pins on the source, so if
 * the sweeper's order changes THAT test goes red and this one stops being a
 * faithful rehearsal.
 *
 * ## The database
 *
 * A throwaway one, built by the real pipeline — bootstrap as a superuser, every
 * migration in directory order as the owner, then the real `database/seed.ts` — so
 * the policies, the grants and the `FORCE` settings are genuinely in force. It
 * refuses the development database by name. The seed issues a CLUSTER-scoped
 * `ALTER ROLE pgrst_authenticator … PASSWORD`, so `afterAll` restores it.
 *
 * ## What each assertion is FOR
 *
 *  1. the shipped executor deletes a fully-populated user, and every referencing
 *     table's fate matches the decision `0015` recorded;
 *  2. the compliance record OUTLIVES the subject, keyed by `request_key` — the
 *     24-month retention of `0010`/`0011`, asserted positively rather than by the
 *     absence of a row;
 *  3. the cascade's predicate is BOUNDED: a second user's rows are untouched, so
 *     "a purge of X removes X's rows and no other user's rows" is checkable;
 *  4. a failing purge unwinds the delete alone, so no half-purged user exists;
 *  5. the CATALOG: every foreign key naming `users` is `CASCADE`. This closes the
 *     class rather than the instance — a sixth referencing table added later as
 *     `NO ACTION` fails here rather than re-opening the defect silently;
 *  6. the escalations the cascade is documented as granting stay bounded: no
 *     serving role other than `app_admin` can delete a `users` row at all, and
 *     `app_admin` still cannot delete a mail row or a token row on its own, so
 *     the referential action is the only route by which a purge empties them;
 *  7. and, since `0016`, that the claim and the completion both happen in a session
 *     with **no claims document in scope** — which is the condition under which the
 *     shipped sweeper claimed nothing at all.
 */

const TIMEOUT = 300_000;
const PROOF_DB = 'user_purge_end_to_end_proof';

const BOOTSTRAP_SQL = join(BACKEND_ROOT, 'database', 'bootstrap', '001_roles.sql');
const MIGRATIONS_DIR = join(BACKEND_ROOT, 'database', 'migrations');

/** The sweeper instance this file speaks as — the value every write predicates on. */
const SWEEPER_INSTANCE = 'sweeper-purge-proof-0001';

/**
 * ## There is no claims document in this file, and there must not be one
 *
 * It used to set one: the claim was the bare `UPDATE` from `purge-claim.ts`, whose
 * inner `SELECT … FOR UPDATE SKIP LOCKED` is governed by `privacy_purge_read` — a
 * capability call on `authz.actor()` — so a claimless session matched zero rows and
 * this suite had to lend the sweeper an identity to get past it. The comment that
 * explained the workaround called it a defect.
 *
 * **The workaround has been removed rather than copied**, and `0016` is what makes
 * removing it possible: the claim now goes through `authz.claim_due_purge()`, a
 * `SECURITY DEFINER` function granted to `app_admin` alone, which performs the
 * claim as the table's owner. This file's session is now byte-for-byte the session
 * `PurgeSweeper.sweepOne()` opens — `pgrst_authenticator`, `SET LOCAL ROLE
 * app_admin`, and nothing else.
 *
 * That matters beyond tidiness. `request.jwt.claims` is a **custom GUC that any
 * role may `SET`** — `AGENTS.md` §B2 F1 records it as verified exploitable — and
 * the entire mitigation is architectural: *no request-reachable SQL path may write
 * it*. A test that sets it is normalising the hazard, and a scheduled job that set
 * it would be that path, promoted to a standing P0 so a cron entry could drain a
 * queue. A fixture accommodation for a defect is how a defect survives a fix: the
 * next reader sees a claims document in the retention path and concludes the
 * retention path needs one.
 */

/** Read from the directory: a hand-kept list goes stale the day a migration lands. */
function migrationFiles(): readonly string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4,}_.*\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort();
}

// =============================================================================
// The fixture identities
// =============================================================================

/**
 * Two users, because "a purge of X touches nothing but X" needs a bystander.
 *
 * `victim` is fully populated — a role row, a membership row, a privacy request
 * with its regulation row, TWO mail rows and TWO refresh tokens joined by a
 * rotation chain. `bystander` carries the same shape, so "the bystander survived"
 * is a statement about the cascade's PREDICATE rather than about a bystander that
 * happened to have nothing to lose.
 */
const IDS = {
  groups: { purge: 'f0000000-0000-0000-0000-000000000001' },
  users: {
    victim: 'f0000000-0000-0000-0000-0000000000a1',
    bystander: 'f0000000-0000-0000-0000-0000000000b2',
  },
} as const;

const SUBJECT = IDS.users.victim;
const BYSTANDER = IDS.users.bystander;

// =============================================================================
// Database plumbing
// =============================================================================

function psqlAsSuperuser(database: string, sql: string): string {
  const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', database, '-c', sql], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`superuser psql failed against ${database}:\n${sql}\n${result.stderr}`);
  }
  return result.stdout;
}

function superuserExec(sql: string, database: string = PROOF_DB): void {
  psqlAsSuperuser(database, sql);
}

/** Superuser SQL, returned as parsed JSON rows. Unfiltered by RLS by construction. */
function superuserRows<T>(sql: string): readonly T[] {
  const stdout = psqlAsSuperuser(
    PROOF_DB,
    `SELECT coalesce(json_agg(_q)::text, '[]') FROM (${sql.replace(/;\s*$/, '')}) AS _q`,
  );
  const trimmed = stdout.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
}

function psqlAsSuperuserFile(database: string, path: string): void {
  const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', database, '-f', path], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`applying ${path} as superuser failed:\n${result.stderr}`);
  }
}

function recreateDatabase(name: string): void {
  const devDb = databaseConfig().database;
  if (name === devDb || name === 'app_dev') {
    throw new Error(`refusing to run the user-purge proof against the development database (${name})`);
  }
  // Terminate first: a leaked backend makes DROP fail naming a connection the
  // operator cannot see (AGENTS.md §B8).
  superuserExec(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
    'postgres',
  );
  superuserExec(`DROP DATABASE IF EXISTS ${name}`, 'postgres');
  superuserExec(`CREATE DATABASE ${name} OWNER ${databaseConfig().user}`, 'postgres');
}

function dropProofDatabase(): void {
  superuserExec(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PROOF_DB}' AND pid <> pg_backend_pid()`,
    'postgres',
  );
  superuserExec(`DROP DATABASE IF EXISTS ${PROOF_DB}`, 'postgres');
}

/** Bootstrap as a superuser, then every migration as the owner role — the seed's own order. */
function applyBaseline(): void {
  psqlAsSuperuserFile(PROOF_DB, BOOTSTRAP_SQL);
  const config = loadTestEnvironment().database;
  for (const migration of migrationFiles()) {
    const result = spawnSync(
      'psql',
      ['-v', 'ON_ERROR_STOP=1', '-q', '-h', config.host, '-U', config.user, '-d', PROOF_DB, '-f', join(MIGRATIONS_DIR, migration)],
      { encoding: 'utf8', env: { ...process.env, PGPASSWORD: config.password } },
    );
    if (result.status !== 0) {
      throw new Error(`applying ${migration} as ${config.user} failed:\n${result.stderr}`);
    }
  }
}

let seedRun: { readonly code: number; readonly output: string };

function runSeed(): { readonly code: number; readonly output: string } {
  const result = spawnSync('node', ['--experimental-strip-types', 'database/seed.ts'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DB_NAME: PROOF_DB, SEED_ADMIN_PASSWORD: 'user-purge-proof-admin-password' },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * The escalation boundary PostgREST itself uses, with the CONFIGURED password.
 *
 * A `Pool` rather than a bare `Client`, because `PurgeExecutor.execute()` takes a
 * `PoolClient` and the sweeper takes its connection from `PurgeConnectionSource
 * .connect()` — which is a pool. A `Client` is not a `PoolClient` (it has no
 * `release()`), so widening the shipped port type to accept one would be editing
 * the mechanism to suit the test.
 *
 * ONE pool for the file, closed in `afterAll`. A pool built per call would leave a
 * socket open behind every probe, and the last one would be held against a
 * database `afterAll` is about to drop — which is the failure §B8 names when it
 * says a leaked backend makes `DROP DATABASE` name a connection the operator cannot
 * see.
 */
let boundary: Pool | undefined;

function authenticatorPool(): Pool {
  const authenticator = loadTestEnvironment().authenticator;
  const database = loadTestEnvironment().database;
  boundary ??= new Pool({
    host: database.host,
    port: database.port,
    user: authenticator.user,
    password: authenticator.password,
    database: PROOF_DB,
    max: 2,
  });
  return boundary;
}

/** One checked-out connection from the escalation boundary. */
async function escalationConnection(): Promise<PoolClient> {
  return authenticatorPool().connect();
}

/**
 * Enqueues one purge, as the OWNER, because the owner is the only identity that
 * can: `0011:407-419` withholds `INSERT` from every serving role and no policy
 * admits one. That refusal is a control asserted in
 * `privacy-purge-queue.spec.ts`; here it is why the fixture's enqueue is a
 * superuser write, and it is why nothing in this file can be mistaken for a
 * human-initiated purge.
 */
function enqueuePurge(targetId: string, targetRef: string, reason: string): string {
  // `psqlAsSuperuser` rather than `superuserRows`: an `INSERT … RETURNING` cannot be
  // wrapped in the `json_agg` subquery the row helper needs, and psql's `-t -A` output
  // is already the bare id.
  const id = psqlAsSuperuser(
    PROOF_DB,
    `INSERT INTO privacy_purge_queue (target_kind, target_id, target_ref, reason, scheduled_for)
     VALUES ('user', '${targetId}', '${targetRef}', '${reason}', now() - interval '1 second')
     RETURNING id`,
  ).trim();
  if (id === '') {
    throw new Error(`the fixture could not enqueue a purge for ${targetRef}`);
  }
  return id;
}

// =============================================================================
// The probe: the sweeper's transaction, driven around the SHIPPED executor
// =============================================================================

type PurgeOutcome =
  | { readonly outcome: 'completed'; readonly rowsDeleted: number }
  | { readonly outcome: 'raised'; readonly code: string; readonly message: string; readonly detail: string };

/**
 * Runs one purge through `SqlPurgeExecutor` in the sweeper's exact transaction
 * shape, and reports whether it COMPLETED or RAISED — never "it returned".
 *
 * The claim is taken with the SHIPPED `CLAIM_DUE_PURGE_SQL` and the completion
 * written with the SHIPPED `COMPLETE_PURGE_SQL`, both imported from
 * `src/purge/purge-claim.ts`, so this exercises the real queue contract rather
 * than a hand-written copy of it — and a fixture INSERT that the sweeper's own
 * `LIMIT 1` would never have claimed could not masquerade as a purge here.
 *
 * **Both are calls into `authz` since `0016`**, and both report their outcome as a
 * RETURNED VALUE rather than as a command tag: the claim returns the row it took
 * (or nothing at all), and the completion returns the number of rows it matched.
 * Reading either from `rowCount` would be wrong — `pg` reports one row for a
 * `SELECT` whether or not the function found anything — and `0` is the answer that
 * matters, because it means this sweeper no longer owns the row.
 */
async function runPurge(claim: PurgeClaim): Promise<PurgeOutcome> {
  const client = await escalationConnection();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_admin');

    const claimed = await client.query<PurgeClaimRow>(CLAIM_DUE_PURGE_SQL, [SWEEPER_INSTANCE]);
    const claimedId: string | undefined = claimed.rows[0]?.id;
    if (claimedId === undefined) {
      throw new Error(
        `the claim returned no row; the fixture enqueued ${claim.id} and the sweeper's own statement ` +
          'claimed nothing. Before `0016` this is exactly what a claimless session produced — UPDATE 0.',
      );
    }
    if (claimedId !== claim.id) {
      throw new Error(`the sweeper's own claim statement claimed ${claimedId}, not the fixture's row`);
    }

    await client.query('SAVEPOINT purge_work');
    try {
      const rowsDeleted = await new SqlPurgeExecutor().execute(client, claim);
      await client.query('RELEASE SAVEPOINT purge_work');
      const completed = await client.query(COMPLETE_PURGE_SQL, [claim.id, SWEEPER_INSTANCE, rowsDeleted]);
      if (writtenRows(completed) !== 1) {
        throw new Error('the completion statement matched zero rows; the ownership predicate did not hold');
      }
      await client.query('COMMIT');
      return { outcome: 'completed', rowsDeleted };
    } catch (error) {
      // The sweeper's failure path, verbatim: unwind the delete alone and keep the
      // claim, which is what `recordFailure` needs in order to match on ownership.
      await client.query('ROLLBACK TO SAVEPOINT purge_work');
      await client.query('COMMIT');
      const failure = error as { code?: string; message: string; detail?: string };
      return {
        outcome: 'raised',
        code: failure.code ?? 'unknown',
        message: failure.message,
        detail: failure.detail ?? '',
      };
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// =============================================================================
// The row-count probe
// =============================================================================

type SurvivorCounts = {
  readonly users: number;
  readonly refresh_tokens: number;
  readonly email_messages: number;
  readonly user_roles: number;
  readonly user_groups: number;
  readonly privacy_requests: number;
  readonly privacy_request_regulations: number;
};

/**
 * The fate of every row that names this user, counted as a superuser.
 *
 * Every count is an UNFILTERED read. A filtered count cannot distinguish "nothing
 * was deleted" from "I can see nothing", which makes every denial assertion
 * vacuous — `AGENTS.md` §B5 names this and it is the reason a purge test that
 * read through `app_admin` would be unable to see the deletion at all.
 */
function survivorsFor(userId: string): SurvivorCounts {
  const rows = superuserRows<SurvivorCounts>(
    `SELECT
       (SELECT count(*) FROM users                     WHERE id       = '${userId}') AS users,
       (SELECT count(*) FROM refresh_tokens            WHERE user_id = '${userId}') AS refresh_tokens,
       (SELECT count(*) FROM email_messages            WHERE user_id = '${userId}') AS email_messages,
       (SELECT count(*) FROM user_roles                WHERE user_id = '${userId}') AS user_roles,
       (SELECT count(*) FROM user_groups               WHERE user_id = '${userId}') AS user_groups,
       (SELECT count(*) FROM privacy_requests          WHERE user_id = '${userId}') AS privacy_requests,
       (SELECT count(*) FROM privacy_request_regulations r
          JOIN privacy_requests p ON p.id = r.request_id
         WHERE p.user_id = '${userId}') AS privacy_request_regulations`,
  )[0];
  if (rows === undefined) {
    throw new Error('the count probe returned no row');
  }
  return rows;
}

/** The shape the fixture builds for BOTH users, asserted before either purge runs. */
const POPULATED = {
  users: 1,
  refresh_tokens: 2,
  email_messages: 2,
  user_roles: 1,
  user_groups: 1,
  privacy_requests: 1,
  privacy_request_regulations: 1,
} as const satisfies SurvivorCounts;

/** Nothing left: every referencing table followed the user out. */
const GONE = {
  users: 0,
  refresh_tokens: 0,
  email_messages: 0,
  user_roles: 0,
  user_groups: 0,
  privacy_requests: 0,
  privacy_request_regulations: 0,
} as const satisfies SurvivorCounts;

// =============================================================================
// Provision
// =============================================================================

let victimQueueRow = '';
let victimRequestKey = '';

beforeAll(() => {
  recreateDatabase(PROOF_DB);
  applyBaseline();
  seedRun = runSeed();
  if (seedRun.code !== 0) {
    throw new Error(`database/seed.ts failed (exit ${seedRun.code}):\n${seedRun.output}`);
  }

  // The fixture is written as the SUPERUSER, because `users` is FORCE RLS'd and the
  // owner is bound by its own policy — the same fact `0009:71-95` records. Writing
  // it any other way would need `SET row_security = off`, which is the owner bypass
  // reopened, and it is forbidden in this repository.
  const memberRole = superuserRows<{ id: string }>(`SELECT id FROM roles WHERE name = 'member'`)[0]?.id;
  if (memberRole === undefined) {
    throw new Error('the seeded `member` role is absent, so the fixture cannot give its users an authority row');
  }

  superuserExec(`INSERT INTO groups (id, name) VALUES ('${IDS.groups.purge}', 'PURGE-PROOF')`);

  for (const [user, username] of [
    [IDS.users.victim, 'purge-victim'],
    [IDS.users.bystander, 'purge-bystander'],
  ] as const) {
    superuserExec(
      `INSERT INTO users (id, username, email, password_hash)
       VALUES ('${user}', '${username}', '${username}@example.test', 'probe-hash-not-a-real-hash')`,
    );
    superuserExec(`INSERT INTO user_roles (user_id, role_id) VALUES ('${user}', '${memberRole}')`);
    superuserExec(`INSERT INTO user_groups (user_id, group_id) VALUES ('${user}', '${IDS.groups.purge}')`);

    // A privacy request, with its regulation child — the TRANSITIVE cascade, two
    // levels deep, so a fix that repaired only the first foreign key would still
    // pass a one-level fixture.
    superuserExec(
      `INSERT INTO privacy_requests (user_id, request_nature, request_channel)
       VALUES ('${user}', 'access', 'in_app')`,
    );
    const requestId = superuserRows<{ id: string }>(
      `SELECT id FROM privacy_requests WHERE user_id = '${user}' AND request_nature = 'access'`,
    )[0]?.id;
    if (requestId === undefined) {
      throw new Error(`the fixture could not read back the privacy request it inserted for ${username}`);
    }
    superuserExec(
      `INSERT INTO privacy_request_regulations (request_id, regulation, sla_deadline)
       VALUES ('${requestId}', 'ccpa', now() + interval '30 days')`,
    );

    // TWO mail rows, so "every row went" is a plural claim rather than one that a
    // single row would satisfy.
    for (const template of ['welcome', 'password_reset']) {
      superuserExec(
        `INSERT INTO email_messages (user_id, template, recipient, subject, status, content_class)
         VALUES ('${user}', '${template}', '${username}@example.test', 'subject-${template}', 'sent', 'metadata_only')`,
      );
    }

    // TWO refresh tokens joined by a ROTATION CHAIN. This is the shape that decides
    // whether a cascade survives the self-referencing `rotated_to` foreign key:
    // token A names token B, both belong to the user, and `rotated_to` is
    // `NO ACTION`. A one-token fixture cannot see it.
    superuserExec(
      `INSERT INTO refresh_tokens (user_id, jti, token_hash, expires_at)
       VALUES ('${user}', uuidv7(), md5('${username}') || '-a', now() + interval '30 days')`,
    );
    superuserExec(
      `INSERT INTO refresh_tokens (user_id, jti, token_hash, expires_at)
       VALUES ('${user}', uuidv7(), md5('${username}') || '-b', now() + interval '30 days')`,
    );
    superuserExec(
      `UPDATE refresh_tokens
          SET rotated_to = (SELECT id FROM refresh_tokens WHERE user_id = '${user}' AND token_hash = md5('${username}') || '-b')
        WHERE user_id = '${user}' AND token_hash = md5('${username}') || '-a'`,
    );
  }

  victimQueueRow = enqueuePurge(SUBJECT, 'purge-victim', 'inactivity_purge');

  // The compliance record for the victim, written BEFORE the purge — which is the
  // only order in which it can be written at all: it is keyed by `request_key`
  // rather than by `request_id` precisely so it does not depend on the request
  // continuing to exist, but the fixture still has to have a request to describe.
  const victimRequest = superuserRows<{ id: string; request_key: string }>(
    `SELECT id, request_key FROM privacy_requests WHERE user_id = '${SUBJECT}'`,
  )[0];
  if (victimRequest === undefined) {
    throw new Error('the fixture could not read back the victim’s privacy request');
  }
  victimRequestKey = victimRequest.request_key;
  superuserExec(
    `INSERT INTO privacy_request_audits
       (event_type, request_key, requested_at, request_nature, request_channel,
        subject_hmac, pepper_kid, subject_user_id)
     SELECT 'received', request_key, requested_at, request_nature, request_channel,
            decode(md5(user_id::text) || md5(user_id::text), 'hex'), 'probe-pepper', user_id
       FROM privacy_requests WHERE id = '${victimRequest.id}'`,
  );
}, TIMEOUT);

afterAll(async () => {
  // The pool goes BEFORE the database: a client still connected to
  // `user_purge_end_to_end_proof` is what makes `DROP DATABASE` fail naming a
  // connection the operator cannot see (§B8).
  const pool = boundary;
  boundary = undefined;
  if (pool !== undefined) {
    await pool.end();
  }
  // `database/seed.ts` runs a CLUSTER-scoped `ALTER ROLE … PASSWORD`, so the restore
  // is in a `finally`: it is the one step that must not be skipped.
  try {
    dropProofDatabase();
  } finally {
    restoreAuthenticatorPassword();
  }
});

/** One claim on an already-enqueued queue row, for a `user` target. */
function claimFor(queueRowId: string, targetId: string, reason: string): PurgeClaim {
  return { id: queueRowId, targetKind: 'user', targetId, targetRef: null, reason, attempt: 1 };
}

// =============================================================================
// 1 — the purge completes, and every child table's fate matches 0015
// =============================================================================

describe('a real user purge removes the user AND every row that references it', () => {
  it(
    'the shipped executor deletes a fully-populated user, and the counts go to zero',
    async () => {
      // The fixture's own precondition, asserted before the purge so a red here is
      // never a red about a fixture that silently built nothing. "No exception
      // thrown" would pass on a user with no children at all — which is exactly the
      // shape that hid the defect.
      expect(survivorsFor(SUBJECT)).toEqual(POPULATED);

      const result = await runPurge(claimFor(victimQueueRow, SUBJECT, 'inactivity_purge'));
      if (result.outcome === 'raised') {
        // Naming the PostgreSQL error rather than "it threw" is the whole point of
        // this suite: `23503` naming `refresh_tokens_user_id_fkey` IS the defect,
        // and a future failure naming something else should read as itself.
        throw new Error(
          `SqlPurgeExecutor raised ${result.code}: ${result.message}\n${result.detail}\n` +
            'A purge that raises here is the defect this suite exists to catch.',
        );
      }

      // `rows_deleted` counts the TARGET rows — `DELETE FROM users WHERE id = $1` —
      // and NOT the cascaded children. That is the column's long-standing meaning
      // (`0015`, "THE RESIDUAL THAT IS NOT BOUNDED") and it is asserted here so a
      // change to it cannot pass unnoticed.
      expect(result.rowsDeleted).toBe(1);

      // THE ASSERTION. Counts, read as a superuser, per §B8 — not "no exception",
      // which is true of a purge that removed nothing.
      expect(survivorsFor(SUBJECT)).toEqual(GONE);

      // The queue row reached `done` carrying the count, which is the operator's
      // only evidence the purge ran at all. `error` is NULL because `COMPLETE_PURGE_SQL`
      // clears it, and `attempt` is 1 because the claim advanced it.
      expect(
        superuserRows<{ status: string; rows_deleted: number; error: string | null; attempt: number }>(
          `SELECT status, rows_deleted, error, attempt FROM privacy_purge_queue WHERE id = '${victimQueueRow}'`,
        )[0],
      ).toEqual({ status: 'done', rows_deleted: 1, error: null, attempt: 1 });
    },
    TIMEOUT,
  );

  it(
    'the bystander keeps every row, so the cascade is bounded to the row being deleted',
    () => {
      // "A purge scheduled for user X deletes exactly user X's row and no other
      // user's row" is the property `purge-executor.ts:55-70` says the count makes
      // checkable. It is only checkable with a SECOND user carrying the same shape.
      expect(survivorsFor(BYSTANDER)).toEqual(POPULATED);
      // The victim must already be gone, or this proves nothing about bounding.
      expect(survivorsFor(SUBJECT).users, 'the victim must already be purged for this to prove anything').toBe(0);
    },
    TIMEOUT,
  );

  it(
    'the compliance record OUTLIVES the subject — 24 months of a consumer request is not erased with them',
    () => {
      // The half of the cascade decision that must not go with it. `0010:169-177`
      // gives `privacy_request_audits` no foreign key and `request_key` instead of
      // `request_id` for exactly this reason, and `0010:298-307` records the
      // statutory reason. Asserted POSITIVELY, by finding the row and matching it
      // on the key that replaced the join — the absence of a row in a table nobody
      // purged would pass just as well.
      const audit = superuserRows<{ event_type: string; subject_hmac: string; subject_user_id: string | null }>(
        `SELECT event_type, encode(subject_hmac, 'hex') AS subject_hmac, subject_user_id
           FROM privacy_request_audits WHERE request_key = '${victimRequestKey}'`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.subject_hmac).not.toBe('');

      // The victim's own request row is GONE, so the audit row is demonstrably an
      // orphan and demonstrably still there. Without this the assertion above would
      // pass on a fixture whose compliance record had outlived nothing.
      expect(survivorsFor(SUBJECT).privacy_requests).toBe(0);

      // …and no role in the database may write to it, which is what makes the row's
      // survival a property of the schema rather than of nobody having deleted it
      // yet (`0010:250-258`).
      for (const role of ['app_anon', 'app_member', 'app_admin']) {
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
          expect(
            superuserRows<{ holds: boolean }>(
              `SELECT has_table_privilege('${role}', 'public.privacy_request_audits', '${privilege}') AS holds`,
            )[0]?.holds,
            `${role} holds ${privilege} on privacy_request_audits`,
          ).toBe(false);
        }
      }
    },
    TIMEOUT,
  );
});

// =============================================================================
// 2 — a failing purge leaves no half-purged user
// =============================================================================

describe('a purge that fails leaves no half-purged user', () => {
  it(
    'the savepoint unwinds the delete alone: the subject is intact after the executor raises',
    async () => {
      // `PURGE_WORK_SAVEPOINT` exists so that a `DELETE` which raises leaves the
      // claim — and therefore the ownership predicate `recordFailure` needs — inside
      // the same transaction (`purge-claim.ts:142-164`). The subject's survival is
      // asserted by COUNT, because "nothing raised" is what a purge that deleted
      // the user and then failed to record anything also looks like from outside.
      //
      // The executor raises for a reason it cannot execute rather than returning
      // `0` — `UnsupportedPurgeReasonError`, `purge-executor.ts:15-23`. That is the
      // shipped refusal, not a manufactured failure, and it is the same shape the
      // `23503` defect took.
      const bystanderQueueRow = enqueuePurge(BYSTANDER, 'purge-bystander', 'retention_login_attempts');
      const before = survivorsFor(BYSTANDER);
      expect(before).toEqual(POPULATED);

      const result = await runPurge(claimFor(bystanderQueueRow, BYSTANDER, 'retention_login_attempts'));
      expect(result.outcome, 'the executor was supposed to raise, and saying so is the point').toBe('raised');

      // The half of "no partial state" that is actually about the SUBJECT: every
      // row the fixture built is still there.
      expect(survivorsFor(BYSTANDER)).toEqual(before);

      // …and the claim SURVIVED the unwind, which is what a savepoint buys over a
      // transaction-wide rollback. Asserted by attempt, not by status alone: a
      // rolled-back claim would read `pending` at attempt 0.
      expect(
        superuserRows<{ status: string; attempt: number; rows_deleted: number | null; error: string | null }>(
          `SELECT status, attempt, rows_deleted, error FROM privacy_purge_queue WHERE id = '${bystanderQueueRow}'`,
        )[0],
      ).toMatchObject({ status: 'claimed', attempt: 1, rows_deleted: null });
    },
    TIMEOUT,
  );
});

// =============================================================================
// 3 — the catalog: every foreign key naming `users` is CASCADE
// =============================================================================

describe('no foreign key naming users can block a purge again', () => {
  it(
    'every table that references users carries ON DELETE CASCADE, and the set is exactly the five 0015 names',
    () => {
      // This is the assertion that closes the CLASS rather than the instance. `0015`
      // fixed two constraints; this says any table added later as `NO ACTION` — the
      // exact shape of the defect — fails the gate instead of re-opening it
      // silently. A test that only purges one fixture user cannot see a sixth
      // referencing table at all.
      //
      // Read from `pg_constraint` rather than from a list in this file, and the list
      // itself is asserted, so a new referencing table has to be given a name and a
      // decision before this suite goes green.
      const referencing = superuserRows<{ child: string; confdeltype: string }>(
        `SELECT child.relname AS child, con.confdeltype AS confdeltype
           FROM pg_constraint con
           JOIN pg_class child  ON child.oid = con.conrelid
           JOIN pg_class parent ON parent.oid = con.confrelid
           JOIN pg_namespace n  ON n.oid = child.relnamespace
          WHERE con.contype = 'f'
            AND n.nspname = 'public'
            AND parent.relname = 'users'
          ORDER BY child.relname`,
      );

      expect(referencing.map((row) => row.child)).toEqual([
        'email_messages',
        'privacy_requests',
        'refresh_tokens',
        'user_groups',
        'user_roles',
      ]);

      // `c` is `confdeltype` for CASCADE. `a` (NO ACTION) is what made every purge
      // of a real user raise `23503`.
      expect(referencing.filter((row) => row.confdeltype !== 'c')).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'the compliance record still carries no foreign key to anything, so nothing can cascade into it',
    () => {
      // `0010:169-177`: `request_key` instead of `request_id`, so the evidence that
      // a request was honoured outlives both the request and the user. Asserted
      // against the catalog so a future "tidy-up" that adds an FK is caught here.
      // Nothing may REFERENCE the compliance table: a `CASCADE` would erase the
      // evidence and a `NO ACTION` would block every deletion for the whole
      // 24-month window.
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_constraint
            WHERE contype = 'f' AND confrelid = 'public.privacy_request_audits'::regclass`,
        )[0]?.count,
      ).toBe(0);

      // …and the queue row carries none either, so the record that a purge was
      // SCHEDULED also outlives its target.
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_constraint
            WHERE contype = 'f' AND conrelid = 'public.privacy_purge_queue'::regclass`,
        )[0]?.count,
      ).toBe(0);

      // …and `0015` did not unbind either table from its owner while it was at it:
      // `FORCE` is what stops the owner bypassing `email_messages`' own policies.
      expect(
        superuserRows<{ relname: string; forced: boolean }>(
          `SELECT c.relname, c.relforcerowsecurity AS forced
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname IN ('email_messages', 'refresh_tokens', 'users')
            ORDER BY c.relname`,
        ),
      ).toEqual([
        { relname: 'email_messages', forced: true },
        { relname: 'refresh_tokens', forced: true },
        { relname: 'users', forced: true },
      ]);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 4 — the cascade's reach is bounded by the `users` DELETE grant
// =============================================================================

describe('only app_admin can reach the cascade, because only app_admin can delete a user', () => {
  it(
    'app_member and app_anon hold no DELETE on users, so neither can trigger a cascade',
    () => {
      // The bounding argument `0015` makes about the cascade crossing RLS: it is
      // reachable by whoever holds `DELETE` on `users`, and by nobody else. The
      // grant is the control, so it is asserted here rather than described in a
      // comment where a later widening would not read it.
      for (const role of ['app_anon', 'app_member']) {
        expect(
          superuserRows<{ holds: boolean }>(
            `SELECT has_table_privilege('${role}', 'public.users', 'DELETE') AS holds`,
          )[0]?.holds,
          `${role} holds DELETE on users`,
        ).toBe(false);
      }

      // `app_admin` does hold it — otherwise the sweeper could not run at all, and a
      // suite that only ever checks denials would pass on a schema where the purge
      // is impossible for a completely different reason.
      expect(
        superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_admin', 'public.users', 'DELETE') AS holds`,
        )[0]?.holds,
      ).toBe(true);

      // …and the policy admits `app_admin` and nothing else, so a role granted DELETE
      // later would still be refused at the row layer.
      const policies = superuserRows<{ cmd: string; qual: string }>(
        `SELECT cmd, qual FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'users' AND cmd = 'DELETE'`,
      );
      expect(policies).toHaveLength(1);
      expect(policies[0]?.qual).toContain('app_admin');
    },
    TIMEOUT,
  );

  it(
    'app_admin still cannot delete a mail row or a token row on its own, so the cascade really is the only route',
    async () => {
      // The half of the `0015` argument that decided the design. There is NO explicit
      // ordered child-delete available to the sweeper, because it cannot delete these
      // rows by any other means — asserted live, as `app_admin`, so a future
      // `GRANT DELETE` is caught here rather than quietly reopening the question.
      const client = await escalationConnection();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE app_admin');

        // Both of these are refused AT THE GRANT, which is `0015`'s stated reason:
        // no role below superuser holds DELETE on either table, so the sweeper's
        // `DELETE FROM users` is the only thing that can clear them.
        for (const statement of [
          `DELETE FROM email_messages WHERE user_id = '${BYSTANDER}'`,
          `DELETE FROM refresh_tokens WHERE user_id = '${BYSTANDER}'`,
        ]) {
          const refusal = await client.query(statement).then(
            () => ({ ok: true as const }),
            (error: unknown) => ({ ok: false as const, error: error as Error }),
          );
          await client.query('ROLLBACK');
          expect(refusal.ok, `app_admin was able to run: ${statement}`).toBe(false);
          expect((refusal as { error: Error }).error.message).toContain('permission denied for table');
          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE app_admin');
        }

        // The UPDATE is the interesting third case, because it does NOT raise.
        // `app_admin` holds the UPDATE grant, but `email_messages` has no `FOR
        // UPDATE` policy and is FORCE RLS'd, so the statement SUCCEEDS AND MATCHES
        // ZERO ROWS. That is §2.3's silent-success shape, live, on this table — and
        // it is the reason `0015` measured row counts rather than trusting either
        // the exit status or the cascade.
        const tampered = await client.query(
          `UPDATE email_messages SET subject = 'tampered' WHERE user_id = '${BYSTANDER}' RETURNING id`,
        );
        expect(tampered.rowCount, 'an UPDATE matched rows, so 0015 measured this wrong').toBe(0);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // …and nothing was disturbed by any of the three attempts.
      expect(survivorsFor(BYSTANDER).email_messages).toBe(2);
      expect(survivorsFor(BYSTANDER).refresh_tokens).toBe(2);
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM email_messages WHERE subject = 'tampered'`,
        )[0]?.count,
      ).toBe(0);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 5 — the proof is a real provision
// =============================================================================

describe('this purge ran against a real provisioned database', () => {
  it(
    'the real seed ran, and the schema the purge executed against carries the migration 0015 changes',
    () => {
      // Without this, every count above would also pass against an un-applied
      // migration or a failed seed.
      expect(seedRun.code, seedRun.output).toBe(0);
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM public.refresh_tokens
            WHERE user_id = '${BYSTANDER}' AND rotated_to IS NOT NULL`,
        )[0]?.count,
        'the fixture did not build a rotation chain, so the self-referencing FK was never exercised',
      ).toBe(1);
      expect(
        superuserRows<{ definition: string }>(
          `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
            WHERE conname IN ('refresh_tokens_user_id_fkey', 'email_messages_user_id_fkey')
            ORDER BY conname`,
        ).map((row) => row.definition),
      ).toEqual([
        'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
        'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
      ]);
    },
    TIMEOUT,
  );
});