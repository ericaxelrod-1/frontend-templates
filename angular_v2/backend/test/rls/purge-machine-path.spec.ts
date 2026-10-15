import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENQUEUE_INACTIVE_PURGES_SQL, SELECT_DUE_PURGES_SQL } from '../../src/purge/purge-enqueue.js';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * The machine claim path and the enqueue scan — migration
 * `0016_purge_machine_path.sql`.
 *
 * ## The defect this file is the red test for
 *
 * `PurgeSweeper.sweepOne()` opens a transaction, runs `SET LOCAL ROLE app_admin` and
 * calls the claim. There is **no `request.jwt.claims` in scope**, deliberately, and
 * `0016` is what made that possible:
 *
 *   * the claim used to be a bare `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED)`,
 *     and that inner `SELECT` is governed by `privacy_purge_read` — which is
 *     `authz.can_read_privacy_purge()` ALONE, by the deliberate decision recorded at
 *     `0011:383-388`. `authz.actor()` is NULL in the sweeper, so the sub-select was
 *     empty and the statement matched **zero rows in production**, silently, with no
 *     error anywhere. Measured on this schema, no claims document in scope:
 *     `UPDATE 0`;
 *   * it is now `authz.claim_due_purge()`, a `SECURITY DEFINER` function granted to
 *     `app_admin` alone, which claims as the table's owner.
 *
 * ## Why "no claims document in scope" is ASSERTED and not merely mentioned
 *
 * The two roads back to a working claim were a `current_user` branch on
 * `privacy_purge_read` (which `privacy-purge-queue.spec.ts` asserts AGAINST) and
 * giving the sweeper an identity to be capability-checked as. The second is the
 * hazard: `request.jwt.claims` is a **custom GUC that any role may `SET`**
 * (`AGENTS.md` §B2 F1 — verified exploitable, a member set it and read another
 * tenant's rows), and the entire mitigation is architectural — *no request-reachable
 * SQL path may write it*. A scheduled job writing its own identity document would be
 * that path, promoted to a standing P0 so a cron entry could drain a queue.
 *
 * So the first test in this file runs the claim and then reads
 * `current_setting('request.jwt.claims', true)` **in the same transaction**, and fails
 * if anything is there. A fixture that lent the sweeper a claims document — which is
 * exactly what `test/rls/user-purge-end-to-end.spec.ts` used to do, and which was
 * removed rather than copied — would fail this assertion instead of passing quietly.
 * That is what stops the workaround being reintroduced as a convenience.
 *
 * ## What the positive assertions are for
 *
 * §B2's measured note: *"A body reading `current_user` inside a `SECURITY DEFINER`
 * function answers identically for everyone, which denies everyone with an ordinary
 * zero-row result."* A suite of denial tests cannot see that — every one of them
 * passes against a definer that denies everybody. So the permitted case is asserted
 * here, positively, and the refusals are asserted as refusals **at the function**,
 * which is a different control from a refusal at the table and therefore a different
 * message.
 *
 * ## Why assertions are on row counts
 *
 * §B8: "no exception thrown" is true of a sweep that enqueued nothing and of one that
 * enqueued everything. Every assertion below reads a COUNT or a row identity.
 *
 * ## The database
 *
 * A throwaway one built by the real pipeline — bootstrap as a superuser, every
 * migration in directory order as the owner, then the real `database/seed.ts` — so
 * the policies, the grants and the `FORCE` settings are genuinely in force. It
 * refuses the development database by name. The seed issues a CLUSTER-scoped
 * `ALTER ROLE pgrst_authenticator … PASSWORD`, so `afterAll` restores it.
 */

const TIMEOUT = 300_000;
const PROOF_DB = 'purge_machine_path_proof';

const BOOTSTRAP_SQL = join(BACKEND_ROOT, 'database', 'bootstrap', '001_roles.sql');
const MIGRATIONS_DIR = join(BACKEND_ROOT, 'database', 'migrations');

/**
 * The two windows the fixture is built around, in days.
 *
 * **These are the shipped FLOORS, not convenient numbers.** Until `0017` the
 * tombstone window was validated as `1..36500` and this file used `30`; the scan
 * now refuses anything below 1825, so a fixture that still asked for 30 would be
 * testing a refusal rather than a scan — and the assertions below would pass for
 * entirely the wrong reason. Raising the fixture to the floor is what keeps them
 * about the window rather than about the guard.
 */
const TOMBSTONE_WINDOW_DAYS = 1825;
const ACCOUNT_WINDOW_DAYS = 1095;

/** The ownership key this file speaks as. */
const SWEEPER_INSTANCE = 'sweeper-machine-path-0001';

/** Read from the directory: a hand-kept list goes stale the day a migration lands. */
function migrationFiles(): readonly string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4,}_.*\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort();
}

// =============================================================================
// The fixture subjects
// =============================================================================

/**
 * Seven users, because "does not enqueue one that is not yet due" needs bystanders
 * — and `0017` gave the scan a second population, so "not yet due" now has three
 * shapes rather than one.
 *
 * `due` is a tombstone older than the window; `fresh` is a tombstone younger than
 * it — and it is a TOMBSTONE, not a live account, so the assertion is about the
 * window rather than about `deleted_at IS NULL`, which the scan's first conjunct
 * already handles and which a live account would prove instead. `live` is the third
 * population, so "the scan found exactly one user" is a claim about a set rather
 * than about a single row.
 *
 * The last three are `0017`'s:
 *
 *   `dormant`   — a LIVE account whose last observed activity is older than the
 *                 account window. The positive control for the second population:
 *                 **an account with observed activity, past the window, IS
 *                 enqueued.** Without it, every test below passes against a scan
 *                 that finds nothing at all, which is exactly the shape a
 *                 "NULL treated as never measured" bug takes.
 *   `recent`    — a LIVE account observed five days ago. Inside the window.
 *   `unobserved`— a LIVE account whose `last_activity_at` IS NULL, standing for
 *                 every account that existed before `0017` and has never
 *                 authenticated since. It must NOT be enqueued, ever, and the
 *                 reason is the safety property of the whole feature.
 */
const IDS = {
  users: {
    due: 'e1000000-0000-0000-0000-000000000001',
    fresh: 'e1000000-0000-0000-0000-000000000002',
    live: 'e1000000-0000-0000-0000-000000000003',
    dormant: 'e1000000-0000-0000-0000-000000000004',
    recent: 'e1000000-0000-0000-0000-000000000005',
    unobserved: 'e1000000-0000-0000-0000-000000000006',
  },
  /** A queue target that is enqueued directly, for the claim tests. */
  queued: 'e1000000-0000-0000-0000-000000000010',
} as const;

// =============================================================================
// Database plumbing
// =============================================================================

/** Superuser SQL on stdin, so each statement gets its own implicit transaction. */
function superuserExec(sql: string, database: string = PROOF_DB): string {
  const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', database], {
    encoding: 'utf8',
    input: sql,
  });
  if (result.status !== 0) {
    throw new Error(`superuser psql failed against ${database}:\n${sql}\n${result.stderr}`);
  }
  return result.stdout;
}

function superuserRows<T>(sql: string): readonly T[] {
  const stdout = superuserExec(`SELECT coalesce(json_agg(_q)::text, '[]') FROM (${sql.replace(/;\s*$/, '')}) AS _q;`);
  const trimmed = stdout.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
}

