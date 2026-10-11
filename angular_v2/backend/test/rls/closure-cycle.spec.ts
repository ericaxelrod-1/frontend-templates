import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * Cycle safety, asserted against a cycle that ACTUALLY EXISTS.
 *
 * `rls.spec.ts` proves the guard — `assert_group_acyclic()` refuses a cyclic
 * insert — and that is the primary control. But on the shipped acyclic fixture the
 * SECOND defence in depth is invisible: on an acyclic tree the closure query's
 * `UNION` and a `UNION ALL` are indistinguishable, both returning the same rows.
 * A W33 tamper run measured it: swapping `UNION` for `UNION ALL` in
 * `0001_rls_foundation.sql` left all 73 tests green. Only a cyclic graph separates
 * them, and the shipped suite cannot build one because the trigger refuses to let
 * it.
 *
 * So this suite forces the cycle the W33 harness did, and measures the two forms
 * against it. That error is what a future "simplification" of the closure query
 * would produce: CI stays green and the closure refresh hangs in production until
 * it exhausts `temp_file_limit`.
 *
 * WHY `session_replication_role = 'replica'` IS NEEDED, AND WHY IT IS TEST-ONLY.
 * The setting makes the session behave as a replica: non-internal triggers are not
 * fired. `assert_group_acyclic()` is a `BEFORE … FOR EACH ROW` trigger, so under
 * `replica` it is not run and the two mutually-parenting rows are admitted. There
 * is no other way to reach the state this suite must measure — the trigger is
 * doing its job, which is the point. It requires a superuser session
 * (`has_parameter_privilege(role, 'session_replication_role', 'SET')` is false for
 * every serving role, asserted in `rls.spec.ts`), and it is set `LOCAL` inside one
 * transaction and asserted back to `origin` before the suite ends. No application
 * path, migration or seed reaches for it — `grep session_replication_role
 * backend/src backend/database` returns nothing.
 *
 * The fix here is deliberately narrow: everything runs in a throwaway database,
 * `closure_cycle_proof`, which the file drops in `afterAll` — and which the last
 * test asserts is gone, so "no residue" is a measurement rather than a comment. No
 * cycle ever reaches a real database.
 *
 * The test builds the real pipeline — bootstrap, migration, seed — against a
 * throwaway database, exactly as `seed.spec.ts` does, and reads the closure query
 * back OUT of the live database with `pg_get_viewdef` rather than hardcoding it.
 * That is what makes the tamper visible: the query this suite measures is the one
 * the migration actually created, so a `UNION` -> `UNION ALL` edit in the migration
 * changes what is measured here without this file changing at all.
 */

const CYCLE_DB = 'closure_cycle_proof';

const MIGRATION_SQL = join(BACKEND_ROOT, 'database', 'migrations', '0001_rls_foundation.sql');
const BOOTSTRAP_SQL = join(BACKEND_ROOT, 'database', 'bootstrap', '001_roles.sql');

/**
 * The reach-around pair, with fixed ids so the assertions can name the rows.
 * Neither is a descendant of anything in the seeded tree, so the cycle is the only
 * new topology these two rows add.
 */
const CYCLE_A = 'eeeeeeee-0000-0000-0000-000000000001';
const CYCLE_B = 'eeeeeeee-0000-0000-0000-000000000002';

/**
 * Bounded so a regression fails the assertion instead of hanging the gate.
 * `verify` step 7 has no per-test timeout that a non-terminating query can escape.
 *
 * `temp_file_limit` is the migration's own third layer of defence, and it is set
 * HERE as well as in the query under test — see `AGENTS.md` §B2, "Cycle safety":
 * without it a non-terminating closure exhausts the filesystem, and the failure is
 * a full disk rather than a slow query. 32MB is the W33 harness value; the shipped
 * `UNION` form needs a few kilobytes.
 */
const STATEMENT_TIMEOUT = '3s';
const TEMP_FILE_LIMIT = '32MB';

