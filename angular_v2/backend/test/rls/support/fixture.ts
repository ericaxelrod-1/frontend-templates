import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { loadTestEnvironment } from '../../support/database.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * The live fixture for the RLS proof suite.
 *
 * Everything here talks to a real PostgreSQL and a real PostgREST process. There
 * is no in-memory substitute and no skip path: if Postgres is unreachable the
 * suite fails with the driver's own error, because a security suite that passes
 * when its subject is absent is worse than no suite at all (AGENTS.md §2.2).
 *
 * Three roles do the work, and keeping them distinct is the whole point:
 *
 *   - `postgres` via `sudo -u postgres psql` — applies the role bootstrap,
 *     because CREATE ROLE needs CREATEROLE and nothing else has it.
 *   - `app`, from backend/.env — the migration/owner role. Owns every table.
 *   - `pgrst_authenticator` — the only role that ever receives a request.
 */

/** Proof-only credentials. Never a real secret, never read from a real environment. */
const AUTHENTICATOR_PASSWORD = 'w07-proof-authenticator';
export const PROOF_JWT_SECRET = 'w07-proof-signing-secret-0123456789abcdef';

/** Deliberately not 3002: another PostgREST instance is already serving there. */
export const PROOF_PORT = 3005;
const PROOF_DATABASE = 'rls_proof';
const POSTGREST_BINARY = '/usr/local/bin/postgrest';

export const MIGRATION_SQL = join(BACKEND_ROOT, 'database', 'migrations', '0001_rls_foundation.sql');
export const BOOTSTRAP_SQL = join(BACKEND_ROOT, 'database', 'bootstrap', '001_roles.sql');

export const SERVING_ROLES = ['app_anon', 'app_member', 'app_admin', 'pgrst_authenticator'] as const;

/** The role that owns every table. A token naming it is the escalation attempt. */
export const OWNING_ROLE = 'app';

function psqlAsSuperuser(sql: string, database: string): string {
  const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', database, '-c', sql], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`superuser psql failed against ${database}:\n${result.stderr}`);
  }
  return result.stdout;
}

function psqlAsSuperuserFile(path: string, database: string): void {
  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', database, '-f', path],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`applying ${path} as superuser failed:\n${result.stderr}`);
  }
}

/**
 * Recreates the proof database from nothing and applies both SQL files.
 *
 * The migration is applied as the owner role, twice, because "applies cleanly"
 * and "is idempotent" are different claims and a file that only ever runs once
 * has not been shown to do either. `ON_ERROR_STOP=1` is not optional: psql
 * continues past an error and still exits 0 by default, so without it a failed
 * grant in the middle of the file is indistinguishable from success.
 */
export function rebuildDatabase(): void {
  // Terminate anything still attached before dropping. A stale PostgREST or a
  // leaked `pg` pool makes DROP DATABASE fail with "database is being accessed
  // by other users", and the resulting error names a connection the operator
  // cannot see.
  psqlAsSuperuser(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PROOF_DATABASE}' AND pid <> pg_backend_pid()`,
    'postgres',
  );
  psqlAsSuperuser(`DROP DATABASE IF EXISTS ${PROOF_DATABASE}`, 'postgres');
  psqlAsSuperuser(`CREATE DATABASE ${PROOF_DATABASE} OWNER ${OWNING_ROLE}`, 'postgres');

  // The authenticator needs a password because PostgREST authenticates with a
  // login role. It is set here rather than in the committed bootstrap because a
  // committed file must not carry a credential.
  psqlAsSuperuser(
    `ALTER ROLE pgrst_authenticator LOGIN PASSWORD '${AUTHENTICATOR_PASSWORD}'`,
    PROOF_DATABASE,
  );

  psqlAsSuperuserFile(BOOTSTRAP_SQL, PROOF_DATABASE);
  applyMigrationAsOwner();
  applyMigrationAsOwner();
}

/**
 * Applies the migration as the owner role. Read from `.env`, so the suite proves
 * the same connection the application uses rather than a private one.
 */
export function applyMigrationAsOwner(): void {
  const config = loadTestEnvironment().database;
  const result = spawnSync(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '-q', '-h', config.host, '-U', config.user, '-d', PROOF_DATABASE, '-f', MIGRATION_SQL],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: config.password } },
  );
  if (result.status !== 0) {
    throw new Error(`applying the migration as ${config.user} failed:\n${result.stderr}`);
  }
}

