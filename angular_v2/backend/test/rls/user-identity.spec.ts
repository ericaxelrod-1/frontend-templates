import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';
import { mintToken, parseJsonArray, request } from './support/jwt.js';

/**
 * `0008_user_identity.sql` — the two foreign keys `0001` deferred, and the
 * self-read path on `users`.
 *
 * ## What this suite is proving
 *
 * Two independent claims, and it is worth saying that they are independent because
 * a suite that only ever proves one of them would stay green while the other
 * regressed.
 *
 * **1. Referential integrity.** `user_roles.user_id` and `user_groups.user_id` name
 * a `users.id`. A membership row naming a user that does not exist is refused with
 * `23503`, and deleting a user takes the principal's role rows and membership rows
 * with it. That second half is the whole point: without it, an inactivity purge
 * deletes the account and leaves behind rows that `has_permission()` still resolves
 * capabilities from and `authz.visible_user_ids()` still returns to every caller who
 * shared a group — so the deleted account keeps its authority and its mail history,
 * and the purge reports success.
 *
 * **2. A member can read themselves, and nothing else.** `users` was reachable only
 * by `app_admin` (0002: `USING (current_user = 'app_admin')`), which answers "may
 * this account read SOME user's row" and not "may it read ITS OWN row".
 *
 * ## Every case is an attack or a hole, not a description
 *
 *  1. a member reads their OWN row through PostgREST — the permitted case, and the
 *     one every denial-only suite is missing.
 *  2. a member reads a COLLEAGUE's row and gets zero rows. Asserted on the row
 *     COUNT and on the colleague's identity being absent, never on the status: a
 *     correct denial, a full `USING (true)` leak and a partial leak were all HTTP
 *     200 (AGENTS.md §B2), so a status-only assertion passes on a real leak.
 *  3. a member cannot obtain `password_hash` — by name, by `select=*`, or by
 *     counting rows. The last one matters: with a table-level `SELECT` in place the
 *     column comes back at HTTP 200 with its value intact and only the body shows
 *     it.
 *  4. `app_admin` keeps full read of `users`, `password_hash` included, because
 *     `src/auth/auth.service.ts:425,433` reads it on the login and refresh paths.
 *  5. the two constraints exist in the catalog, are `ON DELETE CASCADE`, and refuse
 *     a non-existent `user_id` with `23503`.
 *  6. deleting a user removes the memberships — asserted by count after the fact.
 *  7. the grant ORDER is the one that works, and the one that does not is proven
 *     to fail open, so both cannot be "right".
 *  8. `member` resolves `user:read` through `roles.parent_id` inheritance even
 *     though no `role_permissions` row names it — the positive case a denial-only
 *     test cannot see.
 *  9. structure: one policy per verb, `password_hash` absent from the catalog grant,
 *     the helper no-argument and not executable by `PUBLIC`, `loops = 1`.
 * 10. the gate can fail: the policy is replaced by a scope-only one and the self-read
 *     and the cross-user read are watched going wrong, then restored.
 *
 * ## The database
 *
 * A throwaway one, built by the REAL pipeline — bootstrap, every migration in
 * directory order, then the real `database/seed.ts` — so the grant-subset trigger,
 * the policies and the seeded roles are genuinely in force. It refuses the
 * development database by name.
 *
 * It runs the seed, which issues a CLUSTER-scoped `ALTER ROLE pgrst_authenticator
 * … PASSWORD`, so `afterAll` restores it — the wiring `test/rls/rls.spec.ts` gates
 * by scanning this directory.
 *
 * ## Why this suite starts its own PostgREST
 *
 * `support/fixture.ts`'s `startPostgrest()` points at the `rls_proof` database,
 * which `rebuildDatabase()` builds from `0001` alone — a schema with no `users`
 * table at all, so nothing here could run against it. Two fixtures could have been
 * merged; the launcher is duplicated instead, which is the same choice
 * `email-messages.spec.ts`, `uuid-keys.spec.ts` and `seed.spec.ts` each make for
 * their own database. The duplicated part is deliberately the SMALL part: the port
 * guard, the `PGRST_*` stripping and the readiness probe, each copied with its
 * reason attached, because each of those three is a silent-failure trap rather than
 * plumbing.
 */

const TIMEOUT = 180_000;
const PROOF_DB = 'user_identity_proof';

/**
 * A port of its own, not `PROOF_PORT`. The two suites run in sequence
 * (`fileParallelism: false`), so sharing would work today — but a leftover
 * PostgREST from a killed run would then make this suite attach to a server
 * serving a DIFFERENT database, and every assertion would either pass against the
 * wrong schema or fail for no readable reason. That failure mode was hit during
 * development of the shared fixture, and the guard below is the fix.
 */
const PROOF_PORT = 3017;

/** The password this suite authenticates `pgrst_authenticator` with, read from config. */
const AUTHENTICATOR_PASSWORD = loadTestEnvironment().authenticator.password;

/** The signing secret for this suite's own PostgREST. Never the application's. */
const PROOF_JWT_SECRET = 'w27-identity-proof-signing-secret-0123456789ab';
const POSTGREST_BINARY = '/usr/local/bin/postgrest';

const BOOTSTRAP_SQL = join(BACKEND_ROOT, 'database', 'bootstrap', '001_roles.sql');
const MIGRATIONS_DIR = join(BACKEND_ROOT, 'database', 'migrations');

/**
 * Read from the directory rather than listed here. A hand-kept list goes stale the
 * moment a migration is added, and the proof database is then built on a schema the
 * application no longer ships — every assertion below would pass against a baseline
 * that does not exist in production.
 */
function migrationFiles(): readonly string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4,}_.*\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort();
}

// =============================================================================
// The fixture identities
// =============================================================================

/**
 * Fixed ids, because every assertion reads them.
 *
 *   group ──── selfMember  ── holds the seeded `member` role   ── the caller
 *           └─ otherMember ── holds the seeded `member` role   ── the colleague
 *           └─ noReadUser  ── holds `nobody`, which has no capability and no parent
 *
 * `selfMember` and `otherMember` are in the SAME group on purpose: the denial in
 * case 2 is not "a different tenant", it is "a different person", so a policy that
 * accidentally widened to group scope would still be caught.
 *
 * `noReadUser` is the capability-negative half of the self-read predicate. Without
 * it, "the member reads themselves" could be passing on the scope branch alone with
 * `can_read_user()` never consulted.
 */
const IDS = {
  groups: {
    eu: '66666666-0000-0000-0000-000000000001',
    us: '66666666-0000-0000-0000-000000000002',
  },
  users: {
    selfMember: '55555555-0000-0000-0000-000000000001',
    otherMember: '55555555-0000-0000-0000-000000000002',
    noReadUser: '55555555-0000-0000-0000-000000000003',
    purgeVictim: '55555555-0000-0000-0000-000000000004',
  },
  roles: {
    /** A role with no parent and no grants: `user:read` resolves false for it. */
    nobody: '44444444-0000-0000-0000-000000000001',
  },
} as const;

/** The hash written into every probe row, so a leak is unmistakable in a body. */
const PROBE_HASH = 'PROBE-SECRET-HASH-0001';

/** A claims document for `sub` under `role` — the shape a real token carries. */
function claims(sub: string, role: string): string {
  return JSON.stringify({ sub, role });
}

// =============================================================================
// Database plumbing
// =============================================================================