function recreateDatabase(name: string): void {
  const devDb = databaseConfig().database;
  if (name === devDb || name === 'app_dev') {
    throw new Error(`refusing to run the machine-path proof against the development database (${name})`);
  }
  superuserExec(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid();`,
    'postgres',
  );
  superuserExec(`DROP DATABASE IF EXISTS ${name};`, 'postgres');
  superuserExec(`CREATE DATABASE ${name} OWNER ${databaseConfig().user};`, 'postgres');
}

function dropProofDatabase(): void {
  superuserExec(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PROOF_DB}' AND pid <> pg_backend_pid();`,
    'postgres',
  );
  superuserExec(`DROP DATABASE IF EXISTS ${PROOF_DB};`, 'postgres');
}

function applyBaseline(): void {
  const config = loadTestEnvironment().database;
  const bootstrap = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', PROOF_DB, '-f', BOOTSTRAP_SQL], {
    encoding: 'utf8',
  });
  if (bootstrap.status !== 0) {
    throw new Error(`applying the role bootstrap failed:\n${bootstrap.stderr}`);
  }
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

function runSeed(): { readonly code: number; readonly output: string } {
  const result = spawnSync('node', ['--experimental-strip-types', 'database/seed.ts'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DB_NAME: PROOF_DB, SEED_ADMIN_PASSWORD: 'machine-path-proof-admin-password' },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

// =============================================================================
// Running as a serving role
// =============================================================================

/** psql's own transaction echo, which is not any statement's answer. */
const PSQL_TRANSACTION_ECHO = new Set(['BEGIN', 'COMMIT', 'ROLLBACK', 'SET']);

type ServingRole = 'app_admin' | 'app_member' | 'app_anon';

interface ScriptOutcome {
  readonly ok: boolean;
  readonly output: string;
}

/**
 * A statement run as a serving role, in one transaction, through the escalation
 * boundary a superuser session reaches with `SET LOCAL ROLE` — the same shape
 * `PurgeSweeper` uses over `pg`, and the same identity.
 *
 * **THIS HELPER CANNOT EXPRESS A CLAIMS DOCUMENT.** That is deliberate and it is the
 * strongest form the property can take. An earlier draft took a `sub` argument and
 * every call site passed `undefined` — which is a convention, and a convention is
 * one edit away from being the thing `user-purge-end-to-end.spec.ts` did before
 * `0016`. The `set_config('request.jwt.claims', …)` line is gone with the parameter,
 * so there is no code path in this file that could lend the sweeper an identity even
 * by accident, and the first test below reads the GUC back to prove the claim really
 * ran without one.
 *
 * `ON_ERROR_STOP` is on by default because a refused statement must be a failed run
 * and not a script that carries on and exits 0 — `psql` continues past an error and
 * still reports success, which is a fail-open in a test harness. The savepoint test
 * turns it OFF, and that is the one case where continuing is the point: the sweeper
 * handles the raised statement client-side, unwinds to the savepoint and carries on,
 * and a harness that stopped at the error would be testing something the sweeper
 * never does.
 *
 * `VERBOSITY verbose` makes psql print the SQLSTATE, so a refusal can be asserted as
 * a specific error code and not merely as "some error" — `22023` (invalid parameter
 * value) is what says a value was refused rather than a statement being denied.
 */
function runRoleScript(role: ServingRole, statements: readonly string[], options: { readonly onErrorStop?: boolean } = {}): ScriptOutcome {
  const onErrorStop = options.onErrorStop ?? true;
  const preamble = ['\\set VERBOSITY verbose', `SET LOCAL ROLE ${role};`];
  const body = statements
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
    .map((statement) => (/\\[a-z]/.test(statement) || statement.endsWith(';') ? statement : `${statement};`));
  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', ...(onErrorStop ? ['-v', 'ON_ERROR_STOP=1'] : []), '-t', '-A', '-d', PROOF_DB],
    {
      encoding: 'utf8',
      input: ['BEGIN;', ...preamble, ...body, 'COMMIT;'].join('\n'),
    },
  );
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function statementOutput(output: string): readonly string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !PSQL_TRANSACTION_ECHO.has(line));
}

/** A statement expected to run, as a serving role. Throws with the whole output on failure. */
function mustRun(role: ServingRole, statements: readonly string[]): readonly string[] {
  const outcome = runRoleScript(role, statements);
  if (!outcome.ok) {
    throw new Error(`a statement expected to succeed as ${role} failed:\n${outcome.output}`);
  }
  return statementOutput(outcome.output);
}

/**
 * Bind a statement's parameters into its OWN SQL text, because `psql` cannot.
 *
 * `src/purge/purge-enqueue.ts` writes those statements for `pg`, so they carry
 * `$1`. `psql` has no bind protocol and `$1` is neither a psql variable nor a
 * resolvable parameter outside an extended-protocol message, so PostgreSQL answers
 * `there is no parameter $1`.
 *
 * What reaches the server is still the IMPORTED constant — copying the SQL into
 * this file would make it prove a stale copy of itself compatible with the schema,
 * which is the one thing the import exists to prevent. Every value goes through
 * `quote()`, which doubles single quotes, so a quote inside a value is data and can
 * never be syntax; and every placeholder is filled and every value used, so a
 * statement and its arguments cannot drift apart silently.
 */
function bind(sql: string, values: readonly string[]): string {
  const indices = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  const highest = indices.length === 0 ? 0 : Math.max(...indices);
  if (highest !== values.length || new Set(indices).size !== highest) {
    throw new Error(
      `the statement's placeholders ${indices.map((index) => `$${String(index)}`).join(', ')} ` +
        `do not match the ${String(values.length)} value(s) supplied`,
    );
  }
  const quoted = values.map((value) => quote(value));
  return sql.replace(/\$(\d+)/g, (_match, raw: string) => {
    const value = quoted.at(Number(raw) - 1);
    if (value === undefined) {
      throw new Error(`the statement binds $${raw}, which no supplied value fills`);
    }
    return value;
  });
}

// =============================================================================
// The fixture
// =============================================================================

/** Enqueues through the OWNER, which is the only identity that can — see `0011`. */
function enqueue(targetId: string, dueIn = '0 seconds'): string {
  const id = superuserExec(
    `INSERT INTO privacy_purge_queue (target_kind, target_id, target_ref, reason, scheduled_for)
     VALUES ('user', '${targetId}', 'machine-path-${targetId.slice(-4)}', 'inactivity_purge', now() + interval '${dueIn}')
     RETURNING id;`,
  ).trim();
  if (id === '') {
    throw new Error('enqueueing a queue row returned no id');
  }
  return id;
}

interface QueueRow {
  readonly status: string;
  readonly attempt: number;
  readonly claimed_by: string | null;
  readonly claimed_at: string | null;
  readonly completed_at: string | null;
  readonly rows_deleted: number | null;
  readonly error: string | null;
  readonly target_id: string | null;
  readonly reason: string;
}

function queueRow(id: string): QueueRow | undefined {
  return superuserRows<QueueRow>(
    `SELECT status, attempt, claimed_by, claimed_at, completed_at, rows_deleted, error, target_id, reason
       FROM privacy_purge_queue WHERE id = '${id}'`,
  )[0];
}

/** Every queue row, as counts and identities. The unit of assertion in this file. */
function queueContents(): readonly { target_id: string; reason: string; status: string }[] {
  return superuserRows<{ target_id: string; reason: string; status: string }>(
    `SELECT target_id, reason, status FROM privacy_purge_queue ORDER BY target_id`,
  );
}

let seedRun: { readonly code: number; readonly output: string };

