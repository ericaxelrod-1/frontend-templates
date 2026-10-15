import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CLAIM_DUE_PURGE_SQL,
  COMPLETE_PURGE_SQL,
  FAIL_PURGE_SQL,
  REQUEUE_PURGE_SQL,
  toPurgeClaim,
} from '../../src/purge/purge-claim.js';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * `privacy_purge_queue` — migration `0011_privacy_purge_queue.sql`.
 *
 * ## What this suite is proving
 *
 *  1. **The column contract holds.** A concurrent agent wrote the sweeper
 *     (`src/purge/purge-claim.ts`) against this table and named columns in four SQL
 *     statements. This suite runs those four statements — the shipped TEXT, IMPORTED
 *     rather than retyped — against the migrated table. A rename here is not a rename;
 *     it is a sweeper that fails at run time against a table that looks correct.
 *
 *  2. **The ownership key is real.** `claimed_by` is what every write after the claim
 *     predicates on, so a second sweeper's write cannot land on this one's row. That is
 *     asserted by racing the statements: a `COMPLETE` carrying the wrong instance id
 *     must affect ZERO rows, and the runner has to say so rather than reporting success
 *     for work that did not happen (§2.3).
 *
 *  3. **There is no human path to enqueue or delete a queue row**, and the proof is
 *     structural — no serving role holds ANY write verb on this table — rather than a
 *     rule in the migration file. `privacy_purge:create` and `privacy_purge:delete` do
 *     not exist as permission rows at all.
 *
 *  4. **Anonymisation is a STATUS and not a second queue population**, so the admin
 *     list is ONE filterable list. No reason code names a second lifecycle, no column
 *     restates `users.email_anonymized`, and the compliance record is on no purge path.
 *
 *  5. **The RLS POSTURE is pinned** — `relrowsecurity` and `relforcerowsecurity`, read
 *     from `pg_class`. `0011` enables the policies and deliberately does not FORCE the
 *     table, and records that as a trade; until section 8 existed nothing read either
 *     flag, so the sentence was a comment. The trade is only *bounded* while two other
 *     facts hold, and section 8 asserts both: no role reaching the table is SUPERUSER or
 *     BYPASSRLS, and the six `SECURITY DEFINER` writers in `authz` — which run as the
 *     owner and therefore meet NO policy on this table at all — are callable by
 *     `app_admin` alone, with EXECUTE revoked from `PUBLIC`.
 *
 * ## What changed here in `0016`, and why every change is a strengthening
 *
 * `0016` moved the four writes behind narrowly-granted `SECURITY DEFINER` functions in
 * `authz`, because the bare `UPDATE` this suite used to run matched **zero rows in
 * production** — its inner `SELECT … FOR UPDATE SKIP LOCKED` was governed by
 * `privacy_purge_read`, which is a capability call on `authz.actor()`, and the sweeper
 * has no claims document in scope. Three assertions changed with it, and none of them
 * lost a check:
 *
 *  * **`UPDATE 1` / `UPDATE 0` became the exact returned value.** `toContain('UPDATE
 *    1')` passes on `UPDATE 11`, so the substring form was never asserting a count; the
 *    exact form is, and it is asserted through a helper that fails if the statement
 *    printed anything other than exactly one value.
 *  * **The grant assertion GREW.** It used to be "no serving role holds INSERT, DELETE
 *    or TRUNCATE, and `app_admin` holds SELECT and UPDATE". `0016` revokes that UPDATE,
 *    so the assertion is now "no serving role holds ANY write verb, `app_admin` or not"
 *    — a strictly larger set of denials over a strictly larger set of verbs.
 *  * **The UPDATE POLICY assertion is unchanged, and its comment is corrected.** The
 *    policy survives deliberately as the second half of the control; what changed is
 *    that no serving role can reach it, which the comment now says instead of claiming
 *    the sweeper still relies on it.
 *
 * ## Determinism
 *
 * `CLAIM_DUE_PURGE_SQL` claims the globally earliest due row, so every test starts from
 * an empty queue (a file-scope `beforeEach`). Without that, one test's unclaimed row
 * would be claimed by another's and the assertions would pass or fail by declaration
 * order — the false green this suite exists to avoid.
 *
 * ## Execution
 *
 * **These tests have now been run against a real provisioned database** — bootstrap,
 * every migration in directory order, the real `database/seed.ts` — and all of them
 * pass. Getting them to execute required two fixes to the spec itself, both recorded at
 * the site: the column list expected `timestamptz` where `format_type` prints
 * `timestamp with time zone`, and the four imported sweeper statements needed `bind`
 * because `psql` cannot resolve `$1`.
 *
 * The ownership test drives the SHIPPED `COMPLETE_PURGE_SQL` rather than a hand-written
 * copy, so it is the test that goes red if the `claimed_by = p_instance` predicate is
 * removed from `authz.complete_purge()` in `0016`. That was verified by removing it and
 * observing the failure.
 */

const TIMEOUT = 240_000;
const PROOF_DB = 'privacy_purge_queue_proof';

const BOOTSTRAP_SQL = join(BACKEND_ROOT, 'database', 'bootstrap', '001_roles.sql');
const MIGRATIONS_DIR = join(BACKEND_ROOT, 'database', 'migrations');

/** Read from the directory rather than listed here — a stale list is a false baseline. */
function migrationFiles(): readonly string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4,}_.*\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort();
}

/**
 * psql's own transaction echo, which is not any statement's answer.
 *
 * `attemptAsRole` runs with `-q` OFF so that a statement's command tags survive —
 * `UPDATE 0` (matched nothing) and a refused write are different outcomes and
 * telling them apart is half the assertion — and that means `BEGIN`, `SET`,
 * `COMMIT` and `ROLLBACK` are interleaved with the output. They are filtered here
 * rather than by turning `-q` back on, because the tags are still what proves a
 * refused statement was refused AT ALL rather than silently matching nothing.
 */
const PSQL_TRANSACTION_ECHO = new Set(['BEGIN', 'COMMIT', 'ROLLBACK', 'SET', 'ROLLBACK TO SAVEPOINT purge_work']);

function statementOutput(output: string): readonly string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !PSQL_TRANSACTION_ECHO.has(line));
}

/**
 * The single value a settle call returned — `authz.complete_purge()` and its two
 * siblings return the number of rows they matched, and `psql` prints it and nothing
 * else.
 *
 * `toContain('UPDATE 1')` was the previous assertion and it was weaker than it
 * looked: `UPDATE 11` contains `UPDATE 1`, so the substring form never asserted a
 * count. This asserts there is exactly one line and reports what it was, which is
 * both the count and the fact that the statement produced no other output — a
 * `NOTICE` or a second result set would otherwise pass unnoticed.
 */
function settledRows(output: string): string {
  const lines = statementOutput(output);
  if (lines.length !== 1) {
    throw new Error(`expected exactly one returned value, got ${String(lines.length)}:\n${output}`);
  }
  const value = lines[0] ?? '';
  if (!/^\d+$/.test(value)) {
    throw new Error(`expected the number of rows matched, got '${value}':\n${output}`);
  }
  return value;
}

// =============================================================================
// Database plumbing
// =============================================================================

/** Superuser SQL on stdin, so each statement gets its own implicit transaction. */
function superuserExec(database: string, sql: string): string {
  const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', database], {
    encoding: 'utf8',
    input: sql,
  });
  if (result.status !== 0) {
    throw new Error(`superuser psql failed against ${database}:\n${sql}\n${result.stderr}`);
  }
  return result.stdout;
}

function superuserFile(database: string, path: string): void {
  const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', database, '-f', path], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`applying ${path} as superuser failed:\n${result.stderr}`);
  }
}

function superuserCluster(sql: string): void {
  superuserExec('postgres', sql);
}

