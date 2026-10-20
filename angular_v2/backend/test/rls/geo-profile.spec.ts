import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';
import {
  describePostgrestStartupFailure,
  POSTGREST_STARTUP_TIMEOUT_MS,
  sleepSync,
  waitForPostgrest,
} from '../support/postgrest-startup.js';
import { mintToken, parseJsonArray, request } from './support/jwt.js';

/**
 * `0012_user_geo.sql` and `0013_company_profile.sql` — where a person is, where the
 * company is, and what may be concluded about either.
 *
 * ## What this suite is proving, and why the two migrations are in one file
 *
 * They are one story told in two migrations: **evidence has to be attributable, and
 * the predicate that acts on it has to be derived from something that is maintained
 * for a reason that is not compliance.**
 *
 *  * **0012 — provenance on a person's geography.** `geo_source` separates a machine's
 *    guess from a person's assertion, because those are not equivalent evidence when
 *    a statutory obligation is decided on them. The suite proves the member can READ
 *    its own geography (the disclosure is of their own data, and a subject who cannot
 *    read it cannot contest it) and can WRITE none of it — in particular cannot set
 *    `geo_source = 'admin_verified'` on their own row, which would be forging evidence
 *    about themselves into the one column whose entire purpose is to record who made a
 *    determination and how.
 *  * **0013 — the company's geography, and `ccpa_applicable()`.** The predicate is an
 *    `EXISTS` over several addresses, is deliberately an over-application of the
 *    statute, and is executable by `app_anon` because a disclosure owed to the public
 *    is not owed only to the signed-in.
 *
 * ## Every case is an attack or a hole, not a description
 *
 *  1. a member reads their OWN geography — the permitted case every denial-only suite
 *     is missing.
 *  2. a member reads a COLLEAGUE's geography and gets zero rows, asserted on the COUNT
 *     and on the colleague's absence from the body, never on the status (§B2: a correct
 *     denial, a full `USING (true)` leak and a partial leak were ALL HTTP 200).
 *  3. a member cannot write `geo_source = 'admin_verified'` on their own row — the
 *     forgery case — and the column is unchanged afterwards, read by a superuser.
 *  4. `app_member` holds no write verb on `users` at all, asserted per privilege and per
 *     role, because that grant IS the control rather than a comment about one.
 *  5. a GeoIP row carries a radius and a user-declared row does not, and the two are
 *     still distinguishable afterwards — the positive case, without which 3 is a policy
 *     that forbids everything.
 *  6. an EMPTY region is refused. The rejected library (`geoip-lite@2.0.0`) returned
 *     `region: ""` for 9 of 10 well-known US hosts, and an empty string is worse than
 *     NULL because it looks like an answer.
 *  7. a padded or lowercased region is refused, because `'CA ' <> 'CA'` is a silent
 *     under-application of the one predicate that matters.
 *  8. a fabricated accuracy radius on a user-declared region is refused, and provenance
 *     with no instant is refused.
 *  9. `region_code` is indexed for the California filter, and the index is PARTIAL.
 * 10. the company profile and its addresses are readable with NO TOKEN AT ALL, because
 *     that is what the about page and the contact footer are.
 * 11. a member cannot rewrite the company's registered address, and the row is unchanged
 *     afterwards.
 * 12. `ccpa_applicable()` is false with no addresses, false for a Delaware address, and
 *     — the case worth having — false for a CANADIAN address whose country code is the
 *     two letters `CA`, because `CA` is also the state and the predicate must not confuse
 *     them.
 * 13. a California address makes it true, and it is true for an ANONYMOUS caller, over
 *     both the SQL path and the RPC path.
 * 14. a SECOND California address makes it true while the first is somewhere else —
 *     `EXISTS`, not "the address".
 * 15. a US address with no state is refused at the boundary, because that is the row that
 *     would switch the predicate off without saying so.
 * 16. `ccpa_applicable()` is executable by `app_anon` and is NOT reachable through
 *     `PUBLIC`, read from `aclexplode` rather than inferred from a working call.
 * 17. the singleton index refuses a second `company_profile` row.
 * 18. the suite can fail: the predicate replaced by a constant `true` reports California
 *     for a Delaware address, and re-applying the migration restores it.
 *
 * ## The database
 *
 * A throwaway one, built by the REAL pipeline — the role bootstrap, every migration in
 * directory order (read from the directory, never a hand-kept list), then the real
 * `database/seed.ts` — so the policies, the grants and the seeded roles are genuinely in
 * force. It refuses the development database by name, and terminates stale backends
 * before dropping, because a leaked connection makes `DROP DATABASE` fail naming a
 * connection the operator cannot see (§B8).
 *
 * It runs the seed, which issues a CLUSTER-scoped `ALTER ROLE pgrst_authenticator
 * … PASSWORD`, so `afterAll` restores it — the wiring `rls.spec.ts` gates by scanning this
 * directory for the call rather than by a hand-written list.
 *
 * ## Why this suite starts its own PostgREST
 *
 * `support/fixture.ts`'s server points at `rls_proof`, which is built from `0001` alone —
 * a schema with no `users` table and no company tables at all. The launcher is duplicated
 * rather than shared for the same reason `email-messages.spec.ts`, `uuid-keys.spec.ts` and
 * `seed.spec.ts` each duplicate theirs: the duplicated part is the SMALL part (port guard,
 * `PGRST_*` stripping, readiness probe), and each of those three is a silent-failure trap
 * rather than plumbing.
 *
 * Port 3018, distinct from the shared fixture's 3016 and `user-identity.spec.ts`'s 3017.
 * The suites run in sequence (`fileParallelism: false`), so sharing would work today — but
 * a leftover PostgREST from a killed run would then make this suite attach to a server
 * serving a DIFFERENT database, and every assertion would either pass against the wrong
 * schema or fail for no readable reason.
 *
 * ## STATUS: THIS SUITE HAS NOT BEEN RUN
 *
 * It was written in the same change as the two migrations while other agents were working
 * concurrently against the same database, and the instruction for that work was that no
 * command touching Postgres may be run: two migrators applying files to one cluster
 * corrupt each other, and `test:rls` builds a throwaway database from every migration in
 * the directory. So these are UNRUN. They are written to be correct by construction —
 * fixtures, helpers and statements copied from the shipped suites rather than derived —
 * but "correct by construction" is a claim about the writing, not evidence, and the first
 * run against a real cluster is what will tell. Expect the ordinary first-run fixes.
 */

const TIMEOUT = 180_000;
const PROOF_DB = 'geo_profile_proof';
const PROOF_PORT = 3018;

/** The password this suite authenticates `pgrst_authenticator` with, read from config. */
const AUTHENTICATOR_PASSWORD = loadTestEnvironment().authenticator.password;

/** The signing secret for this suite's own PostgREST. Never the application's. */
const PROOF_JWT_SECRET = 'w28-geo-proof-signing-secret-0123456789ab';
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

/** Re-applies ONE migration as the owner role — the tamper restore. */
function applyMigration(name: string): { readonly code: number; readonly output: string } {
  const config = loadTestEnvironment().database;
  const result = spawnSync(
    'psql',
    [
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-h',
      config.host,
      '-U',
      config.user,
      '-d',
      PROOF_DB,
      '-f',
      join(MIGRATIONS_DIR, name),
    ],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: config.password } },
  );
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

// =============================================================================
// The fixture identities
// =============================================================================

/**
 * Fixed ids, because every assertion reads them.
 *
 *   group ──── selfMember  ── holds the seeded `member` role   ── the caller
 *           └─ otherMember ── holds the seeded `member` role   ── the colleague
 *
 * `selfMember` and `otherMember` are in the SAME group on purpose: the denial in case 2
 * is "somebody else", not "another tenant", so a policy that accidentally widened to
 * group scope would still be caught.
 */