/**
 * Runs a query as the cluster superuser and returns its rows as JSON.
 *
 * Some assertions must impersonate a serving role (`SET LOCAL ROLE app_member`)
 * to exercise the policy from the outside. The migration role `app` cannot do
 * that: it is deliberately not a member of the serving roles, and granting it
 * membership would reopen exactly the escalation hole these tests exist to close.
 * Only a superuser can borrow any role, so these checks go through one.
 *
 * `COPY (...) TO STDOUT` rather than `-c` string interpolation: the claims values
 * below are deliberately malformed, and a shell-quoted literal is not a safe way
 * to carry a string designed to be hostile.
 */
export function queryAsSuperuser<T>(sql: string): readonly T[] {
  // json_agg rather than COPY ... FORMAT json: PostgreSQL 15 has no json COPY
  // backend (`COPY format "json" not recognized`), and plain COPY TO STDOUT emits
  // bare scalars that do not parse as row objects. Both verified.
  const inner = sql.replace(/;\s*$/, '');
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
      PROOF_DATABASE,
      '-c',
      `SELECT coalesce(json_agg(_proof)::text, '[]') FROM (${inner}) AS _proof`,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`superuser query failed:\n${result.stderr}`);
  }
  const trimmed = result.stdout.trim();
  if (trimmed === '') {
    return [];
  }
  return JSON.parse(trimmed) as readonly T[];
}

export interface Sites {
  readonly root: string;
  readonly mid: string;
  readonly leaf: string;
  readonly unrelated: string;
  /** A site that exists in the tree, used for the scope test. */
  readonly other: string;
}

/**
 * Seeds a 3-level tree: root -> mid -> leaf, plus one unrelated site and one
 * second root so the scope test has two genuinely disjoint callers.
 *
 * Seeding goes through the escalation boundary, not around it. The owner role is
 * subject to its own policies under FORCE and is rejected outright, and the
 * documented workaround — disabling `row_security` — would reopen the owner
 * bypass. So the seeder connects as `pgrst_authenticator` and assumes `app_admin`,
 * which is the only role the boundary admits with unrestricted scope.
 */
export async function seed(sites: {
  readonly client: Client;
}): Promise<Sites> {
  const { client } = sites;
  await client.query('BEGIN');
  await client.query('SET LOCAL ROLE app_admin');

  const insertSite = async (name: string, parent: string | null): Promise<string> => {
    const result = await client.query<{ id: string }>(
      parent === null
        ? 'INSERT INTO sites (name) VALUES ($1) RETURNING id'
        : 'INSERT INTO sites (name, parent_id) VALUES ($1, $2) RETURNING id',
      parent === null ? [name] : [name, parent],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`seeding site ${name} returned no id`);
    }
    return row.id;
  };

  const root = await insertSite('root', null);
  const mid = await insertSite('mid', root);
  const leaf = await insertSite('leaf', mid);
  const unrelated = await insertSite('unrelated', null);
  const other = await insertSite('other', null);

  // One customer per site. internal_notes carries a recognisable secret so a
  // leaked column is unmistakable in an assertion, not merely "present".
  for (const siteId of [root, mid, leaf, unrelated, other]) {
    await client.query(
      `INSERT INTO customers (site_id, name, internal_notes) VALUES ($1, 'customer-' || $2, 'SECRET-' || $2)`,
      [siteId, siteId.slice(0, 4)],
    );
  }

  await client.query('COMMIT');

  return { root, mid, leaf, unrelated, other };
}

/** A client for the single role PostgREST connects as, i.e. the seeder's identity. */
export function authenticatorClient(): Client {
  return new Client({
    host: 'localhost',
    port: 5432,
    user: 'pgrst_authenticator',
    password: AUTHENTICATOR_PASSWORD,
    database: PROOF_DATABASE,
  });
}

export function baseUrl(): string {
  return `http://127.0.0.1:${PROOF_PORT}`;
}

/**
 * Writes the proof server's config.
 *
 * `jwt-role-claim-key` must be a JSPath. The bare claim name `"role"` makes
 * PostgREST 16.4 PANIC on boot rather than fall back — verified:
 * `failed to parse role-claim-key value (role) ... unexpected "r"`. The leading
 * dot is the whole fix. `$.role` is the newer JSONPath spelling and also panics
 * on 16.4, so do not "modernise" this value.
 */
function writeConfig(directory: string): string {
  const path = join(directory, 'postgrest.conf');
  writeFileSync(
    path,
    [
      'db-schemas = "public"',
      'db-anon-role = "app_anon"',
      `jwt-secret = "${PROOF_JWT_SECRET}"`,
      'jwt-role-claim-key = ".role"',
      'server-host = "127.0.0.1"',
      `server-port = ${PROOF_PORT}`,
      'db-channel-enabled = true',
      'openapi-mode = "ignore-privileges"',
      '',
    ].join('\n'),
    'utf8',
  );
  return path;
}