function psqlAsSuperuser(database: string, sql: string): string {
  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', database, '-c', sql],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`superuser psql failed against ${database}:\n${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Superuser SQL returning its unaligned output, or throwing.
 *
 * One statement per call: `CREATE DATABASE` and `DROP DATABASE` cannot run inside a
 * transaction block, and psql wraps a multi-statement `-c` in exactly one.
 */
function superuserExec(sql: string, database: string = PROOF_DB): void {
  psqlAsSuperuser(database, sql);
}

/** Superuser SQL, returned as parsed JSON rows. */
function superuserRows<T>(sql: string): readonly T[] {
  const stdout = psqlAsSuperuser(
    PROOF_DB,
    `SELECT coalesce(json_agg(_q)::text, '[]') FROM (${sql.replace(/;\s*$/, '')}) AS _q`,
  );
  const trimmed = stdout.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
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

function recreateDatabase(name: string): void {
  const devDb = databaseConfig().database;
  if (name === devDb || name === 'app_dev') {
    throw new Error(`refusing to run the users-identity proof against the development database (${name})`);
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
    const path = join(MIGRATIONS_DIR, migration);
    const result = spawnSync(
      'psql',
      ['-v', 'ON_ERROR_STOP=1', '-q', '-h', config.host, '-U', config.user, '-d', PROOF_DB, '-f', path],
      { encoding: 'utf8', env: { ...process.env, PGPASSWORD: config.password } },
    );
    if (result.status !== 0) {
      throw new Error(`applying ${migration} as ${config.user} failed:\n${result.stderr}`);
    }
  }
}

/** The real seed, with `DB_NAME` pointed at the throwaway database. */
function runSeed(): { readonly code: number; readonly output: string } {
  const result = spawnSync('node', ['--experimental-strip-types', 'database/seed.ts'], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      DB_NAME: PROOF_DB,
      SEED_ADMIN_PASSWORD: 'identity-proof-admin-password',
    },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * Re-applies every migration, as the real runner does.
 *
 * Separate from `applyBaseline` because the ORDER is the thing under test: the
 * baseline applies migrations to an EMPTY database, which is a fresh provision, and
 * a fresh provision has no membership rows to get wrong. This one runs against a
 * SEEDED database — `users`, `user_roles` and `user_groups` all populated — which is
 * what `npm run migration:run` does on every existing install.
 */
function reapplyMigrations(): { readonly code: number; readonly output: string } {
  const config = loadTestEnvironment().database;
  for (const migration of migrationFiles()) {
    const result = spawnSync(
      'psql',
      ['-v', 'ON_ERROR_STOP=1', '-q', '-h', config.host, '-U', config.user, '-d', PROOF_DB, '-f', join(MIGRATIONS_DIR, migration)],
      { encoding: 'utf8', env: { ...process.env, PGPASSWORD: config.password } },
    );
    if (result.status !== 0) {
      return { code: result.status ?? 1, output: `applying ${migration} failed:\n${result.stderr}` };
    }
  }
  return { code: 0, output: 'all migrations re-applied' };
}

/** A client for the migration/owner role — the one that may write `user_groups` in
 * a migrations-only database, and the only role that bypasses nothing. */
function ownerClient(): Client {
  return new Client({ ...loadTestEnvironment().database, database: PROOF_DB });
}

/** A client for the escalation boundary: `pgrst_authenticator`, which `SET ROLE`s. */
function authenticatorClient(): Client {
  return new Client({
    host: 'localhost',
    port: 5432,
    user: 'pgrst_authenticator',
    password: AUTHENTICATOR_PASSWORD,
    database: PROOF_DB,
  });
}

/** Runs `work` as `app_admin` through the boundary, in ONE transaction. */
async function asAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = authenticatorClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_admin');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** The same, for the OWNER — which is the only writer of membership on a
 * migrations-only database and a permitted one everywhere. */
async function asOwner<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = ownerClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
}

/**
 * One write through the boundary as `role`, reporting refusal rather than throwing.
 *
 * A helper that throws on a non-zero status cannot express the assertion that is
 * the point of half this suite — "this is refused" — and reporting refusal as an
 * exception tells the caller nothing about WHICH refusal it was. Returns the
 * SQLSTATE, because `42501` is also what a missing table grant raises and a
 * `42501` cannot distinguish the grant layer from the policy.
 */
interface Attempt {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
}

async function attemptAsAdmin(sql: string): Promise<Attempt> {
  const client = authenticatorClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_admin');
    await client.query(sql);
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const pgError = error as { code?: unknown; message?: unknown };
    return {
      ok: false,
      code: typeof pgError.code === 'string' ? pgError.code : undefined,
      message: typeof pgError.message === 'string' ? pgError.message : undefined,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * A read as a serving role with `request.jwt.claims` in force, straight through SQL.
 *
 * The PostgREST path is what proves the wire format; this is what proves the POLICY,
 * and it is used where the claim under test is about the predicate rather than the
 * HTTP surface. Run as the cluster superuser because it is the only identity that
 * can borrow a serving role.
 */
function readAsRole<T>(role: 'app_member' | 'app_admin' | 'app_anon', sub: string | undefined, sql: string): readonly T[] {
  const claimsLine =
    sub === undefined
      ? ''
      : `SELECT set_config('request.jwt.claims', '${claims(sub, role)}', true) \\g /dev/null`;
  const script = [
    'BEGIN;',
    `SET LOCAL ROLE ${role};`,
    claimsLine,
    `SELECT coalesce(json_agg(_r)::text, '[]') FROM (${sql.replace(/;\s*$/, '')}) AS _r;`,
    'COMMIT;',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', PROOF_DB],
    { encoding: 'utf8', input: script },
  );
  if (result.status !== 0) {
    throw new Error(`read as ${role} failed — the policy raised rather than denying:\n${result.stderr}`);
  }
  const trimmed = result.stdout.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
}

// =============================================================================
// PostgREST
// =============================================================================

function baseUrl(): string {
  return `http://127.0.0.1:${PROOF_PORT}`;
}

/** A token for the proof server: the proof's own secret, never the application's. */
function token(sub: string, role: 'app_member' | 'app_admin'): string {
  return mintToken(PROOF_JWT_SECRET, { sub, role });
}

/**
 * `jwt-role-claim-key` must be a JSPath. The bare claim name `"role"` makes
 * PostgREST 16.4 PANIC on boot rather than fall back — verified: `failed to parse
 * role-claim-key value (role)`. `$.role` also panics on 16.4, so do not
 * "modernise" this value.
 *
 * `db-schemas = "public"` is load-bearing: the closure and the identity accessor
 * live in `authz` precisely because this is the only schema the API server serves.
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

/**
 * Refuse to start if the port is already answering.
 *
 * Without this the readiness probe below succeeds against somebody else's server —
 * a leftover instance or a developer's own — and the suite silently tests a database
 * it did not create. Every assertion either passes against the right schema or fails
 * confusingly, and the log line says "listening" either way.
 */
async function probePort(): Promise<string | undefined> {
  try {
    const response = await fetch(`${baseUrl()}/`, { signal: AbortSignal.timeout(2000) });
    return `an existing server answered GET / with HTTP ${response.status}`;
  } catch {
    return undefined;
  }
}

/**
 * The child environment, with every inherited `PGRST_*` override removed.
 *
 * `test/support/database.ts` imports the .env loader, so `PGRST_JWT_SECRET` from
 * `backend/.env` is in the parent environment — and PostgREST gives environment
 * variables precedence over the config file. The server would then verify tokens
 * against the application's secret while this suite mints them with the proof
 * secret, and every request fails at authentication with `PGRST301` before reaching
 * a single policy. The keys are DELETED rather than set to `undefined`, because
 * `spawn` stringifies env values and `undefined` would reach PostgREST as the
 * literal text "undefined".
 */
function proofChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('PGRST_')) {
      delete env[key];
    }
  }
  return {
    ...env,
    PGRST_DB_URI: `postgresql://pgrst_authenticator:${AUTHENTICATOR_PASSWORD}@localhost:5432/${PROOF_DB}`,
  };
}

async function startPostgrest(): Promise<() => void> {
  if (!existsSync(POSTGREST_BINARY)) {
    throw new Error(`${POSTGREST_BINARY} is not installed; the proof cannot run without a real PostgREST`);
  }

  const contention = await probePort();
  if (contention !== undefined) {
    throw new Error(
      `port ${PROOF_PORT} is already serving. This proof starts its own PostgREST and must not attach to another one.\n${contention}`,
    );
  }

  const directory = mkdtempSync(join(tmpdir(), 'w27-identity-pgrst-'));
  const config = writeConfig(directory);

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

  const stop = (): void => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
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
        return stop;
      }
    } catch {
      // Not listening yet. Retried until the deadline; never swallowed silently.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  stop();
  throw new Error(`PostgREST did not answer on port ${PROOF_PORT} within 30s:\n${log}`);
}