const IDS = {
  groups: {
    eu: '77777777-0000-0000-0000-000000000001',
    us: '77777777-0000-0000-0000-000000000002',
  },
  users: {
    selfMember: '88888888-0000-0000-0000-000000000001',
    otherMember: '88888888-0000-0000-0000-000000000002',
  },
  /** The one company, in a migrations-only database nothing else creates. */
  company: 'aaaaaaaa-0000-0000-0000-000000000001',
} as const;

/** The hash written into every probe row, so a leak is unmistakable in a body. */
const PROBE_HASH = 'PROBE-SECRET-HASH-0012';

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

/** Superuser SQL, discarding output. One statement per call where DDL is involved. */
function superuserExec(sql: string, database: string = PROOF_DB): void {
  psqlAsSuperuser(database, sql);
}

/**
 * Superuser SQL returned as parsed JSON rows.
 *
 * EVERY ground-truth assertion in this file goes through here, and the reason is not
 * stylistic: under `FORCE`, a claimless owner read returns ZERO rows
 * (`AGENTS.md` §B5), so a count taken through an owner connection silently reads zero
 * forever and every denial assertion in the suite passes against an empty fixture.
 */
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
    throw new Error(`refusing to run the geo/profile proof against the development database (${name})`);
  }
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
      [
        '-v',
        'ON_ERROR_STOP=1',
        '-q',
        '-h',
        config.host,
        '-U',
        config.user,
        '-d',
        PROOF_DB,
        '-f',
        join(MIGRATIONS_DIR, migration),
      ],
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
      SEED_ADMIN_PASSWORD: 'geo-profile-proof-admin-password',
    },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
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

/** A client for the migration/owner role, the only writer of membership rows. */
function ownerClient(): Client {
  return new Client({ ...loadTestEnvironment().database, database: PROOF_DB });
}

/** Runs `work` as `role` through the boundary, in ONE transaction. */
async function asRole<T>(role: 'app_anon' | 'app_member' | 'app_admin', work: (client: Client) => Promise<T>): Promise<T> {
  const client = authenticatorClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
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

/** The same, for the OWNER — the sanctioned writer of membership on any database. */
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
 * One statement as `role`, reporting refusal rather than throwing.
 *
 * A helper that throws on failure cannot express the assertion that is the point of
 * most of this suite — "this is refused" — and reporting refusal as an exception tells
 * the caller nothing about WHICH refusal it was. The SQLSTATE is returned because
 * `42501` is also what a missing table grant raises, and a `42501` cannot distinguish
 * the grant layer from the policy; `23514` is a named CHECK and `23505` a unique index,
 * so those ARE distinguishable and are asserted by code.
 */
interface Attempt {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
}

async function attemptAs(role: 'app_anon' | 'app_member' | 'app_admin', sql: string): Promise<Attempt> {
  try {
    await asRole(role, async (client) => {
      await client.query(sql);
    });
    return { ok: true };
  } catch (error) {
    const pgError = error as { code?: unknown; message?: unknown };
    return {
      ok: false,
      code: typeof pgError.code === 'string' ? pgError.code : undefined,
      message: typeof pgError.message === 'string' ? pgError.message : undefined,
    };
  }
}

/**
 * A read as a serving role with `request.jwt.claims` in force, straight through SQL.
 *
 * Run as the cluster superuser because it is the only identity that can borrow a serving
 * role. `claims === undefined` is a case in itself — the shape where a policy used to
 * raise instead of denying.
 */
function readAsRole<T>(role: 'app_anon' | 'app_member' | 'app_admin', sub: string | undefined, sql: string): readonly T[] {
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
 * `jwt-role-claim-key` must be a JSPath. The bare claim name `"role"` makes PostgREST
 * 16.4 PANIC on boot rather than fall back — verified: `failed to parse role-claim-key
 * value (role)`. `$.role` also panics on 16.4, so do not "modernise" this value.
 *
 * `db-schemas = "public"` is load-bearing: the closure and the identity accessor live
 * in `authz` precisely because this is the only schema the API server serves — and it is
 * also why `ccpa_applicable()` is in `public`, so that `/rpc/ccpa_applicable` exists at
 * all.
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
 * Without this the readiness probe below succeeds against somebody else's server — a
 * leftover instance or a developer's own — and the entire suite silently tests a
 * database it did not create. Every assertion either passes against the right schema or
 * fails confusingly, and the log line says "listening" either way.
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
 * against the application's secret while this suite mints them with the proof secret,
 * and every request fails at authentication with `PGRST301` before reaching a single
 * policy. The keys are DELETED rather than set to `undefined`, because `spawn`
 * stringifies env values and `undefined` would reach PostgREST as the literal text
 * "undefined".
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

  const directory = mkdtempSync(join(tmpdir(), 'w28-geo-pgrst-'));
  const config = writeConfig(directory);

  const child: ChildProcess = spawn(POSTGREST_BINARY, [config], {
    env: proofChildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Retained rather than discarded: if PostgREST dies mid-suite, this is the log that
  // says why, and a security suite that swallows it cannot be debugged.
  // BOTH streams are captured: PostgREST writes some of its lines to stdout and
  // some to stderr, so a stderr-only capture loses exactly the lines that
  // explain a failure.
  let log = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    log += chunk.toString('utf8');
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    log += chunk.toString('utf8');
  });

  // A child that could not be started at all raises an `error` event, and an
  // unhandled one takes the test run down with an exception that names neither
  // the binary nor the port. It is captured here, and it reaches the message.
  let spawnError: string | undefined;
  child.on('error', (error: Error) => {
    spawnError = error.message;
    log += `\n[the child could not be started: ${error.message}]\n`;
  });

  const stop = (): void => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      const deadline = Date.now() + 5_000;
      while (child.exitCode === null && Date.now() < deadline) {
        sleepSync(100);
      }
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        sleepSync(200);
      }
    }
    rmSync(directory, { recursive: true, force: true });
  };

  // The shared wait: a generous ceiling and a message that says what the child
  // was doing. It used to be 30 seconds, which only fires when the machine is
  // busy — and when it fired, every test in the file was SKIPPED and the run
  // reported a count that did not add up.
  const outcome = await waitForPostgrest(baseUrl(), {
    timeoutMs: POSTGREST_STARTUP_TIMEOUT_MS,
    childGone: () => child.exitCode !== null || spawnError !== undefined,
  });

  if (outcome.ready) {
    return stop;
  }

  // The child is killed BEFORE the error is thrown, so a failed launch leaves
  // no orphan holding the port.
  stop();

  throw new Error(
    describePostgrestStartupFailure({
      port: PROOF_PORT,
      waitedMs: outcome.waitedMs,
      timeoutMs: POSTGREST_STARTUP_TIMEOUT_MS,
      child: { exitCode: child.exitCode, signal: child.signalCode, log, spawnError },
      probe: outcome.probe,
    }),
  );
}

// =============================================================================
// The fixture
// =============================================================================

let seedRun: { readonly code: number; readonly output: string };
let stopPostgrest: (() => void) | undefined;

/** One address, as the fixture writes it. `null` region is the "no subdivision" case. */
interface AddressFixture {
  readonly line1: string;
  readonly city: string;
  readonly region: string | null;
  readonly country: string;
  readonly kind: string;
  readonly isRegistered?: boolean;
}

/**
 * Replaces the whole address list in one transaction.
 *
 * Each address case sets up its own state rather than inheriting the previous case's,
 * because an ordered pile of shared mutations is a suite whose result depends on which
 * test ran first — and the tests here deliberately walk the predicate through false and
 * true, so inheriting would make every negative case pass for the wrong reason.
 */
