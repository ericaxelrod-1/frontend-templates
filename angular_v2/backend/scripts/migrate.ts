import { Client } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readDownScript } from './down-script.ts';

// Load .env the same way the application does (but it only runs if the file exists).
import '../src/config/load-env-file.ts';

import { resolve } from 'node:path';

const backendRoot = dirname(fileURLToPath(import.meta.url));
const migrationDir = join(backendRoot, '..', 'database', 'migrations');

/**
 * Is this module the process entry point?
 *
 * ## Why this is not `import.meta.url.endsWith(process.argv[1])`
 *
 * That spelling is **false on Windows**, and silently. `import.meta.url` is a URL —
 * `file:///C:/dir/migrate.ts`, forward slashes and a scheme — while
 * `process.argv[1]` is a filesystem path — `C:\dir\migrate.ts`, backslashes and no
 * scheme. They are the same file and the suffix test does not match.
 *
 * The consequence is the worst shape this repository has a rule about
 * (`AGENTS.md` §2.3, "silently returning a success-shaped value is a bug"): `run()`
 * is never called, the script falls off the end, and the process **exits 0 having
 * applied nothing**. `npm run migration:run` printed no output, reported success, and
 * left the database with zero tables — while `npm run db:seed` went on to fail
 * downstream on a table that "had been migrated".
 *
 * Comparing resolved filesystem paths is the honest test: convert the URL with
 * `fileURLToPath`, then `resolve` both sides so a relative `argv[1]` and a
 * `..`-bearing `import.meta.url` agree.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || entry === '') {
    return false;
  }
  return resolve(fileURLToPath(import.meta.url)) === resolve(entry);
}

interface Env {
  DB_HOST: string;
  DB_PORT: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

/**
 * Reads the five connection coordinates from `process.env` and fails loudly on a
 * missing or empty one (`AGENTS.md` §2.3). No default is substituted: a migration
 * run against the wrong database is the failure this exists to prevent.
 *
 * Each key is read by name and collected before the environment is built, in the
 * shape `src/config/environment.ts` already uses. `process.env as Env` — the cast
 * this replaces — is exactly what `strict` and `noPropertyAccessFromIndexSignature`
 * exist to reject, and it turns an absent `DB_PORT` into `NaN` at `new Client()`
 * instead of an error here.
 */
function env(): Env {
  const keys: (keyof Env)[] = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing: string[] = [];
  const values: Partial<Env> = {};

  for (const key of keys) {
    const value = process.env[key];
    if (value === undefined || value === '') {
      missing.push(key);
      continue;
    }
    values[key] = value;
  }

  if (missing.length > 0) {
    throw new Error(`database coordinates required but unset: ${missing.join(', ')}`);
  }

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = values;
  if (
    DB_HOST === undefined ||
    DB_PORT === undefined ||
    DB_USER === undefined ||
    DB_PASSWORD === undefined ||
    DB_NAME === undefined
  ) {
    throw new Error('database coordinates required but unset');
  }

  return { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME };
}

interface Migration {
  name: string;
  path: string;
}

async function listMigrations(): Promise<Migration[]> {
  const entries = await readdir(migrationDir);
  const files = entries
    .filter((n) => n.match(/^\d{4,}_.*\.sql$/) && !n.endsWith('.down.sql'))
    .map((name) => ({ name, path: join(migrationDir, name) }));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

async function appliedMigrations(client: Client): Promise<string[]> {
  const res = await client.query<{ name: string }>(
    'SELECT name FROM migrations ORDER BY applied_at',
  );
  return res.rows.map((row) => row.name);
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function applyMigration(
  client: Client,
  migration: Migration,
): Promise<{ rowsAffected: number }> {
  const sql = await readFile(migration.path, 'utf8');
  const result = await client.query(sql);
  await client.query('INSERT INTO migrations (name) VALUES ($1)', [migration.name]);
  await client.query('NOTIFY pgrst, \'reload schema\'');
  return { rowsAffected: result.rowCount ?? 0 };
}

/**
 * Runs the sibling `<name>.down.sql` and only then drops the ledger row.
 *
 * The down script is a separate file, not a section of the up file. Reading it
 * out of the up file by splitting on `-- DOWN` returned the pointer comment that
 * every migration carries, so the "revert" executed nothing, deleted the
 * `migrations` row anyway and exited 0 — and the next `migration:run` re-applied
 * a migration whose tables, policies and functions were all still there.
 *
 * `readDownScript` throws before this function issues a statement, so an
 * unusable down script leaves the ledger row in place and the migration recorded
 * as applied, which is the truth. Transaction handling is the caller's and is
 * unchanged: `run()` wraps this in BEGIN/COMMIT and rolls back on any throw.
 */
async function revertMigration(client: Client, migration: Migration): Promise<void> {
  const down = await readDownScript(migrationDir, migration.name);
  await client.query(down.sql);
  await client.query('DELETE FROM migrations WHERE name = $1', [migration.name]);
  await client.query('NOTIFY pgrst, \'reload schema\'');
}

async function run(up: boolean): Promise<number> {
  const e = env();
  const client = new Client({
    host: e.DB_HOST,
    port: Number(e.DB_PORT),
    user: e.DB_USER,
    password: e.DB_PASSWORD,
    database: e.DB_NAME,
  });
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    const pending = await listMigrations();
    const appliedSet = new Set(await appliedMigrations(client));

    if (!up && appliedSet.size === 0) {
      console.log('nothing to revert');
      return 0;
    }

    const list = up
      ? pending.filter((m) => !appliedSet.has(m.name))
      : pending.filter((m) => appliedSet.has(m.name)).reverse();

    for (const migration of list) {
      const fromTo = up ? `APPLY   ${migration.name}` : `REVERT  ${migration.name}`;
      console.log(`${fromTo}`);

      await client.query('BEGIN');
      try {
        if (up) {
          await applyMigration(client, migration);
        } else {
          await revertMigration(client, migration);
        }
        await client.query('COMMIT');
        console.log(`  ${fromTo} — done`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ${fromTo} — FAILED`);
        throw err;
      }
    }

    console.log(`migrations: ${up ? 'applied' : 'reverted'} ${list.length} file(s)`);
    return 0;
  } finally {
    await client.end();
  }
}

if (isEntryPoint()) {
  const mode = process.argv[2] === 'down' ? false : true;
  const code = await run(mode);
  process.exit(code);
}
