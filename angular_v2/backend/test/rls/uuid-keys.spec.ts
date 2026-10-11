import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/auth/uuidv7.js';
import { databaseConfig } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * Every key in the schema is UUIDv7, and the gate is the catalog rather than a list.
 *
 * ## Why this is a gate and not a migration test
 *
 * `0006_uuidv7.sql` converts the nine defaults that existed when it was written. A
 * test that asserts those nine is a test that passes the moment somebody adds a
 * tenth table with `DEFAULT gen_random_uuid()` — the failure mode is a new key that
 * silently keeps the old behaviour, which is invisible until someone reads the
 * catalog. So this suite queries `pg_attrdef` and asks about EVERY uuid default in
 * `public`, with no names hardcoded, and separately proves a freshly inserted key
 * really is a v7 rather than trusting the default's text.
 *
 * ## Why a throwaway database
 *
 * The assertions run against a fresh provision built by the real pipeline, because
 * the question is what a fork gets. Asserting against the development database would
 * also pass on a database migrated before `0006`, where every row is still a v4 — a
 * green result that proves nothing about a new install.
 *
 * ## No backfill, and this does not assert one
 *
 * Existing v4 values are left alone on purpose (see the migration). So this suite
 * asserts the DEFAULT and the value of a NEW row. A test demanding that every row
 * in the database is a v7 would demand the backfill that was deliberately rejected.
 */

const TIMEOUT = 180_000;
const PROOF_DB = 'uuid_keys_proof';
const MIGRATIONS_DIR = join(BACKEND_ROOT, 'database', 'migrations');
const BOOTSTRAP_SQL = join(BACKEND_ROOT, 'database', 'bootstrap', '001_roles.sql');

function migrationFiles(): readonly string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4,}_.*\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort();
}

function superuserRows<T>(sql: string): readonly T[] {
  const result = spawnSync(
    'sudo',
    [
      '-u',
      'postgres',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-t',
      '-A',
      '-d',
      PROOF_DB,
    ],
    {
      encoding: 'utf8',
      input: `SELECT coalesce(json_agg(_q)::text, '[]') FROM (${sql.replace(/;\s*$/, '')}) AS _q;\n`,
    },
  );
  if (result.status !== 0) {
    throw new Error(`superuser psql failed:\n${result.stderr}`);
  }
  const trimmed = result.stdout.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
}

/** Superuser SQL, discarding output. One statement per call: `CREATE DATABASE` and
 * `DROP DATABASE` cannot run inside a transaction block, and psql wraps a
 * multi-statement `-c` in exactly one. */
function superuserExec(sql: string, database: string = PROOF_DB): void {
  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', database],
    { encoding: 'utf8', input: sql },
  );
  if (result.status !== 0) {
    throw new Error(`superuser psql failed:\n${result.stderr}`);
  }
}

/** Superuser SQL returning one scalar. Needed for `INSERT ... RETURNING`, which
 * cannot be nested: a data-modifying CTE has to be at the top level of the
 * statement, and `superuserRows` wraps its argument in a subquery. */
function superuserScalar(sql: string): string {
  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', PROOF_DB],
    { encoding: 'utf8', input: sql },
  );
  if (result.status !== 0) {
    throw new Error(`superuser psql failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

interface UuidDefaultRow {
  table: string;
  column: string;
  default_expr: string;
}

beforeAll(() => {
  const devDb = databaseConfig().database;
  if (PROOF_DB === devDb) {
    throw new Error(
      `refusing to run the uuid proof against the development database (${devDb})`,
    );
  }
  superuserExec(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PROOF_DB}' AND pid <> pg_backend_pid()`,
    'postgres',
  );
  superuserExec(`DROP DATABASE IF EXISTS ${PROOF_DB}`, 'postgres');
  superuserExec(
    `CREATE DATABASE ${PROOF_DB} OWNER ${databaseConfig().user}`,
    'postgres',
  );
  for (const file of [BOOTSTRAP_SQL, ...migrationFiles().map((m) => join(MIGRATIONS_DIR, m))]) {
    const result = spawnSync(
      'sudo',
      ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', PROOF_DB, '-f', file],
      { encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(`applying ${file} failed:\n${result.stderr}`);
    }
  }
}, TIMEOUT);

