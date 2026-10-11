import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * Seed integrity — the proof that `database/seed.ts` is not a success-shaped
 * lie. The W27 suite (`rls.spec.ts`) builds its own fixture, so a broken *seed*
 * is invisible to it. Both historical seed defects this test prevents were
 * silent:
 *
 *   1. A multi-row `INSERT ... VALUES` over groups nulled every `parent_id`
 *      (PostgreSQL evaluates every VALUES expression before inserting any
 *      row), which collapsed `authz.org_closure` to the 5 self-rows and made
 *      the RLS scope axis return zero rows for every member — no error
 *      anywhere.
 *   2. The seed's COMMIT/ROLLBACK pair with no BEGIN: every statement
 *      autocommitted, so a mid-seed failure left a partially seeded database
 *      and `SET LOCAL ROLE` degraded to `SET ROLE` with a warning.
 *
 * This spec runs the REAL pipeline — bootstrap, migration, seed — via the same
 * commands a developer runs, against throwaway databases only, and asserts the
 * resulting state. It needs a live PostgreSQL, so it lives in the DB-backed
 * suite (`test:rls`, a gating step of `verify`); it starts no port, so the
 * "port already held" guard reduces to "the database does not already exist":
 * any pre-existing database of the throwaway name had something else holding
 * it, and is refused rather than adopted.
 */

const PROOF_DB = 'seed_proof';
const ROLLBACK_DB = 'seed_rollback_proof';

const MIGRATION_SQL = join(BACKEND_ROOT, 'database', 'migrations', '0001_rls_foundation.sql');
const BOOTSTRAP_SQL = join(BACKEND_ROOT, 'database', 'bootstrap', '001_roles.sql');

interface SeedRun {
  readonly code: number;
  readonly output: string;
}

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

function psqlAsSuperuserFile(database: string, path: string): void {
  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', database, '-f', path],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`applying ${path} as superuser failed:\n${result.stderr}`);
  }
}

/** Runs SQL as the superuser and parses the json_agg result set. */
function psqlJson<T>(database: string, sql: string): readonly T[] {
  const inner = sql.replace(/;\s*$/, '');
  const wrapped = `SELECT coalesce(json_agg(_seed)::text, '[]') FROM (${inner}) AS _seed`;
  const stdout = psqlAsSuperuser(database, wrapped);
  const trimmed = stdout.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
}

/**
 * Recreates a throwaway database from nothing. Any pre-existing database of
 * this name means something else had it — terminate its backends and refuse to
 * look at its contents; it is dropped, never read. The database is owned by
 * the migration role (`app`), because the migration asserts it owns schema
 * public (`AGENTS.md` §B8). It must never be the development database.
 */
function recreateDatabase(name: string): void {
  const devDb = databaseConfig().database;
  if (name === devDb) {
    throw new Error(`refusing to run the seed against the development database (${devDb})`);
  }
  psqlAsSuperuser(
    'postgres',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
  );
  psqlAsSuperuser('postgres', `DROP DATABASE IF EXISTS ${name}`);
  psqlAsSuperuser('postgres', `CREATE DATABASE ${name} OWNER ${databaseConfig().user}`);
}

/**
 * Drops one of the two throwaway databases.
 *
 * `beforeAll` creates both and, without this, every run leaves them behind — so the
 * cluster accumulates stale copies of a schema that has since moved on. Terminate
 * first, exactly as `recreateDatabase` does: an unclosed pool makes DROP fail naming
 * a connection the operator cannot see.
 */
function dropDatabase(name: string): void {
  psqlAsSuperuser(
    'postgres',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
  );
  psqlAsSuperuser('postgres', `DROP DATABASE IF EXISTS ${name}`);
}

/**
 * Runs the real seed entry point with `DB_NAME` pointed at a throwaway
 * database. All five DB_* coordinates come from `backend/.env` via the
 * process environment already; only `DB_NAME` is overridden. `SEED_ADMIN_PASSWORD`
 * is pinned so a re-run exercises the "password unchanged" branch.
 */