// =============================================================================
// The fixture
// =============================================================================

let seedRun: { readonly code: number; readonly output: string };
let stopPostgrest: (() => void) | undefined;

beforeAll(async () => {
  recreateDatabase(PROOF_DB);
  applyBaseline();
  seedRun = runSeed();

  await asAdmin(async (client) => {
    // The role first: `user_roles.role_id` is a real foreign key, so the role row
    // must exist before any membership references it. The ordering is a constraint,
    // not a style choice, and getting it wrong fails the FK.
    await client.query(
      `INSERT INTO roles (id, name, parent_id, is_system_role) VALUES ($1, 'nobody', NULL, false)
       ON CONFLICT (id) DO NOTHING`,
      [IDS.roles.nobody],
    );

    // Then the users. `selfMember`, `otherMember` and `purgeVictim` take the SEEDED
    // `member` role, which is the role a real member holds; `noReadUser` takes
    // `nobody`, which has no parent and therefore no inherited capability.
    //
    // The seeded `member` role id is read back rather than assumed, so this fixture
    // cannot drift from the seed's role graph.
    const roles = await client.query<{ name: string; id: string }>(
      `SELECT name, id FROM roles WHERE name IN ('member', 'nobody')`,
    );
    const memberRole = roles.rows.find((row) => row.name === 'member')?.id;
    if (memberRole === undefined) {
      throw new Error('the seeded `member` role is absent, so the self-read positive case cannot run');
    }

    for (const [user, username, role] of [
      [IDS.users.selfMember, 'identity-self', memberRole],
      [IDS.users.otherMember, 'identity-other', memberRole],
      [IDS.users.purgeVictim, 'identity-purge', memberRole],
      [IDS.users.noReadUser, 'identity-noread', IDS.roles.nobody],
    ] as const) {
      await client.query(
        `INSERT INTO users (id, username, email, password_hash) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [user, username, `${username}@example.test`, PROBE_HASH],
      );
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        user,
        role,
      ]);
    }
  });

  // Membership, through the OWNER: `0001` grants no write on `user_groups` to any
  // serving role, and that refusal is the control that fails open if forgotten. The
  // seed's `grantSeedAccess()` widens it for `app_admin` as a provisioning step, and
  // this suite deliberately does not rely on that — the owner is the sanctioned
  // writer on every database, seeded or not.
  await asOwner(async (client) => {
    await client.query(`INSERT INTO groups (id, name) VALUES ($1, 'identity-EU'), ($2, 'identity-US') ON CONFLICT DO NOTHING`, [
      IDS.groups.eu,
      IDS.groups.us,
    ]);
    for (const [user, group] of [
      [IDS.users.selfMember, IDS.groups.eu],
      [IDS.users.otherMember, IDS.groups.eu],
      [IDS.users.noReadUser, IDS.groups.eu],
      [IDS.users.purgeVictim, IDS.groups.us],
    ] as const) {
      await client.query('INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        user,
        group,
      ]);
    }
  });

  stopPostgrest = await startPostgrest();
}, TIMEOUT);

afterAll(() => {
  // `database/seed.ts` runs a CLUSTER-scoped `ALTER ROLE … PASSWORD`, so the cluster
  // is restored in a `finally`: it is the one step that must not be skipped, and it
  // must not sit behind the drop above. Stopping PostgREST first is what lets the
  // DROP terminate cleanly rather than fail naming a connection.
  try {
    stopPostgrest?.();
  } finally {
    try {
      dropProofDatabase();
    } finally {
      restoreAuthenticatorPassword();
    }
  }
});

// =============================================================================
// 1, 2 — the self-read: permitted, and refused for everybody else
// =============================================================================

describe('users · a member reads their own row and nobody else\'s', () => {
  it(
    'a member CAN read their own users row through PostgREST',
    async () => {
      // The case every denial-only suite is missing. Without it, a policy that
      // refuses everyone would pass every other test in this file.
      const response = await request(
        `${baseUrl()}/users?select=id,username,email&order=username`,
        token(IDS.users.selfMember, 'app_member'),
      );

      expect(response.status, `self-read returned ${response.status}: ${response.body}`).toBe(200);
      const rows = parseJsonArray(response.body);

      // Membership, not a count: a filter returning a different row of the same
      // length would satisfy a count, and this file is about WHICH row comes back.
      expect(rows.map((row) => String(row['id']))).toEqual([IDS.users.selfMember]);
      expect(rows.map((row) => String(row['username']))).toEqual(['identity-self']);

      // And the `password_hash` key is absent from the response, not merely null —
      // a column that came back with its value nulled would satisfy a `toBeNull`
      // and still be a leak of the column's existence.
      expect(Object.keys(rows[0] ?? {})).not.toContain('password_hash');
    },
    TIMEOUT,
  );

  it(
    'a member CANNOT read a colleague in their OWN group — zero rows, and the colleague is absent from the body',
    () => {
      // Same group on purpose: the attack is "somebody else", not "another tenant".
      // A policy that widened to group scope would still be caught here, and one
      // that only answered "not my tenant" would pass it.
      const visible = readAsRole<{ id: string; username: string }>(
        'app_member',
        IDS.users.selfMember,
        'SELECT id, username FROM users ORDER BY username',
      );

      // THE COUNT, which is the load-bearing assertion. AGENTS.md §B2: a correct
      // denial, a full `USING (true)` leak and a partial leak were ALL HTTP 200 in
      // the measurement this suite is built on, so a status-only test passes on a
      // real leak.
      expect(visible).toHaveLength(1);
      expect(visible.map((row) => row.id)).toEqual([IDS.users.selfMember]);

      // The colleague's identity by name as well, so a partial leak that kept the
      // right row COUNT cannot pass either.
      expect(JSON.stringify(visible)).not.toContain(IDS.users.otherMember);
      expect(JSON.stringify(visible)).not.toContain('identity-other');

      // A direct, single-row fetch of the colleague is the same denial. An
      // unfiltered-vs-filtered distinction matters here: a FILTERED count cannot
      // distinguish "the row is hidden from me" from "the row does not exist", so
      // the ground truth below is read by a superuser.
      const colleague = readAsRole<{ id: string }>(
        'app_member',
        IDS.users.selfMember,
        `SELECT id FROM users WHERE id = '${IDS.users.otherMember}'`,
      );
      expect(colleague).toEqual([]);

      // Ground truth: the row IS there, so the denials above are denials and not an
      // empty fixture.
      const groundTruth = superuserRows<{ count: number }>(
        `SELECT count(*)::int AS count FROM users WHERE id = '${IDS.users.otherMember}'`,
      );
      expect(groundTruth[0]?.count).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'a member CANNOT read a member of a group they do not belong to either — the unrelated-tenant case',
    () => {
      // `purgeVictim` is in US and `selfMember` in EU. Distinct from the colleague
      // case above, so a regression that widened scope to "the whole tree" and one
      // that widened it to "my own group" cannot both pass.
      const visible = readAsRole<{ id: string }>(
        'app_member',
        IDS.users.selfMember,
        `SELECT id FROM users WHERE id = '${IDS.users.purgeVictim}'`,
      );
      expect(visible).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'a member whose role resolves NO user:read reads zero rows, INCLUDING their own — the capability axis is present, not decorative',
    () => {
      // Without this, "the member reads themselves" could be passing on the scope
      // branch alone with `authz.can_read_user()` never consulted. This is the
      // cross-axis case: `noReadUser` is in the caller's own group scope by
      // construction (it IS the caller), so only the capability conjunct can deny.
      const visible = readAsRole<{ id: string }>(
        'app_member',
        IDS.users.noReadUser,
        'SELECT id FROM users',
      );
      expect(visible).toEqual([]);

      // Ground truth again: the row exists and the caller is the one it names.
      const groundTruth = superuserRows<{ count: number }>(
        `SELECT count(*)::int AS count FROM users WHERE id = '${IDS.users.noReadUser}'`,
      );
      expect(groundTruth[0]?.count).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'the `member` role resolves user:read through roles.parent_id even though no role_permissions row names it',
    () => {
      // The positive case AGENTS.md §Capability insists on, and the reason NO seed
      // change accompanies this migration.
      //
      // The seeded grant table carries `user:read` for `admin` and `manager` and NOT
      // for `member`, so the obvious reading is that a member cannot read a user.
      // It can: `has_permission()` walks UP `roles.parent_id` and `member` →
      // `manager` → `admin`. A resolver that did NOT walk up — the documented,
      // measured one-level defect — would deny every member and this suite's
      // self-read case would be green for the wrong reason.
      //
      // Resolved here through the SHIPPED resolver over a real `user_roles` row,
      // not through a hand-rolled recursive CTE, so the assertion is about the
      // function the application calls.
      const members = superuserRows<{ name: string; user_id: string }>(
        `SELECT r.name, ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name = 'member'`,
      );
      expect(members.length, 'no member of the `member` role exists, so the case cannot run').toBeGreaterThan(0);

      for (const row of members) {
        const answer = superuserRows<{ holds: boolean }>(
          `SELECT has_permission('${row.user_id}', 'user', 'read') AS holds`,
        );
        expect(answer[0]?.holds, `the seeded \`member\` role does not resolve user:read for ${row.user_id}`).toBe(true);
      }

      // The negative half, so the loop above is not a tautology: a role with no
      // parent and no grants resolves false.
      const nobody = superuserRows<{ holds: boolean }>(
        `SELECT has_permission('${IDS.users.noReadUser}', 'user', 'read') AS holds`,
      );
      expect(nobody[0]?.holds, 'the `nobody` role resolves user:read, so the capability conjunct is not load-bearing').toBe(false);
    },
    TIMEOUT,
  );

  it(
    'a garbage or empty `sub` is a clean denial, not a 500, and does not break the admin',
    () => {
      // `authz.actor()` catches the cast. A policy that RAISES on caller input is a
      // denial-of-service surface and an oracle, and it used to yield HTTP 500
      // where the guarded form denies.
      for (const sub of ['', 'not-a-uuid', '{}', 'null']) {
        const visible = readAsRole<{ id: string }>('app_member', sub, 'SELECT id FROM users');
        expect(visible, `a sub of ${JSON.stringify(sub)} returned rows`).toEqual([]);
      }

      // And the admin branch is untouched by a malformed identity.
      const admin = readAsRole<{ id: string }>('app_admin', 'not-a-uuid', 'SELECT id FROM users');
      expect(admin.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 3, 4 — what must stay denied, and what must not
// =============================================================================

describe('users · password_hash is unreachable by a member and essential to the admin', () => {
  it(
    'a member CANNOT obtain password_hash by naming it, by `select=*`, or by counting rows',
    async () => {
      const member = token(IDS.users.selfMember, 'app_member');

      // Named directly.
      const explicit = await request(`${baseUrl()}/users?select=password_hash`, member);
      expect(explicit.body).not.toContain(PROBE_HASH);
      expect(explicit.body).not.toContain('password_hash');

      // The wildcard, which a column-restricted role cannot use. Asserted on the
      // body rather than the status for the same reason as everywhere else: the
      // grant is the control, and a status code cannot show that the VALUE did not
      // come back.
      const wildcard = await request(`${baseUrl()}/users?select=*`, member);
      expect(wildcard.body).not.toContain(PROBE_HASH);

      // No `select` parameter at all, which PostgREST expands to `select=*`. This is
      // the one a client would actually send, and it is the case the migration's
      // "what this costs the client" section is about.
      const bare = await request(`${baseUrl()}/users`, member);
      expect(bare.body).not.toContain(PROBE_HASH);

      // And the SQL path, which is where a leak would be unambiguous: a
      // column-restricted role cannot name the column at all.
      const viaSql = readAsRole<{ id: string }>(
        'app_member',
        IDS.users.selfMember,
        'SELECT id FROM users',
      );
      expect(JSON.stringify(viaSql)).not.toContain(PROBE_HASH);
    },
    TIMEOUT,
  );

  it(
    'app_member cannot read password_hash from the CATALOG, and app_admin keeps it — the superset, not a bypass',
    async () => {
      // The control, read from `pg_class`/`pg_attribute` rather than from one
      // consequence of it.
      for (const role of ['app_anon', 'app_member', 'pgrst_authenticator']) {
        const readable = superuserRows<{ readable: boolean }>(
          `SELECT has_column_privilege('${role}', 'public.users', 'password_hash', 'SELECT') AS readable`,
        );
        expect(readable[0]?.readable, `${role} can read users.password_hash`).toBe(false);
      }

      // app_admin is asserted separately rather than swept into the loop: it holds
      // TABLE-level SELECT, which is the definition of a superset over a bypass —
      // the admin is wider everywhere, not narrower somewhere by accident.
      //
      // And it is load-bearing, not merely permitted: `src/auth/auth.service.ts:425`
      // and `:433` read `id, username, password_hash FROM users` on the login and
      // refresh paths. Narrowing the admin here breaks authentication outright.
      for (const role of ['app_admin']) {
        const readable = superuserRows<{ readable: boolean }>(
          `SELECT has_column_privilege('${role}', 'public.users', 'password_hash', 'SELECT') AS readable`,
        );
        expect(readable[0]?.readable, `${role} cannot read users.password_hash`).toBe(true);
      }

      // And the positive case over the wire: the admin's own row comes back with
      // the hash intact.
      const admin = token(IDS.users.selfMember, 'app_admin');
      const response = await request(`${baseUrl()}/users?select=username,password_hash`, admin);
      expect(response.status, `admin read returned ${response.status}: ${response.body}`).toBe(200);
      expect(response.body).toContain(PROBE_HASH);
    },
    TIMEOUT,
  );

  it(
    'the readable columns still work, so the restriction is a restriction and not a lockout',
    async () => {
      const member = token(IDS.users.selfMember, 'app_member');
      const allowed = await request(`${baseUrl()}/users?select=id,username,email,created_at`, member);

      expect(allowed.status, `permitted columns returned ${allowed.status}: ${allowed.body}`).toBe(200);
      const rows = parseJsonArray(allowed.body);
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['created_at', 'email', 'id', 'username']);
    },
    TIMEOUT,
  );

  it(
    'app_member holds NO table-level write verb on users — and the two columns 0026 granted are a COLUMN grant, not a verb',
    () => {
      // Asserted per role, and read from `pg_class`, which is TABLE-level: a column privilege
      // does not answer true there. That distinction is the whole content of this case now.
      //
      // `0026_member_self_write.sql` grants `app_member` `UPDATE (first_name, last_name)` so a
      // member's own name write is the policy's decision rather than the service's `WHERE`.
      // That is the change `0008:457-464` predicted and deferred — a per-column `UPDATE` grant
      // AND a `WITH CHECK` pinning `id` — and it is now shipped. It is NOT a table-level
      // `UPDATE`, which is why the loop below still holds and why erasure is still not
      // reachable as a member write: `0008`'s `ON DELETE CASCADE` reaches `email_messages` and
      // `refresh_tokens` (`0015`), which no serving role may otherwise destroy.
      //
      // `test/rls/member-self-write.spec.ts` proves the column grant's exact shape from
      // `pg_attribute`'s ACL; asserting the same list here would be a second copy of one fact.
      // What is asserted here is the DENIAL, plus the fact that the grant that arrived later
      // is a column grant — because that is the only reading under which the loop is a
      // meaningful assertion rather than a coincidence.
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        const holds = superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_member', 'public.users', '${privilege}') AS holds`,
        );
        expect(holds[0]?.holds, `app_member holds table-level ${privilege} on users`).toBe(false);
      }

      const writable = superuserRows<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM pg_attribute a,
                aclexplode(coalesce(a.attacl, acldefault('c', a.attrelid))) AS priv
           JOIN pg_roles r ON r.oid = priv.grantee
          WHERE a.attrelid = 'public.users'::regclass
            AND a.attnum > 0
            AND NOT a.attisdropped
            AND r.rolname = 'app_member'
            AND priv.privilege_type = 'UPDATE'`,
      );
      expect(
        writable[0]?.count,
        'app_member holds UPDATE on some number of users columns other than exactly two',
      ).toBe(2);

      // And the admin keeps all four, which is what the login and provisioning
      // paths write through.
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const holds = superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_admin', 'public.users', '${privilege}') AS holds`,
        );
        expect(holds[0]?.holds, `app_admin is missing ${privilege} on users`).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    'app_admin retains full read of users — all rows, every column, over the wire',
    async () => {
      const admin = token(IDS.users.selfMember, 'app_admin');
      const response = await request(`${baseUrl()}/users?select=id,username,password_hash&order=username`, admin);

      expect(response.status, `admin read returned ${response.status}: ${response.body}`).toBe(200);
      const rows = parseJsonArray(response.body);

      // EVERY row in the database, not just the admin's own — the admin branch is
      // `current_user = 'app_admin'`, not an identity predicate. The ground truth is
      // the WHOLE table rather than the probe rows, because the seeded `admin` user
      // is in it too and counting only the probes would let a policy that showed the
      // four fixture rows and nothing else pass.
      const groundTruth = superuserRows<{ count: number }>(
        `SELECT count(*)::int AS count FROM users`,
      );
      expect(rows).toHaveLength(groundTruth[0]?.count ?? 0);
      expect(rows.length).toBeGreaterThan(1);

      // And the seeded administrator is among them, by name: an admin that could
      // read only the probe rows would satisfy the count above on a smaller fixture
      // and pass for the wrong reason.
      expect(rows.map((row) => String(row['username']))).toContain('admin');
    },
    TIMEOUT,
  );
});

// =============================================================================
// 5, 6 — the two foreign keys
// =============================================================================

describe('0008 · user_roles and user_groups cannot name a user that does not exist', () => {
  it(
    'both constraints exist, point at users(id), and are ON DELETE CASCADE',
    () => {
      // Read from `pg_constraint`, which gives BOTH sides of the reference directly.
      // The information_schema shape needs a second join to reach the REFERENCED
      // table, and getting that join wrong names the referencing table twice — which
      // is how a test ends up asserting `user_roles.user_id` references
      // `user_roles.user_id` and proving nothing.
      const foreignKeys = superuserRows<{
        referencing: string;
        referenced: string;
        column: string;
        on_delete: string;
      }>(
        `SELECT child.relname AS referencing,
                parent.relname AS referenced,
                (SELECT string_agg(a.attname::text, ',' ORDER BY a.attname)
                   FROM unnest(c.conkey) AS k(attnum)
                   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS column,
                c.confdeltype AS on_delete
           FROM pg_constraint c
           JOIN pg_class child ON child.oid = c.conrelid
           JOIN pg_class parent ON parent.oid = c.confrelid
           JOIN pg_namespace n ON n.oid = child.relnamespace
          WHERE n.nspname = 'public'
            AND child.relname IN ('user_roles', 'user_groups')
            AND c.contype = 'f'
            AND parent.relname = 'users'
          ORDER BY child.relname`,
      );

      // `a` is NO ACTION and `c` is CASCADE in pg_constraint.confdeltype. Asserting
      // the letter rather than the word is deliberate: it is what the catalog
      // actually stores, so a rewrite of the constraint to `SET NULL` or `RESTRICT`
      // fails here rather than reading as a synonym.
      expect(foreignKeys).toEqual([
        { referencing: 'user_groups', referenced: 'users', column: 'user_id', on_delete: 'c' },
        { referencing: 'user_roles', referenced: 'users', column: 'user_id', on_delete: 'c' },
      ]);
    },
    TIMEOUT,
  );

  it(
    'an INSERT naming a non-existent user_id is refused with 23503 on BOTH tables',
    async () => {
      // The SQLSTATE, not the message and not a boolean. A missing GRANT also raises
      // `42501`, so a denial that cannot name its code could be the grant layer
      // rather than the constraint.
      const ghost = '99999999-9999-9999-9999-999999999999';

      const roles = await attemptAsAdmin(
        `INSERT INTO user_roles (user_id, role_id) VALUES ('${ghost}', (SELECT id FROM roles WHERE name = 'admin'))`,
      );
      expect(roles.ok, `the orphan user_roles insert succeeded: ${roles.message ?? ''}`).toBe(false);
      expect(roles.code, `expected 23503, got ${roles.code ?? 'none'}: ${roles.message ?? ''}`).toBe('23503');
      expect(roles.message ?? '').toContain('user_roles_user_id_fkey');

      // `user_groups` is written by the OWNER on a migrations-only database and by
      // `app_admin` after the seed's `grantSeedAccess()`. The owner is the
      // sanctioned writer on every database, so the probe uses it and the
      // assertion is about the constraint rather than about which grant is present.
      const owner = ownerClient();
      await owner.connect();
      let groupsCode: string | undefined;
      let groupsMessage: string | undefined;
      try {
        await owner.query('BEGIN');
        await owner.query(
          `INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)`,
          [ghost, IDS.groups.eu],
        );
        await owner.query('COMMIT');
      } catch (error) {
        await owner.query('ROLLBACK').catch(() => undefined);
        const pgError = error as { code?: unknown; message?: unknown };
        groupsCode = typeof pgError.code === 'string' ? pgError.code : undefined;
        groupsMessage = typeof pgError.message === 'string' ? pgError.message : undefined;
      } finally {
        await owner.end();
      }

      expect(groupsCode, `the orphan user_groups insert succeeded: ${groupsMessage ?? ''}`).toBe('23503');
      expect(groupsMessage ?? '').toContain('user_groups_user_id_fkey');

      // And nothing was written: a refused constraint leaves no row, but the check
      // is here because "the statement failed" and "the statement failed and wrote
      // nothing" are different facts.
      const rows = superuserRows<{ count: number }>(
        `SELECT (SELECT count(*)::int FROM user_roles WHERE user_id = '${ghost}')
              + (SELECT count(*)::int FROM user_groups WHERE user_id = '${ghost}') AS count`,
      );
      expect(rows[0]?.count).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'deleting a user takes the role row and the membership row with it — the purge cannot leave a principal behind',
    async () => {
      const victim = IDS.users.purgeVictim;

      // Ground truth BEFORE, so the assertion afterwards is a change and not a
      // fixture that happened to be empty.
      const before = superuserRows<{ user_roles: number; user_groups: number }>(
        `SELECT (SELECT count(*)::int FROM user_roles  WHERE user_id = '${victim}') AS user_roles,
                (SELECT count(*)::int FROM user_groups WHERE user_id = '${victim}') AS user_groups`,
      );
      expect(before[0]?.user_roles).toBe(1);
      expect(before[0]?.user_groups).toBe(1);

      // The purge itself, through the escalation boundary — the shape a purge
      // feature would use.
      const deleted = await attemptAsAdmin(`DELETE FROM users WHERE id = '${victim}'`);
      expect(deleted.ok, `the delete failed: ${deleted.code ?? ''} ${deleted.message ?? ''}`).toBe(true);

      // AFTER, counted as a superuser so the count cannot be a visibility artefact.
      // "The DELETE succeeded" is true whether or not the cascade fired, which is
      // why the assertion is on the membership rows rather than on the statement.
      const after = superuserRows<{
        users: number;
        user_roles: number;
        user_groups: number;
        still_visible: number;
      }>(
        `SELECT (SELECT count(*)::int FROM users       WHERE id = '${victim}') AS users,
                (SELECT count(*)::int FROM user_roles  WHERE user_id = '${victim}') AS user_roles,
                (SELECT count(*)::int FROM user_groups WHERE user_id = '${victim}') AS user_groups,
                (SELECT count(*)::int FROM authz.visible_user_ids()) AS still_visible`,
      );
      expect(after[0]?.users).toBe(0);
      expect(after[0]?.user_roles, 'the purged user kept its role row, so has_permission still resolves them').toBe(0);
      expect(after[0]?.user_groups, 'the purged user kept its membership row, so visible_user_ids still returns them').toBe(0);

      // The consequence the whole change exists for, asserted through the SHIPPED
      // helper rather than by counting a table: with no membership row left,
      // `authz.visible_user_ids()` cannot return the purged id to anybody.
      expect(JSON.stringify(after)).not.toContain(victim);

      // Recreate the victim so the later cases that count probe users still see a
      // stable fixture. `user_roles` and `user_groups` are NOT recreated — leaving
      // them absent is the point, and re-adding them would test nothing.
      await asAdmin(async (client) => {
        await client.query(
          `INSERT INTO users (id, username, email, password_hash) VALUES ($1, 'identity-purge', 'identity-purge@example.test', $2)
           ON CONFLICT (id) DO NOTHING`,
          [victim, PROBE_HASH],
        );
      });
    },
    TIMEOUT,
  );

  it(
    'the FK terminates at a table members cannot write to, which is what makes it legal',
    () => {
      // AGENTS.md §B2's FK discipline, asserted per role. FK checks bypass RLS and
      // fail OPEN, so an FK is an existence oracle over `users.id` — `23503` versus
      // success reveals any id, in scope or not. The mitigation the rule names is
      // that the FK terminate at a table members cannot WRITE to, so the oracle is
      // not reachable by the member role at all.
      //
      // **READ `users_update` IS NOT A WRITE PATH INTO EITHER MEMBERSHIP TABLE**, and
      // `0026` is what made that worth saying rather than assuming. `app_member` holds
      // `UPDATE (first_name, last_name)` on its own row, and `users_update` admits that
      // row — but the oracle is about naming a `user_id` or a `role_id` that belongs to
      // somebody else, and the two membership tables are UNSCOPED reference data
      // (`AGENTS.md` §B2's category table) on which no serving role holds INSERT,
      // UPDATE or DELETE at all (`0001:1009-1019`). Writing the display name on your
      // own identity row cannot name another id.
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
        const holds = superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_member', 'public.users', '${privilege}') AS holds`,
        );
        expect(
          holds[0]?.holds,
          `app_member can ${privilege} users, so the FK is a write path into identity`,
        ).toBe(false);
      }

      // The oracle is still vacuous for the admin, because it can read the whole
      // table anyway. Asserted, because "it can read users anyway" is the entire
      // argument and an unasserted argument is not one.
      const adminReads = superuserRows<{ holds: boolean }>(
        `SELECT has_table_privilege('app_admin', 'public.users', 'SELECT') AS holds`,
      );
      expect(adminReads[0]?.holds, 'app_admin cannot read users, so the FK oracle is a disclosure for it too').toBe(true);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 7 — the grant order, both of them
// =============================================================================

describe('users · the column grant only hides a column because the table grant was taken away first', () => {
  it(
    'IS readable when a column revoke is issued while a table-level SELECT exists',
    async () => {
      // This test asserts the FAIL-OPEN behaviour, on purpose, in a transaction that
      // is always rolled back. It is the regression guard for the grant-order
      // comment in the migration: a column privilege can only narrow a table grant
      // that has already been taken away. It cannot subtract from one.
      const owner = ownerClient();
      await owner.connect();
      try {
        await owner.query('BEGIN');
        try {
          await owner.query('GRANT SELECT ON public.users TO app_member');
          await owner.query('REVOKE SELECT (password_hash) ON public.users FROM app_member');

          const readable = await owner.query<{ readable: boolean }>(
            `SELECT has_column_privilege('app_member', 'public.users', 'password_hash', 'SELECT') AS readable`,
          );

          // Fully readable. The revoke was accepted, exited 0, and did nothing.
          expect(readable.rows[0]?.readable).toBe(true);
        } finally {
          await owner.query('ROLLBACK');
        }
      } finally {
        await owner.end();
      }
    },
    TIMEOUT,
  );

  it(
    'is NOT readable with the order the migration uses — so the two tests cannot both be right',
    async () => {
      // The order `0008_user_identity.sql` writes: REVOKE ALL → verb grants →
      // table-level REVOKE SELECT → column list.
      const owner = ownerClient();
      await owner.connect();
      try {
        await owner.query('BEGIN');
        try {
          await owner.query('GRANT SELECT ON public.users TO app_member');
          await owner.query('REVOKE SELECT ON public.users FROM app_member');
          await owner.query('GRANT SELECT (id, username, email, created_at) ON public.users TO app_member');

          const readable = await owner.query<{ readable: boolean }>(
            `SELECT has_column_privilege('app_member', 'public.users', 'password_hash', 'SELECT') AS readable`,
          );
          expect(readable.rows[0]?.readable).toBe(false);

          // The permitted columns are still readable, so the order narrows rather
          // than locks out.
          const permitted = await owner.query<{ readable: boolean }>(
            `SELECT has_column_privilege('app_member', 'public.users', 'username', 'SELECT') AS readable`,
          );
          expect(permitted.rows[0]?.readable).toBe(true);
        } finally {
          await owner.query('ROLLBACK');
        }
      } finally {
        await owner.end();
      }
    },
    TIMEOUT,
  );
});

// =============================================================================
// 8, 9 — structure, from the catalog
// =============================================================================

describe('0008 · the self-read policy is one total predicate per verb, not four guesses', () => {
  it(
    'there are exactly four policies, one per operation the table needs',
    () => {
      // `pg_policies` puts a `FOR INSERT` policy's predicate in `with_check` and leaves
      // `qual` NULL, because an INSERT has no existing rows for `USING` to filter —
      // which is why the assertion below reads whichever column the verb uses rather
      // than assuming one of them. The set is asserted BY NAME: a policy added to
      // make a feature work and left behind after the feature is gone is invisible
      // to a count.
      const policies = superuserRows<{
        policyname: string;
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `SELECT policyname, cmd, qual, with_check FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'users' ORDER BY policyname`,
      );
      expect(policies.map((row) => `${row.policyname}:${row.cmd}`)).toEqual([
        'users_delete:DELETE',
        'users_insert:INSERT',
        'users_read_scope:SELECT',
        'users_update:UPDATE',
      ]);

      // The read predicate must hold BOTH axes, not either alone. Asserted on the
      // predicate text so a policy that drops the capability conjunct fails here.
      //
      // MATCHED CASE- AND CAST-INSENSITIVELY, and that is not laziness: `pg_policies`
      // returns the deparsed and normalised expression, so the shipped text
      // `current_user = 'app_admin'` comes back as
      // `CURRENT_USER = 'app_admin'::name`. Asserting the literal spelling would
      // fail on a correct policy and would not notice a policy keyed on a token
      // field instead — which is the thing this assertion exists to catch.
      const adminBranch = /current_user\s*=\s*'app_admin'/i;
      const read = policies.find((row) => row.cmd === 'SELECT');
      expect(read?.qual ?? '').toContain('authz.can_read_user()');
      expect(read?.qual ?? '').toContain('authz.actor()');
      expect(read?.qual ?? '', 'the read policy is not keyed on current_user').toMatch(adminBranch);

      // Every write verb is keyed on `current_user`, never on a token field. A
      // member who forges `"role":"app_admin"` into their own validly-signed token
      // gets nothing from these.
      for (const cmd of ['INSERT', 'UPDATE', 'DELETE']) {
        const write = policies.find((row) => row.cmd === cmd);
        const predicate = `${write?.qual ?? ''} ${write?.with_check ?? ''}`;
        expect(predicate, `the ${cmd} policy is not keyed on current_user`).toMatch(adminBranch);
      }
    },
    TIMEOUT,
  );

  it(
    'users is ENABLEd and FORCEd, because an un-FORCEd table reads as every row to its owner with no warning',
    () => {
      const posture = superuserRows<{ enabled: boolean; forced: boolean }>(
        `SELECT c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'users'`,
      );
      expect(posture[0]?.enabled).toBe(true);
      expect(posture[0]?.forced).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'authz.can_read_user is no-argument, not executable by PUBLIC, and executable by every role whose requests evaluate the policy',
    () => {
      // Postgres grants EXECUTE to PUBLIC on every new function, and a SECURITY
      // DEFINER helper reachable anonymously is a privilege escalation rather than a
      // read leak.
      const publicExecute = superuserRows<{ may: boolean }>(
        `SELECT has_function_privilege('public', p.oid, 'EXECUTE') AS may
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'authz' AND p.proname = 'can_read_user'`,
      );
      expect(publicExecute).toHaveLength(1);
      expect(publicExecute[0]?.may, 'can_read_user is executable by PUBLIC').toBe(false);

      // `app_anon` IS granted EXECUTE, and it is not a preference: a policy
      // expression is evaluated for EVERY role that reaches the table, so without it
      // an unauthenticated read fails with `permission denied for function` — a
      // denial-of-service surface and an oracle that names the policy.
      for (const role of ['app_anon', 'app_member', 'app_admin']) {
        const may = superuserRows<{ may: boolean }>(
          `SELECT has_function_privilege('${role}', p.oid, 'EXECUTE') AS may
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'authz' AND p.proname = 'can_read_user'`,
        );
        expect(may[0]?.may, `${role} cannot execute can_read_user, so a scoped read would error`).toBe(true);
      }

      // The disclosure half: no `who` parameter, so a caller can only ever ask about
      // itself. Asserted from the signature rather than the comment.
      const args = superuserRows<{ args: number }>(
        `SELECT p.pronargs AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'authz' AND p.proname = 'can_read_user'`,
      );
      expect(args[0]?.args).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'the scoping subquery runs ONCE per statement and the capability check is called once — not once per row',
    () => {
      // The performance claim, assertable rather than asserted. A `STABLE` function in
      // a qual alongside a column reference is evaluated once per CANDIDATE ROW, not
      // once per statement: `email_messages` measured 1 call inside its subquery
      // against 3,300 beside it at 3,300 rows, and the withdrawn per-row walk ran
      // 400,001 times over 400,000 rows.
      //
      // `pg_stat_user_functions` needs `track_functions` on, so the database is set
      // to count. It is scoped to the throwaway database, so it is hermetic: any
      // session connecting here counts, and dropping the database takes the setting
      // with it.
      superuserExec(`ALTER DATABASE ${PROOF_DB} SET track_functions = 'all'`, 'postgres');
      psqlAsSuperuser(PROOF_DB, 'SELECT pg_stat_reset()');

      const plan = spawnSync(
        'sudo',
        ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', PROOF_DB],
        {
          encoding: 'utf8',
          input: [
            'BEGIN;',
            'SET LOCAL ROLE app_member;',
            `SELECT set_config('request.jwt.claims', '${claims(IDS.users.selfMember, 'app_member')}', true) \\g /dev/null`,
            'EXPLAIN (ANALYZE, COSTS OFF, FORMAT TEXT) SELECT count(*) FROM users;',
            'COMMIT;',
          ].join('\n'),
        },
      );
      expect(plan.status, `EXPLAIN failed:\n${plan.stderr}`).toBe(0);
      const explain = plan.stdout;

      expect(explain, `no SubPlan in the plan:\n${explain}`).toContain('SubPlan');
      const loops = [...explain.matchAll(/SubPlan \d+[\s\S]*?loops=(\d+)/g)].map((match) => match[1]);
      expect(loops.length).toBeGreaterThan(0);
      for (const loop of loops) {
        expect(Number(loop), `the scoping subplan ran ${loop} times, not once`).toBe(1);
      }

      // The sharper assertion: the capability resolution must not be per-row either.
      // `pg_stat_user_functions` has NO ROW for a function that was never called, so
      // a missing row means zero — and reading it as `undefined` is what makes such
      // an assertion read as a broken measurement rather than as the tamper it
      // actually caught.
      const calls = superuserRows<{ funcname: string; calls: number }>(
        `SELECT funcname, coalesce(calls, 0)::int AS calls FROM pg_stat_user_functions
          WHERE funcname IN ('can_read_user', 'has_permission') ORDER BY funcname`,
      );
      const byName = new Map(calls.map((row) => [row.funcname, row.calls]));
      expect(
        byName.get('can_read_user') ?? 0,
        'can_read_user was not called once for the whole statement, so the capability conjunct is not in the plan',
      ).toBe(1);
      expect(
        byName.get('has_permission') ?? 0,
        'has_permission was not called once, so the capability axis is absent from the policy',
      ).toBe(1);
    },
    TIMEOUT,
  );

  it(
    're-applying every migration to a SEEDED database succeeds — the migration must not count orphans through an RLS-bound read',
    () => {
      // THE REGRESSION THIS FILE EXISTS MOST OF ALL FOR, and it was written after
      // the first draft of the migration failed on `app_dev`.
      //
      // That draft counted orphans before adding the constraints:
      //
      //   SELECT count(*) FROM user_roles ur
      //    WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ur.user_id)
      //
      // and it reported three orphans on a database with one perfectly valid
      // `users` row. The cause is the documented trap: a migration runs as the OWNER
      // of `users`, `users` is `FORCE ROW LEVEL SECURITY`, so the owner is bound by
      // `users_read_scope`, admits nothing without claims, and the `NOT EXISTS`
      // sees an EMPTY `users`. Every membership row then looks like an orphan and
      // the migration refuses to apply to a healthy database.
      //
      // `beforeAll` applies the baseline to an EMPTY database, which is a fresh
      // provision and has no membership rows to get wrong — so the whole suite was
      // green against a migration that cannot be deployed. This case runs the real
      // order: seed first (done in `beforeAll`), migrations second.
      const seeded = superuserRows<{ count: number }>(
        `SELECT (SELECT count(*)::int FROM users) + (SELECT count(*)::int FROM user_roles)
              + (SELECT count(*)::int FROM user_groups) AS count`,
      );
      // Ground truth: the database really is populated, read as a superuser so the
      // FORCE-RLS blindness cannot make this case pass for the wrong reason. That is
      // the same reason the whole file reads the catalog through `sudo -u postgres`.
      expect(
        seeded[0]?.count ?? 0,
        'the database is empty, so this case proves nothing about a seeded one',
      ).toBeGreaterThan(0);

      const reapplied = reapplyMigrations();
      expect(reapplied.code, `re-applying the migrations to a seeded database failed:\n${reapplied.output}`).toBe(0);

      // And the schema is still the shipped one afterwards — a re-application that
      // half-succeeded would leave the constraints and the policies in a state the
      // assertions above already ran against and would not notice.
      const foreignKeys = superuserRows<{ conname: string; validated: boolean }>(
        `SELECT conname, convalidated AS validated FROM pg_constraint
          WHERE conname IN ('user_roles_user_id_fkey', 'user_groups_user_id_fkey') ORDER BY conname`,
      );
      expect(foreignKeys).toEqual([
        { conname: 'user_groups_user_id_fkey', validated: true },
        { conname: 'user_roles_user_id_fkey', validated: true },
      ]);
    },
    TIMEOUT,
  );

  it(
    'the seed ran cleanly and every migration applied, so nothing above is testing a half-provisioned database',
    () => {
      // Every assertion above reads rows the fixture wrote. If the seed had failed,
      // the roles and the `member` role would be missing and the self-read case
      // would pass for the wrong reason — a capability system that denies everyone
      // looks exactly like one that works.
      expect(seedRun.code, `the seed failed:\n${seedRun.output}`).toBe(0);
      expect(seedRun.output).not.toContain('seed failed');
      expect(seedRun.output).toContain('seed complete.');

      // And the migration that carries both changes is in the ledger, so a database
      // whose schema has the constraints but whose ledger does not would be caught
      // here rather than by a re-run that tries to add them again.
      const applied = superuserRows<{ name: string }>(
        `SELECT name FROM migrations WHERE name = '0008_user_identity.sql'`,
      );
      expect(applied, '0008 is not recorded in the migrations ledger').toHaveLength(1);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 10 — the gate can fail
// =============================================================================

describe('0008 · the suite can fail: replace the policy and these tests go wrong, then restore it', () => {
  it(
    'dropping the capability conjunct admits a member holding no user:read, and the visible-users predicate admits a colleague',
    () => {
      // The control is proven, not trusted (AGENTS.md §B8). Two tampers, because the
      // two halves of the shipped predicate are separately load-bearing and one
      // tamper cannot show that.
      //
      // TAMPER 1 — drop the capability conjunct. The scope half is `id = actor()`,
      // so removing `can_read_user()` alone does not widen the row set for a member
      // who DOES hold the capability. What it does is admit the `nobody`-role user
      // to their own row, which is the case the conjunct exists to deny — and
      // asserting THAT is what proves the conjunct is a gate and not decoration.
      expect(readAsRole('app_member', IDS.users.noReadUser, 'SELECT id FROM users')).toEqual([]);

      superuserExec(
        `DROP POLICY users_read_scope ON public.users;
         CREATE POLICY users_read_scope ON public.users FOR SELECT USING (
           current_user = 'app_admin' OR id IN (SELECT authz.actor() AS actor_id))`,
      );

      try {
        const underTamper = readAsRole<{ id: string }>(
          'app_member',
          IDS.users.noReadUser,
          'SELECT id FROM users',
        );
        expect(
          underTamper.map((row) => row.id),
          'removing the capability conjunct did not admit the row, so the conjunct is not load-bearing',
        ).toEqual([IDS.users.noReadUser]);
      } finally {
        restoreReadPolicy();
      }

      // Restored, and proven by re-running the assertion that must fail again.
      expect(readAsRole('app_member', IDS.users.noReadUser, 'SELECT id FROM users')).toEqual([]);

      // TAMPER 2 — the realistic escalation: replace the self predicate with the
      // VISIBLE-USERS set, which is what a copy of the `email_messages` policy would
      // do. `otherMember` is in the caller's own group, so this admits a colleague —
      // the leak case 2 exists to catch.
      superuserExec(
        `DROP POLICY users_read_scope ON public.users;
         CREATE POLICY users_read_scope ON public.users FOR SELECT USING (
           current_user = 'app_admin'
           OR id IN (SELECT u.user_id FROM authz.visible_user_ids() AS u (user_id)
                      WHERE authz.can_read_user()))`,
      );

      try {
        const underVisibleUsers = readAsRole<{ id: string }>(
          'app_member',
          IDS.users.selfMember,
          'SELECT id FROM users ORDER BY id',
        );
        expect(
          underVisibleUsers.map((row) => row.id),
          'the visible_user_ids tamper did not admit the colleague, so it proves nothing',
        ).toContain(IDS.users.otherMember);
      } finally {
        restoreReadPolicy();
      }

      // And the shipped policy is back: the colleague is gone again.
      const restored = readAsRole<{ id: string }>(
        'app_member',
        IDS.users.selfMember,
        'SELECT id FROM users ORDER BY id',
      );
      expect(restored.map((row) => row.id)).toEqual([IDS.users.selfMember]);
    },
    TIMEOUT,
  );

  it(
    'dropping the foreign key lets an orphan membership row in, and re-adding it is what refuses that row',
    async () => {
      // The FK is the second control in this file, so it gets its own tamper. A
      // suite that passes whether or not the protection exists is the exact failure
      // the file exists to prevent.
      const ghost = '99999999-9999-9999-9999-999999999998';

      superuserExec(`ALTER TABLE public.user_groups DROP CONSTRAINT user_groups_user_id_fkey`);
      try {
        // With the key gone the insert lands, and a membership row naming a user
        // that does not exist is exactly the state the purge would leave behind.
        await asOwner(async (client) => {
          await client.query(`INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
            ghost,
            IDS.groups.eu,
          ]);
        });

        const inserted = superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM user_groups WHERE user_id = '${ghost}'`,
        );
        expect(inserted[0]?.count, 'the orphan row did not land, so this tamper proves nothing').toBe(1);
      } finally {
        superuserExec(`DELETE FROM public.user_groups WHERE user_id = '${ghost}'`);
        superuserExec(
          `ALTER TABLE public.user_groups
             ADD CONSTRAINT user_groups_user_id_fkey
             FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE`,
        );
      }

      // Restored, and the same insert is now refused.
      const owner = ownerClient();
      await owner.connect();
      let code: string | undefined;
      try {
        await owner.query('BEGIN');
        await owner.query(`INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)`, [ghost, IDS.groups.eu]);
        await owner.query('COMMIT');
      } catch (error) {
        await owner.query('ROLLBACK').catch(() => undefined);
        const pgError = error as { code?: unknown };
        code = typeof pgError.code === 'string' ? pgError.code : undefined;
      } finally {
        await owner.end();
      }
      expect(code, 'the restored constraint did not refuse the orphan').toBe('23503');
    },
    TIMEOUT,
  );
});

/**
 * Reinstates the shipped read policy, verbatim from the migration.
 *
 * A tamper that is not undone leaves the next assertion — and the next run —
 * testing a schema nobody shipped, so the restore is in a `finally` and the case
 * that follows re-runs the denial rather than trusting it.
 */
function restoreReadPolicy(): void {
  superuserExec(
    `DROP POLICY IF EXISTS users_read_scope ON public.users;
     CREATE POLICY users_read_scope ON public.users FOR SELECT USING (
       current_user = 'app_admin'
       OR id IN (SELECT authz.actor() AS actor_id WHERE authz.can_read_user()))`,
  );
}