/**
 * The SQLSTATEs that mean "this query did not terminate".
 *
 * 57014 is the `statement_timeout` backstop. 53100 and 53400 are the two faces of
 * the `temp_file_limit` breach: PostgreSQL raises **53400**
 * (`configuration_limit_exceeded`) for a limit it enforces itself, and 53100
 * (`disk_full`) when the filesystem genuinely fills. Both are accepted because the
 * load-bearing claim is that the query did not terminate, and either code proves it
 * — but a reader copying a code from here should know 53400 is the one PostgreSQL
 * actually emits for `temp_file_limit`.
 */
const NON_TERMINATING_CODES = ['57014', '53100', '53400'] as const;

/** Runs a psql command as the cluster superuser, throwing on failure. */
function psqlAsSuperuser(database: string, sql: string): string {
  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', database, '-c', sql],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`superuser psql failed against ${database}: ${sql}\n${result.stderr}`);
  }
  return result.stdout;
}

/** Runs SQL as the superuser and parses the json_agg result set. */
function psqlJson<T>(database: string, sql: string): readonly T[] {
  const inner = sql.replace(/;\s*$/, '');
  const wrapped = `SELECT coalesce(json_agg(_probe)::text, '[]') FROM (${inner}) AS _probe`;
  const stdout = psqlAsSuperuser(database, wrapped);
  const trimmed = stdout.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
}

interface Outcome {
  /** psql's exit status. `ON_ERROR_STOP=1`, so a non-zero status is a real failure. */
  readonly ok: boolean;
  /** stdout and stderr, so the assertion can name the error the way the user sees it. */
  readonly output: string;
  /** The SQLSTATE, parsed from `VERBOSITY=verbose` output. Undefined when none was raised. */
  readonly code?: string;
  /** The message beside the SQLSTATE. */
  readonly message?: string;
}

/**
 * Runs `statements` as the cluster superuser in ONE session and reports the outcome
 * rather than throwing.
 *
 * `attempt`-shaped because the interesting cases are the ones that must NOT
 * succeed: a helper that reports "refused" by throwing cannot express "this query
 * was expected to be cancelled", and the SQLSTATE is the whole assertion.
 *
 * `VERBOSITY=verbose` is what makes the SQLSTATE visible at all — at the default
 * verbosity psql prints only `ERROR:  <message>`, and `canceling statement due to
 * statement timeout` is indistinguishable from any other timeout without its code.
 *
 * One psql invocation fed on stdin because `statement_timeout` and
 * `temp_file_limit` are session-level settings that must be in force for the very
 * query they bound, and the database name and the cycle rows must be in the same
 * session as the reach-around.
 */
function attemptAsSuperuser(statements: readonly string[]): Outcome {
  const script = statements.map((statement) => `${statement.trim()};`).join('\n');
  const result: SpawnSyncReturns<string> = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-q', '-t', '-A', '-d', CYCLE_DB],
    { encoding: 'utf8', input: script },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const error = /^ERROR:\s+([0-9A-Z]{5}):\s+(.*)$/m.exec(output);
  return {
    ok: result.status === 0,
    output,
    ...(error === null ? {} : { code: error[1], message: error[2] }),
  };
}

/**
 * Recreates the throwaway database from nothing. A pre-existing database of this
 * name is dropped, never read — something else having held it is not a licence to
 * inspect its contents. Owned by the migration role (`app`), because the migration
 * asserts it owns schema `public`. It must never be the development database.
 */
function recreateDatabase(name: string): void {
  const devDb = databaseConfig().database;
  if (name === devDb) {
    throw new Error(`refusing to run the cycle probe against the development database (${devDb})`);
  }
  psqlAsSuperuser(
    'postgres',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
  );
  psqlAsSuperuser('postgres', `DROP DATABASE IF EXISTS ${name}`);
  psqlAsSuperuser('postgres', `CREATE DATABASE ${name} OWNER ${databaseConfig().user}`);
}

/**
 * Drops the throwaway database, terminating its backends first.
 *
 * Terminating first because a leaked backend makes the drop fail naming a
 * connection the operator cannot see. Idempotent, because both the asserted teardown
 * below and the file-level `afterAll` call it.
 */
function dropCycleDatabase(): void {
  psqlAsSuperuser(
    'postgres',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${CYCLE_DB}' AND pid <> pg_backend_pid()`,
  );
  psqlAsSuperuser('postgres', `DROP DATABASE IF EXISTS ${CYCLE_DB}`);
}

