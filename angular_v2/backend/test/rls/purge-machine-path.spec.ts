import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENQUEUE_INACTIVE_PURGES_SQL, SELECT_DUE_TOMBSTONES_SQL } from '../../src/purge/purge-enqueue.js';
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

/** The window the fixture is built around, in days. */
const WINDOW_DAYS = 30;

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
 * Three users, because "does not enqueue one that is not yet due" needs a bystander.
 *
 * `due` is a tombstone older than the window; `fresh` is a tombstone younger than it —
 * and it is a TOMBSTONE, not a live account, so the assertion is about the window
 * rather than about `deleted_at IS NULL`, which the scan's first conjunct already
 * handles and which a live account would prove instead. `live` is the third
 * population, so "the scan found exactly one user" is a claim about a set rather than
 * about a single row.
 */
const IDS = {
  users: {
    due: 'e1000000-0000-0000-0000-000000000001',
    fresh: 'e1000000-0000-0000-0000-000000000002',
    live: 'e1000000-0000-0000-0000-000000000003',
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
    [IDS.queued, 'mp-queued'],
  ] as const) {
    superuserExec(
      `INSERT INTO users (id, username, email, password_hash)
       VALUES ('${id}', '${username}', '${username}@example.test', 'probe-hash-not-a-real-hash');`,
    );
  }

  // Two tombstones, one on each side of the window, and one live account.
  //
  // `100 days` and `5 days` rather than "older/newer than the window": a fixture that
  // used the same number the code does would pass even if the comparison were
  // inverted, and the whole point of the assertion is which side of the window each
  // row falls on. WINDOW_DAYS is 30.
  superuserExec(
    `UPDATE users SET deleted_at = now() - interval '100 days', deletion_reason = 'inactive' WHERE id = '${IDS.users.due}';`,
  );
  superuserExec(
    `UPDATE users SET deleted_at = now() - interval '5 days', deletion_reason = 'inactive' WHERE id = '${IDS.users.fresh}';`,
  );
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
        `SELECT coalesce(array_agg(t.user_id)::text, '<none>') FROM authz.retention_due_tombstones(${String(WINDOW_DAYS)}) AS t`,
      ]);
      expect(scan).toHaveLength(1);
      expect(scan[0]).toBe(`{${IDS.users.due}}`);

      // Now the pipeline, as ONE statement: the enqueue takes the scan's own output,
      // so a scan that returned the fresh tombstone would enqueue two rows and the
      // count below would be 2. (Over `pg` the application performs the same two
      // steps with the scan's ids bound as a parameter, and skips the enqueue
      // entirely when the scan is empty.)
      const enqueued = mustRun('app_admin', [
        `SELECT authz.enqueue_inactive_purges(ARRAY(SELECT t.user_id FROM authz.retention_due_tombstones(${String(WINDOW_DAYS)}) AS t))`,
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
      const statement = `SELECT authz.enqueue_inactive_purges(ARRAY(SELECT t.user_id FROM authz.retention_due_tombstones(${String(WINDOW_DAYS)}) AS t))`;

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
      const scan = mustRun('app_admin', [bind(SELECT_DUE_TOMBSTONES_SQL, [String(WINDOW_DAYS)])]);
      expect(scan).toHaveLength(1);
      expect(scan[0]).toContain(IDS.users.due);
      expect(scan[0], 'the fresh tombstone was returned by the scan').not.toContain(IDS.users.fresh);

      const enqueued = mustRun('app_admin', [bind(ENQUEUE_INACTIVE_PURGES_SQL, [`{${IDS.users.due}}`])]);
      expect(enqueued).toEqual(['1']);

      expect(queueContents()).toEqual([{ target_id: IDS.users.due, reason: 'inactivity_purge', status: 'pending' }]);

      // And the window reaches the statement as a BOUND value, never as text: a
      // statement built by interpolation would take whatever the caller passed, and
      // the loader that produces this value is the only thing standing between an
      // operator's typo and a syntax error at three in the morning.
      expect(SELECT_DUE_TOMBSTONES_SQL).toContain('$1::integer');
      expect(SELECT_DUE_TOMBSTONES_SQL).not.toMatch(/interval|make_interval/);
    },
    TIMEOUT,
  );

  it(
    'refuses a window of zero, of nothing at all, and of a century and a day',
    () => {
      // Zero is the dangerous one: every tombstone that has ever existed becomes due
      // on the next sweep. A default of zero would be a retention policy nobody chose
      // that deletes personal data immediately.
      for (const [what, argument] of [
        ['zero', '0'],
        ['negative', '-1'],
        ['beyond the ceiling', '36501'],
      ] as const) {
        const refused = runRoleScript('app_admin', [
          `SELECT t.user_id FROM authz.retention_due_tombstones(${argument}) AS t`,
        ]);
        expect(refused.ok, `a ${what} window was accepted:\n${refused.output}`).toBe(false);
        expect(refused.output, `a ${what} window did not raise 22023`).toContain('22023');
        expect(refused.output).toContain('retention window must be between');
      }

      // No window at all is refused too, rather than defaulting to one.
      const absent = runRoleScript('app_admin', ['SELECT authz.retention_due_tombstones(NULL)']);
      expect(absent.ok, absent.output).toBe(false);
      expect(absent.output).toContain('the retention window is required');

      // And a NULL target list is refused rather than read as an empty list: "there is
      // nothing to enqueue" and "nobody said" are different, and only the second is an
      // error.
      const nullList = runRoleScript('app_admin', ['SELECT authz.enqueue_inactive_purges(NULL)']);
      expect(nullList.ok, nullList.output).toBe(false);
      expect(nullList.output).toContain('22023');

      // Nothing was enqueued by any of the five.
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
      expect(mustRun('app_admin', [`SELECT t.user_id FROM authz.retention_due_tombstones(${String(WINDOW_DAYS)}) AS t`]))
        .toHaveLength(1);

      const enqueued = mustRun('app_admin', [
        `SELECT authz.enqueue_inactive_purges(ARRAY(SELECT t.user_id FROM authz.retention_due_tombstones(${String(WINDOW_DAYS)}) AS t))`,
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
          `SELECT authz.enqueue_inactive_purges(ARRAY['${IDS.users.due}']::uuid[])`,
          `SELECT t.user_id FROM authz.retention_due_tombstones(${String(WINDOW_DAYS)}) AS t`,
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
      // twelve attempts.
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
        'authz.enqueue_inactive_purges(uuid[])',
        'authz.retention_due_tombstones(integer)',
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
      // The owner of all six is the migration role, and none of them is owned by a
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
});