export async function startPostgrest(): Promise<{ stop: () => void; directory: string }> {
  if (!existsSync(POSTGREST_BINARY)) {
    throw new Error(`${POSTGREST_BINARY} is not installed; the RLS proof cannot run without a real PostgREST`);
  }

  // Refuse to start if the port is already answering. Without this the readiness
  // probe below succeeds against somebody else's server — a leftover instance
  // from a previous run, or a developer's own — and the entire suite silently
  // tests a database it did not create. That failure mode is invisible: every
  // assertion either passes against the right schema or fails confusingly, and
  // the log line says "listening" either way. Hit during development, not
  // theorised.
  const contention = await probePort();
  if (contention !== undefined) {
    throw new Error(
      `port ${PROOF_PORT} is already serving. The RLS proof starts its own PostgREST and must not attach to another one.\n${contention}`,
    );
  }

  const directory = mkdtempSync(join(tmpdir(), 'w07-pgrst-'));
  const config = writeConfig(directory);

  /**
 * The child environment, with every inherited PGRST_* override removed.
 *
 * CORRECTED. `test/support/database.ts` imports the .env loader, so
 * PGRST_JWT_SECRET from backend/.env is in the parent environment — and PostgREST
 * gives environment variables precedence over the config file. The proof server
 * was therefore verifying tokens against the developer's application secret while
 * the suite minted them with the proof secret, and every request failed at
 * authentication with PGRST301 before reaching a single policy. Found by dumping
 * the child's environment, not by reading the config, which was byte-identical to
 * a config that worked.
 *
 * The keys are deleted rather than set to `undefined`, because `spawn` stringifies
 * env values and `undefined` would reach PostgREST as the literal text
 * "undefined" — a new silent misconfiguration in place of the old one.
 */
function proofChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('PGRST_')) {
      delete env[key];
    }
  }
  return { ...env, PGRST_DB_URI: `postgresql://pgrst_authenticator:${AUTHENTICATOR_PASSWORD}@localhost:5432/${PROOF_DATABASE}` };
}

const child: ChildProcess = spawn(POSTGREST_BINARY, [config], {
    env: proofChildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Retained rather than discarded: if PostgREST dies mid-suite, this is the log
  // that says why, and a security suite that swallows it cannot be debugged.
  let log = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    log += chunk.toString('utf8');
  });

  let owned = false;
  const stop = (): void => {
    if (owned && child.exitCode === null) {
      child.kill('SIGTERM');
      // Wait for the port to actually free. `kill` returns immediately and the
      // child holds the socket for a few hundred ms, so a suite killed mid-run
      // leaves an orphan that makes the NEXT run fail its port guard — reported
      // as "port 3005 is already serving" with nothing pointing at the process
      // responsible. Hit during development, not theorised.
      const deadline = Date.now() + 5_000;
      while (child.exitCode === null && Date.now() < deadline) {
        spawnSync('sleep', ['0.1']);
      }
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        spawnSync('sleep', ['0.2']);
      }
    }
    rmSync(directory, { recursive: true, force: true });
  };

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`PostgREST exited with ${child.exitCode} before serving:\n${log}`);
    }
    try {
      const response = await fetch(`${baseUrl()}/`, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) {
        owned = true;
        return { stop, directory };
      }
    } catch {
      // Not listening yet. Retried until the deadline; never swallowed silently.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  stop();
  throw new Error(`PostgREST did not answer on port ${PROOF_PORT} within 30s:\n${log}`);
}

/**
 * Returns a description if something is already listening, undefined if the port
 * is free.
 *
 * Includes the holding PID where it can be found, because "port 3005 is already
 * serving" with nothing more actionable is the worst possible error message: the
 * operator has no way to tell a stray test server from their own.
 */
async function probePort(): Promise<string | undefined> {
  try {
    const response = await fetch(`${baseUrl()}/`, { signal: AbortSignal.timeout(2000) });
    return `an existing server answered GET / with HTTP ${response.status}\n${describeHolder()}`;
  } catch {
    return undefined;
  }
}

function describeHolder(): string {
  const listeners = spawnSync('ss', ['-ltnp'], { encoding: 'utf8' });
  if (listeners.status !== 0) {
    return '(could not identify the process holding the port; try: ss -ltnp | grep 3005)';
  }
  const line = listeners.stdout.split('\n').find((entry) => entry.includes(`:${PROOF_PORT}`));
  return line ?? '(no listener found on the port)';
}