/** Applies the role boundary and the migration to the throwaway database. */
function applyBaseline(): void {
  const bootstrap = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', CYCLE_DB, '-f', BOOTSTRAP_SQL],
    { encoding: 'utf8' },
  );
  if (bootstrap.status !== 0) {
    throw new Error(`applying ${BOOTSTRAP_SQL} as superuser failed:\n${bootstrap.stderr}`);
  }

  const config = loadTestEnvironment().database;
  const migration = spawnSync(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '-q', '-h', config.host, '-U', config.user, '-d', CYCLE_DB, '-f', MIGRATION_SQL],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: config.password } },
  );
  if (migration.status !== 0) {
    throw new Error(`applying the migration as ${config.user} failed:\n${migration.stderr}`);
  }
}

/** Runs the real seed entry point with `DB_NAME` pointed at the throwaway database. */
function runSeed(): { readonly code: number; readonly output: string } {
  const result = spawnSync('node', ['--experimental-strip-types', 'database/seed.ts'], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      DB_NAME: CYCLE_DB,
      SEED_ADMIN_PASSWORD: 'closure-cycle-probe-password',
    },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * The closure query as the LIVE database parsed it.
 *
 * Read from `pg_get_viewdef` rather than pasted here, and that is the load-bearing
 * choice in this file: a `UNION` -> `UNION ALL` edit in the migration changes the
 * string this suite measures without a single character changing here. A test that
 * carries its own copy of the query would keep proving the old query terminates
 * while the shipped one no longer does — a false green on exactly the property
 * this file exists to hold.
 */
function shippedClosureDefinition(): string {
  const rows = psqlJson<{ definition: string }>(
    CYCLE_DB,
    `SELECT pg_get_viewdef('authz.org_closure'::regclass, true) AS definition`,
  );
  const definition = rows[0]?.definition;
  if (definition === undefined) {
    throw new Error('could not read the closure definition out of the live database');
  }
  return definition;
}

/**
 * The `UNION ALL` variant of `definition`, derived by rewriting the one set
 * operator the swap turns on.
 *
 * The rewrite is IDEMPOTENT, and that is what keeps this suite's red legible. A
 * naive `UNION` -> `UNION ALL` substitution finds nothing in an already-tampered
 * definition, so under the very tamper this file exists to catch the derivation
 * would throw inside `beforeAll` and every test would be SKIPPED rather than failed
 * — a false green wearing a red exit code, and exactly the shape `AGENTS.md` §B8
 * forbids. Rewriting each set operator to `UNION ALL` instead means a definition
 * that already says `UNION ALL` is its own variant, the control measurement still
 * runs, and it is the assertions about the SHIPPED query that fail.
 *
 * The count is asserted, not assumed: a definition that had grown a second set
 * operator would otherwise produce a variant differing from the shipped query in
 * more than the set operator, and the comparison would stop meaning anything.
 */
function unionAllVariantOf(definition: string): string {
  const setOperator = /\bUNION(?:\s+ALL)?\b/g;
  const found = definition.match(setOperator) ?? [];
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one set operator in the closure definition to rewrite, found ${found.length}:\n${definition}`,
    );
  }
  return definition.replace(setOperator, 'UNION ALL');
}

/** Wraps a `SELECT` body so a row COUNT can be taken of it. */
function countOf(body: string): string {
  return `SELECT count(*)::int AS count FROM (${body.replace(/;\s*$/, '')}) AS _closure`;
}

/** The session preamble that bounds every closure query run below. */
function bounded(statements: readonly string[]): readonly string[] {
  return [
    `SET statement_timeout = '${STATEMENT_TIMEOUT}'`,
    `SET temp_file_limit = '${TEMP_FILE_LIMIT}'`,
    // The view definition refers to `groups` unqualified, as the migration wrote it.
    'SET search_path = public, authz',
    ...statements,
  ];
}

// =============================================================================
// Outcomes captured in `beforeAll`, asserted in the `it()`s below
// =============================================================================

let seedRun: { readonly code: number; readonly output: string };
let shippedDefinition: string;
let acyclicShipped: Outcome;
let acyclicUnionAll: Outcome;
let cyclicShipped: Outcome;
let cyclicUnionAll: Outcome;
let cyclicRefresh: Outcome;
let cyclicTriggeredRefresh: Outcome;
let normalPathRefusal: Outcome;
let parentMapAfterRefusal: ReadonlyMap<string, string | null>;
let nameAfterTriggeredWrite: string | undefined;
let replicationRoleAfter: string | undefined;

beforeAll(() => {
  recreateDatabase(CYCLE_DB);
  applyBaseline();
  seedRun = runSeed();
  shippedDefinition = shippedClosureDefinition();

  // --- 1. THE ACYCLIC BASELINE -------------------------------------------------
  // Both forms, on the seeded tree. This is the measurement that explains the whole
  // gap: on acyclic data the safe and unsafe queries are indistinguishable, which is
  // why swapping one for the other keeps every other test in the suite green.
  acyclicShipped = attemptAsSuperuser(bounded([countOf(shippedDefinition)]));
  acyclicUnionAll = attemptAsSuperuser(bounded([countOf(unionAllVariantOf(shippedDefinition))]));

  // --- 2. FORCE THE CYCLE ------------------------------------------------------
  // `replica` is what silences `assert_group_acyclic()`; see the file header for
  // why that is test-only and unreachable from any application path. `LOCAL` inside
  // one transaction, so the setting cannot outlive the statement even if this suite
  // dies here.
  const forced = attemptAsSuperuser([
    'BEGIN',
    `SET LOCAL session_replication_role = 'replica'`,
    `INSERT INTO groups (id, name, parent_id) VALUES ('${CYCLE_A}', 'cyc-a', '${CYCLE_B}'), ('${CYCLE_B}', 'cyc-b', '${CYCLE_A}')`,
    'COMMIT',
  ]);
  if (!forced.ok) {
    throw new Error(`forcing the cycle failed — the reach-around did not work:\n${forced.output}`);
  }

  // The setting is asserted back to `origin` in a FRESH session, which is the only
  // way to show the `SET LOCAL` did not leave residue behind. `current_setting` and
  // not `SHOW`: `SHOW` is a utility statement and cannot be the body of a subquery,
  // which is the shape the json_agg row helper needs.
  const role = psqlJson<{ session_replication_role: string }>(
    CYCLE_DB,
    `SELECT current_setting('session_replication_role') AS session_replication_role`,
  );
  replicationRoleAfter = role[0]?.session_replication_role;

  // The cycle is present. Without this the two measurements below would be
  // measuring an acyclic tree again and the whole file would be a false green.
  const cycleRows = psqlJson<{ count: number }>(
    CYCLE_DB,
    `SELECT count(*)::int AS count FROM groups
      WHERE (id = '${CYCLE_A}' AND parent_id = '${CYCLE_B}')
         OR (id = '${CYCLE_B}' AND parent_id = '${CYCLE_A}')`,
  );
  if (cycleRows[0]?.count !== 2) {
    throw new Error(`the two mutually-parenting rows are not both present:\n${JSON.stringify(cycleRows)}`);
  }

  // --- 3. BOTH FORMS AGAINST THE CYCLE ----------------------------------------
  cyclicShipped = attemptAsSuperuser(bounded([countOf(shippedDefinition)]));
  cyclicUnionAll = attemptAsSuperuser(bounded([countOf(unionAllVariantOf(shippedDefinition))]));

  // --- 4. THE PRODUCTION REFRESH PATH -----------------------------------------
  // Running the query text proves the recursion terminates. This proves the
  // statement that actually runs in production terminates: the wholesale
  // `REFRESH MATERIALIZED VIEW`, which is what a group write fires.
  cyclicRefresh = attemptAsSuperuser([
    `SET statement_timeout = '${STATEMENT_TIMEOUT}'`,
    `SET temp_file_limit = '${TEMP_FILE_LIMIT}'`,
    'REFRESH MATERIALIZED VIEW authz.org_closure',
    `SELECT count(*)::int AS count FROM authz.org_closure`,
  ]);

  // And the trigger path: an ordinary group write, with the acyclicity trigger
  // ACTIVE, whose `AFTER … FOR EACH STATEMENT` trigger runs the refresh as the view
  // owner. This is the closest thing in the file to what a production write does.
  //
  // The bounds are set BEFORE `SET LOCAL ROLE app_admin`, and that ordering is not
  // cosmetic: `temp_file_limit` is a superuser-only parameter, so a serving role is
  // refused `42501 permission denied to set parameter "temp_file_limit"` — the
  // identical refusal a member gets for `session_replication_role`. Session-level
  // settings survive the role change, so bounding the write is a superuser action
  // that then applies to the write itself.
  //
  // The closure count is read AFTER the commit rather than the `UPDATE 1` tag,
  // because this helper passes `-q` (which suppresses command tags) and because the
  // row count is the stronger claim anyway: the tag would be printed even if the
  // AFTER STATEMENT trigger had silently refreshed a different tree. That the write
  // itself landed is asserted separately, by the renamed row below.
  cyclicTriggeredRefresh = attemptAsSuperuser([
    `SET statement_timeout = '${STATEMENT_TIMEOUT}'`,
    `SET temp_file_limit = '${TEMP_FILE_LIMIT}'`,
    'BEGIN',
    'SET LOCAL ROLE app_admin',
    `UPDATE groups SET name = 'cyc-a-touched' WHERE id = '${CYCLE_A}'`,
    'COMMIT',
    'SELECT count(*)::int AS count FROM authz.org_closure',
  ]);

  // The write landed. Read separately from the write's own exit status, because a
  // statement that quietly affects no rows exits 0 and a control that denies
  // everyone looks exactly like one that works.
  const renamed = psqlJson<{ name: string }>(CYCLE_DB, `SELECT name FROM groups WHERE id = '${CYCLE_A}'`);
  nameAfterTriggeredWrite = renamed[0]?.name;

  // --- 5. THE NORMAL PATH, WITH THE TRIGGER ACTIVE ----------------------------
  // The reach-around was ONE superuser statement. A real caller still cannot reach
  // this state. `rls.spec.ts` proves this on an acyclic database; here the guard is
  // asked AFTER a cycle has already been forced into the table, which is the case
  // the shipped suite cannot reach and the one that would show a disabled trigger.
  normalPathRefusal = attemptAsSuperuser([
    'BEGIN',
    'SET LOCAL ROLE app_admin',
    `UPDATE groups SET parent_id = '${CYCLE_A}' WHERE id = '${CYCLE_B}'`,
  ]);

  // Read as a parent map keyed by id, and NOT as names. The names move — the
  // triggered-refresh write above renames one of the two — and an assertion coupled
  // to them would go red for the wrong reason if that write failed, turning an
  // independent control into a second casualty of the closure regression.
  const parentRows = psqlJson<{ id: string; parent_id: string | null }>(
    CYCLE_DB,
    `SELECT id, parent_id FROM groups WHERE id IN ('${CYCLE_A}', '${CYCLE_B}')`,
  );
  parentMapAfterRefusal = new Map(parentRows.map((row) => [row.id, row.parent_id]));
}, 600_000);

afterAll(() => {
  // No residue, on every exit path. The asserted teardown in the second `describe`
  // below has usually already run this; `DROP … IF EXISTS` makes the second call a
  // no-op, and this one is what guarantees the drop when a test fails first.
  //
  // `database/seed.ts` runs a CLUSTER-scoped `ALTER ROLE … PASSWORD`, so the
  // cluster is restored first: it is the one step that must not be skipped, and
  // it must not sit behind the drop above, because a suite that died before
  // reaching this hook is exactly when the cluster would be left behind.
  try {
    dropCycleDatabase();
  } finally {
    restoreAuthenticatorPassword();
  }
});

describe('W31 · cycle safety: the closure query must terminate on a graph that actually has a cycle', () => {
  it('the fixture is a real one — bootstrap, migration and seed ran, and the closure reads back from the live database', () => {
    expect(seedRun.code).toBe(0);
    expect(seedRun.output).toContain('seed complete.');
    expect(shippedDefinition).toMatch(/WITH\s+RECURSIVE/i);
  });

  it('the shipped closure query is UNION with no accumulator column — the two properties that terminate it', () => {
    // Asserted on the SQL text because that is where the property lives, and a text
    // assertion is what fails first when someone edits the migration. The
    // BEHAVIOURAL proof that these two properties are load-bearing is the pair of
    // measurements below; this is the cheap gate that names the edit.
    expect(shippedDefinition).toMatch(/\bUNION\b/);
    expect(shippedDefinition).not.toMatch(/\bUNION\s+ALL\b/);

    // No accumulator: the recursive CTE declares no column list at all, so the
    // recursive row is exactly the two columns the seed and the recursive term
    // produce. An accumulator is what makes `UNION` unable to deduplicate, so this
    // is half the same control — `UNION` alone does not survive `depth`.
    expect(shippedDefinition).toMatch(/WITH\s+RECURSIVE\s+\w+\s+AS\s*\(/i);

    // And the closure exposes exactly the two columns, so an accumulator cannot have
    // been smuggled into the projection either.
    const columns = psqlJson<{ attname: string }>(
      CYCLE_DB,
      `SELECT attname FROM pg_attribute
        WHERE attrelid = 'authz.org_closure'::regclass AND attnum > 0 AND NOT attisdropped
        ORDER BY attnum`,
    );
    expect(columns.map((column) => column.attname)).toEqual(['ancestor', 'descendant']);
  });

  it('UNION and UNION ALL return the same rows on the seeded acyclic tree — which is why swapping them keeps every other test green', () => {
    // The measurement that explains the gap rather than merely reporting it. A
    // tamper run of `UNION` -> `UNION ALL` in the migration is invisible here, and
    // this is the reason in one assertion.
    expect(acyclicShipped.ok, `shipped form failed on the acyclic tree:\n${acyclicShipped.output}`).toBe(true);
    expect(acyclicUnionAll.ok, `UNION ALL form failed on the acyclic tree:\n${acyclicUnionAll.output}`).toBe(true);
    expect(acyclicShipped.output.trim()).toBe(acyclicUnionAll.output.trim());
    // Non-zero and small: a `count` of 0 would make the equality above trivially
    // true and every conclusion below vacuous.
    expect(Number(acyclicShipped.output.trim())).toBe(9);
  });

  it('a cycle forced past the acyclicity trigger does not stop the shipped UNION closure query from terminating', () => {
    expect(cyclicShipped.ok, `the shipped closure did NOT terminate on a cyclic tree:\n${cyclicShipped.output}`).toBe(
      true,
    );
    // Bounded and exact. The seeded tree contributes 9 rows; the two cycle members
    // each gain themselves and the other, so 4 more. This is the "fail-closed on the
    // query" half: the closure still resolves, and it resolves to a finite set.
    // (The fail-OPEN half is the data: each cycle member inherits the whole cycle's
    // scope, which is why a cycle is an authorization defect and not a tidy-up.)
    expect(Number(cyclicShipped.output.trim())).toBe(13);
  });

  it('a wholesale REFRESH MATERIALIZED VIEW over the cyclic tree terminates — the statement that runs in production, not just the query text', () => {
    expect(
      cyclicRefresh.ok,
      `REFRESH MATERIALIZED VIEW did not terminate on a cyclic tree:\n${cyclicRefresh.output}`,
    ).toBe(true);
    // 9 seeded + 4 cycle rows, matching the query-text measurement. This proves the
    // refresh is bounded, which is what a group write depends on: the refresh runs
    // INSIDE the writing transaction, so a hang here is a hang on every tenant read
    // behind an AccessExclusiveLock.
    expect(cyclicRefresh.output.trim().split('\n').pop()).toBe('13');
  });

  it('an ordinary group write, with the acyclicity trigger ACTIVE, still refreshes the closure over the cyclic tree', () => {
    // The trigger path, one step closer to production than the previous test: a
    // write as `app_admin` — the only serving role that holds UPDATE on `groups` —
    // whose `AFTER … FOR EACH STATEMENT` trigger runs the refresh as the view owner.
    // A tampered `UNION ALL` closure makes THIS statement the one that hangs, which
    // is why it is measured and not merely the query text above.
    expect(
      cyclicTriggeredRefresh.ok,
      `a group write over a cyclic tree did not complete:\n${cyclicTriggeredRefresh.output}`,
    ).toBe(true);
    // The refreshed closure is bounded and complete: 9 seeded rows plus the 4 the two
    // cycle members contribute. An empty or partial closure here is the other
    // documented failure mode — a `FORCE`d `groups` refreshes the matview to zero
    // rows with no error at all — so the count is asserted rather than the exit.
    expect(cyclicTriggeredRefresh.output.trim().split('\n').pop()).toBe('13');
    // And the write itself landed: a statement that quietly affected no row would
    // exit 0 and would have proved nothing.
    expect(nameAfterTriggeredWrite).toBe('cyc-a-touched');
  });

  it('the UNION ALL variant of the same closure query does NOT terminate on a cyclic tree, which is what makes the shipped UNION load-bearing', () => {
    // The red half of the pair. On an acyclic tree this form returns exactly what
    // the shipped form returns (asserted above), so nothing else in the suite can
    // see the difference — only this one, against a graph with a cycle in it.
    //
    // What is asserted is that the query is CANCELED, not that it is slow: a
    // `count` that returned a number would mean the variant terminated, which is
    // the regression this test exists to catch.
    expect(
      cyclicUnionAll.ok,
      `the UNION ALL closure TERMINATED on a cyclic tree — it returned:\n${cyclicUnionAll.output}`,
    ).toBe(false);

    // Asserted against a set rather than one code, because the code is a property of
    // the machine's configuration and not of the control: whichever bound trips
    // first, a `count` that came back is the regression, and a cancellation is the
    // proof the recursion never reached a fixed point. The observed code is carried
    // in the failure message so a reader is never left guessing which bound fired.
    expect(
      NON_TERMINATING_CODES,
      `the UNION ALL closure was refused, but not by a resource bound — SQLSTATE ${cyclicUnionAll.code ?? '(none)'}: ${cyclicUnionAll.message ?? ''}\n${cyclicUnionAll.output}`,
    ).toContain(cyclicUnionAll.code);
  });

  it('the reach-around is one superuser statement: a real caller still cannot build the cycle, with a cycle already in the table', () => {
    // `assert_group_acyclic()` is the primary control and this is the assertion that
    // it is still ARMED. Asked after a cycle was forced in, which is the state
    // `rls.spec.ts` cannot reach — that suite proves the refusal on an acyclic
    // database, and this proves the guard did not come off in the process of the
    // bad data arriving.
    //
    // The error is asserted on BOTH the SQLSTATE and the message: `23514` is a
    // check_violation, and a re-parent that failed for a different reason would
    // raise something else — but the message is what proves `assert_group_acyclic`
    // fired rather than a constraint or the policy.
    expect(normalPathRefusal.ok, `a cyclic re-parent as app_admin was ADMITTED:\n${normalPathRefusal.output}`).toBe(false);
    expect(normalPathRefusal.code).toBe('23514');
    expect(normalPathRefusal.message).toMatch(/group cycle/i);

    // Fail-closed on the data too: the row that would have closed the loop is
    // unchanged, so the pre-existing cycle was not widened. Asserted as a parent map
    // keyed by id so that this control fails only if the GUARD fails.
    expect([...parentMapAfterRefusal.entries()].sort()).toEqual([
      [CYCLE_A, CYCLE_B],
      [CYCLE_B, CYCLE_A],
    ]);
  });

  it('no residue: the reach-around setting is back to origin, because it was set LOCAL inside one transaction', () => {
    // `SET LOCAL` inside one transaction is the mechanism; this is the proof it
    // worked, read in a fresh session.
    expect(replicationRoleAfter).toBe('origin');
  });
});

describe('W31 · teardown: the cycle never outlives this file', () => {
  beforeAll(() => {
    // The drop is performed HERE rather than only in `afterAll` so that it can be
    // ASSERTED. A file-level `afterAll` runs after every test in the file, so a test
    // cannot observe its effect — which would leave "no residue" as a claim in a
    // comment, i.e. exactly the kind of claim this repository's rules forbid. The
    // file-level `afterAll` below remains, and is idempotent, because a run that
    // dies partway must still leave no cyclic database behind.
    dropCycleDatabase();
  });

  it('the throwaway database is gone, so the cycle is gone with it', () => {
    const remaining = psqlJson<{ count: number }>(
      'postgres',
      `SELECT count(*)::int AS count FROM pg_database WHERE datname = '${CYCLE_DB}'`,
    );
    expect(remaining[0]?.count).toBe(0);
  });
});