function superuserRows<T>(sql: string): readonly T[] {
  const stdout = superuserExec(
    PROOF_DB,
    `SELECT coalesce(json_agg(_q)::text, '[]') FROM (${sql.replace(/;\s*$/, '')}) AS _q;`,
  );
  const trimmed = stdout.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
}

/** A statement expected to FAIL, run as the superuser. Returns the message so the test
 *  can name WHICH control refused it. */
function superuserRefusal(sql: string): ScriptOutcome {
  const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', PROOF_DB], {
    encoding: 'utf8',
    input: sql,
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function recreateDatabase(name: string): void {
  const devDb = databaseConfig().database;
  if (name === devDb) {
    throw new Error(`refusing to run the purge-queue proof against the development database (${devDb})`);
  }
  superuserCluster(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid();`);
  superuserCluster(`DROP DATABASE IF EXISTS ${name};`);
  superuserCluster(`CREATE DATABASE ${name} OWNER ${databaseConfig().user};`);
  // The call-count style measurement in the sibling suite needs it; scoped to this
  // throwaway database it is hermetic because the setting dies with the database.
  superuserCluster(`ALTER DATABASE ${name} SET track_functions = 'all';`);
}

function dropProofDatabase(): void {
  superuserCluster(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PROOF_DB}' AND pid <> pg_backend_pid();`);
  superuserCluster(`DROP DATABASE IF EXISTS ${PROOF_DB};`);
}

function applyBaseline(): void {
  superuserFile(PROOF_DB, BOOTSTRAP_SQL);
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

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function claimsFor(sub: string, role: string): string {
  return JSON.stringify({ sub, role });
}

/**
 * The sweeper instance this file speaks as — the value every write after the claim
 * predicates on, so it is named once here rather than typed as a literal at each site.
 */
const SWEEPER_INSTANCE = 'sweeper-0001';

/**
 * Bind a sweeper statement's parameters into its OWN SQL text, because `psql` cannot.
 *
 * `src/purge/purge-claim.ts` writes those statements for `pg`, so they carry `$1`,
 * `$2`, `$3`. `psql` has no bind protocol and is not the client they were written for:
 * `$1` is neither a psql variable (`:'x'`) nor a resolvable parameter outside an
 * extended-protocol message, so PostgreSQL answers `there is no parameter $1` and every
 * test touching the claim fails. What reaches the server is still the IMPORTED constant
 * — copying the SQL into this file would make it prove a stale copy of itself
 * compatible with the table, which is the one thing the import exists to prevent.
 *
 * Running the four statements through `pg` with real bound parameters is the better
 * isolation, and was rejected for one reason: every other assertion in this file is
 * written against **psql's own output** — `UPDATE 0` versus `UPDATE 1`,
 * `permission denied for table` versus `permission denied for function`,
 * `duplicate key`, and the named constraints. None of that survives a transport swap
 * without a rewrite, and rewriting this file's error surface to fix four statements is a
 * larger and riskier change than the bug.
 *
 * Interpolating into SQL is only safe because of the two rules below, and both are
 * enforced here rather than left to the caller:
 *
 *  1. **Every value goes through `quote()`**, which doubles single quotes — the only
 *     escape a `standard_conforming_strings` literal needs. A quote inside a value is
 *     therefore data and can never be syntax.
 *  2. **Every placeholder is filled and every value is used.** A statement and its
 *     arguments cannot drift apart silently: a missing value throws HERE, naming the
 *     parameter, rather than arriving at the server as `there is no parameter $3` —
 *     which is exactly how this bug presented in the first place.
 *
 * The values themselves are all constructed by this file — the queue row's uuid, an
 * instance id, a row count, a short failure string — so nothing derived from a token, a
 * response body or the environment is ever interpolated.
 */
function bind(sql: string, values: readonly string[]): string {
  const indices = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  // 0 parameters and 0 values is the legal empty case; anything else must be contiguous
  // 1..n with exactly n values, which `new Set(indices).size` rules out for `$2` alone.
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

/**
 * The outcome of a scripted psql run, WITHOUT the throw.
 *
 * "this is refused" cannot be expressed by a helper that reports refusal as an
 * exception and then says nothing about WHICH refusal it was: `permission denied for
 * table` (a GRANT) and `new row violates row-level security policy` (a POLICY) are two
 * different controls, and §B2 records that a status-only assertion passes on a real
 * leak.
 */
interface ScriptOutcome {
  readonly ok: boolean;
  readonly output: string;
}

function runRoleScript(role: string, sub: string | undefined, statements: readonly string[], quiet: boolean): ScriptOutcome {
  const preamble = [
    `SET LOCAL ROLE ${role};`,
    ...(sub === undefined ? [] : [`SELECT set_config('request.jwt.claims', ${quote(claimsFor(sub, role))}, true) \\g /dev/null`]),
  ];
  const body = statements
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
    .map((statement) => (/\\[a-z]/.test(statement) || statement.endsWith(';') ? statement : `${statement};`));
  const script = ['BEGIN;', ...preamble, ...body, 'COMMIT;'].join('\n');
  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', ...(quiet ? ['-q'] : []), '-t', '-A', '-d', PROOF_DB],
    { encoding: 'utf8', input: script },
  );
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

type ServingRole = 'app_member' | 'app_admin' | 'app_anon';

/**
 * A statement expected to FAIL, as a serving role. `-q` is off so psql's command TAGS
 * survive: `UPDATE 0` (matched nothing) and a refused write are different outcomes, and
 * telling them apart is half the assertion.
 */
function attemptAsRole(role: ServingRole, sub: string | undefined, statements: readonly string[]): ScriptOutcome {
  return runRoleScript(role, sub, statements, false);
}

/** A statement expected to SUCCEED, as a serving role, as parsed JSON rows. */
function rowsAsRole<T>(role: ServingRole, sub: string | undefined, sql: string): readonly T[] {
  const outcome = runRoleScript(
    role,
    sub,
    [`SELECT coalesce(json_agg(_r)::text, '[]') FROM (${sql.replace(/;\s*$/, '')}) AS _r;`],
    true,
  );
  if (!outcome.ok) {
    throw new Error(`query as ${role} (sub ${sub ?? 'unset'}) failed:\n${outcome.output}`);
  }
  const trimmed = outcome.output.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
}

// =============================================================================
// The fixture
// =============================================================================

/**
 * One `users` row per purge TARGET, so "one open purge per target" is a claim about
 * distinct targets rather than a single row in a single-target fixture — and so each
 * test's queue row cannot collide with another's partial UNIQUE.
 */
const IDS = {
  adminProbe: 'c1000000-0000-0000-0000-000000000001',
  narrowAdmin: 'c1000000-0000-0000-0000-000000000002',
  targets: {
    contract: 'c1000000-0000-0000-0000-000000000010',
    ownership: 'c1000000-0000-0000-0000-000000000011',
    poison: 'c1000000-0000-0000-0000-000000000012',
    narrowing: 'c1000000-0000-0000-0000-000000000013',
    guard: 'c1000000-0000-0000-0000-000000000014',
    guardOther: 'c1000000-0000-0000-0000-000000000015',
    claimed: 'c1000000-0000-0000-0000-000000000016',
    checks: 'c1000000-0000-0000-0000-000000000017',
    readGate: 'c1000000-0000-0000-0000-000000000018',
    anonymised: 'c1000000-0000-0000-0000-000000000019',
  },
  /** Holds `project.read` and nothing privacy — the capability "nobody" case. */
  noPrivacyRole: 'c2000000-0000-0000-0000-000000000001',
} as const;

function probeLabel(id: string): string {
  return `probe-${id.slice(-4)}`;
}

function probeEmail(id: string): string {
  return `${probeLabel(id)}@example.test`;
}

/**
 * Enqueues through the OWNER, which is the only identity that can: no serving role holds
 * INSERT on this table, and that refusal is the control under test. A row written any
 * other way would be testing a fixture rather than the schema.
 */
function enqueue(targetId: string, dueIn = '0 seconds'): string {
  const stdout = superuserExec(
    PROOF_DB,
    `INSERT INTO privacy_purge_queue (target_kind, target_id, target_ref, reason, scheduled_for)
     VALUES ('user', '${targetId}', 'probe-user-${targetId.slice(-4)}', 'inactivity_purge', now() + interval '${dueIn}')
     RETURNING id;`,
  );
  const id = stdout.trim();
  if (id === '') {
    throw new Error('enqueueing a purge row returned no id');
  }
  return id;
}

interface QueueRow {
  readonly status: string;
  readonly attempt: number;
  readonly claimed_by: string | null;
  readonly rows_deleted: number | null;
  readonly error: string | null;
  readonly completed_at: string | null;
  readonly target_id: string | null;
}

function queueRow(id: string): QueueRow | undefined {
  return superuserRows<QueueRow>(
    `SELECT status, attempt, claimed_by, rows_deleted, error, completed_at, target_id
       FROM privacy_purge_queue WHERE id = '${id}'`,
  )[0];
}

let seedRun: { readonly code: number; readonly output: string };

function runSeed(): { readonly code: number; readonly output: string } {
  const result = spawnSync('node', ['--experimental-strip-types', 'database/seed.ts'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DB_NAME: PROOF_DB, SEED_ADMIN_PASSWORD: 'purge-proof-admin-password' },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

beforeAll(() => {
  recreateDatabase(PROOF_DB);
  applyBaseline();

  seedRun = runSeed();
  if (seedRun.code !== 0) {
    throw new Error(`database/seed.ts failed (exit ${seedRun.code}):\n${seedRun.output}`);
  }

  // `Object.values`, not `Object.entries`: entries() yields [label, id] pairs and
  // destructuring `[id]` takes the LABEL — a human-readable word like 'contract'
  // straight into a uuid column. The `as ReadonlyArray<readonly [string, string]>`
  // cast is what let it typecheck, and it was asserting the shape away rather than
  // checking it.
  const userIds: readonly string[] = [IDS.adminProbe, IDS.narrowAdmin, ...Object.values(IDS.targets)];

  const values = userIds
    .map((id) => `('${id}', '${probeLabel(id)}', '${probeEmail(id)}', 'not-a-real-hash')`)
    .join(',\n        ');

  superuserExec(
    PROOF_DB,
    `
    INSERT INTO roles (id, name, parent_id, is_system_role)
      VALUES ('${IDS.noPrivacyRole}', 'probe-role-no-purge', NULL, false);

    INSERT INTO role_permissions (role_id, permission_id)
      SELECT '${IDS.noPrivacyRole}', id FROM permissions WHERE resource = 'project' AND action_id = 'read';

    INSERT INTO users (id, username, email, password_hash) VALUES
      ${values};

    INSERT INTO user_roles (user_id, role_id) SELECT '${IDS.adminProbe}', id FROM roles WHERE name = 'admin';
    INSERT INTO user_roles (user_id, role_id) VALUES ('${IDS.narrowAdmin}', '${IDS.noPrivacyRole}');
    `,
  );
}, TIMEOUT);

// Determinism, not hygiene: the sweeper claims the globally earliest DUE row, so a row
// left behind by one test would be claimed by another and the assertions would depend on
// declaration order. Cleared as the OWNER, which is the only identity with DELETE.
beforeEach(() => {
  superuserExec(PROOF_DB, 'DELETE FROM privacy_purge_queue;');
});

afterAll(() => {
  // `database/seed.ts` runs a CLUSTER-scoped `ALTER ROLE … PASSWORD`, so the restore is
  // in a `finally`: it is the one step that must not be skipped.
  try {
    dropProofDatabase();
  } finally {
    restoreAuthenticatorPassword();
  }
});

// =============================================================================
// 1 — the column contract
// =============================================================================

describe('privacy_purge_queue · the column contract the sweeper was written against', () => {
  it(
    'carries exactly the agreed columns, in the agreed order, with the agreed types',
    () => {
      // Read from the catalog rather than from the migration file: the contract is what
      // the database presents to `src/purge/purge-claim.ts`, not what a file claims to
      // contain. `target_id` is in the list because the spec adds it to the twelve the
      // sweeper names — the ROW BEING ACTED ON, which `SqlPurgeExecutor.deleteUser()`
      // needs and which `target_ref` cannot carry for a `user` target.
      //
      // `format_type` renders `timestamptz` as `timestamp with time zone` — the SQL
      // standard name, which is what the catalog's canonical renderer emits and what
      // `pg_attribute.atttypname` ('timestamptz') is an ALIAS of. Matching either
      // spelling would accept a string no renderer produces, so the expected list states
      // the renderer's output exactly. §B1 wants `timestamptz`; this asserts the same
      // OID, read by the name the database prints.
      const columns = superuserRows<{ column: string; type: string }>(
        `SELECT a.attname AS column, format_type(a.atttypid, a.atttypmod) AS type
           FROM pg_attribute a
          WHERE a.attrelid = 'public.privacy_purge_queue'::regclass
            AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum`,
      );
      expect(columns.map((row) => `${row.column}:${row.type}`)).toEqual([
        'id:uuid',
        'target_kind:text',
        'target_id:uuid',
        'target_ref:text',
        'reason:text',
        'scheduled_for:timestamp with time zone',
        'status:text',
        'attempt:integer',
        'claimed_at:timestamp with time zone',
        'claimed_by:text',
        'completed_at:timestamp with time zone',
        'rows_deleted:integer',
        'error:text',
      ]);
    },
    TIMEOUT,
  );

  it(
    'attempt is an integer defaulting to 0, and every key is uuidv7() from the column default',
    () => {
      // `attempt` is what feeds the retry/backoff and what the poison-pill threshold
      // counts, so its default is part of the contract rather than an implementation
      // detail. `NOT NULL DEFAULT 0` rather than nullable: a null attempt is a third
      // state nobody has a meaning for, and a comparison against the threshold would
      // treat NULL as "no attempts yet" on a row that has failed nine times.
      expect(
        superuserRows<{ default_expr: string; not_null: boolean }>(
          `SELECT coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS default_expr, a.attnotnull AS not_null
             FROM pg_attribute a
             LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = 'public.privacy_purge_queue'::regclass AND a.attname = 'attempt'`,
        )[0],
      ).toEqual({ default_expr: '0', not_null: true });

      // A v4 would break the tie-break's meaning, not merely index locality: the sweeper
      // orders by `(scheduled_for, id)` and the ids are v7 so the tie-break IS mint order.
      expect(
        superuserRows<{ column: string; default_expr: string }>(
          `SELECT a.attname AS column, pg_get_expr(d.adbin, d.adrelid) AS default_expr
             FROM pg_attrdef d
             JOIN pg_class c ON c.oid = d.adrelid
             JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
            WHERE c.oid = 'public.privacy_purge_queue'::regclass
              AND format_type(a.atttypid, a.atttypmod) = 'uuid'
              AND pg_get_expr(d.adbin, d.adrelid) <> 'uuidv7()'`,
        ).map((row) => `${row.column}=${row.default_expr}`),
      ).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'the four shipped sweeper statements execute against this table — the contract, RUN rather than asserted',
    () => {
      // The point of the whole file. `src/purge/purge-claim.ts` is IMPORTED, not
      // retyped, so a column renamed in the migration cannot be "proved compatible"
      // against a stale copy of its own SQL. `bind` only supplies the values the
      // statement already declares — `$1` is the instance id on the claim, and
      // `$1/$2/$3` on the three writes are (row id, instance id, payload).
      const id = enqueue(IDS.targets.contract);

      const claimed = attemptAsRole('app_admin', IDS.adminProbe, [bind(CLAIM_DUE_PURGE_SQL, [SWEEPER_INSTANCE])]);
      expect(claimed.ok, claimed.output).toBe(true);
      // Exactly one row back, and it is the fixture's row. `authz.claim_due_purge()`
      // returns the claim or returns nothing, so a zero-row answer would be visible
      // here as an empty output — which is what the shipped statement produced in
      // production before `0016`, silently.
      const claimRows = statementOutput(claimed.output);
      expect(claimRows).toHaveLength(1);
      expect(claimRows[0]).toContain(id);

      const afterClaim = queueRow(id);
      expect(afterClaim?.status).toBe('claimed');
      expect(afterClaim?.attempt, 'attempt advances on EVERY claim, including a failed one').toBe(1);
      // The substituted value is visible in the row, not only in the SQL text: this is
      // what says the bind actually reached `claimed_by`.
      expect(afterClaim?.claimed_by).toBe(SWEEPER_INSTANCE);
      // …and in the row the claim RETURNED, which is a second, independent read of
      // the same fact rather than a re-read of the table the claim wrote.
      expect(claimRows[0]).toContain(SWEEPER_INSTANCE);

      // `REQUEUE_PURGE_SQL` clears the owner together with the status, so the row is
      // claimable again and the CHECK `pending ⇒ unowned` holds.
      const requeued = attemptAsRole('app_admin', IDS.adminProbe, [
        bind(REQUEUE_PURGE_SQL, [id, SWEEPER_INSTANCE, 'transient']),
      ]);
      expect(requeued.ok, requeued.output).toBe(true);
      expect(settledRows(requeued.output)).toBe('1');

      const afterRequeue = queueRow(id);
      expect(afterRequeue?.status).toBe('pending');
      expect(afterRequeue?.claimed_by).toBeNull();
      expect(afterRequeue?.error, 'the failure text is KEPT so an operator can read it').toBe('transient');

      const reclaimed = attemptAsRole('app_admin', IDS.adminProbe, [bind(CLAIM_DUE_PURGE_SQL, [SWEEPER_INSTANCE])]);
      expect(reclaimed.ok, reclaimed.output).toBe(true);
      expect(statementOutput(reclaimed.output)).toHaveLength(1);
      const completed = attemptAsRole('app_admin', IDS.adminProbe, [bind(COMPLETE_PURGE_SQL, [id, SWEEPER_INSTANCE, '1'])]);
      expect(completed.ok, completed.output).toBe(true);
      expect(settledRows(completed.output)).toBe('1');

      const done = queueRow(id);
      expect(done?.status).toBe('done');
      expect(done?.rows_deleted).toBe(1);
      expect(done?.completed_at).not.toBeNull();
      expect(done?.error).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'a sweeper that no longer owns a row matches ZERO rows, and the outcome says so rather than reporting success',
    () => {
      // The N-sweeper safety story in one assertion, run through the SHIPPED statement
      // rather than a copy of it. `authz.complete_purge()`'s `claimed_by = p_instance`
      // is the predicate, so this is the test that goes red if that conjunct is
      // removed from `0016_purge_machine_path.sql` — a hand-written `UPDATE` here would
      // have proved only that the SCHEMA tolerates the predicate, while saying nothing
      // whatever about the statement that actually ships it.
      const id = enqueue(IDS.targets.ownership);
      const claimed = attemptAsRole('app_admin', IDS.adminProbe, [bind(CLAIM_DUE_PURGE_SQL, [SWEEPER_INSTANCE])]);
      expect(claimed.ok, claimed.output).toBe(true);
      expect(queueRow(id)?.claimed_by).toBe(SWEEPER_INSTANCE);

      const competitor = attemptAsRole('app_admin', IDS.adminProbe, [bind(COMPLETE_PURGE_SQL, [id, 'sweeper-9999', '1'])]);
      expect(competitor.ok, competitor.output).toBe(true);
      // ZERO is the whole assertion. Reporting success here is `sweepOne`'s §2.3
      // failure mode: work that happened on somebody else's row recorded as work this
      // sweeper did. Exact equality, so a statement that wrote two rows cannot pass.
      expect(settledRows(competitor.output)).toBe('0');

      // The refused write left NO trace: a completion that matched zero rows must not
      // still have stamped a count or a completion instant (§2.3, in the other
      // direction — a partial application of work that did not happen).
      const stolen = queueRow(id);
      expect(stolen?.status).toBe('claimed');
      expect(stolen?.rows_deleted).toBeNull();
      expect(stolen?.completed_at).toBeNull();

      // …and the instance that DOES own it still can.
      const owner = attemptAsRole('app_admin', IDS.adminProbe, [bind(COMPLETE_PURGE_SQL, [id, SWEEPER_INSTANCE, '1'])]);
      expect(owner.ok, owner.output).toBe(true);
      expect(settledRows(owner.output)).toBe('1');
      expect(queueRow(id)?.status).toBe('done');

      // …and the same owner cannot complete it twice: `status = 'claimed'` is the second
      // conjunct, and a second erasure from one row is the whole reason it is there.
      const again = attemptAsRole('app_admin', IDS.adminProbe, [bind(COMPLETE_PURGE_SQL, [id, SWEEPER_INSTANCE, '1'])]);
      expect(again.ok, again.output).toBe(true);
      expect(settledRows(again.output)).toBe('0');
    },
    TIMEOUT,
  );

  it(
    'the poison pill is terminal, keeps its error, and stays visible to an operator',
    () => {
      const id = enqueue(IDS.targets.poison);
      const claimed = attemptAsRole('app_admin', IDS.adminProbe, [bind(CLAIM_DUE_PURGE_SQL, [SWEEPER_INSTANCE])]);
      expect(claimed.ok, claimed.output).toBe(true);

      const failed = attemptAsRole('app_admin', IDS.adminProbe, [
        bind(FAIL_PURGE_SQL, [id, SWEEPER_INSTANCE, 'unsupported reason']),
      ]);
      expect(failed.ok, failed.output).toBe(true);
      expect(settledRows(failed.output)).toBe('1');

      const row = queueRow(id);
      expect(row?.status).toBe('failed');
      expect(row?.error).toBe('unsupported reason');
      expect(row?.attempt).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'toPurgeClaim refuses a target_kind this build does not implement rather than passing it through',
    () => {
      // The narrowing half of the shipped narrowing, asserted against the ROW the
      // database actually returned. A row this build cannot execute must become
      // `undefined`, so no downstream `switch` can grow a default branch and start
      // treating an unknown target as something it is not.
      const id = enqueue(IDS.targets.narrowing);
      const claimed = attemptAsRole('app_admin', IDS.adminProbe, [bind(CLAIM_DUE_PURGE_SQL, [SWEEPER_INSTANCE])]);
      expect(claimed.ok, claimed.output).toBe(true);

      const row = superuserRows<{
        id: string;
        target_kind: string;
        target_id: string | null;
        target_ref: string | null;
        reason: string;
        attempt: number;
      }>(`SELECT id, target_kind, target_id, target_ref, reason, attempt FROM privacy_purge_queue WHERE id = '${id}'`)[0];
      if (row === undefined) {
        throw new Error('the claimed row vanished');
      }

      const claim = toPurgeClaim(row);
      expect(claim?.targetKind).toBe('user');
      // `targetId` is nullable in the type, and the database's CHECK is what makes a
      // `user` target non-null — so the executor's `targetId === null` branch really is
      // unreachable, which is why it checks anyway rather than assuming.
      expect(claim?.targetId).toBe(IDS.targets.narrowing);
      expect(toPurgeClaim({ ...row, target_kind: 'wormhole' })).toBeUndefined();
    },
    TIMEOUT,
  );
});

// =============================================================================
// 2 — the constraints that stop a double sweep reporting success
// =============================================================================

describe('privacy_purge_queue · a double sweep cannot report rows_deleted = 0 as success', () => {
  it(
    'the partial UNIQUE refuses a second OPEN purge for the same target, and permits a fresh one once the first is terminal',
    () => {
      // Without it, a retention scan that runs twice inside one window queues every
      // tombstone twice; the second attempt finds nothing to delete, writes
      // `rows_deleted = 0`, and the admin view reads that as a successful purge — a
      // success-shaped value for work that did not happen (§2.3).
      enqueue(IDS.targets.guard);

      const refused = superuserRefusal(
        `INSERT INTO privacy_purge_queue (target_kind, target_id, target_ref, reason, scheduled_for)
         VALUES ('user', '${IDS.targets.guard}', 'probe-duplicate', 'inactivity_purge', now());`,
      );
      expect(refused.ok, refused.output).toBe(false);
      expect(refused.output).toContain('duplicate key');
      expect(refused.output).toContain('privacy_purge_queue_one_open_per_target');

      // A DIFFERENT target is not a duplicate — the index leads on `target_kind` and then
      // the target, so "one open purge per target" really is per target rather than "one
      // open purge in the table".
      expect(() => enqueue(IDS.targets.guardOther)).not.toThrow();

      // Once the first is terminal, a later sweep may schedule a fresh purge for the same
      // target — so the guard does not pin a target forever.
      superuserExec(
        PROOF_DB,
        `UPDATE privacy_purge_queue SET status = 'done', completed_at = now(), rows_deleted = 1
          WHERE target_id = '${IDS.targets.guard}' AND status = 'pending';`,
      );
      expect(() => enqueue(IDS.targets.guard)).not.toThrow();
    },
    TIMEOUT,
  );

  it(
    'a CLAIMED row also blocks a re-enqueue — a target being deleted RIGHT NOW must not get a second purge behind it',
    () => {
      const id = enqueue(IDS.targets.claimed);
      superuserExec(
        PROOF_DB,
        `UPDATE privacy_purge_queue SET status = 'claimed', claimed_at = now(), claimed_by = 'sweeper-0001'
          WHERE id = '${id}';`,
      );

      const refused = superuserRefusal(
        `INSERT INTO privacy_purge_queue (target_kind, target_id, target_ref, reason, scheduled_for)
         VALUES ('user', '${IDS.targets.claimed}', 'probe-behind-a-claim', 'inactivity_purge', now());`,
      );
      expect(refused.ok, refused.output).toBe(false);
      expect(refused.output).toContain('duplicate key');
    },
    TIMEOUT,
  );

  it(
    'the CHECKs refuse every shape the sweeper must never produce',
    () => {
      // Each of these is a value an operator would read as a completed deletion. They are
      // refused at INSERT, which is the only point a CHECK is evaluated — the same reason
      // the audit table's completeness CHECK is worth nothing on a mutable row.
      const target = IDS.targets.checks;
      const refused: ReadonlyArray<{ what: string; values: string }> = [
        {
          what: 'a done row with no completed_at and no rows_deleted',
          values: `('user', '${target}', 'r', 'inactivity_purge', now(), 'done', 0, NULL, NULL, NULL, NULL, NULL)`,
        },
        {
          what: 'a claimed row that names no owner',
          values: `('user', '${target}', 'r', 'inactivity_purge', now(), 'claimed', 1, NULL, NULL, NULL, NULL, NULL)`,
        },
        {
          what: 'a pending row that still names a sweeper',
          values: `('user', '${target}', 'r', 'inactivity_purge', now(), 'pending', 0, now(), 'sweeper-0001', NULL, NULL, NULL)`,
        },
        {
          what: 'a negative row count',
          values: `('user', '${target}', 'r', 'inactivity_purge', now(), 'done', 0, NULL, NULL, now(), -1, NULL)`,
        },
        {
          what: 'a user target with no target_id',
          values: `('user', NULL, 'r', 'inactivity_purge', now(), 'pending', 0, NULL, NULL, NULL, NULL, NULL)`,
        },
        {
          what: 'a file target with no target_ref',
          values: `('file', NULL, NULL, 'retention_export_artefact', now(), 'pending', 0, NULL, NULL, NULL, NULL, NULL)`,
        },
        {
          what: 'a target_kind this build does not implement',
          values: `('wormhole', NULL, 'r', 'inactivity_purge', now(), 'pending', 0, NULL, NULL, NULL, NULL, NULL)`,
        },
        {
          what: 'a reason code this build does not implement',
          values: `('user', '${target}', 'r', 'when_i_feel_like_it', now(), 'pending', 0, NULL, NULL, NULL, NULL, NULL)`,
        },
      ];

      for (const { what, values } of refused) {
        const attempt = superuserRefusal(
          `INSERT INTO privacy_purge_queue
             (target_kind, target_id, target_ref, reason, scheduled_for, status, attempt,
              claimed_at, claimed_by, completed_at, rows_deleted, error)
           VALUES ${values};`,
        );
        expect(attempt.ok, `${what} was accepted:\n${attempt.output}`).toBe(false);
        // Named constraints, so the refusal says WHICH control fired rather than merely
        // that something did.
        expect(attempt.output).toContain('privacy_purge_queue_');
      }

      // Nothing above left a row behind, which is itself part of the assertion: a refused
      // INSERT that still enqueued would make the next test's double-sweep guard fire
      // for the wrong reason.
      expect(superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM privacy_purge_queue`)[0]?.count).toBe(0);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 3 — no human path to enqueue or delete
// =============================================================================

describe('privacy_purge_queue · enqueue and execute have no human path', () => {
  it(
    'no serving role holds ANY write verb — the control is the grant, not a rule in a file',
    () => {
      // INSERT, UPDATE, DELETE and TRUNCATE, for every serving role INCLUDING
      // `app_admin`. Before `0016` this list was missing UPDATE, because the sweeper's
      // claim was a bare `UPDATE`; that grant is revoked now, so the assertion covers
      // one more verb than it did and there is one fewer role that can write here.
      //
      // The reason for removing it is in `0016`: with the grant in place the bare
      // statements remain a second, WORKING route to the same job, and the one that is
      // inert fails SILENTLY — `UPDATE 0` reads exactly like an empty queue.
      for (const role of ['app_anon', 'app_member', 'app_admin']) {
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
          expect(
            superuserRows<{ holds: boolean }>(
              `SELECT has_table_privilege('${role}', 'public.privacy_purge_queue', '${privilege}') AS holds`,
            )[0]?.holds,
            `${role} holds ${privilege} on privacy_purge_queue`,
          ).toBe(false);
        }
      }

      // …and the one verb that remains is the admin list. It is still gated by
      // `privacy_purge_read`, so an admin whose role lacks `privacy_purge:read` reads
      // ZERO rows despite holding it — asserted in the capability section below, which
      // is why this file can name the grant as the admin's read without it being a
      // bypass.
      expect(
        superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_admin', 'public.privacy_purge_queue', 'SELECT') AS holds`,
        )[0]?.holds,
        'app_admin is missing SELECT, so the admin list cannot be read at all',
      ).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'an app_admin INSERT, UPDATE and DELETE are all refused, and the refusal names the TABLE rather than a policy',
    () => {
      for (const statement of [
        `INSERT INTO privacy_purge_queue (target_kind, target_ref, reason, scheduled_for) VALUES ('file', '/tmp/x', 'retention_export_artefact', now())`,
        `UPDATE privacy_purge_queue SET status = 'done', completed_at = now(), rows_deleted = 1 WHERE status = 'pending'`,
        'DELETE FROM privacy_purge_queue',
      ]) {
        const attempt = attemptAsRole('app_admin', IDS.adminProbe, [statement]);
        expect(attempt.ok, attempt.output).toBe(false);
        expect(attempt.output).toContain('permission denied for table');
        // The oracle: `permission denied for FUNCTION` would mean a caller had reached the
        // policy, which names the schema behind it.
        expect(attempt.output).not.toContain('permission denied for function');
      }
    },
    TIMEOUT,
  );

  it(
    'the table carries only a SELECT and an UPDATE policy, so a future table-level grant still cannot open a write',
    () => {
      expect(
        superuserRows<{ cmd: string }>(
          `SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'privacy_purge_queue' ORDER BY cmd`,
        ).map((row) => row.cmd),
      ).toEqual(['SELECT', 'UPDATE']);

      // CORRECTED, 2026-10-14, by `0016`. The predicate is still `current_user` and
      // nothing else, and the reasoning that made it so still holds: the retention job
      // carries no claims document, so `authz.actor()` is NULL inside it and any
      // capability conjunct would deny it on a database whose seed had never run.
      //
      // What is no longer true is that any serving role can REACH this policy. `0016`
      // revoked `UPDATE` from `app_admin`, so no serving role holds the grant this
      // policy would admit — which is why it is KEPT: it is the second half of the
      // control, and a future `GRANT UPDATE` is refused at the row layer as well as at
      // the grant layer. That is the same two-halves arrangement `privacy_request_audits`
      // uses in the other direction (no policy AND no grant), and asserting the policy
      // set is what stops a "tidy-up" from deleting the half that is not obviously load
      // bearing.
      const update = superuserRows<{ qual: string }>(
        `SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'privacy_purge_queue' AND cmd = 'UPDATE'`,
      )[0];
      expect(update?.qual).toContain('app_admin');
      expect(update?.qual).not.toContain('has_permission');
    },
    TIMEOUT,
  );

  it(
    'privacy_purge carries read and update and NEITHER create nor delete',
    () => {
      // Admin alone, matching the table grants: a permission nobody can reach the table
      // with is a decorative row. And the two absent verbs are absent from `permissions`
      // entirely, so they could be granted to every role in the database and not one of
      // them could use them.
      expect(
        superuserRows<{ resource: string; action_id: string; grants: number }>(
          `SELECT p.resource, p.action_id, count(rp.role_id)::int AS grants
             FROM permissions p
             LEFT JOIN role_permissions rp ON rp.permission_id = p.id
            WHERE p.resource = 'privacy_purge'
            GROUP BY p.resource, p.action_id
            ORDER BY p.action_id`,
        ).map((row) => `${row.action_id}=${String(row.grants)}`),
      ).toEqual(['read=1', 'update=1']);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 4 — the read is capability-gated
// =============================================================================

describe('privacy_purge_queue · the admin list is ONE filterable list, and it is capability-gated', () => {
  it(
    'an admin holding privacy_purge:read sees the queue; an admin without it sees ZERO rows',
    () => {
      enqueue(IDS.targets.readGate);

      // PERMITTED: the admin, through the boundary, holding the capability.
      expect(
        rowsAsRole<{ reason: string }>('app_admin', IDS.adminProbe, 'SELECT reason FROM privacy_purge_queue'),
      ).not.toEqual([]);

      // DENIED: the read policy is a bare capability call with NO `current_user`
      // shortcut, so the principal that holds the table grant AND reaches this table is
      // still refused unless its ROLE rows confer the capability. This is the assertion
      // that says capability is a gate and not a decoration beside a table grant.
      expect(
        rowsAsRole<{ reason: string }>('app_admin', IDS.narrowAdmin, 'SELECT reason FROM privacy_purge_queue'),
      ).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'a member and an app_anon cannot read the queue at all — the refusal is at the GRANT layer',
    () => {
      // Half the rows in this queue have no subject at all (a retention sweep over
      // `login_attempts` past its window), so there is no member-scoped question this
      // table could answer and inventing one would be the DERIVED mistake ADR-0025 names.
      for (const role of ['app_member', 'app_anon'] as const) {
        const attempt = attemptAsRole(role, undefined, ['SELECT count(*) FROM privacy_purge_queue']);
        expect(attempt.ok, attempt.output).toBe(false);
        expect(attempt.output).toContain('permission denied for table');
        expect(attempt.output).not.toContain('permission denied for function');
      }
    },
    TIMEOUT,
  );
});

// =============================================================================
// 5 — anonymisation is a status, not a second population
// =============================================================================

describe('privacy_purge_queue · anonymisation is a STATUS, not a second queue population', () => {
  it(
    'no reason code names a second lifecycle, and no column restates users.email_anonymized',
    () => {
      // Conflating the two operations is the mistake that either never deletes anything
      // or destroys the compliance evidence. Conflated towards anonymisation it is
      // retention that never expires — and the harm is not disk, it is that the retention
      // policy this template PUBLISHES is one it does not ENFORCE, which is what an
      // auditor reads. Conflated towards purge it destroys the record that a request was
      // honoured, converting compliance from an obligation into an unverifiable claim.
      //
      // Anonymisation is an in-place column rewrite and purge is a row deletion: two
      // statements on two tables with opposite failure modes. So there is ONE code for
      // every `users` row, anonymised or not, and the tombstone reaches the queue through
      // the SAME scan as everybody else — which is what makes the admin list ONE
      // filterable list rather than two half-populations.
      const check = superuserRows<{ definition: string }>(
        `SELECT pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'public.privacy_purge_queue'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%inactivity_purge%'`,
      )[0]?.definition;
      expect(check).toBeDefined();
      expect(check).toContain('inactivity_purge');

      // `erasure_anonymized` was rejected: a code that names a POPULATION implies that
      // population has its own lifecycle, and it does not need one.
      expect(check).not.toContain('erasure_anonymized');
      // `cancelled` is named in `docs/rebase.md` §9A.5 and deliberately absent: an enum
      // value nothing writes is a status the database appears to support and nothing can
      // produce (§2.1). It is one `ALTER TABLE` when the cancel lands.
      expect(check).not.toContain('cancelled');

      // Nothing on the row restates the fact, so the two copies cannot drift.
      const columns = superuserRows<{ attname: string }>(
        `SELECT attname FROM pg_attribute
          WHERE attrelid = 'public.privacy_purge_queue'::regclass AND attnum > 0 AND NOT attisdropped`,
      ).map((row) => row.attname);
      expect(columns.filter((name) => name.includes('anonym'))).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'the compliance record is on no purge path at all, and the queue row outlives its target',
    () => {
      // The absence is a design decision with a test rather than an omission: an operator
      // who edits the reason vocabulary to reach the audit table has found a bug, not
      // extended the mechanism.
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_constraint
            WHERE contype = 'f' AND confrelid = 'public.privacy_request_audits'::regclass`,
        )[0]?.count,
      ).toBe(0);

      // …and the queue row carries no foreign key to its target either, so the record
      // that a purge was SCHEDULED outlives the row it was scheduled against. An FK would
      // either block the delete or cascade the queue row away with it, and in both cases
      // `SqlPurgeExecutor` could not delete what it was asked to delete.
      expect(
        superuserRows<{ conname: string }>(
          `SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.privacy_purge_queue'::regclass AND contype = 'f'`,
        ).map((row) => row.conname),
      ).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'an anonymised user is a users row like any other, so it purges for inactivity under the same reason code',
    () => {
      // The claim on the row rather than in a comment. Soft-delete the target, and the one
      // reason code still covers it. The choke point in 0009 removes its memberships — and
      // nothing about the queue has to know that happened.
      const target = IDS.targets.anonymised;
      superuserExec(
        PROOF_DB,
        `UPDATE users SET deleted_at = now(), deletion_reason = 'rtbf' WHERE id = '${target}';`,
      );
      enqueue(target);

      const tombstone = superuserRows<{ anonymized: boolean; deleted: boolean }>(
        `SELECT email_anonymized AS anonymized, deleted_at IS NOT NULL AS deleted FROM users WHERE id = '${target}'`,
      )[0];
      expect(tombstone?.anonymized).toBe(true);
      expect(tombstone?.deleted).toBe(true);

      // Queued under the SAME code as anybody else — one population, one reason, one list.
      expect(
        superuserRows<{ reason: string; status: string }>(
          `SELECT reason, status FROM privacy_purge_queue WHERE target_id = '${target}'`,
        ).map((row) => row.reason),
      ).toEqual(['inactivity_purge']);

      // And the tombstone's authority is already gone, which is the anonymisation choke
      // point doing its job with the queue not participating at all.
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM user_roles WHERE user_id = '${target}'`,
        )[0]?.count,
      ).toBe(0);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 6 — the indexes the sweeper's one query depends on
// =============================================================================

describe('privacy_purge_queue · the sweeper one query has an index that matches it', () => {
  it(
    'carries a partial index on exactly the due predicate, one on the admin list, and the double-sweep guard',
    () => {
      // Asserted as INDEXES rather than as a comment: a constraint that is only a
      // comment is the §2.1 shape, and the tie-break in `ORDER BY scheduled_for, id`
      // has to be stable across two sweepers or they contend for one row and one does
      // nothing.
      const indexes = new Map(
        superuserRows<{ indexname: string; indexdef: string }>(
          `SELECT indexname, indexdef FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'privacy_purge_queue'`,
        ).map((row) => [row.indexname, row.indexdef]),
      );
      expect([...indexes.keys()].sort()).toEqual([
        'privacy_purge_queue_due_idx',
        'privacy_purge_queue_one_open_per_target',
        'privacy_purge_queue_open_idx',
        'privacy_purge_queue_pkey',
      ]);

      const due = indexes.get('privacy_purge_queue_due_idx') ?? '';
      expect(due).toContain('(scheduled_for, id)');
      expect(due).toContain("'pending'");

      // The admin list asks a DIFFERENT question — everything still open, oldest first —
      // so it gets its own partial index rather than a sort over the pending subset, and
      // rather than being served `claimed` rows from an index that excludes them.
      const open = indexes.get('privacy_purge_queue_open_idx') ?? '';
      expect(open).toContain('(scheduled_for, id)');
      expect(open).toContain("'claimed'");

      const guard = indexes.get('privacy_purge_queue_one_open_per_target') ?? '';
      expect(guard).toContain('UNIQUE');
      expect(guard).toContain("'pending'");
      expect(guard).toContain("'claimed'");
    },
    TIMEOUT,
  );
});

// =============================================================================
// 7 — the proof is really a provision
// =============================================================================

describe('the purge-queue proof is a real provision, so no denial above is a vacuous one', () => {
  it(
    'the real seed ran, and the table and its two capability rows exist',
    () => {
      // Without this, every "sees zero rows" assertion above would also pass against an
      // un-applied migration, a failed seed, or an absent table.
      expect(seedRun.code, seedRun.output).toBe(0);
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_class WHERE oid = 'public.privacy_purge_queue'::regclass`,
        )[0]?.count,
      ).toBe(1);
      expect(
        superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM permissions WHERE resource = 'privacy_purge'`)[0]
          ?.count,
      ).toBe(2);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 8 — the RLS posture: ENABLEd, deliberately NOT FORCEd, and bounded
// =============================================================================

/**
 * The six `authz` writers `0016` installed, addressed by their **exact signatures**.
 *
 * A name-only match would also catch a same-named overload, and `aclexplode` over
 * `proacl` is the only way to ask "who may call this" without assuming `proacl` is
 * set — a NULL `proacl` means the default ACL, which grants EXECUTE to PUBLIC.
 */
const AUTHZ_PURGE_WRITERS: readonly string[] = [
  'authz.claim_due_purge(text)',
  'authz.complete_purge(uuid,text,integer)',
  'authz.fail_purge(uuid,text,text)',
  'authz.requeue_purge(uuid,text,text)',
  // Two arguments since 0017: the tombstone and the dormant-account populations are
  // enqueued by one call with two disjoint id arrays, and the reason is a literal in
  // the function body rather than a caller argument — so a bug in the enqueuer cannot
  // file a live account under the tombstone reason. Matching on the FULL signature
  // rather than the bare name is the point: a bare-name match would pass on a
  // same-named overload left behind by the old one-argument form.
  'authz.enqueue_inactive_purges(uuid[],uuid[])',
  'authz.retention_due_tombstones(integer)',
];

/** The same six, by bare function name — what `pg_proc.proname` actually holds. */
const AUTHZ_PURGE_WRITER_NAMES: readonly string[] = AUTHZ_PURGE_WRITERS.map(
  (signature) => (signature.split('.')[1] ?? '').split('(')[0] ?? '',
).sort();

/**
 * The one member of that set which is `SECURITY INVOKER` on purpose.
 *
 * It does not write the queue — it scans `users` for tombstones and returns ids — and
 * making it a definer is the one change that would make it quietly return nothing.
 * `users` is FORCE RLS'd and `users_read_scope` resolves the caller through
 * `authz.actor()`, which a definer cannot satisfy because `current_user` has already
 * rebound to the owner. Asserted in the negative on purpose: see the test body.
 */
const AUTHZ_PURGE_INVOKER_READERS: readonly string[] = ['retention_due_tombstones'];

function toRegProcedureList(): string {
  return AUTHZ_PURGE_WRITERS.map((signature) => `to_regprocedure('${signature}')`).join(', ');
}

/**
 * A row count read as `role`, borrowed by the cluster superuser — the only identity that
 * can borrow another role, which is the reason `test/rls/support/fixture.ts` gives for
 * doing the same thing.
 *
 * `SET LOCAL ROLE` is wrapped in an explicit transaction because outside one it warns
 * and does nothing, and a probe that silently read as the superuser would assert
 * nothing. `statementOutput` strips the transaction's own echo.
 */
function countAsRole(role: string, relation: string): number {
  const stdout = superuserExec(
    PROOF_DB,
    `BEGIN;\nSET LOCAL ROLE ${role};\nSELECT count(*)::int FROM ${relation};\nCOMMIT;`,
  );
  const value = statementOutput(stdout)[0] ?? '';
  if (!/^\d+$/.test(value)) {
    throw new Error(`counting ${relation} as ${role} returned '${value}':\n${stdout}`);
  }
  return Number(value);
}

describe('privacy_purge_queue · ENABLEd, NOT FORCEd, and the residual is bounded rather than open', () => {
  it(
    'is ENABLE ROW LEVEL SECURITY and is NOT FORCE ROW LEVEL SECURITY, and the catalog is what says it',
    () => {
      // THE pin. `0011` enables the policies and deliberately does not FORCE them, and
      // records the choice as a trade rather than as an oversight — but until now nothing
      // read `relforcerowsecurity`, so the sentence was a comment. Both halves are
      // asserted, because each is a change that silently flips the design:
      //
      //   · `relrowsecurity = false` removes the policies from every non-owner read;
      //   · `relforcerowsecurity = true` would bind the OWNER, and the six `authz`
      //     definers run as the owner — so the purge machine path would be refused by
      //     `privacy_purge_write`, and the retention job would stop deleting anything,
      //     which is the one outcome worse than not having the queue.
      //
      // Read from `pg_class`, not from the migration file: the question is what the
      // database presents, and a migration that says `FORCE` and a catalog that says
      // otherwise is a drift no assertion on the SQL would catch.
      const posture = superuserRows<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relrowsecurity, relforcerowsecurity
           FROM pg_class
          WHERE oid = 'public.privacy_purge_queue'::regclass`,
      )[0];

      expect(posture).toBeDefined();
      expect(posture?.relrowsecurity, 'RLS is disabled, so no policy on this table applies to anybody').toBe(true);
      expect(
        posture?.relforcerowsecurity,
        'this table is FORCEd, so the owner is bound by privacy_purge_write and the authz definers cannot write',
      ).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'and every role that can reach the table is NOSUPERUSER and NOBYPASSRLS, PUBLIC holds nothing, and the role list is read from the ACL',
    () => {
      // AGENTS.md §B2's rule — FORCE does not bind a superuser or a BYPASSRLS role, so
      // these two attributes are the only thing between a serving role and every row —
      // applied to THIS table and read from the table's own ACL rather than from a list
      // of roles somebody remembered.
      //
      // `aclexplode` is what makes this exhaustive: it expands every privilege type on
      // the relation, and `COALESCE(relacl, acldefault('r', relowner))` means a table
      // whose ACL was never touched is expanded through PostgreSQL's DEFAULT (owner
      // only) rather than skipped. The LEFT JOIN keeps grantee 0, so a `PUBLIC` grant
      // appears as the literal string instead of disappearing from the result.
      const grantees = superuserRows<{ grantee: string; rolsuper: boolean; rolbypassrls: boolean | null }>(
        `SELECT coalesce(r.rolname, 'PUBLIC') AS grantee, r.rolsuper, r.rolbypassrls
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
           LEFT JOIN pg_roles r ON r.oid = acl.grantee
          WHERE n.nspname = 'public' AND c.relname = 'privacy_purge_queue'
          GROUP BY 1, 2, 3
          ORDER BY 1`,
      );

      // Properties of the list, not the list: a hardcoded role list is a baseline that
      // goes stale the moment a fourth grantee appears, which is the change worth
      // catching. `app_admin` must be in it — the admin list is the reason SELECT is
      // granted at all — so the assertion cannot pass on an empty result.
      expect(grantees.length).toBeGreaterThan(0);
      expect(grantees.map((row) => row.grantee)).toContain('app_admin');

      // `PUBLIC` is checked separately and first, because its row has no `pg_roles`
      // entry and its attributes are NULL: a `PUBLIC` grant is the shape `0011`'s
      // `REVOKE ALL … FROM PUBLIC` exists to prevent, and reading it off the LEFT JOIN
      // is the only way it appears in this result at all.
      expect(
        grantees.filter((row) => row.grantee === 'PUBLIC').map((row) => row.grantee),
        'PUBLIC holds a privilege on privacy_purge_queue',
      ).toEqual([]);

      // Note what is NOT asserted: that `app_anon` and `app_member` appear here. They do
      // not, and that is correct — `REVOKE ALL … FROM app_anon` on a role that holds
      // nothing writes no ACL entry, so their absence from this list IS the finding.
      // Section 3 asserts the same fact at the privilege layer, where it is readable.
      for (const row of grantees.filter((candidate) => candidate.grantee !== 'PUBLIC')) {
        expect(row.rolsuper, `${row.grantee} reaches privacy_purge_queue and is a superuser`).toBe(false);
        expect(row.rolbypassrls, `${row.grantee} reaches privacy_purge_queue and bypasses RLS`).toBe(false);
      }
    },
    TIMEOUT,
  );

  it(
    'the owner reads every row with no claims in scope, which is the residual being pinned rather than narrated',
    () => {
      // The trade `0011` records, asserted as a FACT with row counts on both sides of
      // it. Not FORCEd means the owner bypasses `privacy_purge_read`, so the
      // capability gate is not the whole control on this table — the grants above, and
      // the fact that the owner never receives a request, are. A reader who assumes
      // FORCE here is wrong, and this is the assertion that says so.
      enqueue(IDS.targets.readGate);
      enqueue(IDS.targets.anonymised);

      expect(countAsRole(databaseConfig().user, 'privacy_purge_queue'), 'the fixture did not enqueue two rows').toBe(2);

      // …and the same table read through the boundary is capability-gated: an admin
      // holding `privacy_purge:read` sees them, and one without it sees nothing. The
      // contrast is the whole point — without the two numbers side by side, "the owner
      // reads two" is only half a claim.
      expect(rowsAsRole<{ reason: string }>('app_admin', IDS.adminProbe, 'SELECT reason FROM privacy_purge_queue')).toHaveLength(2);
      expect(rowsAsRole<{ reason: string }>('app_admin', IDS.narrowAdmin, 'SELECT reason FROM privacy_purge_queue')).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'the six authz writers are SECURITY DEFINER and are callable by app_admin alone — which is what makes not-FORCEing this table bounded',
    () => {
      // The other half of the trade, and the half that actually decays. Because the
      // table is not FORCEd and no policy on it names `current_user`, those definers
      // are subject to NO policy at all: their narrowness is carried entirely by
      // `EXECUTE`. Grant one of them to `PUBLIC`, or revoke the revoke, and every
      // caller in the database inherits an owner-privileged writer on a table with no
      // policy to pass — silently, and with no error anywhere.
      //
      // `COALESCE(proacl, acldefault('f', proowner))` again: a function whose ACL was
      // never touched expands through the DEFAULT, which is EXECUTE to PUBLIC, so the
      // dangerous case is reported rather than skipped.
      const writers = superuserRows<{
        proname: string;
        prosecdef: boolean;
        grantee: string;
      }>(
        `SELECT p.proname, p.prosecdef, coalesce(r.rolname, 'PUBLIC') AS grantee
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
           LEFT JOIN pg_roles r ON r.oid = acl.grantee
          WHERE n.nspname = 'authz' AND p.oid = ANY(ARRAY[${toRegProcedureList()}]::regprocedure[])
          GROUP BY 1, 2, 3
          ORDER BY 1, 3`,
      );

      // Exactly these six and no others, read from the catalog by exact signature. A
      // seventh definable writer added without a grant is a red line here rather than a
      // silent extension of the set; `to_regprocedure` on a signature the database does
      // not have returns NULL, which `= ANY(…::regprocedure[])` silently drops — so the
      // count assertion is what catches a rename, not the query.
      expect([...new Set(writers.map((row) => row.proname))].sort()).toEqual(AUTHZ_PURGE_WRITER_NAMES);
      expect(writers.length).toBeGreaterThan(AUTHZ_PURGE_WRITER_NAMES.length);

      // The five that WRITE the queue really are definers, which is the fact the whole
      // residual rests on.
      for (const row of writers) {
        if (AUTHZ_PURGE_INVOKER_READERS.includes(row.proname)) {
          continue;
        }
        expect(row.prosecdef, `${row.proname} is not SECURITY DEFINER, so it runs as its caller and the residual above is not the design`).toBe(true);
      }

      // …and the one that only READS is deliberately NOT, which is the opposite
      // assertion and the easy one to get backwards.
      //
      // `retention_due_tombstones` scans `users`, and `users` is FORCE RLS'd. Inside a
      // SECURITY DEFINER function `current_user` rebinds to the owner, so a definer
      // scan satisfies no policy an `actor()`-driven one can satisfy and returns
      // ZERO rows against a populated table — measured, and the reason this function is
      // INVOKER. Asserting `prosecdef = true` here would be asserting the bug that
      // measurement found: the function would silently find nothing, the queue would
      // stay empty, and an empty queue is indistinguishable from "nothing is due".
      // One entry per FUNCTION, not per row: the query groups by grantee too, so a
      // function with two grantees is two rows and a bare `.map` would double-count it.
      const invoker = [...new Set(writers.filter((row) => AUTHZ_PURGE_INVOKER_READERS.includes(row.proname)).map((row) => row.proname))].sort();
      expect(invoker, 'the invoker readers are missing from the set').toEqual(
        [...AUTHZ_PURGE_INVOKER_READERS].sort(),
      );
      for (const row of writers.filter((r) => AUTHZ_PURGE_INVOKER_READERS.includes(r.proname))) {
        expect(row.prosecdef, `${row.proname} became SECURITY DEFINER: it would scan FORCE-RLS \`users\` as the owner and return zero rows`).toBe(false);
      }

      expect(
        writers.filter((row) => row.grantee === 'PUBLIC').map((row) => row.proname),
        'PUBLIC may call an authz purge writer',
      ).toEqual([]);

      // The owner holds EXECUTE on its own functions, which is the identity these
      // definers deliberately run as. The assertion is therefore about the SECOND
      // grantee: exactly one non-owner may call them, and it is `app_admin`.
      const writerGrantees = [...new Set(writers.map((row) => row.grantee))].sort();
      expect(writerGrantees).toContain('app_admin');
      expect(
        writerGrantees.filter((grantee) => grantee !== databaseConfig().user),
        'a role other than app_admin may call an authz purge writer',
      ).toEqual(['app_admin']);
    },
    TIMEOUT,
  );
});