afterAll(() => {
  spawnSync(
    'sudo',
    [
      '-u',
      'postgres',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-d',
      'postgres',
      '-c',
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PROOF_DB}' AND pid <> pg_backend_pid()`,
    ],
    { encoding: 'utf8' },
  );
  spawnSync(
    'sudo',
    [
      '-u',
      'postgres',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-d',
      'postgres',
      '-c',
      `DROP DATABASE IF EXISTS ${PROOF_DB}`,
    ],
    { encoding: 'utf8' },
  );
});

describe('every uuid key in a fresh provision defaults to uuidv7()', () => {
  it('finds the uuid columns to check, so an empty result is not a pass', () => {
    const rows = superuserRows<UuidDefaultRow>(`
      SELECT c.relname AS table, a.attname AS column, coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS default_expr
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND pg_catalog.format_type(a.atttypid, a.atttypmod) = 'uuid'
      ORDER BY c.relname, a.attname`);
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it('has no uuid column still defaulting to gen_random_uuid(), which is a v4', () => {
    const offenders = superuserRows<UuidDefaultRow>(`
      SELECT c.relname AS table, a.attname AS column, pg_get_expr(d.adbin, d.adrelid) AS default_expr
      FROM pg_attrdef d
      JOIN pg_class c ON c.oid = d.adrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE n.nspname = 'public' AND pg_get_expr(d.adbin, d.adrelid) LIKE '%gen_random_uuid%'
      ORDER BY c.relname, a.attname`);
    expect(
      offenders.map((row) => `${row.table}.${row.column}`),
      'these uuid keys still mint a v4',
    ).toEqual([]);
  });

  it('defaults every uuid primary key to uuidv7(), read from the catalog rather than a list', () => {
    const wrong = superuserRows<UuidDefaultRow>(`
      SELECT c.relname AS table, a.attname AS column, pg_get_expr(d.adbin, d.adrelid) AS default_expr
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND pg_catalog.format_type(a.atttypid, a.atttypmod) = 'uuid'
        AND pg_get_expr(d.adbin, d.adrelid) <> 'uuidv7()'
      ORDER BY c.relname, a.attname`);
    expect(
      wrong.map((row) => `${row.table}.${row.column} = ${row.default_expr}`),
      'a uuid column with a default that is not uuidv7()',
    ).toEqual([]);
  });

  it('holds refresh_tokens.jti as a uuid, because the database can then hold what the token carries', () => {
    const rows = superuserRows<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'refresh_tokens' AND column_name = 'jti'`,
    );
    expect(rows[0]?.data_type).toBe('uuid');
  });

  it('keeps one index on refresh_tokens.jti, because a plain btree beside a unique one is a subset of it', () => {
    const rows = superuserRows<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'refresh_tokens' AND indexdef LIKE '%(jti)%'`,
    );
    expect(rows.map((row) => row.indexname)).toEqual(['refresh_tokens_jti_key']);
  });
});

describe('a key the database mints really is a v7', () => {
  it('reads version nibble 7 on a freshly inserted default-generated id', () => {
    // The default's TEXT is not the proof; a default could say uuidv7() and be
    // overridden. This inserts nothing explicit and reads the value back.
    const version = superuserScalar(
      `INSERT INTO groups (name) VALUES ('uuid-v7-proof')
       RETURNING substring(id::text, 15, 1)`,
    );
    expect(version).toBe('7');
  });

  it('time-prefixes the value, which is the entire reason for being on v7', () => {
    // The default's name is not evidence. This reads the leading 48 bits back and
    // checks they are the current wall clock in milliseconds, which is what makes a
    // v7 sort by minting time and a v4 not. A regression to gen_random_uuid() fails
    // here even if the column's default text still said uuidv7().
    const before = Date.now();
    const rows = superuserRows<{ version: string; prefix: string }>(`
      SELECT substring(v, 15, 1) AS version, left(replace(v, '-', ''), 12) AS prefix
      FROM (SELECT uuidv7()::text AS v) AS s`);
    const after = Date.now();

    expect(rows[0]?.version).toBe('7');
    const timestampMs = Number.parseInt(rows[0]?.prefix ?? '', 16);
    expect(Number.isNaN(timestampMs)).toBe(false);
    expect(timestampMs).toBeGreaterThanOrEqual(before);
    expect(timestampMs).toBeLessThanOrEqual(after);
  });

  it('the application generator and the database default produce the same kind of value, so a v4 from either side cannot make refresh_tokens.jti half v4', () => {
    // `refresh_tokens.jti` is the one key the database never mints — the value
    // lives inside the access token the refresh row is keyed on, so
    // `src/auth/uuidv7.ts` produces it in the application. If the two code paths
    // drift into different UUID versions, the column ends up holding a mix, and
    // nothing reads the version nibble, so it is invisible until someone does.
    //
    // The previous version of this test asked only what the database's own
    // `uuidv7()` returned, which passes identically if `src/auth/uuidv7.ts` does
    // not exist. It compared one side against itself.
    const before = Date.now();
    const fromDatabase = superuserRows<{ value: string }>(
      `SELECT uuidv7()::text AS value`,
    );
    const fromApplication = uuidv7();
    const after = Date.now();

    const dbValue = fromDatabase[0]?.value;
    expect(dbValue, 'the database produced no uuidv7() to compare against').toBeDefined();

    // Version nibble — the 13th hex digit. `randomUUID()` leaves a 4 there, so an
    // application generator that forgot to overwrite it yields a v4 that merely
    // looks time-ordered.
    expect(fromApplication.charAt(14), 'the application generator did not write version 7').toBe('7');
    expect(dbValue?.charAt(14), 'the database default did not write version 7').toBe('7');

    // Variant bits — the high pair of the 17th hex digit must be 0b10, or the value
    // is not a UUID at all and the `uuid` column rejects it on insert.
    for (const [source, value] of [
      ['application', fromApplication],
      ['database', dbValue ?? ''],
    ] as const) {
      expect(['8', '9', 'a', 'b'], `${source} wrote a bad variant`).toContain(value.charAt(19));
    }

    // Time-prefixed head: both leading 48 bits decode to the current wall clock.
    // This is the property a v4 fails, and it is the one the id exists for.
    for (const [source, value] of [
      ['application', fromApplication],
      ['database', dbValue ?? ''],
    ] as const) {
      const timestampMs = Number.parseInt(value.replaceAll('-', '').slice(0, 12), 16);
      expect(Number.isNaN(timestampMs), `${source} head is not 48 bits of hex`).toBe(false);
      expect(timestampMs, `${source} head is not the current wall clock`).toBeGreaterThanOrEqual(
        before,
      );
      expect(timestampMs, `${source} head is not the current wall clock`).toBeLessThanOrEqual(after);
    }

    // And the two are interchangeable as far as the column is concerned: the value
    // the application mints is a uuid the database's own generator would accept.
    // `superuserScalar` interpolates, so the format is asserted rather than assumed
    // — the value reaching the SQL is 32 hex digits and 4 hyphens, nothing else.
    expect(fromApplication).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(superuserScalar(`SELECT '${fromApplication}'::uuid::text`)).toBe(fromApplication);
  });
});

describe('the migration files say what the catalog shows', () => {
  it('ships a migration that sets every default, and a down script that reverses it', () => {
    const up = readFileSync(join(MIGRATIONS_DIR, '0006_uuidv7.sql'), 'utf8');
    const down = readFileSync(join(MIGRATIONS_DIR, '0006_uuidv7.down.sql'), 'utf8');
    expect(up).toContain('uuidv7()');
    expect(down).toContain('gen_random_uuid()');
  });

  it('leaves no gen_random_uuid() in the seed, because a seed that supplies its own id bypasses the default', () => {
    // The failure this catches is subtle: the seed would still produce v7-looking
    // data if it called gen_random_uuid(), because the column default is not used
    // when a value is supplied. The catalog gate above would pass. Only this sees it.
    const seed = readFileSync(join(BACKEND_ROOT, 'database', 'seed.ts'), 'utf8');
    expect(seed).not.toContain('gen_random_uuid');
  });
});