beforeAll(() => {
  recreateDatabase(PROOF_DB);
  applyBaseline();
  seedRun = runSeed();
  if (seedRun.code !== 0) {
    throw new Error(`database/seed.ts failed (exit ${seedRun.code}):\n${seedRun.output}`);
  }

  // The fixture users are written as the SUPERUSER because `users` is FORCE RLS'd and
  // the owner is bound by its own policies — the same fact `0009:71-95` records.
  // Writing them any other way would need `SET row_security = off`, which is the owner
  // bypass reopened, and it is forbidden in this repository.
  for (const [id, username] of [
    [IDS.users.due, 'mp-due'],
    [IDS.users.fresh, 'mp-fresh'],
    [IDS.users.live, 'mp-live'],
    [IDS.users.dormant, 'mp-dormant'],
    [IDS.users.recent, 'mp-recent'],
    [IDS.users.unobserved, 'mp-unobserved'],
    [IDS.queued, 'mp-queued'],
  ] as const) {
    superuserExec(
      `INSERT INTO users (id, username, email, password_hash)
       VALUES ('${id}', '${username}', '${username}@example.test', 'probe-hash-not-a-real-hash');`,
    );
  }

  // Two tombstones, one on each side of the window, and one live account.
  //
  // `2000 days` and `5 days` rather than "older/newer than the window": a fixture
  // that used the same number the code does would pass even if the comparison were
  // inverted, and the whole point of the assertion is which side of the window each
  // row falls on. TOMBSTONE_WINDOW_DAYS is 1825.
  superuserExec(
    `UPDATE users SET deleted_at = now() - interval '2000 days', deletion_reason = 'inactive' WHERE id = '${IDS.users.due}';`,
  );
  superuserExec(
    `UPDATE users SET deleted_at = now() - interval '5 days', deletion_reason = 'inactive' WHERE id = '${IDS.users.fresh}';`,
  );

  // `0017`'s second population, built on the same two-sided fixture.
  //
  // `dormant` and `recent` are both LIVE and both have an OBSERVED activity; they
  // differ only in which side of ACCOUNT_WINDOW_DAYS (1095) they fall on. `unobserved`
  // is left NULL on purpose — writing `created_at` there would be the backfill
  // `0017` §1 refuses, and it is the single most destructive thing a reader of this
  // file could "fix" it by doing.
  superuserExec(`UPDATE users SET last_activity_at = now() - interval '2000 days' WHERE id = '${IDS.users.dormant}';`);
  superuserExec(`UPDATE users SET last_activity_at = now() - interval '5 days' WHERE id = '${IDS.users.recent}';`);
}, TIMEOUT);

// Determinism, not hygiene: the claim takes the globally earliest DUE row, so a row
// left behind by one test would be claimed by another and the assertions would depend
// on declaration order.
beforeEach(() => {
  superuserExec('DELETE FROM privacy_purge_queue;');
});

afterAll(() => {
  try {
    dropProofDatabase();
  } finally {
    restoreAuthenticatorPassword();
  }
});

// =============================================================================
// 1 — the claim, with no identity of its own
// =============================================================================