function runSeed(database: string): SeedRun {
  const result: SpawnSyncReturns<string> = spawnSync(
    'node',
    ['--experimental-strip-types', 'database/seed.ts'],
    {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        DB_NAME: database,
        SEED_ADMIN_PASSWORD: 'seed-test-password-123',
      },
      encoding: 'utf8',
      timeout: 300_000,
    },
  );
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/** Applies the role boundary and the migration to a throwaway database. */
function applyBaseline(database: string): void {
  psqlAsSuperuserFile(database, BOOTSTRAP_SQL);
  const config = loadTestEnvironment().database;
  const result = spawnSync(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '-q', '-h', config.host, '-U', config.user, '-d', database, '-f', MIGRATION_SQL],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: config.password } },
  );
  if (result.status !== 0) {
    throw new Error(`applying the migration as ${config.user} failed:\n${result.stderr}`);
  }
}

interface CountRow {
  readonly count: number;
}

function countIn(database: string, table: string): number {
  const rows = psqlJson<CountRow>(database, `SELECT count(*)::int AS count FROM ${table}`);
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`count query on ${table} returned no row`);
  }
  return row.count;
}

/** The complete seed table census, used for the idempotency snapshot. */
function seedCensus(database: string): Record<string, number> {
  return {
    groups: countIn(database, 'groups'),
    roles: countIn(database, 'roles'),
    actions: countIn(database, 'actions'),
    permissions: countIn(database, 'permissions'),
    role_permissions: countIn(database, 'role_permissions'),
    user_roles: countIn(database, 'user_roles'),
    user_groups: countIn(database, 'user_groups'),
    users: countIn(database, 'users'),
    projects: countIn(database, 'projects'),
    customers: countIn(database, 'customers'),
    closure: countIn(database, 'authz.org_closure'),
  };
}

const SEED_TABLES = [
  'groups',
  'roles',
  'actions',
  'permissions',
  'role_permissions',
  'user_roles',
  'user_groups',
  'users',
  'projects',
  'customers',
] as const;

/** The standard postconditions of one successful seed. */
function expectSeededState(database: string): void {
  const groups = psqlJson<{ name: string; parent_name: string | null; is_system_group: boolean }>(
    database,
    `SELECT g.name AS name, p.name AS parent_name, g.is_system_group AS is_system_group
     FROM groups g LEFT JOIN groups p ON p.id = g.parent_id ORDER BY g.name`,
  );
  expect(groups).toEqual([
    { name: 'EU', parent_name: 'root', is_system_group: false },
    { name: 'FR', parent_name: 'EU', is_system_group: false },
    { name: 'HQ', parent_name: null, is_system_group: false },
    { name: 'KF', parent_name: 'root', is_system_group: false },
    { name: 'root', parent_name: null, is_system_group: true },
  ]);

  // HQ is the one exception to the "every group has a parent" shape — it is
  // seeded standalone, deliberately. Any OTHER parentless row is the bug.
  const unparented =
    psqlJson<CountRow>(database, `SELECT count(*)::int AS count FROM groups WHERE name NOT IN ('root', 'HQ') AND parent_id IS NULL`)[0];
  expect(unparented?.count).toBe(0);

  const roles = psqlJson<{ name: string; parent_name: string | null; is_system_role: boolean }>(
    database,
    `SELECT r.name AS name, p.name AS parent_name, r.is_system_role AS is_system_role
     FROM roles r LEFT JOIN roles p ON p.id = r.parent_id ORDER BY r.name`,
  );
  expect(roles).toEqual([
    { name: 'admin', parent_name: null, is_system_role: true },
    { name: 'manager', parent_name: 'admin', is_system_role: false },
    { name: 'member', parent_name: 'manager', is_system_role: false },
  ]);

  expect(countIn(database, 'authz.org_closure')).toBe(9);
  expect(
    psqlJson<CountRow>(
      database,
      `SELECT count(*)::int AS count FROM authz.org_closure c
       JOIN groups a ON a.id = c.ancestor JOIN groups d ON d.id = c.descendant
       WHERE a.name = 'EU' AND d.name = 'FR'`,
    )[0]?.count,
  ).toBe(1);

  const adminMemberships = psqlJson<CountRow>(
    database,
    `SELECT count(*)::int AS count FROM user_groups ug
     JOIN users u ON u.id = ug.user_id JOIN groups g ON g.id = ug.group_id
     WHERE u.username = 'admin' AND g.name IN ('HQ', 'EU')`,
  )[0];
  expect(adminMemberships?.count).toBe(2);

  const adminRole = psqlJson<CountRow>(
    database,
    `SELECT count(*)::int AS count FROM user_roles ur
     JOIN users u ON u.id = ur.user_id JOIN roles r ON r.id = ur.role_id
     WHERE u.username = 'admin' AND r.name = 'admin'`,
  )[0];
  expect(adminRole?.count).toBe(1);

  expect(
    psqlJson<CountRow>(database, `SELECT count(*)::int AS count FROM projects p JOIN groups g ON g.id = p.group_id WHERE g.name = 'EU'`)[0]?.count,
  ).toBe(2);
  expect(
    psqlJson<CountRow>(database, `SELECT count(*)::int AS count FROM customers c JOIN groups g ON g.id = c.group_id WHERE g.name = 'EU'`)[0]?.count,
  ).toBe(1);
}