async function replaceAddresses(rows: readonly AddressFixture[]): Promise<void> {
  await asRole('app_admin', async (client) => {
    await client.query('DELETE FROM company_addresses');
    for (const row of rows) {
      await client.query(
        `INSERT INTO company_addresses
           (company_profile_id, line1, city, region_code, country_code, kind, is_registered)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [IDS.company, row.line1, row.city, row.region, row.country, row.kind, row.isRegistered ?? false],
      );
    }
  });
}

/** `ccpa_applicable()` as the given role, through SQL. */
function ccpaApplicableAs(role: 'app_anon' | 'app_member' | 'app_admin'): boolean {
  const rows = readAsRole<{ applicable: boolean }>(
    role,
    undefined,
    'SELECT ccpa_applicable() AS applicable',
  );
  return rows[0]?.applicable === true;
}

beforeAll(async () => {
  recreateDatabase(PROOF_DB);
  applyBaseline();
  seedRun = runSeed();

  await asRole('app_admin', async (client) => {
    const roles = await client.query<{ name: string; id: string }>(
      `SELECT name, id FROM roles WHERE name = 'member'`,
    );
    const memberRole = roles.rows.find((row) => row.name === 'member')?.id;
    if (memberRole === undefined) {
      throw new Error('the seeded `member` role is absent, so the permitted member cases cannot run');
    }

    for (const [user, username] of [
      [IDS.users.selfMember, 'geo-self'],
      [IDS.users.otherMember, 'geo-other'],
    ] as const) {
      await client.query(
        `INSERT INTO users (id, username, email, password_hash) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [user, username, `${username}@example.test`, PROBE_HASH],
      );
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        user,
        memberRole,
      ]);
    }

    // THE COMPANY, which nothing else creates. 0013 deliberately seeds nothing: a
    // placeholder legal name in a migration is a placeholder that ships (§2.1). The
    // fixture writes one so the predicate cases have something to be about.
    await client.query(
      `INSERT INTO company_profile (id, legal_name, display_name, support_email, privacy_contact_email)
       VALUES ($1, 'Proof Trading Company Limited', 'Proof Trading', 'support@example.test',
               'privacy@example.test')
       ON CONFLICT (id) DO NOTHING`,
      [IDS.company],
    );

    // ONE ADDRESS, DELIBERATELY NOT IN CALIFORNIA. Both reasons are about assertions
    // being able to fail: the anonymous-read case needs a row to read rather than an
    // empty table that any policy would also produce, and the predicate starts from a
    // database that HOLDS AN ADDRESS and answers false — so the first `true` further down
    // is a change in the data rather than the fixture having been empty all along.
    await client.query(
      `INSERT INTO company_addresses (company_profile_id, line1, city, region_code, country_code, kind)
       VALUES ($1, '1 Invalidenstrasse', 'Berlin', 'BE', 'DE', 'headquarters')`,
      [IDS.company],
    );
  });

  // Geography for the two users, written by the admin because that is the only write
  // path `users` has (0008). The member's region is New York rather than California so
  // that nothing in this suite can be confused with the company predicate below.
  await asRole('app_admin', async (client) => {
    await client.query(
      `UPDATE users
          SET country_code = 'US', region_code = 'NY', city = 'Albany',
              geo_source = 'geoip', geo_accuracy_km = 25, geo_updated_at = now()
        WHERE id = $1`,
      [IDS.users.selfMember],
    );
    await client.query(
      `UPDATE users
          SET country_code = 'DE', region_code = 'BE', city = 'Berlin',
              geo_source = 'user_declared', geo_updated_at = now()
        WHERE id = $1`,
      [IDS.users.otherMember],
    );
  });

  // Membership, through the OWNER: `0001` grants no write on `user_groups` to any serving
  // role, and that refusal is the control that fails open if forgotten. The owner is the
  // sanctioned writer on every database, seeded or not.
  await asOwner(async (client) => {
    await client.query(
      `INSERT INTO groups (id, name) VALUES ($1, 'geo-EU'), ($2, 'geo-US') ON CONFLICT DO NOTHING`,
      [IDS.groups.eu, IDS.groups.us],
    );
    for (const [user, group] of [
      [IDS.users.selfMember, IDS.groups.eu],
      [IDS.users.otherMember, IDS.groups.eu],
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
  // `database/seed.ts` runs a CLUSTER-scoped `ALTER ROLE … PASSWORD`, so the cluster is
  // restored in a `finally`: it is the one step that must not be skipped, and it must not
  // sit behind the drop above. Stopping PostgREST first is what lets the DROP terminate
  // cleanly rather than fail naming a connection.
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
// 0012 — the member reads its own geography
// =============================================================================

describe('0012 · a member reads its own geography and nobody else\'s', () => {
  it(
    'a member CAN read their own country, region and provenance — the disclosure is of the member\'s own data',
    async () => {
      // The permitted case every denial-only suite is missing. Without it, a policy that
      // refuses everyone would pass every other test in this describe block.
      //
      // The columns are NAMED, never `select=*`: `app_member` is column-restricted on
      // `users` (0008) and a column-restricted role cannot use the wildcard at all. That
      // is not an inconvenience here, it is the reason this request is written the way a
      // generated client would write it.
      const response = await request(
        `${baseUrl()}/users?select=id,username,country_code,region_code,city,geo_source,geo_accuracy_km,geo_updated_at`,
        token(IDS.users.selfMember, 'app_member'),
      );

      expect(response.status, `self-read returned ${response.status}: ${response.body}`).toBe(200);
      const rows = parseJsonArray(response.body);

      // Membership, not a count: a filter returning a different row of the same length
      // would satisfy a count, and this file is about WHICH row comes back.
      expect(rows.map((row) => String(row['id']))).toEqual([IDS.users.selfMember]);
      expect(rows[0]?.['country_code']).toBe('US');
      expect(rows[0]?.['region_code']).toBe('NY');
      expect(rows[0]?.['city']).toBe('Albany');

      // The provenance travels with the geography. A member shown "New York" with no
      // indication of whether that is something they said or something a database
      // guessed has been told a guess in the voice of a fact.
      expect(rows[0]?.['geo_source']).toBe('geoip');
      expect(rows[0]?.['geo_accuracy_km']).toBe(25);

      // And `password_hash` is still absent from the response, not merely null: 0012
      // re-issued the column grant, and a widened grant is the regression this would
      // catch.
      expect(Object.keys(rows[0] ?? {})).not.toContain('password_hash');
      expect(response.body).not.toContain(PROBE_HASH);
    },
    TIMEOUT,
  );

  it(
    'a member CANNOT read a colleague in their OWN group\'s geography — zero rows, and the colleague is absent from the body',
    () => {
      // Same group on purpose: the attack is "somebody else", not "another tenant".
      const visible = readAsRole<{ id: string; username: string }>(
        'app_member',
        IDS.users.selfMember,
        'SELECT id, username, region_code, geo_source FROM users ORDER BY username',
      );

      // THE COUNT, which is the load-bearing assertion. A correct denial, a full
      // `USING (true)` leak and a partial leak were ALL HTTP 200 in the measurement this
      // suite is built on, so a status-only test passes on a real leak.
      expect(visible).toHaveLength(1);
      expect(visible.map((row) => row.id)).toEqual([IDS.users.selfMember]);

      // The colleague's identity by name as well, so a partial leak that kept the right
      // row COUNT cannot pass either.
      expect(JSON.stringify(visible)).not.toContain(IDS.users.otherMember);
      expect(JSON.stringify(visible)).not.toContain('geo-other');

      // An UNFILTERED read is what distinguishes "the row is hidden from me" from "the
      // row does not exist"; a filtered count cannot tell them apart.
      const colleague = readAsRole<{ id: string }>(
        'app_member',
        IDS.users.selfMember,
        `SELECT id FROM users WHERE id = '${IDS.users.otherMember}'`,
      );
      expect(colleague).toEqual([]);

      // Ground truth: the row IS there, with its geography, so the denial above is a
      // denial and not an empty fixture.
      const groundTruth = superuserRows<{ count: number; region_code: string }>(
        `SELECT count(*)::int AS count, min(region_code) AS region_code
           FROM users WHERE id = '${IDS.users.otherMember}'`,
      );
      expect(groundTruth[0]?.count).toBe(1);
      expect(groundTruth[0]?.region_code).toBe('BE');
    },
    TIMEOUT,
  );

  it(
    'a garbage or empty `sub` is a clean denial on the geography read, not a 500',
    () => {
      // `authz.actor()` catches the cast. A policy that RAISES on caller input is a
      // denial-of-service surface and an oracle, and it used to yield HTTP 500 where the
      // guarded form denies.
      for (const sub of ['', 'not-a-uuid', '{}']) {
        const visible = readAsRole<{ id: string }>('app_member', sub, 'SELECT id, region_code FROM users');
        expect(visible, `a sub of ${JSON.stringify(sub)} returned rows`).toEqual([]);
      }

      // And the admin branch is untouched by a malformed identity.
      const admin = readAsRole<{ id: string }>('app_admin', 'not-a-uuid', 'SELECT id, region_code FROM users');
      expect(admin.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 0012 — the forgery case
// =============================================================================

describe('0012 · a member cannot forge the provenance of their own geography', () => {
  it(
    'a member CANNOT set their own geo_source to admin_verified — forging evidence about themselves is refused and the column is unchanged',
    async () => {
      // THE ATTACK THIS MIGRATION EXISTS TO REFUSE. `geo_source` records who made a
      // determination about where a person is and how. A member who could write
      // 'admin_verified' onto their own row would be asserting that an operator
      // confirmed something no operator looked at — and every downstream decision that
      // trusts the provenance would be acting on it.
      const forged = await attemptAs(
        'app_member',
        `UPDATE users SET geo_source = 'admin_verified', geo_updated_at = now() WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(forged.ok, `the member forged geo_source: ${forged.code ?? ''} ${forged.message ?? ''}`).toBe(false);
      expect(forged.code).toBe('42501');

      // Asserted on the ROW, not on the error: "the statement failed" and "the statement
      // failed and wrote nothing" are different facts, and only the second one is the
      // control.
      const after = superuserRows<{ geo_source: string | null; region_code: string }>(
        `SELECT geo_source, region_code FROM users WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(after).toHaveLength(1);
      expect(after[0]?.geo_source, 'the forged provenance was written').toBe('geoip');
      expect(after[0]?.region_code).toBe('NY');

      // The whole shape of the attack, not just the one column: a member cannot rewrite
      // their own jurisdiction either, so they cannot manufacture a California address
      // and then a California provenance for it.
      const relocated = await attemptAs(
        'app_member',
        `UPDATE users SET region_code = 'CA', country_code = 'US' WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(relocated.ok, 'a member relocated their own account to California').toBe(false);

      const stillThere = superuserRows<{ region_code: string }>(
        `SELECT region_code FROM users WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(stillThere[0]?.region_code).toBe('NY');
    },
    TIMEOUT,
  );

  it(
    'app_member holds NO table-level write verb on users — the forgery control is a grant, asserted per role rather than in a comment',
    () => {
      // 0012's forgery control is not a trigger or a CHECK; it is the absence of a
      // grant, and an absence asserted only in prose is an absence nobody re-checks.
      //
      // Read from `pg_class`, which is TABLE-level, and the distinction is load-bearing since
      // `0026_member_self_write.sql`: `app_member` now holds `UPDATE (first_name, last_name)`,
      // so a reader checking "does a member hold UPDATE here?" has to be told explicitly that
      // the answer is about the TABLE verb. It is. The member's own name write is bounded by
      // the two-column grant and by `users_update`, and neither of those touches the six
      // geography columns this suite is about — `member-self-write.spec.ts` proves the exact
      // column set from `pg_attribute`'s ACL.
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        const holds = superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_member', 'public.users', '${privilege}') AS holds`,
        );
        expect(holds[0]?.holds, `app_member holds table-level ${privilege} on users, so the forgery case above is not load-bearing`).toBe(false);
      }

      // The six geography columns specifically, because "no table verb" would still leave a
      // column grant able to forge `geo_source` — and forging provenance about yourself is
      // the entire point of the case above.
      for (const column of ['country_code', 'region_code', 'city', 'geo_source', 'geo_accuracy_km', 'geo_updated_at']) {
        const writable = superuserRows<{ holds: boolean }>(
          `SELECT has_column_privilege('app_member', 'public.users', '${column}', 'UPDATE') AS holds`,
        );
        expect(writable[0]?.holds, `app_member can UPDATE users.${column}, so the forgery control is not the grant`).toBe(false);
      }

      // The superset, on the other side: `app_admin` writes these columns, because the
      // administrative write path `users` has runs as `app_admin`. An admin
      // narrower than a member on this table would be a different design.
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const holds = superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_admin', 'public.users', '${privilege}') AS holds`,
        );
        expect(holds[0]?.holds, `app_admin does not hold ${privilege} on users`).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    'the member\'s own geography is readable through the SQL path too, so the grant is a grant and not a one-route accident',
    () => {
      // The PostgREST case above proves the wire format; this proves the GRANT. A role
      // that can read a column over HTTP and not over SQL would mean the answer came
      // from somewhere other than the schema.
      const rows = readAsRole<{ country_code: string; region_code: string; city: string }>(
        'app_member',
        IDS.users.selfMember,
        'SELECT country_code, region_code, city FROM users',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.region_code).toBe('NY');

      // The six new columns are granted, and `password_hash` still is not — asserted from
      // the catalog rather than from one consequence of it.
      for (const column of [
        'country_code',
        'region_code',
        'city',
        'geo_source',
        'geo_accuracy_km',
        'geo_updated_at',
      ]) {
        const readable = superuserRows<{ readable: boolean }>(
          `SELECT has_column_privilege('app_member', 'public.users', '${column}', 'SELECT') AS readable`,
        );
        expect(readable[0]?.readable, `app_member cannot read users.${column}`).toBe(true);
      }

      const secret = superuserRows<{ readable: boolean }>(
        `SELECT has_column_privilege('app_member', 'public.users', 'password_hash', 'SELECT') AS readable`,
      );
      expect(secret[0]?.readable, 'the re-issued column grant widened to password_hash').toBe(false);

      // `app_anon` still has nothing on `users` at all: an unauthenticated read is
      // refused at the grant layer, which is a denial that names nothing about the
      // schema behind it.
      const anon = superuserRows<{ holds: boolean }>(
        `SELECT has_table_privilege('app_anon', 'public.users', 'SELECT') AS holds`,
      );
      expect(anon[0]?.holds).toBe(false);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 0012 — what the constraints refuse
// =============================================================================

describe('0012 · an absent answer, a padded answer and a fabricated radius are all refused', () => {
  it(
    'a GeoIP guess is storable WITH a radius and a user declaration is storable WITHOUT one, and the two stay distinguishable',
    async () => {
      // The POSITIVE case. A suite that only ever proves refusals passes against a schema
      // that refuses everything, and `geo_accuracy_km IS NULL OR geo_source = 'geoip'`
      // is exactly the kind of constraint that could be over-tightened into a lockout.
      const written = await attemptAs(
        'app_admin',
        `UPDATE users SET geo_source = 'user_declared', geo_accuracy_km = NULL, geo_updated_at = now()
          WHERE id = '${IDS.users.otherMember}'`,
      );
      expect(written.ok, `the admin could not write a user declaration: ${written.code ?? ''} ${written.message ?? ''}`).toBe(true);

      const rows = superuserRows<{ geo_source: string; geo_accuracy_km: number | null }>(
        `SELECT geo_source, geo_accuracy_km FROM users WHERE id = '${IDS.users.otherMember}'`,
      );
      expect(rows[0]?.geo_source).toBe('user_declared');
      expect(rows[0]?.geo_accuracy_km, 'a user-declared region acquired a confidence radius').toBeNull();

      // And the guess still carries its radius, because the two rows are different rows
      // with different evidence rather than one row read twice.
      const guessed = superuserRows<{ geo_source: string; geo_accuracy_km: number | null }>(
        `SELECT geo_source, geo_accuracy_km FROM users WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(guessed[0]?.geo_source).toBe('geoip');
      expect(guessed[0]?.geo_accuracy_km).toBe(25);
    },
    TIMEOUT,
  );

  it(
    'an EMPTY region is refused — the rejected geoip library returned "" and an empty string looks like an answer',
    async () => {
      // `geoip-lite@2.0.0` returned `region: ""` rather than null for most addresses: 9 of
      // 10 well-known US hosts came back EMPTY. An empty string passes every
      // `IS NOT NULL` test and is not 'CA', so it makes the California predicate say no
      // while every report claims the region is known.
      for (const blank of ['', ' ']) {
        const attempt = await attemptAs(
          'app_admin',
          `UPDATE users SET region_code = '${blank}' WHERE id = '${IDS.users.selfMember}'`,
        );
        expect(attempt.ok, `an empty region (${JSON.stringify(blank)}) was stored`).toBe(false);
        expect(attempt.code).toBe('23514');
        expect(attempt.message ?? '').toContain('users_region_code_canonical');
      }

      // Nothing was written by either attempt.
      const after = superuserRows<{ region_code: string }>(
        `SELECT region_code FROM users WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(after[0]?.region_code).toBe('NY');
    },
    TIMEOUT,
  );

  it(
    'a padded or lowercased region is refused, because "CA " would silently fail the California comparison',
    async () => {
      // The blank rule is not the whole trap. `'CA '` and `'ca'` are not empty, so a check
      // written only against `''` admits them, and then `region_code = 'CA'` is FALSE for a
      // California row — the failure direction that ends in a lawsuit rather than in an
      // afternoon.
      for (const wrong of ['CA ', ' CA', 'ca', 'Ca']) {
        const attempt = await attemptAs(
          'app_admin',
          `UPDATE users SET region_code = '${wrong}' WHERE id = '${IDS.users.selfMember}'`,
        );
        expect(attempt.ok, `the non-canonical region ${JSON.stringify(wrong)} was stored`).toBe(false);
        expect(attempt.code).toBe('23514');
        expect(attempt.message ?? '').toContain('users_region_code_canonical');
      }

      // The canonical spelling is accepted, so the constraint is a form rule and not a
      // prohibition on the answer.
      const canonical = await attemptAs(
        'app_admin',
        `UPDATE users SET region_code = 'CA' WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(canonical.ok, `the canonical region was refused: ${canonical.message ?? ''}`).toBe(true);

      const after = superuserRows<{ region_code: string }>(
        `SELECT region_code FROM users WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(after[0]?.region_code).toBe('CA');

      // …and put back, so the fixture the read cases depend on is unchanged for them.
      await attemptAs(
        'app_admin',
        `UPDATE users SET region_code = 'NY' WHERE id = '${IDS.users.selfMember}'`,
      );
    },
    TIMEOUT,
  );

  it(
    'a country code that is not an ISO alpha-2 code is refused, and a blank one is refused with it',
    async () => {
      for (const wrong of ['', 'USA', 'United States', ' US', 'us']) {
        const attempt = await attemptAs(
          'app_admin',
          `UPDATE users SET country_code = '${wrong}' WHERE id = '${IDS.users.selfMember}'`,
        );
        expect(attempt.ok, `the country code ${JSON.stringify(wrong)} was stored`).toBe(false);
        expect(attempt.code).toBe('23514');
        expect(attempt.message ?? '').toContain('users_country_code_canonical');
      }
    },
    TIMEOUT,
  );

  it(
    'a fabricated confidence radius on a user-declared region is refused — precision the evidence does not have',
    async () => {
      const attempt = await attemptAs(
        'app_admin',
        `UPDATE users SET geo_source = 'user_declared', geo_accuracy_km = 5 WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(attempt.ok, 'a user declaration acquired a GeoIP confidence radius').toBe(false);
      expect(attempt.code).toBe('23514');
      expect(attempt.message ?? '').toContain('users_geo_accuracy_requires_geoip_source');

      // The row is untouched: `geo_source` is still the GeoIP guess and the radius is
      // still its own.
      const after = superuserRows<{ geo_source: string; geo_accuracy_km: number | null }>(
        `SELECT geo_source, geo_accuracy_km FROM users WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(after[0]?.geo_source).toBe('geoip');
      expect(after[0]?.geo_accuracy_km).toBe(25);
    },
    TIMEOUT,
  );

  it(
    'a negative radius, and provenance recorded at no instant, are both refused',
    async () => {
      const negative = await attemptAs(
        'app_admin',
        `UPDATE users SET geo_accuracy_km = -1 WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(negative.ok, 'a negative confidence radius was stored').toBe(false);
      expect(negative.code).toBe('23514');
      expect(negative.message ?? '').toContain('users_geo_accuracy_non_negative');

      // Provenance with no instant is a record of a decision nobody took: it cannot be
      // audited and it cannot expire.
      //
      // `geo_accuracy_km = NULL` IS PART OF THIS STATEMENT, and it is here to isolate the
      // constraint under test rather than to tidy up. The row carries a 25 km GeoIP
      // radius, so leaving it would violate
      // `users_geo_accuracy_requires_geoip_source` as well — and whichever of the two
      // Postgres happened to report first would decide which constraint name this
      // assertion could name. Both raise `23514`, so a code-only assertion could not tell
      // them apart; clearing the radius makes the timestamp the ONLY rule broken.
      const undated = await attemptAs(
        'app_admin',
        `UPDATE users SET geo_source = 'admin_verified', geo_accuracy_km = NULL, geo_updated_at = NULL
          WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(undated.ok, 'a verification with no instant was stored').toBe(false);
      expect(undated.code).toBe('23514');
      expect(undated.message ?? '').toContain('users_geo_source_requires_updated_at');

      // And a word that is not in the vocabulary is refused, rather than becoming a
      // fourth kind of evidence nobody can interpret. The radius is cleared for the same
      // reason as above — one rule broken, one constraint named.
      const invented = await attemptAs(
        'app_admin',
        `UPDATE users SET geo_source = 'probably_california', geo_accuracy_km = NULL WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(invented.ok, 'an invented provenance was stored').toBe(false);
      expect(invented.message ?? '').toContain('users_geo_source_check');

      // Nothing was written by any of the three attempts, so the read cases above and
      // below are looking at the fixture rather than at a repair.
      const after = superuserRows<{ geo_source: string; geo_accuracy_km: number | null }>(
        `SELECT geo_source, geo_accuracy_km FROM users WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(after[0]?.geo_source).toBe('geoip');
      expect(after[0]?.geo_accuracy_km).toBe(25);
    },
    TIMEOUT,
  );

  it(
    'the California filter has an index, and it is PARTIAL — most rows carry no region at all',
    () => {
      // Asserted from the catalog: the index is what a jurisdiction sweep costs, and a
      // regression to a full index would be invisible until the table was large.
      const indexes = superuserRows<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'users' AND indexname = 'users_region_code_idx'`,
      );
      expect(indexes).toHaveLength(1);
      expect(indexes[0]?.indexdef ?? '').toContain('region_code');
      expect(indexes[0]?.indexdef ?? '').toContain('WHERE (region_code IS NOT NULL)');

      // Every constraint 0012 adds exists, is VALIDATED rather than `NOT VALID`, and
      // sits on the table the migration claims — the `NOT VALID` case is the one that
      // enforces new writes while never having been checked against the rows that already
      // exist, and it is invisible in the ledger.
      const constraints = superuserRows<{ conname: string; convalidated: boolean }>(
        `SELECT conname, convalidated FROM pg_constraint
          WHERE conrelid = 'public.users'::regclass
            AND conname IN ('users_country_code_canonical', 'users_region_code_canonical',
                            'users_city_not_blank', 'users_geo_source_check',
                            'users_geo_accuracy_non_negative',
                            'users_geo_accuracy_requires_geoip_source',
                            'users_geo_source_requires_updated_at')
          ORDER BY conname`,
      );
      expect(constraints).toHaveLength(7);
      expect(constraints.filter((row) => !row.convalidated)).toEqual([]);

      // Every one of the six columns exists, nullable, with no DEFAULT that would fill
      // them in. A DEFAULT on a nullable "no determination has been made" column is an
      // assertion, and `NOT NULL` would be a lie for every user who has never been asked.
      const columns = superuserRows<{ attname: string; attnotnull: boolean; default_is_null: boolean }>(
        `SELECT a.attname, a.attnotnull, (d.adbin IS NULL) AS default_is_null
           FROM pg_attribute a
           LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = 'public.users'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND a.attname IN ('country_code', 'region_code', 'city', 'geo_source',
                              'geo_accuracy_km', 'geo_updated_at')
          ORDER BY a.attname`,
      );
      expect(columns).toHaveLength(6);
      for (const column of columns) {
        expect(column.attnotnull, `${column.attname} is NOT NULL, so "unknown" has no representation`).toBe(false);
        expect(column.default_is_null, `${column.attname} carries a DEFAULT`).toBe(true);
      }
    },
    TIMEOUT,
  );
});

// =============================================================================
// 0013 — the company content is public
// =============================================================================

describe('0013 · the about page is not behind a login, and the company\'s address is not member-writable', () => {
  it(
    'an UNAUTHENTICATED reader can fetch the company profile — the contact footer is rendered for people with no account',
    async () => {
      // NO TOKEN AT ALL. This is the case a "signed in" reading of the website misses: a
      // privacy policy, an about page and a terms-of-service footer are served to whoever
      // asks, and `db-anon-role = app_anon` is the identity they arrive as.
      const response = await request(`${baseUrl()}/company_profile?select=legal_name,display_name,support_email,privacy_contact_email`);

      expect(response.status, `the anonymous read returned ${response.status}: ${response.body}`).toBe(200);
      const rows = parseJsonArray(response.body);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.['legal_name']).toBe('Proof Trading Company Limited');
      expect(rows[0]?.['privacy_contact_email']).toBe('privacy@example.test');
    },
    TIMEOUT,
  );

  it(
    'an UNAUTHENTICATED reader can fetch the company addresses, and an anonymous member of the API role sees the same rows',
    async () => {
      const response = await request(`${baseUrl()}/company_addresses?select=id,city,region_code,country_code,kind`);

      expect(response.status, `the anonymous address read returned ${response.status}: ${response.body}`).toBe(200);
      const rows = parseJsonArray(response.body);

      // The row is named, not counted: a count of one is satisfied by the wrong row, and
      // "the public can see a postal address" is a claim about WHICH address.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.['city']).toBe('Berlin');
      expect(rows[0]?.['country_code']).toBe('DE');

      // The same rows through the SQL path as `app_anon`, because a 200 over HTTP with a
      // policy that returns nothing underneath it would be a strange thing to ship and a
      // stranger thing to assert.
      const viaSql = readAsRole<{ city: string }>('app_anon', undefined, 'SELECT city FROM company_addresses');
      expect(viaSql.map((row) => row.city)).toEqual(['Berlin']);

      // Ground truth: the addresses this suite's predicate cases write are the SAME rows,
      // so an anon read that found nothing while the predicate found California would be
      // an inconsistency worth failing on.
      const owner = superuserRows<{ count: number }>(
        `SELECT count(*)::int AS count FROM company_addresses`,
      );
      expect(viaSql).toHaveLength(owner[0]?.count ?? -1);
    },
    TIMEOUT,
  );

  it(
    'a member CANNOT rewrite the company\'s registered address, and the row is unchanged afterwards',
    async () => {
      await replaceAddresses([
        {
          line1: '1 Market Street',
          city: 'San Francisco',
          region: 'CA',
          country: 'US',
          kind: 'registered',
          isRegistered: true,
        },
      ]);

      const before = superuserRows<{ count: number }>(
        `SELECT count(*)::int AS count FROM company_addresses`,
      );
      expect(before[0]?.count).toBe(1);

      // Over the wire, as the forge would arrive.
      const patched = await request(
        `${baseUrl()}/company_addresses?company_profile_id=eq.${IDS.company}`,
        token(IDS.users.selfMember, 'app_member'),
        {
          method: 'PATCH',
          body: JSON.stringify({ city: 'Reno', region_code: 'NV', country_code: 'US' }),
        },
      );
      expect(patched.body).not.toContain('Reno');

      // And through SQL, which is where the GRANT is visible: a member holds no write
      // verb on either table.
      for (const table of ['company_profile', 'company_addresses']) {
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
          const holds = superuserRows<{ holds: boolean }>(
            `SELECT has_table_privilege('app_member', 'public.${table}', '${privilege}') AS holds`,
          );
          expect(holds[0]?.holds, `app_member holds ${privilege} on ${table}`).toBe(false);
        }
      }

      const viaSql = await attemptAs(
        'app_member',
        `UPDATE company_addresses SET region_code = 'NV' WHERE company_profile_id = '${IDS.company}'`,
      );
      expect(viaSql.ok, `a member rewrote the company's address: ${viaSql.code ?? ''}`).toBe(false);
      expect(viaSql.code).toBe('42501');

      // Asserted by row, not by status. The address is the evidence a statutory
      // predicate is computed from, so "the write was refused" and "the write was refused
      // and the address still says California" are different facts.
      const after = superuserRows<{ region_code: string; city: string }>(
        `SELECT region_code, city FROM company_addresses`,
      );
      expect(after).toHaveLength(1);
      expect(after[0]?.region_code).toBe('CA');
      expect(after[0]?.city).toBe('San Francisco');

      // And `app_admin` CAN write it, which is what "app_admin is a superset" means and
      // what stops the grant above from being a lockout.
      const byAdmin = await attemptAs(
        'app_admin',
        `UPDATE company_addresses SET city = 'Oakland' WHERE company_profile_id = '${IDS.company}'`,
      );
      expect(byAdmin.ok, `app_admin could not write the company's address: ${byAdmin.message ?? ''}`).toBe(true);
      const edited = superuserRows<{ city: string }>(`SELECT city FROM company_addresses`);
      expect(edited[0]?.city).toBe('Oakland');
    },
    TIMEOUT,
  );
});

// =============================================================================
// 0013 — the predicate
// =============================================================================

describe('0013 · ccpa_applicable() answers about addresses, and only about addresses', () => {
  it(
    'with no addresses at all it is false — the empty case, before anything is California',
    async () => {
      await replaceAddresses([]);
      expect(ccpaApplicableAs('app_admin')).toBe(false);
      expect(ccpaApplicableAs('app_anon')).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'a Delaware address does not trigger it — a company in the United States is not thereby covered',
    async () => {
      await replaceAddresses([
        { line1: '1201 Orange Street', city: 'Wilmington', region: 'DE', country: 'US', kind: 'registered' },
      ]);
      expect(ccpaApplicableAs('app_admin')).toBe(false);
      expect(ccpaApplicableAs('app_anon')).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'a CANADIAN address does not trigger it — "CA" is also the country code, and the predicate must not confuse the two',
    async () => {
      // The case that a `country_code = 'CA'` implementation gets exactly wrong, and the
      // one a hand-written EU/UK/other list gets wrong in the other direction. The
      // province is British Columbia; the country is Canada. Neither half of that is
      // California.
      await replaceAddresses([
        { line1: '200 Burrard Street', city: 'Vancouver', region: 'BC', country: 'CA', kind: 'headquarters' },
      ]);
      expect(ccpaApplicableAs('app_admin')).toBe(false);
      expect(ccpaApplicableAs('app_anon')).toBe(false);

      // Ground truth: the row really is there and really does carry the two-letter code
      // that a careless implementation would match on. Without this the case passes
      // against an empty table.
      const rows = superuserRows<{ count: number; country_code: string }>(
        `SELECT count(*)::int AS count, min(country_code) AS country_code FROM company_addresses`,
      );
      expect(rows[0]?.count).toBe(1);
      expect(rows[0]?.country_code).toBe('CA');
    },
    TIMEOUT,
  );

  it(
    'a California address makes it true, and it is true for an ANONYMOUS caller over both the RPC and the SQL path',
    async () => {
      await replaceAddresses([
        { line1: '1 Market Street', city: 'San Francisco', region: 'CA', country: 'US', kind: 'registered', isRegistered: true },
      ]);

      expect(ccpaApplicableAs('app_admin')).toBe(true);
      expect(ccpaApplicableAs('app_member')).toBe(true);

      // The disclosure case. No `Authorization` header at all, so PostgREST arrives as
      // `app_anon`. A 401 here would not be a security control; it would be a refusal to
      // publish the privacy notice to the person asking for it.
      const response = await request(`${baseUrl()}/rpc/ccpa_applicable`);
      expect(response.status, `the anonymous RPC returned ${response.status}: ${response.body}`).toBe(200);
      expect(response.body.trim()).toBe('true');

      // The URL exists at all only because the function is in `public`: `authz` is
      // outside `db-schemas`, so a function there is neither addressable nor in the spec.
      // Asserted through the catalog rather than by the shape of a string.
      const schema = superuserRows<{ nspname: string }>(
        `SELECT n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname = 'ccpa_applicable' AND n.nspname = 'public'`,
      );
      expect(schema).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'a SECOND California address makes it true while the first is somewhere else — EXISTS, not "the address"',
    async () => {
      // This is the whole reason `company_addresses` is a child table rather than a
      // `region_code` column on `company_profile`. A company with a Delaware office and a
      // California one has to be able to say so.
      await replaceAddresses([
        { line1: '1201 Orange Street', city: 'Wilmington', region: 'DE', country: 'US', kind: 'registered', isRegistered: true },
        { line1: '500 Oracle Parkway', city: 'Redwood City', region: 'CA', country: 'US', kind: 'office' },
        { line1: '1 Marina Boulevard', city: 'San Francisco', region: 'CA', country: 'US', kind: 'mailing' },
      ]);

      const groundTruth = superuserRows<{ count: number; california: number }>(
        `SELECT count(*)::int AS count,
                count(*) FILTER (WHERE region_code = 'CA' AND country_code = 'US')::int AS california
           FROM company_addresses`,
      );
      expect(groundTruth[0]?.count).toBe(3);
      expect(groundTruth[0]?.california).toBe(2);

      expect(ccpaApplicableAs('app_admin')).toBe(true);
      expect(ccpaApplicableAs('app_anon')).toBe(true);

      // Remove ONE of the two California addresses and the answer must not move — `true`
      // is not counting them, and a predicate that returned a COUNT would be a different
      // function with the same name.
      await asRole('app_admin', async (client) => {
        await client.query(`DELETE FROM company_addresses WHERE kind = 'mailing'`);
      });
      expect(ccpaApplicableAs('app_admin')).toBe(true);

      // Remove the other and it does move, which is what makes the line above a fact
      // about the data rather than a tautology.
      await replaceAddresses([
        { line1: '1201 Orange Street', city: 'Wilmington', region: 'DE', country: 'US', kind: 'registered' },
      ]);
      expect(ccpaApplicableAs('app_admin')).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'a US address with no state is refused at the boundary — it is the row that would switch the predicate off silently',
    async () => {
      const attempt = await attemptAs(
        'app_admin',
        `INSERT INTO company_addresses (company_profile_id, line1, city, country_code, kind)
         VALUES ('${IDS.company}', '1 Market Street', 'San Francisco', 'US', 'office')`,
      );
      expect(attempt.ok, 'a US address with no state was stored').toBe(false);
      expect(attempt.code).toBe('23514');
      expect(attempt.message ?? '').toContain('company_addresses_us_address_requires_region');

      // Nothing was inserted, so the predicate below is unaffected by the attempt.
      const rows = superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM company_addresses`);
      expect(rows[0]?.count).toBe(1);
      expect(ccpaApplicableAs('app_admin')).toBe(false);

      // The NON-US counterpart is admitted with no region at all, so the constraint is
      // about the one country whose subdivision decides the answer rather than a blanket
      // demand that every address name a province.
      await replaceAddresses([
        { line1: '200 Burrard Street', city: 'Vancouver', region: null, country: 'CA', kind: 'office' },
      ]);
      const allowed = superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM company_addresses`);
      expect(allowed[0]?.count).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'a non-canonical region on a company address is refused for the same reason as on a user: "CA " is not California',
    async () => {
      for (const wrong of ['ca', 'CA ']) {
        const attempt = await attemptAs(
          'app_admin',
          `INSERT INTO company_addresses (company_profile_id, line1, city, region_code, country_code, kind)
           VALUES ('${IDS.company}', '1 Market Street', 'San Francisco', '${wrong}', 'US', 'office')`,
        );
        expect(attempt.ok, `the address region ${JSON.stringify(wrong)} was stored`).toBe(false);
        expect(attempt.code).toBe('23514');
        expect(attempt.message ?? '').toContain('company_addresses_region_code_canonical');
      }
    },
    TIMEOUT,
  );

  it(
    'ccpa_applicable() is executable by app_anon and is NOT reachable through PUBLIC',
    () => {
      // The GRANT side of the disclosure, read from the catalog rather than inferred from
      // a call that happens to work: `has_function_privilege` for each serving role, and
      // then `aclexplode` for the grantee `0` that IS `PUBLIC`.
      for (const role of ['app_anon', 'app_member', 'app_admin']) {
        const holds = superuserRows<{ holds: boolean }>(
          `SELECT has_function_privilege('${role}', 'public.ccpa_applicable()', 'EXECUTE') AS holds`,
        );
        expect(holds[0]?.holds, `${role} cannot execute ccpa_applicable(), so the disclosure is withheld from it`).toBe(true);
      }

      // Postgres grants EXECUTE to PUBLIC on every new function, so the revoke is the
      // whole control and it has to be asserted. `grantee = 0` is PUBLIC.
      const publicGrants = superuserRows<{ grantee: number }>(
        `SELECT x.grantee::int AS grantee
           FROM pg_proc p, aclexplode(p.proacl) AS x
          WHERE p.proname = 'ccpa_applicable' AND x.grantee = 0`,
      );
      expect(publicGrants, 'ccpa_applicable() is executable through PUBLIC').toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'the function is SECURITY DEFINER with a pinned search_path, and its body reads both columns the decision turns on',
    () => {
      // Read from `pg_proc`, so a rewrite that answers from something else fails here
      // rather than passing because the address table happened to agree.
      const functions = superuserRows<{
        prosecdef: boolean;
        provolatile: string;
        search_path: string;
        definition: string;
      }>(
        `SELECT p.prosecdef,
                p.provolatile,
                coalesce(array_to_string(p.proconfig, ','), '') AS search_path,
                pg_get_functiondef(p.oid) AS definition
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'ccpa_applicable'`,
      );
      expect(functions).toHaveLength(1);

      const fn = functions[0];
      expect(fn?.prosecdef, 'ccpa_applicable() is SECURITY INVOKER, so it needs a grant on the table to answer').toBe(true);
      expect(fn?.provolatile, 'ccpa_applicable() is not STABLE, so the planner may re-read it mid-statement').toBe('s');
      expect(fn?.search_path, 'ccpa_applicable() has no pinned search_path').toContain('search_path=');

      // The body. `EXISTS` over the CHILD table, and BOTH halves of the conjunction —
      // an implementation matching only on the country would answer true for Canada, which
      // is the mistake the Canadian case above is built to catch.
      expect(fn?.definition ?? '').toContain('company_addresses');
      expect(fn?.definition ?? '').toContain('EXISTS');
      expect(fn?.definition ?? '').toContain("region_code = 'CA'");
      expect(fn?.definition ?? '').toContain("country_code = 'US'");
    },
    TIMEOUT,
  );

  it(
    'a second company_profile row is refused — one deployment, one company, enforced by the database',
    async () => {
      const attempt = await attemptAs(
        'app_admin',
        `INSERT INTO company_profile (id, legal_name, display_name) VALUES (gen_random_uuid(), 'Rival Ltd', 'Rival')`,
      );
      expect(attempt.ok, 'a second company profile row was inserted').toBe(false);
      expect(attempt.code).toBe('23505');

      const rows = superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM company_profile`);
      expect(rows[0]?.count).toBe(1);

      // And the index that refuses it exists, by name, rather than by folklore.
      const indexes = superuserRows<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'company_profile' AND indexname = 'company_profile_singleton_idx'`,
      );
      expect(indexes).toHaveLength(1);
      expect(indexes[0]?.indexdef ?? '').toContain('UNIQUE');
    },
    TIMEOUT,
  );

  it(
    'every key in the two new tables defaults to uuidv7(), because a v4 scatters index insertions',
    () => {
      // The catalog gate in `uuid-keys.spec.ts` is global and would catch this too, but it
      // names no tables, so a reader of THIS file should not have to know that to see why
      // `DEFAULT uuidv7()` is here.
      //
      // SCOPED TO `uuid` COLUMNS, deliberately. `created_at` carries `DEFAULT now()`,
      // which is not `uuidv7()` and is not supposed to be — a filter that forgot the type
      // would report every timestamp column in the table as a v4 key.
      const wrong = superuserRows<{ table: string; column: string; default_expr: string }>(
        `SELECT c.relname AS table, a.attname AS column, pg_get_expr(d.adbin, d.adrelid) AS default_expr
           FROM pg_attrdef d
           JOIN pg_class c ON c.oid = d.adrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
          WHERE n.nspname = 'public'
            AND c.relname IN ('company_profile', 'company_addresses')
            AND pg_catalog.format_type(a.atttypid, a.atttypmod) = 'uuid'
            AND pg_get_expr(d.adbin, d.adrelid) <> 'uuidv7()'`,
      );
      expect(wrong).toEqual([]);

      // And a freshly minted key really is a v7, read back rather than inferred from
      // the default's text.
      const minted = superuserRows<{ version: string }>(
        `SELECT substring(id::text, 15, 1) AS version FROM company_addresses LIMIT 1`,
      );
      for (const row of minted) {
        expect(row.version).toBe('7');
      }
    },
    TIMEOUT,
  );
});

// =============================================================================
// The gate can fail
// =============================================================================

describe('0013 · the suite can fail: a predicate that always says true is watched being wrong, then restored', () => {
  it(
    'replacing ccpa_applicable() with a constant true reports California for a Delaware address, and re-applying 0013 restores it',
    async () => {
      // `AGENTS.md` §B8: a suite that passes whether or not the protection exists is the
      // exact failure this file is meant to be immune to. The tamper here is the crudest
      // possible over-application — a function that ignores the addresses entirely — and
      // the thing watched going wrong is the NEGATIVE case, which is the one a suite of
      // positive assertions would not have.
      await replaceAddresses([
        { line1: '1201 Orange Street', city: 'Wilmington', region: 'DE', country: 'US', kind: 'registered' },
      ]);
      expect(ccpaApplicableAs('app_admin')).toBe(false);

      superuserExec(
        `CREATE OR REPLACE FUNCTION public.ccpa_applicable() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$`,
      );

      try {
        const underTamper = ccpaApplicableAs('app_admin');
        expect(
          underTamper,
          'a predicate that answers true unconditionally did not answer true, so this tamper proves nothing about the negative cases',
        ).toBe(true);

        // The false case is what has gone wrong: a Delaware address now reads as a
        // covered business.
        expect(readAsRole<{ applicable: boolean }>('app_anon', undefined, 'SELECT ccpa_applicable() AS applicable')).toEqual([
          { applicable: true },
        ]);
      } finally {
        // The restore is the MIGRATION, re-applied as the owner role — the same file, so
        // the restored definition is the shipped one rather than a copy of it that can
        // drift (§2.4).
        //
        // THE DROP BEFORE IT IS NOT OPTIONAL, and the reason is a fact about ownership
        // rather than about tidiness. `CREATE OR REPLACE FUNCTION` may only be issued by
        // the function's owner, and the tamper above REPLACED the function as the cluster
        // superuser — which makes THAT role the owner and leaves the migration role unable
        // to replace it back. Re-applying the migration without dropping first would fail
        // with `must be owner of function ccpa_applicable`, and the suite would report a
        // restore failure for a restore that was never attempted. A superuser may drop
        // any function, so the drop is here; the recreation, and the ownership that goes
        // with it, come from the migration.
        superuserExec('DROP FUNCTION IF EXISTS public.ccpa_applicable()');
        const restored = applyMigration('0013_company_profile.sql');
        expect(restored.code, `re-applying 0013 to restore the predicate failed:\n${restored.output}`).toBe(0);
      }

      // Restored, and proven by re-running the assertion that must fail again.
      expect(ccpaApplicableAs('app_admin')).toBe(false);
      expect(ccpaApplicableAs('app_anon')).toBe(false);

      // And the shipped attributes are back, not merely the body: the tamper above
      // dropped SECURITY DEFINER and the pinned search_path, so a restore that only put
      // the body back would leave an anon caller unable to execute it.
      const attributes = superuserRows<{ prosecdef: boolean; search_path: string }>(
        `SELECT p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') AS search_path
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'ccpa_applicable'`,
      );
      expect(attributes[0]?.prosecdef).toBe(true);
      expect(attributes[0]?.search_path).toContain('search_path=');
      expect(ccpaApplicableAs('app_anon')).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'the seed ran cleanly and both migrations are in the ledger, so nothing above is testing a half-provisioned database',
    () => {
      // Every assertion above reads rows this fixture wrote. If the seed had failed the
      // roles and the `member` role would be missing, and the permitted member cases
      // would pass for the wrong reason — a capability system that denies everyone looks
      // exactly like one that works.
      expect(seedRun.code, `the seed failed:\n${seedRun.output}`).toBe(0);
      expect(seedRun.output).toContain('seed complete.');

      const applied = superuserRows<{ name: string }>(
        `SELECT name FROM migrations WHERE name IN ('0012_user_geo.sql', '0013_company_profile.sql') ORDER BY name`,
      );
      expect(applied.map((row) => row.name)).toEqual([
        '0012_user_geo.sql',
        '0013_company_profile.sql',
      ]);

      // The tables exist with the shapes the assertions above assume, so a migration that
      // failed to apply is reported here by name rather than as a null somewhere further
      // down.
      const tables = superuserRows<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name IN ('company_profile', 'company_addresses')
          ORDER BY table_name`,
      );
      expect(tables.map((row) => row.table_name)).toEqual(['company_addresses', 'company_profile']);
    },
    TIMEOUT,
  );
});