describe('the machine claim path · a sweeper with no claims document of its own', () => {
  it(
    'claims a due row with NOTHING in request.jwt.claims, and records the owner on it',
    () => {
      // THE RED TEST for the defect this migration fixes. Before `0016` the shipped
      // statement returned `UPDATE 0` in exactly this session — claimless, through
      // the boundary, on a table holding a due row — and reported nothing wrong.
      const queued = enqueue(IDS.queued);

      // The marker and the claim run in ONE transaction, so "there was no claims
      // document when this claim ran" is a fact about the claim rather than a
      // property of some other session.
      const output = mustRun('app_admin', [
        `SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '<unset>') AS claims_in_scope`,
        `SELECT q.id, q.claimed_by, q.attempt FROM authz.claim_due_purge('${SWEEPER_INSTANCE}') AS q`,
      ]);

      expect(output[0], `the claim ran with a claims document in scope: ${String(output[0])}`).toBe('<unset>');
      // Exactly one row came back, and it is the fixture's row: `claim_due_purge()`
      // returns the claim or returns nothing, so a zero-row answer would be an empty
      // output here — which is what the shipped statement produced, silently.
      expect(output).toHaveLength(2);
      const claim = output[1] ?? '';
      expect(claim).toContain(queued);
      expect(claim).toContain(SWEEPER_INSTANCE);

      const row = queueRow(queued);
      expect(row?.status).toBe('claimed');
      expect(row?.attempt, 'attempt advances on the claim').toBe(1);
      expect(row?.claimed_by).toBe(SWEEPER_INSTANCE);
      expect(row?.claimed_at).not.toBeNull();
    },
    TIMEOUT,
  );

  it(
    'a second claim in the same state finds nothing, because nothing is left pending',
    () => {
      // "Nothing due" must arrive as ZERO ROWS and not as a success-shaped value.
      // A claim that returned a row anyway would be two sweepers holding one row.
      enqueue(IDS.queued);
      const first = mustRun('app_admin', [`SELECT q.id FROM authz.claim_due_purge('${SWEEPER_INSTANCE}') AS q`]);
      expect(first).toHaveLength(1);

      const second = mustRun('app_admin', [`SELECT q.id FROM authz.claim_due_purge('sweeper-machine-path-0002') AS q`]);
      expect(second).toEqual([]);
      expect(queueContents()).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'a row that is not DUE is not claimed, however long the queue has been waiting',
    () => {
      // `scheduled_for` has no default precisely so that a row enqueued for a future
      // retention expiry is not immediately claimable by a job that asked for the
      // wrong time.
      const queued = enqueue(IDS.queued, '1 hour');
      const claimed = mustRun('app_admin', [`SELECT q.id FROM authz.claim_due_purge('${SWEEPER_INSTANCE}') AS q`]);
      expect(claimed).toEqual([]);
      expect(queueRow(queued)?.status).toBe('pending');
    },
    TIMEOUT,
  );

  it(
    'a sweeper that no longer owns a row completes ZERO rows, and the refusal leaves no trace',
    () => {
      const queued = enqueue(IDS.queued);
      mustRun('app_admin', [`SELECT q.id FROM authz.claim_due_purge('${SWEEPER_INSTANCE}') AS q`]);

      const stranger = mustRun('app_admin', [
        `SELECT authz.complete_purge('${queued}', 'sweeper-machine-path-9999', 1)`,
      ]);
      expect(stranger).toEqual(['0']);

      // No count, no completion instant, no status change: a write that matched
      // nothing must not leave half of itself behind (§2.3, in the direction where
      // the work did not happen).
      const untouched = queueRow(queued);
      expect(untouched?.status).toBe('claimed');
      expect(untouched?.rows_deleted).toBeNull();
      expect(untouched?.completed_at).toBeNull();

      // …and the owner still can. Which also means the second erasure this row's
      // `status = 'claimed'` conjunct exists to prevent cannot happen.
      const owner = mustRun('app_admin', [
        `SELECT authz.complete_purge('${queued}', '${SWEEPER_INSTANCE}', 1)`,
      ]);
      expect(owner).toEqual(['1']);
      expect(queueRow(queued)?.status).toBe('done');

      const again = mustRun('app_admin', [
        `SELECT authz.complete_purge('${queued}', '${SWEEPER_INSTANCE}', 1)`,
      ]);
      expect(again).toEqual(['0']);
      expect(queueRow(queued)?.rows_deleted).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'a failed purge unwinds the delete ALONE: the claim survives the savepoint rollback, so the failure is recordable',
    () => {
      // The property `PURGE_WORK_SAVEPOINT` exists for. Rolling the whole transaction
      // back would restore the row to `pending` with `claimed_by = NULL`, and the
      // failure write's ownership predicate would then match ZERO rows — the error
      // recorded nowhere, `attempt` never advancing, and the poison-pill threshold
      // unreachable code.
      const queued = enqueue(IDS.queued);
      mustRun('app_admin', [`SELECT q.id FROM authz.claim_due_purge('${SWEEPER_INSTANCE}') AS q`]);

      const outcome = runRoleScript(
        'app_admin',
        [
          'SAVEPOINT purge_work',
          // A statement that raises, standing in for a DELETE blocked by a foreign key.
          // What matters is that it ABORTS the transaction inside the savepoint.
          `SELECT 1 / 0 FROM privacy_purge_queue WHERE id = '${queued}'`,
          'ROLLBACK TO SAVEPOINT purge_work',
          `SELECT authz.requeue_purge('${queued}', '${SWEEPER_INSTANCE}', 'division by zero')`,
        ],
        // The sweeper catches the raised statement client-side and carries on, so the
        // script has to as well; `ON_ERROR_STOP` would stop at the division and never
        // reach the statement under test. The assertion that the raise HAPPENED is the
        // `division by zero` in the output below.
        { onErrorStop: false },
      );
      expect(outcome.output, 'the statement inside the savepoint did not raise at all').toContain('division by zero');
      const requeued = queueRow(queued);
      expect(requeued?.status).toBe('pending');
      // `attempt` is 1, NOT 0: the claim survived the unwind. A rewound counter is the
      // exact signature of a whole-transaction rollback.
      expect(requeued?.attempt).toBe(1);
      expect(requeued?.claimed_by).toBeNull();
      expect(requeued?.error, 'the reason survives into the next attempt').toBe('division by zero');

      // And a terminal write above the limit keeps the row visible with its reason.
      mustRun('app_admin', [`SELECT q.id FROM authz.claim_due_purge('${SWEEPER_INSTANCE}') AS q`]);
      const failed = mustRun('app_admin', [
        `SELECT authz.fail_purge('${queued}', '${SWEEPER_INSTANCE}', 'unsupported reason')`,
      ]);
      expect(failed).toEqual(['1']);
      expect(queueRow(queued)).toMatchObject({ status: 'failed', attempt: 2, error: 'unsupported reason' });
    },
    TIMEOUT,
  );

  it(
    'a write with no ownership key is REFUSED rather than matching rows nobody owns',
    () => {
      // `claimed_by` is `text` and the table's CHECK only requires it to be non-NULL,
      // so an empty owner would satisfy every constraint while making "does this
      // sweeper still hold the row" a question two sweepers answer the same way.
      const queued = enqueue(IDS.queued);
      for (const [what, statement] of [
        ['claim', `SELECT q.id FROM authz.claim_due_purge('') AS q`],
        ['complete', `SELECT authz.complete_purge('${queued}', '', 1)`],
        ['fail', `SELECT authz.fail_purge('${queued}', '', 'reason')`],
        ['requeue', `SELECT authz.requeue_purge('${queued}', '', 'reason')`],
      ] as const) {
        const refused = runRoleScript('app_admin', [statement]);
        expect(refused.ok, `an empty ownership key was accepted by ${what}:\n${refused.output}`).toBe(false);
        expect(refused.output, `${what} did not raise 22023`).toContain('22023');
      }
      // Nothing was written by any of the four.
      expect(queueRow(queued)?.status).toBe('pending');
    },
    TIMEOUT,
  );
});

// =============================================================================
// 2 — the enqueue scan
// =============================================================================

describe('the enqueue scan · the queue is not filled by an empty table', () => {
  it(
    'finds the tombstone past the window, and does NOT enqueue the one that is not yet due',
    () => {
      // The scan, on its own, as a row count and an identity — not "it did not
      // throw", which is what a scan that found nothing also looks like.
      const scan = mustRun('app_admin', [
        `SELECT coalesce(array_agg(t.user_id)::text, '<none>') FROM authz.retention_due_tombstones(${String(TOMBSTONE_WINDOW_DAYS)}) AS t`,
      ]);
      expect(scan).toHaveLength(1);
      expect(scan[0]).toBe(`{${IDS.users.due}}`);

      // Now the pipeline, as ONE statement: the enqueue takes the scan's own output,
      // so a scan that returned the fresh tombstone would enqueue two rows and the
      // count below would be 2. (Over `pg` the application performs the same step
      // with the scan's ids bound as a parameter, and skips the enqueue entirely when
      // the scan is empty.) The second argument is an EMPTY account array: this
      // assertion is about the tombstone population, and `0017`'s own block asserts
      // what happens when a live account is due in the same sweep.
      const enqueued = mustRun('app_admin', [
        `SELECT authz.enqueue_inactive_purges(ARRAY(SELECT t.user_id FROM authz.retention_due_tombstones(${String(TOMBSTONE_WINDOW_DAYS)}) AS t), ARRAY[]::uuid[])`,
      ]);
      expect(enqueued).toEqual(['1']);

      // The assertion is on the queue's CONTENTS, read as the owner and unfiltered.
      const contents = queueContents();
      expect(contents).toHaveLength(1);
      expect(contents[0]).toEqual({ target_id: IDS.users.due, reason: 'inactivity_purge', status: 'pending' });

      // …and the fixture really did build both tombstones, or "one row" would be a
      // statement about a fixture that built one.
      expect(
        superuserRows<{ tombstones: number }>(
          `SELECT count(*)::int AS tombstones FROM users WHERE deleted_at IS NOT NULL`,
        )[0]?.tombstones,
        'the fixture no longer has exactly the two tombstones these assertions are about',
      ).toBe(2);
    },
    TIMEOUT,
  );

  it(
    'a second sweep inside one window enqueues NOTHING, so a double sweep cannot report a successful zero-row purge',
    () => {
      // The partial UNIQUE index from `0011` is the control, not `ON CONFLICT DO
      // NOTHING`: without it, a scan that runs twice queues every tombstone twice, the
      // second attempt deletes nothing, writes `rows_deleted = 0`, and the admin view
      // reads that as a successful purge.
      const statement = `SELECT authz.enqueue_inactive_purges(ARRAY(SELECT t.user_id FROM authz.retention_due_tombstones(${String(TOMBSTONE_WINDOW_DAYS)}) AS t), ARRAY[]::uuid[])`;

      expect(mustRun('app_admin', [statement])).toEqual(['1']);
      expect(queueContents()).toHaveLength(1);

      expect(mustRun('app_admin', [statement])).toEqual(['0']);
      expect(queueContents(), 'a second sweep added a row').toHaveLength(1);
      expect(
        superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM privacy_purge_queue`)[0]?.count,
      ).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'the SHIPPED enqueue statements run against this schema, so the text in src/ is the text that works',
    () => {
      // Both constants are IMPORTED from `src/purge/purge-enqueue.ts`, never retyped,
      // so a renamed column or a moved function cannot be "proved compatible" against
      // a stale copy of the application's own SQL.
      //
      // The scan constant now covers BOTH populations, so it binds BOTH windows, and
      // the enqueue constant takes one array per population for the same reason. A
      // `bind()` that did not match the placeholders would throw rather than pass, so
      // this also proves the argument counts have not drifted from the statements.
      const scan = mustRun('app_admin', [
        bind(SELECT_DUE_PURGES_SQL, [String(TOMBSTONE_WINDOW_DAYS), String(ACCOUNT_WINDOW_DAYS)]),
      ]);
      // TWO rows, one per population — the shipped statement covers both anchors, so
      // asserting a single row here would be asserting that `0017`'s second population
      // is not wired in.
      expect(scan).toHaveLength(2);
      expect(scan[0]).toContain(IDS.users.due);
      expect(scan[0]).toContain('inactivity_purge');
      expect(scan[1], 'the dormant live account was not returned by the shipped scan').toContain(IDS.users.dormant);
      expect(scan[1]).toContain('inactive_account_purge');
      expect(scan[0], 'the fresh tombstone was returned by the scan').not.toContain(IDS.users.fresh);
      expect(scan[1], 'the recently-observed account was returned by the scan').not.toContain(IDS.users.recent);
      expect(
        scan.join('|'),
        'an account whose activity was never observed was returned by the scan',
      ).not.toContain(IDS.users.unobserved);

      const enqueued = mustRun('app_admin', [bind(ENQUEUE_INACTIVE_PURGES_SQL, [`{${IDS.users.due}}`, '{}'])]);
      expect(enqueued).toEqual(['1']);

      expect(queueContents()).toEqual([{ target_id: IDS.users.due, reason: 'inactivity_purge', status: 'pending' }]);

      // And both windows reach the statement as BOUND values, never as text: a
      // statement built by interpolation would take whatever the caller passed, and
      // the loader that produces these values is the only thing standing between an
      // operator's typo and a syntax error at three in the morning.
      expect(SELECT_DUE_PURGES_SQL).toContain('$1::integer');
      expect(SELECT_DUE_PURGES_SQL).toContain('$2::integer');
      expect(SELECT_DUE_PURGES_SQL).not.toMatch(/interval|make_interval/);
      expect(ENQUEUE_INACTIVE_PURGES_SQL).toContain('$1::uuid[]');
      expect(ENQUEUE_INACTIVE_PURGES_SQL).toContain('$2::uuid[]');
    },
    TIMEOUT,
  );

  it(
    'refuses a window below the floor, of nothing at all, and of a century and a day',
    () => {
      // **The floor is the control, and `1` is the case that matters.** Under
      // `0016`'s `1..36500` bound `RETENTION_TOMBSTONE_DAYS=1` was valid
      // configuration and hard-destroyed every tombstone in the repository on the
      // next sweep; the floor is what makes the key mean what the template says it
      // means.
      for (const [what, argument] of [
        ['zero', '0'],
        ['negative', '-1'],
        ['one — the shortest route to destroying every tombstone in the repository', '1'],
        ['just below the five-year floor', '1824'],
        ['beyond the ceiling', '36501'],
      ] as const) {
        const refused = runRoleScript('app_admin', [
          `SELECT t.user_id FROM authz.retention_due_tombstones(${argument}) AS t`,
        ]);
        expect(refused.ok, `a ${what} window was accepted:\n${refused.output}`).toBe(false);
        expect(refused.output, `a ${what} window did not raise 22023`).toContain('22023');
        expect(refused.output).toContain('retention window must be between');
        expect(refused.output, `a ${what} window did not name the five-year floor`).toContain('1825');
      }

      // …and the account scan refuses its OWN floor, which is a different number for
      // a different population. A single function with two arguments could not say
      // which key it was refusing; that is why there are two.
      for (const [what, argument] of [
        ['zero', '0'],
        ['one', '1'],
        ['thirty — the value every `.env` shipped before 0017', '30'],
        ['just below the three-year floor', '1094'],
        ['beyond the ceiling', '36501'],
      ] as const) {
        const refused = runRoleScript('app_admin', [
          `SELECT a.user_id FROM authz.retention_due_accounts(${argument}) AS a`,
        ]);
        expect(refused.ok, `a ${what} account window was accepted:\n${refused.output}`).toBe(false);
        expect(refused.output, `a ${what} account window did not raise 22023`).toContain('22023');
        expect(refused.output).toContain('authz.retention_due_accounts');
        expect(refused.output).toContain('retention window must be between');
        expect(refused.output, `a ${what} account window did not name the three-year floor`).toContain('1095');
      }

      // The floor itself is ACCEPTED by both, so these are bounds and not a
      // function that refuses everything.
      expect(
        mustRun('app_admin', [`SELECT count(*) FROM authz.retention_due_tombstones(${String(TOMBSTONE_WINDOW_DAYS)})`]),
      ).toHaveLength(1);
      expect(
        mustRun('app_admin', [`SELECT count(*) FROM authz.retention_due_accounts(${String(ACCOUNT_WINDOW_DAYS)})`]),
      ).toHaveLength(1);

      // No window at all is refused too, rather than defaulting to one.
      const absent = runRoleScript('app_admin', ['SELECT authz.retention_due_tombstones(NULL)']);
      expect(absent.ok, absent.output).toBe(false);
      expect(absent.output).toContain('the retention window is required');
      const absentAccounts = runRoleScript('app_admin', ['SELECT authz.retention_due_accounts(NULL)']);
      expect(absentAccounts.ok, absentAccounts.output).toBe(false);
      expect(absentAccounts.output).toContain('the retention window is required');

      // And a NULL target list is refused rather than read as an empty list: "there is
      // nothing to enqueue" and "nobody said" are different, and only the second is an
      // error. BOTH arguments, because a NULL in either one would otherwise purge one
      // population while the caller believed it had reported on both.
      for (const [what, arguments_] of [
        ['no lists at all', 'NULL, NULL'],
        ['no tombstones list', 'NULL, ARRAY[]::uuid[]'],
        ['no accounts list', "ARRAY[]::uuid[], NULL"],
      ] as const) {
        const nullList = runRoleScript('app_admin', [`SELECT authz.enqueue_inactive_purges(${arguments_})`]);
        expect(nullList.ok, `${what} was accepted:\n${nullList.output}`).toBe(false);
        expect(nullList.output).toContain('22023');
      }

      // Nothing was enqueued by any of the eleven.
      expect(queueContents()).toEqual([]);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 3 — the seam is narrow, and the permitted case is asserted
// =============================================================================

describe('the seam is narrow, and the permitted case is asserted rather than inferred', () => {
  it(
    'app_admin can claim and enqueue — a definer reading current_user would deny EVERYONE',
    () => {
      // §B2's measured note: inside a `SECURITY DEFINER` function `current_user`
      // rebinds to the owner, so a body that reads it answers identically for
      // everybody and denies everybody with an ordinary zero-row result — the whole
      // capability axis silently absent. Every denial-only test passes against that.
      // This is the positive case, and it is the one that sees the defect.
      expect(
        mustRun('app_admin', [`SELECT t.user_id FROM authz.retention_due_tombstones(${String(TOMBSTONE_WINDOW_DAYS)}) AS t`]),
      ).toHaveLength(1);

      const enqueued = mustRun('app_admin', [
        `SELECT authz.enqueue_inactive_purges(ARRAY(SELECT t.user_id FROM authz.retention_due_tombstones(${String(TOMBSTONE_WINDOW_DAYS)}) AS t), ARRAY[]::uuid[])`,
      ]);
      expect(enqueued).toEqual(['1']);

      // …and the row it produced is claimable by the same identity, which closes the
      // loop the other way: a producer that could not hand its work to the consumer
      // would be two jobs that each look complete.
      const claimed = mustRun('app_admin', [`SELECT q.id FROM authz.claim_due_purge('${SWEEPER_INSTANCE}') AS q`]);
      expect(claimed).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'a member and an app_anon are refused AT THE FUNCTION, which is a different control from a refusal at the table',
    () => {
      // The two messages are the assertion. `permission denied for table` means the
      // grant layer refused before any policy was consulted, and names nothing about
      // the schema behind it; `permission denied for function` means the caller
      // reached the seam and was refused by the narrow grant that is the whole of its
      // authority. A test that accepted either message would pass on a schema where
      // the seam was unreachable for the wrong reason.
      for (const role of ['app_member', 'app_anon'] as const) {
        for (const statement of [
          `SELECT q.id FROM authz.claim_due_purge('${SWEEPER_INSTANCE}') AS q`,
          `SELECT authz.complete_purge('00000000-0000-0000-0000-000000000000', '${SWEEPER_INSTANCE}', 1)`,
          `SELECT authz.fail_purge('00000000-0000-0000-0000-000000000000', '${SWEEPER_INSTANCE}', 'x')`,
          `SELECT authz.requeue_purge('00000000-0000-0000-0000-000000000000', '${SWEEPER_INSTANCE}', 'x')`,
          `SELECT authz.enqueue_inactive_purges(ARRAY['${IDS.users.due}']::uuid[], ARRAY[]::uuid[])`,
          `SELECT t.user_id FROM authz.retention_due_tombstones(${String(TOMBSTONE_WINDOW_DAYS)}) AS t`,
          // `0017`'s two additions to the seam, refused at the FUNCTION like every
          // other one — including the WRITER, which is the one seam in this schema a
          // caller drives: `app_member` holds no `UPDATE` on `users` at all
          // (`0008:465`), so a grant here would be a widening of the table's write
          // surface to stamp a column that decides whether the account is destroyed.
          `SELECT a.user_id FROM authz.retention_due_accounts(${String(ACCOUNT_WINDOW_DAYS)}) AS a`,
          `SELECT authz.record_user_activity('${IDS.users.due}')`,
        ]) {
          const refused = runRoleScript(role, [statement]);
          expect(refused.ok, `${role} was able to run: ${statement}\n${refused.output}`).toBe(false);
          expect(refused.output).toContain('permission denied for function');
          expect(refused.output, `${role} hit the table layer instead of the function layer`).not.toContain(
            'permission denied for table',
          );
        }
      }

      // Nothing was claimed, completed, failed, requeued or enqueued by any of the
      // sixteen attempts.
      expect(queueContents()).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'the granted set is exactly app_admin, read from the catalog rather than from the migration file',
    () => {
      // A revoke while granting to nobody is strictly worse than doing nothing: every
      // legitimate caller dies with `permission denied for function` while every
      // policy, grant and comment still looks correct. So BOTH halves are asserted —
      // the refusal to `app_anon`/`app_member` and the grant to `app_admin` — and
      // neither is read out of the file that wrote them.
      const signatures = [
        'authz.claim_due_purge(text)',
        'authz.complete_purge(uuid, text, integer)',
        'authz.fail_purge(uuid, text, text)',
        'authz.requeue_purge(uuid, text, text)',
        'authz.enqueue_inactive_purges(uuid[], uuid[])',
        'authz.retention_due_tombstones(integer)',
        // `0017`'s two: the second scan, and the writer. The writer is the sharper of
        // the two to narrow — it is the only seam here a caller drives, and the
        // `has_function_privilege` loop below asserts all three serving roles on it.
        'authz.retention_due_accounts(integer)',
        'authz.record_user_activity(uuid)',
      ];

      // `oid::regprocedure` is the canonical signature rendering — schema, name and
      // ARGUMENT TYPES, no parameter names, and no spaces after the commas (which
      // `replace` puts back so the strings below are the ones the migration's
      // `GRANT`/`REVOKE` statements are written with).
      // `pg_get_function_identity_arguments` keeps the names (`p_instance text`),
      // which is why a grant written from it would name no function at all.
      const granted = superuserRows<{ signature: string; role: string }>(
        `WITH wanted(signature) AS (VALUES ${signatures.map((signature) => `(${quote(signature)})`).join(', ')})
         SELECT w.signature, r.rolname AS role
           FROM wanted w
           JOIN pg_proc p ON replace(p.oid::regprocedure::text, ',', ', ') = w.signature
           JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'authz'
           JOIN pg_roles r ON r.oid = p.proowner
          ORDER BY w.signature`,
      );
      // The owner of all of them is the migration role, and none is owned by a
      // SERVING role: a definer owned by `app_admin` would let any admin request
      // redefine the retention mechanism.
      // The declaration order of the functions is not the point; the SET is, so both
      // sides are sorted and a reordering of the migration cannot fail this.
      expect(granted.map((row) => `${row.signature} owned by ${row.role}`).sort()).toEqual(
        signatures.map((signature) => `${signature} owned by ${databaseConfig().user}`).sort(),
      );

      for (const signature of signatures) {
        for (const role of ['app_admin', 'app_member', 'app_anon']) {
          expect(
            superuserRows<{ holds: boolean }>(
              `SELECT has_function_privilege('${role}', '${signature}', 'EXECUTE') AS holds`,
            )[0]?.holds,
            `${role} ${signature} EXECUTE`,
          ).toBe(role === 'app_admin');
        }
      }
    },
    TIMEOUT,
  );

  it(
    'no serving role holds EXECUTE on any function in authz that this migration did not grant, and none at all holds it implicitly',
    () => {
      // The general form of the assertion above, from the catalog rather than from a
      // hand-kept list: any role other than `app_admin` holding EXECUTE on any
      // `authz` function is a finding, and PUBLIC holding it is one too.
      //
      // `app_anon` and `app_member` DO hold EXECUTE on the capability and policy
      // helpers `0001`/`0005`/`0010` granted them, which is why this asserts the
      // shape — "every granted function was granted by a migration that names
      // app_admin, and PUBLIC holds none" — rather than "app_member holds nothing".
      const publicHolders = superuserRows<{ signature: string }>(
        `SELECT p.oid::regprocedure::text AS signature
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'authz'
          WHERE has_function_privilege('public', p.oid, 'EXECUTE')`,
      );
      expect(publicHolders).toEqual([]);

      const nonAdminHolders = superuserRows<{ signature: string; role: string }>(
        `SELECT p.oid::regprocedure::text AS signature, r.rolname AS role
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'authz'
           JOIN pg_roles r ON r.oid = p.proowner
          WHERE r.rolname IN ('app_anon', 'app_member', 'app_admin')
            AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')`,
      );
      expect(nonAdminHolders.filter((row) => row.role !== 'app_admin')).toEqual([]);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 4 — the proof is a real provision
// =============================================================================

describe('this proof ran against a real provisioned database', () => {
  it(
    'the real seed ran, and 0016 is what created the seam this file drives',
    () => {
      // Without this, every assertion above would also pass against an un-applied
      // migration, a failed seed, or an absent function.
      expect(seedRun.code, seedRun.output).toBe(0);
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'authz'
              AND p.proname IN ('claim_due_purge','complete_purge','fail_purge','requeue_purge','enqueue_inactive_purges','retention_due_tombstones')`,
        )[0]?.count,
      ).toBe(6);

      // The grant the migration takes away, asserted rather than described: with
      // `UPDATE` in place the bare statements remain a second, working route to the
      // same job, and the one that is inert fails SILENTLY.
      expect(
        superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_admin', 'public.privacy_purge_queue', 'UPDATE') AS holds`,
        )[0]?.holds,
      ).toBe(false);
    },
    TIMEOUT,
  );

  it(
    '0017 is applied, and the column it adds is NULLABLE with no default',
    () => {
      // The two properties `0017` §1 exists to establish, read from the catalog
      // rather than from the migration file. Both are load-bearing and both are
      // invisible in the served API:
      //
      //   * **nullable** — a NOT NULL column would need a default on `ALTER TABLE`
      //     for the rows that already exist, which is the backfill `0017` refuses;
      //   * **no default** — `DEFAULT now()` writes a value at INSERT time, which
      //     would make the migration's execution time a retention decision for every
      //     account in the repository, taken by nobody.
      //
      // `column_default IS NULL` is asserted separately from nullability because a
      // column can be nullable AND defaulted (`DEFAULT now()` is exactly that), and
      // only the second assertion catches it.
      expect(
        superuserRows<{ is_nullable: string; column_default: string | null }>(
          `SELECT is_nullable, column_default
             FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'last_activity_at'`,
        ),
      ).toEqual([{ is_nullable: 'YES', column_default: null }]);

      // And the index the dormant scan serves exists, so the scan is not a
      // sequential scan over the whole table.
      expect(
        superuserRows<{ indexdef: string }>(
          `SELECT indexdef FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_last_activity_at_idx'`,
        ),
      ).toHaveLength(1);
    },
    TIMEOUT,
  );
});


// =============================================================================
// 5 — THE SECOND ANCHOR: a dormant LIVE account, and the two floors
// =============================================================================
// `0017`. Everything above is `0016`'s machinery; this block is the new population,
// and it is written so that the dangerous failure — "the scan finds nothing at all,
// and a suite of negative assertions reports green" — cannot pass silently. The
// `dormant` fixture is the positive control for that, and it is asserted FIRST.
// =============================================================================

describe('a dormant live account is retention, and it is enqueued under its own reason code', () => {
  it(
    'a LIVE account with observed activity past the window IS enqueued — the positive control',
    () => {
      // **THE CONTROL THAT MAKES THE OTHER ASSERTIONS IN THIS BLOCK MEANINGFUL.**
      // Every test below is a "does not enqueue" test, and every one of them passes
      // against a scan that returns nothing at all — which is the exact shape a
      // `last_activity_at IS NOT NULL` bug, a wrong column name, or a broken
      // predicate all produce. A deletion-only test cannot see it (§B8's positive-case
      // rule, applied to a scan instead of to a policy).
      //
      // So: one live account, never soft-deleted, last observed 2000 days ago, window
      // 1095. It MUST come back, and it must come back under
      // `inactive_account_purge` rather than the tombstone code — a shared code is
      // what makes a wrongly-configured window invisible in the operator's list.
      const scan = mustRun('app_admin', [
        `SELECT coalesce(array_agg(a.user_id)::text, '<none>') FROM authz.retention_due_accounts(${String(ACCOUNT_WINDOW_DAYS)}) AS a`,
      ]);
      expect(scan, 'the dormant-account scan found nothing, so nothing below can mean anything').toHaveLength(1);
      expect(scan[0]).toBe(`{${IDS.users.dormant}}`);

      // Through the real pipeline, both populations at once — which is the shape the
      // operator's single filterable list is filled from.
      const enqueued = mustRun('app_admin', [
        `SELECT authz.enqueue_inactive_purges(
           ARRAY(SELECT t.user_id FROM authz.retention_due_tombstones(${String(TOMBSTONE_WINDOW_DAYS)}) AS t),
           ARRAY(SELECT a.user_id FROM authz.retention_due_accounts(${String(ACCOUNT_WINDOW_DAYS)}) AS a))`,
      ]);
      // Two rows, and the count is the sum of BOTH populations: one tombstone
      // (`due`) plus one dormant account (`dormant`). A sweep that enqueued one row
      // would mean the second population is not really wired in.
      expect(enqueued).toEqual(['2']);

      // The queue's CONTENTS, read unfiltered by the owner — the operator's list,
      // with the two populations distinguishable in it. Ordered by target_id, which is
      // why `due` precedes `dormant`: the assertion is on the SET, and an order that
      // happened to match the enqueue order would pass against a queue whose contents
      // were scrambled.
      expect(queueContents()).toEqual([
        { target_id: IDS.users.due, reason: 'inactivity_purge', status: 'pending' },
        { target_id: IDS.users.dormant, reason: 'inactive_account_purge', status: 'pending' },
      ]);

      // …and the reason a row was purged is a value in the domain, read back from
      // the CHECK rather than from the migration that wrote it.
      expect(
        superuserRows<{ definition: string }>(
          `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
            WHERE conrelid = 'public.privacy_purge_queue'::regclass
              AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%inactive_account_purge%'`,
        ),
      ).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'an account whose activity was NEVER OBSERVED is not enqueued, whatever its age',
    () => {
      // **THE SAFETY PROPERTY, and the reason `last_activity_at` is nullable.**
      // `unobserved` stands for every account that existed before `0017` and has not
      // authenticated since: NULL means "we never watched this account", which is
      // not evidence of dormancy. Destroying it would be destroying an account on
      // the strength of a measurement that was never taken.
      //
      // The TOMBSTONE scan must not return `dormant` either, and that is the other
      // half of the same property: `deleted_at IS NULL` is what keeps the two
      // populations disjoint, so one sweep can never put the same row in both lists
      // with two different reasons. A row that appeared in both would be scheduled
      // twice — the second attempt would delete nothing, write `rows_deleted = 0`,
      // and read in the admin view as a successful purge.
      expect(
        superuserRows<{ id: string; last_activity_at: string | null }>(
          `SELECT id, last_activity_at FROM users WHERE id = '${IDS.users.unobserved}'`,
        ),
      ).toEqual([{ id: IDS.users.unobserved, last_activity_at: null }]);

      // The account scan does not return it. At the widest window this schema allows,
      // which is the only place the `IS NOT NULL` conjunct could be doing the work
      // by accident rather than by design.
      for (const window of [String(ACCOUNT_WINDOW_DAYS), '1825', '3650', '36500']) {
        const scan = mustRun('app_admin', [
          `SELECT coalesce(array_agg(a.user_id)::text, '<none>') FROM authz.retention_due_accounts(${window}) AS a`,
        ]);
        expect(scan[0], `an unobserved account became eligible at a ${window}-day window`).not.toContain(
          IDS.users.unobserved,
        );
      }

      // `dormant` is the disjointness control: it IS due, and it comes back from the
      // ACCOUNT scan and from nowhere else.
      expect(
        mustRun('app_admin', [
          `SELECT coalesce(array_agg(a.user_id)::text, '<none>') FROM authz.retention_due_accounts(${String(ACCOUNT_WINDOW_DAYS)}) AS a`,
        ])[0],
      ).toContain(IDS.users.dormant);
      for (const window of [String(TOMBSTONE_WINDOW_DAYS), '36500']) {
        expect(
          mustRun('app_admin', [
            `SELECT coalesce(array_agg(t.user_id)::text, '<none>') FROM authz.retention_due_tombstones(${window}) AS t`,
          ])[0],
          'a LIVE dormant account appeared in the tombstone list',
        ).not.toContain(IDS.users.dormant);
      }

      // And the whole pipeline enqueues it neither way, at the widest window the
      // schema accepts — 36500 days, which is also the widest the FLOOR allows a
      // window to be, so this is the strongest version of the claim available.
      mustRun('app_admin', [
        `SELECT authz.enqueue_inactive_purges(
           ARRAY(SELECT t.user_id FROM authz.retention_due_tombstones('36500') AS t),
           ARRAY(SELECT a.user_id FROM authz.retention_due_accounts('36500') AS a))`,
      ]);
      expect(queueContents().map((row) => row.target_id)).not.toContain(IDS.users.unobserved);
    },
    TIMEOUT,
  );

  it(
    'an account INSIDE either window is not enqueued, and a tombstone past its window still is',
    () => {
      // Both windows have a "recent" side, and both are asserted — a window that
      // only ever matched would be a window nobody can distinguish from "now".
      //
      // `recent`: a LIVE account observed 5 days ago, inside a 1095-day window.
      // `live` and `fresh` are the same idea for the other shapes: a live account with
      // no observation at all, and a tombstone 5 days old.
      const accounts = mustRun('app_admin', [
        `SELECT coalesce(array_agg(a.user_id)::text, '<none>') FROM authz.retention_due_accounts(${String(ACCOUNT_WINDOW_DAYS)}) AS a`,
      ]);
      expect(accounts[0]).not.toContain(IDS.users.recent);

      const tombstones = mustRun('app_admin', [
        `SELECT coalesce(array_agg(t.user_id)::text, '<none>') FROM authz.retention_due_tombstones(${String(TOMBSTONE_WINDOW_DAYS)}) AS t`,
      ]);
      expect(tombstones[0], 'a tombstone inside its window was returned').not.toContain(IDS.users.fresh);

      // By row COUNT, over the whole fixture, so "not toContain" on an array cannot
      // pass because the scan returned an empty array for an unrelated reason.
      expect(
        superuserRows<{ due: number }>(
          `SELECT count(*)::int AS due FROM users u
            WHERE (u.deleted_at IS NULL AND u.last_activity_at IS NOT NULL
                   AND u.last_activity_at < now() - make_interval(days => ${String(ACCOUNT_WINDOW_DAYS)}))
               OR (u.deleted_at IS NOT NULL
                   AND u.deleted_at < now() - make_interval(days => ${String(TOMBSTONE_WINDOW_DAYS)}))`,
        )[0]?.due,
        'the fixture no longer holds exactly one due row per population',
      ).toBe(2);

      mustRun('app_admin', [
        `SELECT authz.enqueue_inactive_purges(
           ARRAY(SELECT t.user_id FROM authz.retention_due_tombstones(${String(TOMBSTONE_WINDOW_DAYS)}) AS t),
           ARRAY(SELECT a.user_id FROM authz.retention_due_accounts(${String(ACCOUNT_WINDOW_DAYS)}) AS a))`,
      ]);
      const queued = queueContents().map((row) => row.target_id).sort();
      expect(queued).toEqual([IDS.users.dormant, IDS.users.due].sort());
    },
    TIMEOUT,
  );

  it(
    'the reason code is a literal in SQL, so no caller can file a live account under the tombstone code',
    () => {
      // The rejected design was `enqueue_inactive_purges(uuid[], text)` with the
      // caller naming the reason — one argument instead of two, and one bug away
      // from an operator filtering on "tombstone" and finding a person. What is
      // asserted here is that the reason is not reachable as an argument at all:
      // passing one is a type error, and the enqueue is reachable only with two
      // arrays.
      const wrongArity = runRoleScript('app_admin', [
        `SELECT authz.enqueue_inactive_purges(ARRAY['${IDS.users.dormant}']::uuid[])`,
      ]);
      expect(wrongArity.ok, 'the one-argument overload is still there:\n' + wrongArity.output).toBe(false);
      expect(wrongArity.output).toContain('function authz.enqueue_inactive_purges');

      // …and the two-argument call with the DORMANT account in the tombstone array
      // writes the tombstone code, which is the design's one remaining hazard and is
      // why the reason is a literal per array rather than a per-row value: the
      // database cannot tell a misfiled live account from a tombstone, and the
      // application's `splitByPopulation` is the only thing that can. Asserted so the
      // behaviour is on the record rather than assumed.
      const enqueued = mustRun('app_admin', [
        `SELECT authz.enqueue_inactive_purges(ARRAY['${IDS.users.dormant}']::uuid[], ARRAY[]::uuid[])`,
      ]);
      expect(enqueued).toEqual(['1']);
      expect(queueContents()).toEqual([
        { target_id: IDS.users.dormant, reason: 'inactivity_purge', status: 'pending' },
      ]);
    },
    TIMEOUT,
  );

  it(
    'authz.record_user_activity stamps now(), returns whether it landed, and refuses a null id',
    () => {
      // The writer, exercised through the boundary the thin app uses. Three
      // properties, and each is a different kind of wrong if it fails:
      //
      //   * it WRITES — a definer body would update zero rows silently here, because
      //     `users` is FORCE RLS'd and `current_user` rebinds to the owner inside a
      //     definer (the measurement `0016` records). The positive call is the only
      //     thing that sees it;
      //   * it uses ITS OWN clock — the function takes no timestamp, so a caller
      //     cannot write `'-infinity'` (accelerating its own destruction) or
      //     `'infinity'` (making itself immortal). Asserted as `now() <= value <=
      //     now()` measured around the call, not as an exact timestamp;
      //   * it REPORTS — a `false` answer is an un-deleted row, and a function that
      //     returned `rowCount` would report 1 either way.
      const before = new Date();
      const written = mustRun('app_admin', [`SELECT authz.record_user_activity('${IDS.users.live}')`]);
      const after = new Date();
      expect(written).toEqual(['t']);

      const stamped = superuserRows<{ last_activity_at: string }>(
        `SELECT last_activity_at FROM users WHERE id = '${IDS.users.live}'`,
      )[0];
      expect(stamped?.last_activity_at, 'the writer did not stamp the column').toBeDefined();
      const stampedAt = new Date(stamped?.last_activity_at ?? '');
      expect(stampedAt.getTime(), 'the stamp is not inside the call window').toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      );
      expect(stampedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);

      // A row that does not exist is `false`, not an error and not `true`.
      expect(
        mustRun('app_admin', [`SELECT authz.record_user_activity('00000000-0000-0000-0000-0000000000ff')`]),
      ).toEqual(['f']);

      // A tombstone is NOT stamped — the person is gone and the row is what retention
      // keeps; a clock that restarts on every touch is the failure `0017` §5 names.
      const tombstoneBefore = superuserRows<{ last_activity_at: string | null }>(
        `SELECT last_activity_at FROM users WHERE id = '${IDS.users.due}'`,
      )[0]?.last_activity_at;
      expect(mustRun('app_admin', [`SELECT authz.record_user_activity('${IDS.users.due}')`])).toEqual(['f']);
      expect(
        superuserRows<{ last_activity_at: string | null }>(
          `SELECT last_activity_at FROM users WHERE id = '${IDS.users.due}'`,
        )[0]?.last_activity_at,
      ).toBe(tombstoneBefore);

      // And a NULL id is refused rather than recording activity for nobody.
      const refused = runRoleScript('app_admin', [`SELECT authz.record_user_activity(NULL)`]);
      expect(refused.ok, refused.output).toBe(false);
      expect(refused.output).toContain('22023');
      expect(refused.output).toContain('the user id is required');
    },
    TIMEOUT,
  );
});