let firstSeed: SeedRun;
let firstCensus: Record<string, number>;

beforeAll(() => {
  recreateDatabase(PROOF_DB);
  recreateDatabase(ROLLBACK_DB);
  applyBaseline(ROLLBACK_DB);
  // Arm the deliberate mid-seed failure on the rollback database: the seed's
  // projects INSERT is where it fires, which is AFTER groups/roles/users have
  // been written — a partial seed is exactly what the transaction must undo.
  psqlAsSuperuser(
    ROLLBACK_DB,
    `CREATE OR REPLACE FUNCTION seed_blowup() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'deliberate mid-seed failure'; END $f$;
     CREATE TRIGGER seed_blowup BEFORE INSERT ON projects FOR EACH ROW EXECUTE FUNCTION seed_blowup();`,
  );
  firstSeed = runSeed(PROOF_DB);
  firstCensus = seedCensus(PROOF_DB);
}, 600_000);

afterAll(() => {
  // `database/seed.ts` runs a CLUSTER-scoped `ALTER ROLE … PASSWORD`, so the
  // cluster is restored in a `finally`: it is the one step that must not be
  // skipped, and this suite drops two databases first, either of which can fail
  // on a connection an earlier failure left behind. Idempotent — the seed
  // writes the same configured value this restores.
  try {
    dropDatabase(PROOF_DB);
    dropDatabase(ROLLBACK_DB);
  } finally {
    restoreAuthenticatorPassword();
  }
});

describe('seed integrity: real pipeline, throwaway databases', () => {
  it('the seed exits 0 and reports no transaction-block warning', () => {
    expect(firstSeed.code).toBe(0);
    expect(firstSeed.output).toContain('seed complete.');
    expect(firstSeed.output).not.toContain('can only be used in transaction blocks');
  });

  it('groups form the expected tree: every group except root and standalone HQ has a parent', () => {
    expectSeededState(PROOF_DB);
  });

  it('org_closure holds all 9 rows, including the EU→FR edge the nulled-parent bug destroyed', () => {
    expect(countIn(PROOF_DB, 'authz.org_closure')).toBe(9);
    expect(
      psqlJson<CountRow>(
        PROOF_DB,
        `SELECT count(*)::int AS count FROM authz.org_closure c
         JOIN groups a ON a.id = c.ancestor JOIN groups d ON d.id = c.descendant
         WHERE a.name = 'EU' AND d.name = 'FR'`,
      )[0]?.count,
    ).toBe(1);
  });

  it('a second seed run is idempotent: exit 0, unchanged-password line, byte-identical row counts', () => {
    const second = runSeed(PROOF_DB);
    expect(second.code).toBe(0);
    expect(second.output).toContain('admin already exists; its password is unchanged.');
    expect(seedCensus(PROOF_DB)).toEqual(firstCensus);
  }, 300_000);

  it('a mid-seed failure rolls back every table to empty, and recovery re-seeds cleanly', () => {
    const failed = runSeed(ROLLBACK_DB);
    expect(failed.code).toBe(1);
    expect(failed.output).toContain('seed failed');
    for (const table of SEED_TABLES) {
      expect(countIn(ROLLBACK_DB, table), `${table} must be empty after a rolled-back seed`).toBe(0);
    }
    expect(countIn(ROLLBACK_DB, 'authz.org_closure')).toBe(0);

    psqlAsSuperuser(ROLLBACK_DB, 'DROP TRIGGER seed_blowup ON projects; DROP FUNCTION seed_blowup();');
    const recovered = runSeed(ROLLBACK_DB);
    expect(recovered.code).toBe(0);
    expectSeededState(ROLLBACK_DB);
  }, 600_000);
});
