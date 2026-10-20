import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';
import { startPostgrestProcess, type PostgrestProcess } from '../support/postgrest-process.js';
import {
  describePostgrestStartupFailure,
  POSTGREST_STARTUP_TIMEOUT_MS,
} from '../support/postgrest-startup.js';
import { mintToken, parseJsonArray, request, sqlStateOf } from './support/jwt.js';

/**
 * `0026_member_self_write.sql` — who may write a `users` row, and how much of it.
 *
 * ## What this suite is proving
 *
 * `0026` changes WHO may write what on the identity table, so the suite is the proof that
 * the change is as narrow as it claims. Every case below is a shape of write that must be
 * refused, or a positive case that would otherwise be able to pass against a policy that
 * refuses everybody.
 *
 *  1. **a member CAN write their own `first_name` / `last_name`** over PostgREST — the
 *     permitted case. A suite of denials alone is green against a policy that denies
 *     everybody, which is a capability system that looks exactly like one that works.
 *  2. **a member CANNOT write another member's row** — same group on purpose, so the
 *     denial is "a different person" and not "another tenant".
 *  3. **a member CANNOT rewrite `created_at`, `deleted_at`, `email`, `username` or any
 *     `disabled_*`** — one case each, because "the other columns are withheld too" is a
 *     claim and a claim is not an assertion.
 *  4. **a member CANNOT repoint a row's `id`**, and this case is the interesting one: the
 *     grant is WIDENED inside the test, so the refusal that comes back is demonstrably the
 *     POLICY's `WITH CHECK` and not the column grant it has stopped relying on.
 *  5. **`app_admin` can still write every one of those columns**, because erasure,
 *     retention and seeding depend on it — the superset, asserted per column.
 *  6. **the twelve-column member READ grant is unchanged**, read from `pg_attribute`'s ACL
 *     through `aclexplode` rather than from this migration's comment, because a write
 *     migration that quietly narrowed a read is a regression nobody would otherwise see.
 *  7. **the grant ORDER still fails open when reversed**, in the UPDATE direction this
 *     file needed it for the first time, and the two orders cannot both be right.
 *  8. **the policy is a TOTAL expression** — a garbage or empty `sub` is a clean denial on
 *     the WRITE, and it does not take the admin branch down with it.
 *  9. **the suite can fail.** Two tampers, each removing one control and watching the
 *     matching case go wrong, then restoring it and watching the denial return.
 *
 * ## The database
 *
 * A throwaway one built by the REAL pipeline — the role bootstrap, every migration in
 * directory order (read from the directory, never a hand-kept list, so this suite cannot
 * pass against a schema the application no longer ships), then the real
 * `database/seed.ts`. It refuses the development database by name.
 *
 * It runs the seed, which issues a CLUSTER-scoped `ALTER ROLE pgrst_authenticator
 * … PASSWORD`, so `afterAll` restores it — the wiring `test/rls/rls.spec.ts` gates by
 * scanning this directory rather than by a hand-written list.
 *
 * ## Why this suite starts its own PostgREST
 *
 * `support/fixture.ts`'s server points at `rls_proof`, which `rebuildDatabase()` builds
 * from `0001` alone — a schema with no `users` table at all. The launcher is duplicated for
 * the same reason `email-messages.spec.ts`, `uuid-keys.spec.ts` and `seed.spec.ts` each
 * duplicate theirs: the duplicated part is deliberately the SMALL part — the port guard,
 * the `PGRST_*` stripping and the readiness probe — because each of those three is a
 * silent-failure trap rather than plumbing.
 *
 * Port 3019, distinct from the shared fixture's 3016, `user-identity.spec.ts`'s 3017 and
 * `geo-profile.spec.ts`'s 3018. The suites run in sequence (`fileParallelism: false`), so
 * sharing would work today — but a leftover PostgREST from a killed run would then make
 * this suite attach to a server serving a DIFFERENT database, and every assertion would
 * either pass against the wrong schema or fail for no readable reason.
 */

const TIMEOUT = 180_000;
const PROOF_DB = 'member_self_write_proof';
const PROOF_PORT = 3019;

/** The password this suite authenticates `pgrst_authenticator` with, read from config. */
const AUTHENTICATOR_PASSWORD = loadTestEnvironment().authenticator.password;

/** The signing secret for this suite's own PostgREST. Never the application's. */
const PROOF_JWT_SECRET = 'w26-member-self-write-signing-0123456789ab';

const BOOTSTRAP_SQL = join(BACKEND_ROOT, 'database', 'bootstrap', '001_roles.sql');
const MIGRATIONS_DIR = join(BACKEND_ROOT, 'database', 'migrations');

/**
 * Read from the directory rather than listed here. A hand-kept list goes stale the moment
 * a migration is added, and the proof database is then built on a schema the application no
 * longer ships — every assertion below would pass against a baseline that does not exist in
 * production.
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
 *   group ──── selfMember    ── role `member`, the caller
 *           └─ otherMember   ── role `member`, SAME GROUP: the denial is about a person
 *
 *   (none)  ──  loneMember   ── NO role row and NO membership row
 *
 * `selfMember` and `otherMember` take the SEEDED `member` role rather than an invented one,
 * for the reason `user-identity.spec.ts` gives: a fixture holding a role nobody holds
 * proves the policy rather than the fixture.
 *
 * **`loneMember` exists for the `id`-repoint case and the reason is mechanical.** Five
 * foreign keys name `users.id` with `ON DELETE CASCADE` and no `ON UPDATE` action
 * (`0008`, `0010`, `0015`), and PostgreSQL's AFTER-ROW referential trigger fires BEFORE an
 * UPDATE's RLS `WITH CHECK` is evaluated. A row with a `user_roles` or `user_groups` row
 * therefore cannot be repointed without raising `23503` from the foreign key first, which
 * would mean the case never reached the clause it exists to prove. A row with NO
 * referencing rows has nothing to check, so the only control left standing is `users_update`.
 *
 * It is also a real shape rather than a contrivance. It is exactly the account
 * `POST /api/users` used to produce — and after `UsersService.createUser` began requiring
 * `role` and `group`, it is an account NO ROUTE IN THIS TREE PRODUCES ANY MORE, which is
 * what makes it the right subject here: `users_update` is keyed on IDENTITY rather than on
 * capability, so this row is how that decision reads from the outside. A member holding no
 * `user:read` can still correct the spelling of their own name, and can do nothing else.
 */
const IDS = {
  groups: {
    self: '77777777-0000-0000-0000-000000000001',
    other: '77777777-0000-0000-0000-000000000002',
  },
  users: {
    selfMember: '88888888-0000-0000-0000-000000000001',
    otherMember: '88888888-0000-0000-0000-000000000002',
    tombstone: '88888888-0000-0000-0000-000000000003',
    loneMember: '88888888-0000-0000-0000-000000000004',
  },
} as const;

/**
 * A UUID no row in the fixture holds. The repoint probe moves a row's `id` to something,
 * and moving it onto a row that already exists would raise `23505` from `users_pkey`
 * before any policy is consulted.
 */
const UNUSED_UUID = '88888888-0000-0000-0000-00000000dead';

/** The hash written into every probe row, so a leak is unmistakable in a body. */
const PROBE_HASH = 'PROBE-SECRET-HASH-0026';

/**
 * The twelve columns `app_member` may READ on `users` — written out here because the
 * assertion below is that the LIVE CATALOG still carries exactly this set, and an assertion
 * copied out of the migration it audits proves nothing.
 *
 * It is also the set `UsersService.updateMe` sends as `select=`, which is why one of the two
 * moving without the other is a red run here rather than a `42501` in production.
 */
const MEMBER_READ_COLUMNS: readonly string[] = [
  'id',
  'username',
  'email',
  'created_at',
  'country_code',
  'region_code',
  'city',
  'geo_source',
  'geo_accuracy_km',
  'geo_updated_at',
  'first_name',
  'last_name',
];

/** The two columns `app_member` may WRITE, and the ones this suite proves it cannot. */
const MEMBER_WRITE_COLUMNS: readonly string[] = ['first_name', 'last_name'];

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
 * Superuser SQL, returned as parsed JSON rows.
 *
 * Read through the superuser rather than through any serving role, and that is not
 * convenience: `users` is `FORCE ROW LEVEL SECURITY`, so a claimless owner read returns
 * ZERO rows and a count taken that way is silently zero forever. Every "and the row is
 * unchanged" assertion in this suite goes through here.
 */
function superuserRows<T>(sql: string): readonly T[] {
  const stdout = psqlAsSuperuser(
    PROOF_DB,
    `SELECT coalesce(json_agg(_q)::text, '[]') FROM (${sql.replace(/;\s*$/, '')}) AS _q`,
  );
  const trimmed = stdout.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
}

/**
 * One statement per call: `CREATE DATABASE` and `DROP DATABASE` cannot run inside a
 * transaction block, and psql wraps a multi-statement `-c` in exactly one.
 */
function superuserExec(sql: string, database: string = PROOF_DB): void {
  psqlAsSuperuser(database, sql);
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
    throw new Error(`refusing to run the member-write proof against the development database (name: ${name})`);
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
    env: { ...process.env, DB_NAME: PROOF_DB, SEED_ADMIN_PASSWORD: 'member-write-proof-admin-password' },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * A client for the migration/owner role, which is the ONLY identity that may `GRANT` on
 * `users`: a privilege can only be conferred by the table owner or a superuser, so the
 * tamper cases that widen and narrow the member's grant have to run through here.
 */
function ownerClient(): Client {
  return new Client({ ...loadTestEnvironment().database, database: PROOF_DB });
}

/** Runs `work` on a fresh owner connection, in ONE transaction. */
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

/** Runs `work` as `app_admin` through the escalation boundary, in ONE transaction. */
async function asAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'pgrst_authenticator',
    password: AUTHENTICATOR_PASSWORD,
    database: PROOF_DB,
  });
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

// =============================================================================
// Running statements as a serving role
// =============================================================================

/**
 * The outcome of a scripted psql run, without the throw.
 *
 * Every "this is refused" assertion needs this shape. A helper that throws on a non-zero
 * status cannot express "refused", and one that reports refusal as an exception tells the
 * caller nothing about WHICH refusal it was: `42501 permission denied for column email`
 * and `42501 new row violates row-level security policy` are two DIFFERENT controls and a
 * status code cannot tell them apart. So the SQLSTATE and the message both come back.
 */
interface Attempt {
  readonly ok: boolean;
  readonly output: string;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Runs `statements` in ONE transaction and reports whether it was refused.
 *
 * `\set VERBOSITY verbose` is what puts the SQLSTATE in psql's own output as
 * `ERROR:  42501: …`. Without it a refusal reads as prose and the caller has nothing
 * machine-readable to assert on — which is the whole reason this suite does not use
 * `queryAsRole`, whose contract is that the statement SUCCEEDS.
 *
 * `-q` is deliberately NOT passed: these assertions read the command TAG (`UPDATE 0`
 * against `UPDATE 1`), and `-q` suppresses exactly that. A POLICY denial is not an error —
 * it is zero rows and exit 0 — so without the tag the distinction between "refused" and
 * "silently did nothing" disappears.
 */
function runScript(statements: readonly string[]): Attempt {
  const script = [
    '\\set VERBOSITY verbose',
    'BEGIN;',
    ...statements.map((statement) => `${statement.trim().replace(/;$/, '')};`),
    'COMMIT;',
  ].join('\n');
  const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-d', PROOF_DB], {
    encoding: 'utf8',
    input: script,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const failure = /^ERROR:\s+([0-9A-Z]{5}):\s*(.*)$/m.exec(output);
  return {
    ok: result.status === 0,
    output,
    code: failure?.[1],
    message: failure?.[2],
  };
}

/**
 * Runs `statements` as `role` with `request.jwt.claims` in force, in one transaction, and
 * reports refusal rather than throwing.
 *
 * Run through the cluster superuser because it is the only identity that can borrow a
 * serving role. The migration role deliberately is not a member of any serving role, and
 * granting it membership would reopen exactly the escalation these tests exist to close.
 *
 * `claims === undefined` means the setting is never touched, which is itself one of the
 * shapes under test.
 */
function attemptAsRole(role: string, claimsDocument: string | undefined, statements: readonly string[]): Attempt {
  const preamble = [
    `SET LOCAL ROLE ${role}`,
    ...(claimsDocument === undefined
      ? []
      : [`SELECT set_config('request.jwt.claims', '${claimsDocument.replaceAll("'", "''")}', true) \\g /dev/null`]),
  ];
  return runScript([...preamble, ...statements]);
}

/** The `UPDATE n` / `INSERT 0 n` / `DELETE n` tag psql printed, or undefined. */
function rowTag(attempt: Attempt): number | undefined {
  const match = /\b(?:UPDATE|INSERT|DELETE)\s+(\d+)/.exec(attempt.output);
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
}

/** A member (`actorId`, defaulting to `selfMember`) writing `first_name` on `targetId` over SQL. */
function memberWrite(targetId: string, value: string, actorId: string = IDS.users.selfMember): Attempt {
  return attemptAsRole('app_member', claims(actorId, 'app_member'), [
    `UPDATE users SET first_name = '${value}' WHERE id = '${targetId}'`,
  ]);
}

/**
 * Reinstates `users_update` verbatim from `0026`, on an owner connection.
 *
 * Called from the two tamper cases, and only those. **The owner is the identity that may
 * `GRANT` on `users` and `CREATE POLICY` on it**, so DDL-side tampering has nowhere else to
 * go — but it is NOT the identity for DML: `users` is `FORCE ROW LEVEL SECURITY`, so an
 * owner write is bound by `users_update` like anybody else's, which is why TAMPER 2's
 * repair goes through `asAdmin` instead.
 *
 * **Duplicated from the migration rather than re-applied from it**, and that is a
 * deliberate exception to §2.4: applying `0026` would re-issue the whole `REVOKE ALL` /
 * `GRANT` block, which is a bigger change than a tamper is allowed to make, and reading the
 * migration file at test time would make the assertion depend on the parser
 * `scripts/migrate.ts` uses. The restore is small, total, and both tamper cases re-assert
 * the shipped behaviour afterwards, so a divergence from the file shows up as a red case
 * rather than as a silently different policy.
 */
function restoreShippedUpdatePolicy(client: Client): Promise<unknown> {
  return client
    .query('DROP POLICY IF EXISTS users_update ON public.users')
    .then(() =>
      client.query(`CREATE POLICY users_update ON public.users FOR UPDATE
        USING (current_user = 'app_admin' OR (deleted_at IS NULL AND id IN (SELECT authz.actor() AS actor_id)))
        WITH CHECK (current_user = 'app_admin' OR (deleted_at IS NULL AND id IN (SELECT authz.actor() AS actor_id)))`),
    );
}

/**
 * Verifies from the live catalog and a live cross-member probe that a tamper's `finally`
 * actually restored the shipped grants and `users_update` policy.
 */
function assertShippedCatalogState(): void {
  const writableColumns = superuserRows<{ column: string }>(
    `SELECT a.attname AS column
       FROM pg_attribute a,
            aclexplode(coalesce(a.attacl, acldefault('c', a.attrelid))) AS priv
       JOIN pg_roles r ON r.oid = priv.grantee
      WHERE a.attrelid = 'public.users'::regclass
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND r.rolname = 'app_member'
        AND priv.privilege_type = 'UPDATE'
      ORDER BY a.attname`,
  ).map((row) => row.column);
  expect(writableColumns, 'the restored UPDATE grant list on users does not match the shipped two columns').toEqual(
    [...MEMBER_WRITE_COLUMNS].sort(),
  );

  const policies = superuserRows<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(
    `SELECT policyname, cmd, qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'users_update'`,
  );
  expect(policies).toHaveLength(1);
  const update = policies[0];
  for (const clause of [update?.qual ?? '', update?.with_check ?? '']) {
    expect(clause).toMatch(/current_user\s*=\s*'app_admin'/i);
    expect(clause).toContain('deleted_at IS NULL');
    expect(clause).toMatch(/id IN \(\s*SELECT authz\.actor\(\)/i);
  }

  const crossMember = memberWrite(IDS.users.otherMember, 'Grace');
  expect(crossMember.ok, `the restored policy raised on a cross-member write: ${crossMember.output}`).toBe(true);
  expect(rowTag(crossMember), `the restored policy admitted a cross-member write: ${crossMember.output}`).toBe(0);
}

// =============================================================================
// PostgREST — THE SHARED LAUNCHER, NOT A THIRD COPY
// =============================================================================
//
// This suite used to carry its own `baseUrl`/`probePort`/`writeConfig`/
// `proofChildEnv`/`startPostgrest`, and that copy is what `test/support/
// postgrest-process.ts` was written to prevent. Its own docstring says: "if a
// third configuration ever needs one, the right move is to lift both into this
// module". A third configuration is exactly what arrived, so the inline copy is
// gone and this suite calls `startPostgrestProcess` with its own four settings.
//
// The inline copy also could not have worked here: its `POSTGREST_BINARY` was the
// Linux path `/usr/local/bin/postgrest`, which does not exist on the machine these
// proofs also have to run on. The shared launcher resolves the binary portably,
// which is a second reason to stop copying it.

const PROFILE_SELECT = MEMBER_READ_COLUMNS.join(',');

function baseUrl(): string {
  return postgrest.baseUrl;
}

/** A token for the proof server: the proof's own secret, never the application's. */
function token(sub: string, role: 'app_member' | 'app_admin'): string {
  return mintToken(PROOF_JWT_SECRET, { sub, role });
}

// =============================================================================
// The fixture
// =============================================================================

let seedRun: { readonly code: number; readonly output: string };
let postgrest: PostgrestProcess;

beforeAll(async () => {
  recreateDatabase(PROOF_DB);
  applyBaseline();
  seedRun = runSeed();

  await asAdmin(async (client) => {
    // The seeded `member` role is READ BACK rather than assumed, so this fixture cannot
    // drift from the seed's role graph — a fixture holding a role nobody holds would prove
    // the policy rather than the fixture.
    const roles = await client.query<{ name: string; id: string }>(
      `SELECT name, id FROM roles WHERE name = 'member'`,
    );
    const memberRole = roles.rows[0]?.id;
    if (memberRole === undefined) {
      throw new Error('the seeded `member` role is absent, so the permitted write case cannot run');
    }

    for (const [user, username, firstName, lastName] of [
      [IDS.users.selfMember, 'selfwrite-self', 'Ada', 'Lovelace'],
      [IDS.users.otherMember, 'selfwrite-other', 'Grace', 'Hopper'],
    ] as const) {
      await client.query(
        `INSERT INTO users (id, username, email, password_hash, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user, username, `${username}@example.test`, PROBE_HASH, firstName, lastName],
      );
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [user, memberRole]);
    }

    // `loneMember`: created, and deliberately left with NO `user_roles` and NO
    // `user_groups` row. See `IDS.users.loneMember` for why the repoint case needs one.
    await client.query(
      `INSERT INTO users (id, username, email, password_hash, first_name, last_name)
       VALUES ($1, 'selfwrite-lone', 'selfwrite-lone@example.test', $2, 'Alan', 'Kay')`,
      [IDS.users.loneMember, PROBE_HASH],
    );

    // The tombstone, written through the admin path exactly as
    // `src/privacy/erasure.service.ts` writes one, which also fires
    // `authz.revoke_subject_authority` (`0009`). The row therefore has NO role and NO
    // membership by the time the cases below reach it, and that is the realistic shape of
    // an anonymised account rather than a constructed one.
    await client.query(
      `INSERT INTO users (id, username, email, password_hash, first_name, last_name)
       VALUES ($1, 'selfwrite-tombstone', 'selfwrite-tombstone@example.test', $2, 'Alan', 'Turing')`,
      [IDS.users.tombstone, PROBE_HASH],
    );
    await client.query('UPDATE users SET deleted_at = now(), deletion_reason = $2 WHERE id = $1', [
      IDS.users.tombstone,
      'rtbf',
    ]);
  });

  // Membership, through the OWNER: `0001` grants no write on `user_groups` to any serving
  // role, and the seed's `grantSeedAccess()` widens it for `app_admin` only. The owner is
  // the sanctioned writer on every database, so the fixture does not depend on which of
  // those two is true here.
  await asOwner(async (client) => {
    await client.query(
      `INSERT INTO groups (id, name) VALUES ($1, 'selfwrite-EU'), ($2, 'selfwrite-US') ON CONFLICT DO NOTHING`,
      [IDS.groups.self, IDS.groups.other],
    );
    for (const [user, group] of [
      [IDS.users.selfMember, IDS.groups.self],
      [IDS.users.otherMember, IDS.groups.self],
    ] as const) {
      await client.query('INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        user,
        group,
      ]);
    }
  });

  postgrest = await startPostgrestProcess({
    port: PROOF_PORT,
    database: PROOF_DB,
    authenticatorPassword: AUTHENTICATOR_PASSWORD,
    jwtSecret: PROOF_JWT_SECRET,
  });

  // The launcher has already waited for the catalogue over HTTP, so this is a
  // second opinion rather than the readiness check. It keeps the same ceiling as
  // every other launcher — the 30 seconds it used to carry was tight enough to
  // trip on a loaded machine, and when it tripped the whole file was SKIPPED.
  const readyDeadline = Date.now() + POSTGREST_STARTUP_TIMEOUT_MS;
  let ready = false;
  while (Date.now() < readyDeadline) {
    try {
      const probe = await fetch(`${postgrest.baseUrl}/`, { signal: AbortSignal.timeout(1_000) });
      if (probe.status > 0) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!ready) {
    throw new Error(
      describePostgrestStartupFailure({
        port: PROOF_PORT,
        waitedMs: POSTGREST_STARTUP_TIMEOUT_MS,
        timeoutMs: POSTGREST_STARTUP_TIMEOUT_MS,
        child: { exitCode: null, signal: null, log: postgrest.log(), spawnError: undefined },
        probe: { ready: false, answered: undefined },
      }),
    );
  }
}, TIMEOUT);

afterAll(() => {
  // `database/seed.ts` runs a CLUSTER-scoped `ALTER ROLE … PASSWORD`, so the cluster is
  // restored in a `finally`: it is the one step that must not be skipped, and it must not
  // sit behind the drop above. Stopping PostgREST first is what lets the DROP terminate
  // cleanly rather than fail naming a connection.
  try {
    postgrest?.stop();
  } finally {
    try {
      dropProofDatabase();
    } finally {
      restoreAuthenticatorPassword();
    }
  }
});

// =============================================================================
// 1 — the permitted case
// =============================================================================

describe('a member writes their own name, and the answer is what the DATABASE stored', () => {
  it(
    'a member CAN write their own first_name and last_name through PostgREST, on their own row',
    async () => {
      // The case a suite of denials alone is missing: against a policy that refuses
      // everybody, every other `it()` in this file is green.
      //
      // `Prefer: return=representation` is load-bearing and not decoration — PostgREST's
      // default for `PATCH` is `return=minimal`, which answers `204` with no body (`return=full`
      // is ignored by PostgREST and falls back to `204`), and the `200` of `PATCH /api/users/me`
      // IS the stored row. `UsersService.updateMe` sends the same two things for the same
      // reasons.
      const response = await request(
        `${baseUrl()}/users?id=eq.${IDS.users.selfMember}&select=${PROFILE_SELECT}`,
        token(IDS.users.selfMember, 'app_member'),
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ first_name: 'Adalovelace', last_name: 'Byron' }),
        },
      );

      expect(response.status, `the member's own write returned ${response.status}: ${response.body}`).toBe(200);
      const rows = parseJsonArray(response.body);
      expect(rows).toHaveLength(1);

      // Exactly the twelve granted columns and no more: the response is the read grant, so a
      // body carrying `password_hash` would be the same leak the read policy exists to
      // prevent, reached through the write path instead.
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual([...MEMBER_READ_COLUMNS].sort());
      expect(rows[0]?.['first_name']).toBe('Adalovelace');
      expect(rows[0]?.['last_name']).toBe('Byron');

      // And the value is in the row, read by a SUPERUSER rather than through the API layer.
      // "The 200 said so" is exactly the assertion this repository distrusts.
      const stored = superuserRows<{ first_name: string; last_name: string }>(
        `SELECT first_name, last_name FROM users WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(stored[0]?.first_name).toBe('Adalovelace');
      expect(stored[0]?.last_name).toBe('Byron');

      // Only the named column moves. `UsersService.updateMe` builds the body from the keys
      // the DTO carries, and a body naming one field must not clear the other: a partial
      // write that returns 200 is the worst way to ship the data-loss bug
      // `test/e2e/profile.e2e-spec.ts` was written against.
      await request(
        `${baseUrl()}/users?id=eq.${IDS.users.selfMember}&select=${PROFILE_SELECT}`,
        token(IDS.users.selfMember, 'app_member'),
        { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ first_name: 'Ada' }) },
      );
      const partial = superuserRows<{ first_name: string; last_name: string }>(
        `SELECT first_name, last_name FROM users WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(partial[0]?.first_name).toBe('Ada');
      expect(partial[0]?.last_name, 'a one-field write cleared the other field').toBe('Byron');

      // Restore the fixture so the cases below compare against a known state.
      await asAdmin(async (client) => {
        await client.query('UPDATE users SET first_name = $2, last_name = $3 WHERE id = $1', [
          IDS.users.selfMember,
          'Ada',
          'Lovelace',
        ]);
      });
    },
    TIMEOUT,
  );

  it(
    'a blank name is refused by the DATABASE, and the refusal is a code rather than a crash',
    async () => {
      // `users_first_name_not_blank` / `users_last_name_not_blank` (`0023`). PostgREST
      // carries the SQLSTATE through as `code`, and `UsersService.updateMe` maps it to a
      // `422`. The assertion is on the code and on the row, never on the status alone: with
      // a column-restricted role in play, HTTP 200 is what a leak looks like.
      const response = await request(
        `${baseUrl()}/users?id=eq.${IDS.users.selfMember}&select=${PROFILE_SELECT}`,
        token(IDS.users.selfMember, 'app_member'),
        { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ first_name: '   ' }) },
      );

      expect(sqlStateOf(response.body), `a blank name was accepted: ${response.status} ${response.body}`).toBe('23514');

      const stored = superuserRows<{ first_name: string }>(
        `SELECT first_name FROM users WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(stored[0]?.first_name).toBe('Ada');
    },
    TIMEOUT,
  );
});

// =============================================================================
// 2 — the row bound
// =============================================================================

describe('a member writes their OWN row, which is a person and not a tenant', () => {
  it(
    'a member CANNOT write a colleague in their OWN group — zero rows, and the colleague is unchanged',
    () => {
      // Same group on purpose. The attack is "somebody else", not "another tenant": a policy
      // that accidentally widened to group scope would be caught here, and one that only
      // answered "not my tenant" would pass it.
      const attempt = memberWrite(IDS.users.otherMember, 'Not-Mine');

      // A POLICY denial is not an error. Zero rows, exit 0 — the refusal has to arrive as a
      // refusal, and an assertion of `ok === false` here would be asserting the wrong
      // control entirely.
      expect(attempt.ok, `the cross-member write raised rather than denying: ${attempt.output}`).toBe(true);
      expect(rowTag(attempt), `expected UPDATE 0 and got: ${attempt.output}`).toBe(0);

      // Ground truth, read as a superuser so the count cannot be a visibility artefact: the
      // row IS there and it did NOT change.
      const colleague = superuserRows<{ first_name: string }>(
        `SELECT first_name FROM users WHERE id = '${IDS.users.otherMember}'`,
      );
      expect(colleague[0]?.first_name).toBe('Grace');
    },
    TIMEOUT,
  );

  it(
    'a member CANNOT put a name on their own tombstone, in SQL or over the wire',
    async () => {
      // `users_update`'s member branch carries `deleted_at IS NULL`, borrowed from
      // `users_read_scope`. This is a case the SERVICE could not express at all: a PostgREST
      // filter on `deleted_at` is privilege-checked like any other column reference and
      // `deleted_at` is not in the member's twelve-column grant. Moving the rule into the
      // policy is what makes it expressible, and this is that move being exercised.
      const attempt = memberWrite(IDS.users.tombstone, 'Resurrected', IDS.users.tombstone);
      expect(attempt.ok, `a tombstone write raised rather than denying: ${attempt.output}`).toBe(true);
      expect(rowTag(attempt), `a tombstone was writable: ${attempt.output}`).toBe(0);

      const tombstone = superuserRows<{ first_name: string; deleted_at: string | null }>(
        `SELECT first_name, deleted_at FROM users WHERE id = '${IDS.users.tombstone}'`,
      );
      expect(tombstone[0]?.first_name).toBe('Alan');
      expect(
        tombstone[0]?.deleted_at,
        'the tombstone lost its deleted_at, so this row is not a tombstone and the case proves nothing',
      ).not.toBeNull();

      // Over the wire as well, because a rule that holds only in SQL is a rule about a
      // different database than the one the application uses.
      const response = await request(
        `${baseUrl()}/users?id=eq.${IDS.users.tombstone}&select=${PROFILE_SELECT}`,
        token(IDS.users.tombstone, 'app_member'),
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ first_name: 'Resurrected' }),
        },
      );
      expect(
        JSON.stringify(parseJsonArray(response.body)),
        'a member named a row they cannot even read',
      ).not.toContain('Resurrected');
    },
    TIMEOUT,
  );
});

// =============================================================================
// 3 — the column bound, named column by column
// =============================================================================

describe('a member writes TWO columns, and which two is asserted one at a time', () => {
  it(
    'a member CANNOT rewrite created_at, deleted_at, email, username, or any disabled_* column',
    () => {
      // One case per column, and the reason is that "the other columns are withheld too" is
      // a CLAIM. A grant that widens by one column is the failure this whole change closes,
      // and it would be invisible if the test asked only about `email`.
      //
      // Each attempt asserts TWO things, because `42501` alone cannot tell them apart: that
      // the statement was refused, and that the row is UNCHANGED afterwards read by a
      // superuser. The second is what §B2 asks for — a status-only assertion passes on a
      // real leak, and here the leak is a silent rewrite of an audit column.
      const forbidden: ReadonlyArray<{ readonly column: string; readonly value: string }> = [
        { column: 'created_at', value: "'1999-01-01T00:00:00Z'" },
        { column: 'deleted_at', value: 'NULL' },
        { column: 'email', value: "'attacker@example.test'" },
        { column: 'username', value: "'selfwrite-hijacked'" },
        { column: 'disabled_at', value: 'NULL' },
        { column: 'disabled_by', value: 'NULL' },
        { column: 'disabled_reason', value: "'admin'" },
        { column: 'disabled_until', value: 'NULL' },
      ];

      for (const { column, value } of forbidden) {
        const attempt = attemptAsRole('app_member', claims(IDS.users.selfMember, 'app_member'), [
          `UPDATE users SET ${column} = ${value} WHERE id = '${IDS.users.selfMember}'`,
        ]);

        expect(attempt.ok, `${column} was written by a member: ${attempt.output}`).toBe(false);
        expect(attempt.code, `expected 42501 for ${column}, got ${attempt.code ?? 'none'}: ${attempt.output}`).toBe('42501');

        const unchanged = superuserRows<Record<string, unknown>>(
          `SELECT created_at, deleted_at, email, username, disabled_at, disabled_by, disabled_reason, disabled_until
             FROM users WHERE id = '${IDS.users.selfMember}'`,
        );
        expect(unchanged[0]?.['username'], `${column} was rewritten under a member write`).toBe('selfwrite-self');
        expect(unchanged[0]?.['email']).toBe('selfwrite-self@example.test');
        expect(unchanged[0]?.['deleted_at']).toBeNull();
        expect(unchanged[0]?.['disabled_at']).toBeNull();
        expect(unchanged[0]?.['disabled_reason']).toBeNull();
      }

      // `created_at` is not in the projection above on purpose: it is a `timestamptz`, and
      // a string comparison against a JSON round trip is a weaker assertion than the four
      // exact ones. So it gets its own, from the catalog rather than from the value.
      const stamped = superuserRows<{ created: string }>(
        `SELECT to_char(created_at, 'YYYY-MM-DD') AS created FROM users WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(stamped[0]?.created, 'a member moved their own created_at').not.toBe('1999-01-01');

      // The catalog, which is what actually proves the GRANT is the control: a refusal could
      // equally have come from `0009`'s anonymisation trigger or `0023`'s blank rules, and
      // those touch three of the eight columns above.
      for (const { column } of forbidden) {
        const holds = superuserRows<{ holds: boolean }>(
          `SELECT has_column_privilege('app_member', 'public.users', '${column}', 'UPDATE') AS holds`,
        );
        expect(holds[0]?.holds, `app_member holds UPDATE on users.${column}`).toBe(false);
      }
      for (const column of MEMBER_WRITE_COLUMNS) {
        const holds = superuserRows<{ holds: boolean }>(
          `SELECT has_column_privilege('app_member', 'public.users', '${column}', 'UPDATE') AS holds`,
        );
        expect(
          holds[0]?.holds,
          `app_member cannot UPDATE users.${column}, so the permitted case above proves nothing`,
        ).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    'a member CANNOT delete a users row, so the erasure cascade is not reachable as a member write',
    () => {
      // Asserted per verb and read from `pg_class`, which is TABLE-level: a COLUMN grant does
      // not answer true there, so none of this can be satisfied by the two-column UPDATE — and
      // all of it would be satisfied if that grant had been written table-level by mistake.
      for (const privilege of ['INSERT', 'DELETE', 'TRUNCATE']) {
        const holds = superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_member', 'public.users', '${privilege}') AS holds`,
        );
        expect(holds[0]?.holds, `app_member holds ${privilege} on users`).toBe(false);
      }
      const writes = superuserRows<{ holds: boolean }>(
        `SELECT has_table_privilege('app_member', 'public.users', 'UPDATE') AS holds`,
      );
      expect(
        writes[0]?.holds,
        'app_member holds a TABLE-level UPDATE on users, so the two-column grant is decorative and the whole-row ' +
          'write it is supposed to prevent is open',
      ).toBe(false);

      // And the live probe, because `0008`'s `ON DELETE CASCADE` reaches `email_messages` and
      // `refresh_tokens` (`0015`), which no serving role may otherwise destroy: a member who
      // could delete a `users` row would erase mail nobody else can erase.
      const attempt = attemptAsRole('app_member', claims(IDS.users.selfMember, 'app_member'), [
        `DELETE FROM users WHERE id = '${IDS.users.otherMember}'`,
      ]);
      expect(attempt.ok, `a member DELETE was not refused at the grant layer: ${attempt.output}`).toBe(false);
      expect(attempt.code, `expected 42501 on DELETE, got ${attempt.code ?? 'none'}: ${attempt.output}`).toBe('42501');

      const survives = superuserRows<{ count: number }>(
        `SELECT count(*)::int AS count FROM users WHERE id = '${IDS.users.otherMember}'`,
      );
      expect(survives[0]?.count, 'the colleague was deleted').toBe(1);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 4 — the `id` repoint, and why this case widens the grant on purpose
// =============================================================================

describe('a member cannot REPOINT a row, and the clause that stops them is the policy', () => {
  it(
    'even with UPDATE granted on `id`, WITH CHECK refuses the repoint and the row keeps its key',
    async () => {
      // This case widens the grant on purpose, and that is the whole point of it.
      //
      // With the shipped grant the repoint is refused by `GRANT UPDATE (first_name,
      // last_name)` — which proves nothing about `users_update`, and would keep passing if
      // somebody replaced the whole policy with `USING (true)`. So `UPDATE (id)` is added
      // here, and the refusal that comes back is then demonstrably the POLICY's `WITH CHECK`.
      //
      // `loneMember` is the subject because it has no `user_roles` or `user_groups` row:
      // five foreign keys name `users.id` with `ON DELETE CASCADE` and no `ON UPDATE`
      // action, and PostgreSQL's AFTER-ROW referential trigger fires BEFORE an UPDATE's RLS
      // `WITH CHECK`, so a row with a referencing membership row would raise `23503` and
      // this case would never reach the clause it exists to prove. See `IDS.users.loneMember`.
      const subject = IDS.users.loneMember;

      // The shape this case proves is not refuted before the grant is widened: with the
      // shipped grant, `id` is withheld at the column.
      const beforeGrant = attemptAsRole('app_member', claims(subject, 'app_member'), [
        `UPDATE users SET id = '${UNUSED_UUID}' WHERE id = '${subject}'`,
      ]);
      expect(beforeGrant.ok, `the repoint raised instead of being refused: ${beforeGrant.output}`).toBe(false);

      await asOwner(async (client) => {
        await client.query('GRANT UPDATE (id) ON public.users TO app_member');
      });

      try {
        // No `WHERE id = ...`: reading any column of `users` in `WHERE` causes PostgreSQL to
        // apply the `FOR SELECT` policy (`users_read_scope`) alongside `users_update`, and
        // `loneMember` has no `user_roles` row so `authz.can_read_user()` is false and the row
        // would be filtered out (`UPDATE 0`) before `users_update`'s `WITH CHECK` is reached.
        // Without `WHERE`, `users_update`'s own `USING` scopes the update to `authz.actor()`.
        const widened = attemptAsRole('app_member', claims(subject, 'app_member'), [
          `UPDATE users SET id = '${UNUSED_UUID}'`,
        ]);

        // The grant no longer stops it, so whatever refuses it now is the policy.
        //
        // **A `WITH CHECK` refusal is an ERROR, not zero rows** — `42501`, `new row
        // violates row-level security policy`. That is a different shape from a `USING`
        // denial (a row the `USING` filters out is simply not updated, and the statement
        // exits 0), and the difference is the assertion: with `id` in the grant the
        // statement would otherwise have succeeded, so a refusal here is the policy and a
        // success would be a hole. The message is asserted too, because `42501` is also
        // what the grant layer raises for something else entirely.
        expect(widened.ok, `the repoint was not refused: ${widened.output}`).toBe(false);
        expect(widened.code, `expected 42501, got ${widened.code ?? 'none'}: ${widened.output}`).toBe('42501');
        expect(
          widened.message ?? '',
          `the repoint was refused, but not by the row-level security policy, so this case is not testing the ` +
            `clause it exists to prove: ${widened.output}`,
        ).toMatch(/row-level security policy/i);

        // The row kept its key, read by a superuser so this cannot be a visibility artefact.
        const kept = superuserRows<{ id: string }>(`SELECT id FROM users WHERE username = 'selfwrite-lone'`);
        expect(kept[0]?.id, 'the row was repointed anyway').toBe(subject);
      } finally {
        await asOwner(async (client) => {
          await client.query('REVOKE UPDATE (id) ON public.users FROM app_member');
        });
      }

      assertShippedCatalogState();

      // Restored, and the same statement is refused again — by the grant this time, which is
      // the state the suite's remaining cases run against.
      const restored = attemptAsRole('app_member', claims(subject, 'app_member'), [
        `UPDATE users SET id = '${UNUSED_UUID}' WHERE id = '${subject}'`,
      ]);
      expect(restored.ok, `the restored grant did not refuse the repoint: ${restored.output}`).toBe(false);
      expect(restored.code, `expected 42501, got ${restored.code ?? 'none'}: ${restored.output}`).toBe('42501');
    },
    TIMEOUT,
  );
});

// =============================================================================
// 5 — the superset
// =============================================================================

describe('app_admin is a superset, not a bypass: every column 0026 withheld from a member is its to write', () => {
  it(
    'app_admin CAN write created_at and the disabled_* columns, and CAN write deleted_at',
    async () => {
      // `src/privacy/erasure.service.ts`'s anonymisation rewrite sets `email`, `username`,
      // `password_hash`, `deleted_at` and `deletion_reason`; `0016`'s retention sweep sets
      // `deleted_at`; `0023`'s disable feature sets the four `disabled_*`. Narrow the admin on
      // any of them and one of those paths dies — the erasure one mid-transaction, which is
      // the worst place to find out.
      for (const { column, value } of [
        { column: 'disabled_reason', value: "'compliance'" },
        { column: 'disabled_at', value: 'now()' },
      ] as const) {
        const attempt = attemptAsRole('app_admin', claims(IDS.users.selfMember, 'app_admin'), [
          `UPDATE users SET ${column} = ${value} WHERE id = '${IDS.users.selfMember}'`,
        ]);
        expect(attempt.ok, `app_admin could not write ${column}: ${attempt.output}`).toBe(true);
        expect(rowTag(attempt), `app_admin's write of ${column} touched no rows: ${attempt.output}`).toBe(1);
      }

      // `created_at` is the third and the one an over-eager column grant is most likely to
      // catch by accident, because it is `NOT NULL DEFAULT now()` and therefore looks
      // writable.
      const stamped = await asAdmin(async (client) => {
        await client.query(`UPDATE users SET created_at = '2020-02-02T02:02:02Z' WHERE id = $1`, [IDS.users.selfMember]);
        return client.query<{ created: string }>(
          `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created FROM users WHERE id = $1`,
          [IDS.users.selfMember],
        );
      });
      expect(stamped.rows[0]?.created).toBe('2020-02-02');

      // Restore, and put the disable back to the state the fixture described.
      await asAdmin(async (client) => {
        await client.query(
          `UPDATE users SET created_at = now(), disabled_at = NULL, disabled_reason = NULL WHERE id = $1`,
          [IDS.users.selfMember],
        );
      });

      // `deleted_at` is the expensive one: writing it fires `authz.revoke_subject_authority`
      // (`0009`), which DELETEs the row's role and membership. If the admin could not do that,
      // erasure would leave a tombstone whose principal still holds its authority — the exact
      // defect `0008:117-129` documents about the purge.
      //
      // Proved on a row THIS case creates, and that is not tidiness. Anonymising a fixture
      // identity would leave a tombstone where the suite expects a live one, and the tamper
      // cases below depend on `loneMember` still being undeleted — a shared subject would
      // make this case's passing depend on the order two describes run in.
      const anonymised = await asAdmin(async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO users (username, email, password_hash)
           VALUES ('selfwrite-anonymised', 'selfwrite-anonymised@example.test', $1) RETURNING id`,
          [PROBE_HASH],
        );
        const id = inserted.rows[0]?.id;
        if (id === undefined) {
          throw new Error('the anonymisation probe row was not created');
        }
        await client.query(
          `INSERT INTO user_roles (user_id, role_id) SELECT $1, r.id FROM roles r WHERE r.name = 'member'`,
          [id],
        );
        const before = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM user_roles WHERE user_id = $1`,
          [id],
        );
        // Ground truth BEFORE, so the assertion afterwards is a change and not a fixture that
        // happened to be empty — the same discipline `user-identity.spec.ts`'s cascade case
        // uses for the same claim.
        expect(
          before.rows[0]?.count ?? 0,
          'the probe row started with no role, so nothing can be revoked and this case proves nothing',
        ).toBe(1);

        await client.query('UPDATE users SET deleted_at = now(), deletion_reason = $2 WHERE id = $1', [id, 'rtbf']);
        const after = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM user_roles WHERE user_id = $1`,
          [id],
        );
        return after.rows[0]?.count ?? -1;
      });
      expect(anonymised, 'the anonymised row kept its role row, so a tombstone still holds power').toBe(0);
    },
    TIMEOUT,
  );

  it(
    'app_admin holds a table-level grant on users, so every column it acquires later is reachable without a migration',
    () => {
      // Asserted because the inference a reader will make is the dangerous one: "no GRANT
      // line names these columns, so they must be unreachable". They are reachable, and that
      // is what "a table-level grant covers every column the table has now and every column
      // it acquires later" means (`0023:531-546`).
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const holds = superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_admin', 'public.users', '${privilege}') AS holds`,
        );
        expect(holds[0]?.holds, `app_admin is missing ${privilege} on users`).toBe(true);
      }
      for (const column of [...MEMBER_READ_COLUMNS, 'password_hash', 'disabled_at', 'disabled_reason']) {
        const holds = superuserRows<{ holds: boolean }>(
          `SELECT has_column_privilege('app_admin', 'public.users', '${column}', 'UPDATE') AS holds`,
        );
        expect(holds[0]?.holds, `app_admin cannot UPDATE users.${column}`).toBe(true);
      }
    },
    TIMEOUT,
  );
});

// =============================================================================
// 6 — the read grant did not move
// =============================================================================

describe('a write migration that narrows a read is a regression, and this reads the catalog rather than the comment', () => {
  it(
    'the member READ grant is still exactly the twelve columns, and the WRITE grant exactly two',
    () => {
      // Read from `pg_attribute`'s ACL through `aclexplode` rather than column by column with
      // `has_column_privilege`. Both work; this one is a single query naming the WHOLE set, so
      // a thirteenth column added by accident fails here. Twelve `has_column_privilege` calls
      // would each answer true for the column it asks about and say nothing about the rest.
      const grantsOf = (privilege: string): readonly string[] =>
        superuserRows<{ column: string }>(
          `SELECT a.attname AS column
             FROM pg_attribute a,
                  aclexplode(coalesce(a.attacl, acldefault('c', a.attrelid))) AS priv
             JOIN pg_roles r ON r.oid = priv.grantee
            WHERE a.attrelid = 'public.users'::regclass
              AND a.attnum > 0
              AND NOT a.attisdropped
              AND r.rolname = 'app_member'
              AND priv.privilege_type = '${privilege}'
            ORDER BY a.attname`,
        ).map((row) => row.column);

      expect([...grantsOf('SELECT')].sort()).toEqual([...MEMBER_READ_COLUMNS].sort());
      // The SET of writable columns is an assertion rather than an inference from the two
      // permitted cases, and `password_hash` is named explicitly because a member holding
      // UPDATE on the hash would be the most consequential grant mistake available here.
      expect([...grantsOf('UPDATE')]).toEqual([...MEMBER_WRITE_COLUMNS].sort());
      expect(grantsOf('UPDATE')).not.toContain('password_hash');
    },
    TIMEOUT,
  );

  it(
    'the member still reads their own twelve columns over the wire and still cannot read password_hash',
    async () => {
      const response = await request(
        `${baseUrl()}/users?id=eq.${IDS.users.selfMember}&select=${PROFILE_SELECT}`,
        token(IDS.users.selfMember, 'app_member'),
      );
      expect(response.status, `the member self-read returned ${response.status}: ${response.body}`).toBe(200);
      expect(Object.keys(parseJsonArray(response.body)[0] ?? {}).sort()).toEqual([...MEMBER_READ_COLUMNS].sort());

      // Asserted on the BODY, not the status: with a table-level SELECT in place a hidden
      // column comes back at HTTP 200 with its value intact, and a status-only test passes on
      // the leak.
      const named = await request(`${baseUrl()}/users?select=password_hash`, token(IDS.users.selfMember, 'app_member'));
      expect(named.body).not.toContain(PROBE_HASH);
      const wildcard = await request(`${baseUrl()}/users?select=*`, token(IDS.users.selfMember, 'app_member'));
      expect(wildcard.body).not.toContain(PROBE_HASH);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 7 — the grant order, in the UPDATE direction
// =============================================================================

describe('a column UPDATE grant only narrows a table UPDATE because the table grant was taken away first', () => {
  it(
    'IS a whole-row write while a table-level UPDATE stands, and is NOT once it is revoked — so the two orders cannot both be right',
    async () => {
      // The regression guard for `0026`'s grant-order comment, in the direction this file
      // needed it for the first time. `0001:1021` and `0008:427-432` record the same measured
      // failure for `SELECT`: revoking a COLUMN privilege while a TABLE-level grant exists is
      // accepted, exits 0, and changes nothing.
      //
      // Both halves run inside ONE transaction that is ALWAYS ROLLED BACK, so the proof
      // database is the shipped one afterwards whether the assertions pass or throw.
      //
      // **That rollback is the load-bearing part of this test, and getting it wrong is
      // worse than not writing the case at all.** The helper the rest of this file uses
      // (`asOwner`) COMMITS, so issuing the fail-open `GRANT UPDATE` through it would leave
      // `app_member` with a whole-row write on `users` for every case that follows and for
      // the next run of the suite. A raw connection with an explicit `ROLLBACK` is used
      // here for exactly that reason, and `has_any_column_privilege` is read back after it
      // as the check that the rollback actually happened rather than the intent.
      const probe = ownerClient();
      await probe.connect();
      try {
        await probe.query('BEGIN');
        await probe.query('GRANT UPDATE ON public.users TO app_member');
        await probe.query('GRANT UPDATE (first_name, last_name) ON public.users TO app_member');
        const failOpen = await probe.query<{ holds: boolean }>(
          `SELECT has_column_privilege('app_member', 'public.users', 'created_at', 'UPDATE') AS holds`,
        );
        // Fully writable. The column grant was accepted, exited 0, and did nothing.
        expect(
          failOpen.rows[0]?.holds,
          'a table-level UPDATE standing under a column grant is not a whole-row write, so the ordering is not ' +
            'load-bearing and this case proves nothing',
        ).toBe(true);

        // …and the order 0026 writes: take the table verb away FIRST, then the column list.
        await probe.query('REVOKE UPDATE ON public.users FROM app_member');
        await probe.query('GRANT UPDATE (first_name, last_name) ON public.users TO app_member');
        const narrowed = await probe.query<{ holds: boolean }>(
          `SELECT has_column_privilege('app_member', 'public.users', 'created_at', 'UPDATE') AS holds`,
        );
        expect(narrowed.rows[0]?.holds, 'the narrowed order still lets a member rewrite created_at').toBe(false);
        const permitted = await probe.query<{ holds: boolean }>(
          `SELECT has_column_privilege('app_member', 'public.users', 'first_name', 'UPDATE') AS holds`,
        );
        expect(permitted.rows[0]?.holds, 'the narrowed order locks the member out of its own name').toBe(true);
      } finally {
        await probe.query('ROLLBACK').catch(() => undefined);
        await probe.end();
      }

      // The rollback happened. Read through a SEPARATE superuser connection rather than
      // through `probe`, because the point is what the cluster now holds and not what the
      // transaction that changed it still believes.
      const shipped = superuserRows<{ holds: boolean }>(
        `SELECT has_column_privilege('app_member', 'public.users', 'created_at', 'UPDATE') AS holds`,
      );
      expect(
        shipped[0]?.holds,
        'the fail-open grant survived the rollback, so the proof database now holds a whole-row member write and ' +
          'every case after this one is testing a schema nobody shipped',
      ).toBe(false);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 8 — the policy is a total expression
// =============================================================================

describe('a malformed identity is a clean denial on the WRITE, not a 500 and not a taken-down admin', () => {
  it(
    'a garbage or empty sub denies the write with zero rows, and the admin branch is untouched',
    async () => {
      // §B2's totality rule: every `OR` branch must be safe to evaluate, because `OR` does NOT
      // short-circuit past a raising operand — a cast that raises in the member branch takes
      // the whole statement down INCLUDING the admin branch. `authz.actor()` catches the cast
      // and returns NULL, which makes `id IN (SELECT NULL …)` NULL, and a `USING` clause
      // treats NULL as a denial.
      //
      // The assertion is that the statement is DENIED and that it is denied by returning zero
      // rows. An error here would be the whole failure this case rules out: a policy that
      // raises on caller input is a denial-of-service surface and an oracle.
      for (const sub of ['', 'not-a-uuid', '{}', 'null']) {
        const attempt = attemptAsRole('app_member', claims(sub, 'app_member'), [
          `UPDATE users SET first_name = 'Zero-Rows' WHERE id = '${IDS.users.selfMember}'`,
        ]);
        expect(attempt.ok, `a sub of ${JSON.stringify(sub)} raised rather than denying: ${attempt.output}`).toBe(true);
        expect(rowTag(attempt), `a sub of ${JSON.stringify(sub)} was not a clean denial: ${attempt.output}`).toBe(0);
      }

      // Nothing moved.
      const untouched = superuserRows<{ first_name: string }>(
        `SELECT first_name FROM users WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(untouched[0]?.first_name).toBe('Ada');

      // And the admin branch still works under exactly the same malformed identity — this is
      // the half a raising member branch would take down with it.
      const admin = attemptAsRole('app_admin', claims('not-a-uuid', 'app_admin'), [
        `UPDATE users SET first_name = 'Admin-Still-Works' WHERE id = '${IDS.users.selfMember}'`,
      ]);
      expect(admin.ok, `the admin branch died on a malformed sub: ${admin.output}`).toBe(true);
      expect(rowTag(admin), `the admin branch touched no rows: ${admin.output}`).toBe(1);

      await asAdmin(async (client) => {
        await client.query('UPDATE users SET first_name = $2 WHERE id = $1', [IDS.users.selfMember, 'Ada']);
      });
    },
    TIMEOUT,
  );

  it(
    'app_anon can write nothing at all, and is refused at the GRANT rather than by a policy that raises',
    () => {
      // A policy expression is evaluated for EVERY role that reaches the table. `app_anon`
      // holds no table grant on `users`, so it never reaches `users_update` and the refusal
      // is `permission denied for table` — the denial that names nothing about the schema
      // behind it, which is the correct direction for an unauthenticated caller.
      const attempt = attemptAsRole('app_anon', undefined, [
        `UPDATE users SET first_name = 'Anonymous' WHERE id = '${IDS.users.selfMember}'`,
      ]);
      expect(attempt.ok, `an anonymous write was not refused: ${attempt.output}`).toBe(false);
      expect(attempt.code, `expected 42501, got ${attempt.code ?? 'none'}: ${attempt.output}`).toBe('42501');

      const untouched = superuserRows<{ first_name: string }>(
        `SELECT first_name FROM users WHERE id = '${IDS.users.selfMember}'`,
      );
      expect(untouched[0]?.first_name).toBe('Ada');
    },
    TIMEOUT,
  );
});

// =============================================================================
// Structure — the policy is the shipped one, readable from the catalog
// =============================================================================

describe('users_update is ONE total policy that names the actor, and both clauses are written out', () => {
  it(
    'the UPDATE policy carries an admin branch keyed on current_user and a member branch keyed on authz.actor()',
    () => {
      const policies = superuserRows<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(
        `SELECT policyname, cmd, qual, with_check FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'users' ORDER BY policyname`,
      );

      // Four policies, one per operation the table needs (`0008:369-387`), and the set is
      // asserted BY NAME: a policy added to make a feature work and left behind after the
      // feature is gone is invisible to a count.
      expect(policies.map((row) => `${row.policyname}:${row.cmd}`)).toEqual([
        'users_delete:DELETE',
        'users_insert:INSERT',
        'users_read_scope:SELECT',
        'users_update:UPDATE',
      ]);

      const update = policies.find((row) => row.cmd === 'UPDATE');
      // `current_user`, never a token field: a member who forges `"role":"app_admin"` into their
      // own validly-signed token gets nothing from this branch.
      expect(update?.qual ?? '').toMatch(/current_user\s*=\s*'app_admin'/i);
      expect(update?.qual ?? '', 'the UPDATE policy does not read the actor').toContain('authz.actor()');
      // The member branch pins the tombstone guard, which the service could not express.
      expect(update?.qual ?? '', 'the member write branch does not exclude a tombstone').toContain('deleted_at IS NULL');
      // UNCORRELATED: a subquery with no reference to the outer row is what the planner hoists
      // to a one-time filter. A correlated variant is per candidate row, which
      // `email_messages` measured at 3,300 calls over 3,300 rows.
      expect(update?.qual ?? '').toMatch(/id IN \(\s*SELECT authz\.actor\(\)/i);
      // NO capability conjunct, and its absence is asserted because it is a decision: §B2's
      // `can_read_user()` shape would be dead here, because the seeded `member` role resolves
      // no `user:update` (it holds none, and inherits only `user:read` from `manager`).
      expect(update?.qual ?? '', 'the member branch consults a capability the member does not resolve').not.toContain(
        'can_update_user',
      );
      expect(update?.qual ?? '', 'the member branch names a token field').not.toMatch(/request_claims/);

      // `WITH CHECK` is WRITTEN, not inherited. `pg_policies` reports an inherited one as NULL,
      // and a policy that reads as saying nothing about what a row may be rewritten into is the
      // invisibility `0026` exists to end.
      expect(
        update?.with_check ?? '',
        'users_update has no WITH CHECK, so the repoint guard is invisible in the catalog',
      ).not.toBeNull();
      expect(update?.with_check ?? '').toMatch(/current_user\s*=\s*'app_admin'/i);
      expect(update?.with_check ?? '').toMatch(/id IN \(\s*SELECT authz\.actor\(\)/i);
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
    'the seed ran cleanly and 0026 is in the ledger, so nothing above is testing a half-provisioned database',
    () => {
      // Every assertion above reads rows the fixture wrote, and the fixture's role graph comes
      // from the seed. A capability system that denies everyone looks exactly like one that
      // works, so the positive cases are only evidence if the seed actually ran.
      expect(seedRun.code, `the seed failed:\n${seedRun.output}`).toBe(0);
      expect(seedRun.output).toContain('seed complete.');

      const applied = superuserRows<{ name: string }>(
        `SELECT name FROM migrations WHERE name = '0026_member_self_write.sql'`,
      );
      expect(applied, '0026 is not recorded in the migrations ledger').toHaveLength(1);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 9 — the gate can fail
// =============================================================================

describe('the suite can fail: remove a control and these cases go wrong, then restore it', () => {
  it(
    'TAMPER — putting users_update back to `current_user = \'app_admin\'` kills the member\'s own write and, with it, every denial case',
    async () => {
      // TAMPER 1: the pre-0026 policy. A tamper that is not undone leaves the next assertion
      // — and the next run — testing a schema nobody shipped, so the tamper, the assertions
      // and the restore all live inside ONE `try` whose `finally` puts the shipped policy
      // back. The tamper itself is inside that `try` rather than before it, because a tamper
      // that half-applies (the `DROP` lands, the `CREATE` fails) must still be undone.
      const shippedSelf = memberWrite(IDS.users.selfMember, 'Ada');
      expect(shippedSelf.ok && rowTag(shippedSelf) === 1, 'the shipped state does not permit the member write').toBe(true);
      const shippedOther = memberWrite(IDS.users.otherMember, 'Grace');
      expect(shippedOther.ok && rowTag(shippedOther) === 1, 'the shipped policy admits a cross-member write').toBe(false);
      expect(rowTag(shippedOther), `expected UPDATE 0 and got: ${shippedOther.output}`).toBe(0);

      try {
        await asOwner(async (client) => {
          await client.query('DROP POLICY users_update ON public.users');
          await client.query(`CREATE POLICY users_update ON public.users FOR UPDATE USING (current_user = 'app_admin')`);
        });

        // The permitted case is what dies first, and it dies as a CLEAN DENIAL rather than an
        // error: `users_update` no longer admits the member's row, so the statement updates
        // zero rows and exits 0. That is why the permitted case asserts a row count and not a
        // status, and it is the whole of what this tamper demonstrates.
        const underTamper = memberWrite(IDS.users.selfMember, 'Tampered');
        expect(underTamper.ok, `the tampered policy raised rather than denying: ${underTamper.output}`).toBe(true);
        expect(rowTag(underTamper), `the tampered policy still admitted the member's own row: ${underTamper.output}`).toBe(0);

        const untouched = superuserRows<{ first_name: string }>(
          `SELECT first_name FROM users WHERE id = '${IDS.users.selfMember}'`,
        );
        expect(untouched[0]?.first_name, 'the tampered policy wrote the name anyway').toBe('Ada');
      } finally {
        await asOwner((client) => restoreShippedUpdatePolicy(client));
      }

      assertShippedCatalogState();

      // Restored, and proven by re-running BOTH assertions that must fail again — the permitted
      // one and the denial. A tamper that only shows half the change is a weak proof.
      const restoredSelf = memberWrite(IDS.users.selfMember, 'Ada');
      expect(restoredSelf.ok && rowTag(restoredSelf) === 1, 'the shipped policy was not restored').toBe(true);
      const restoredOther = memberWrite(IDS.users.otherMember, 'Grace');
      expect(restoredOther.ok && rowTag(restoredOther) === 1, 'the restored policy admits a cross-member write').toBe(false);
      expect(rowTag(restoredOther), `expected UPDATE 0 and got: ${restoredOther.output}`).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'TAMPER — dropping the `id` conjunct from WITH CHECK lets a member repoint their own row, and putting it back stops them',
    async () => {
      // TAMPER 2, and it is the one that proves `WITH CHECK` is a CONTROL rather than a
      // comment. Three steps, and each is necessary:
      //
      //   1. grant `UPDATE (id)` as well, or the grant refuses the repoint and this tamper
      //      proves nothing about the policy;
      //   2. relax `WITH CHECK` to `deleted_at IS NULL` alone, which is exactly the shape a
      //      future migration might write when somebody "simplifies" it;
      //   3. watch the repoint land, then restore BOTH and watch it refused again.
      //
      // **THE SUBJECT IS `loneMember` AND NOTHING ELSE MAY BE**, because it is the one row in
      // the fixture with no referencing `user_roles` or `user_groups`. Five foreign keys name
      // `users.id` with `ON DELETE CASCADE` and no `ON UPDATE` action, and PostgreSQL's
      // AFTER-ROW referential trigger fires before an UPDATE's RLS `WITH CHECK`, so a row with
      // a membership row raises `23503` first and this tamper would never reach the clause it
      // exists to prove. See `IDS.users.loneMember`.
      const subject = IDS.users.loneMember;

      try {
        await asOwner(async (client) => {
          await client.query('GRANT UPDATE (id) ON public.users TO app_member');
          await client.query('DROP POLICY users_update ON public.users');
          await client.query(`CREATE POLICY users_update ON public.users FOR UPDATE
            USING (current_user = 'app_admin' OR (deleted_at IS NULL AND id IN (SELECT authz.actor() AS actor_id)))
            WITH CHECK (current_user = 'app_admin' OR deleted_at IS NULL)`);
        });

        const tampered = attemptAsRole('app_member', claims(subject, 'app_member'), [
          `UPDATE users SET id = '${UNUSED_UUID}'`,
        ]);
        // "the write went through" is not the same claim as "the row moved", and only the
        // second is the finding.
        expect(
          tampered.ok && rowTag(tampered) === 1,
          `the relaxed WITH CHECK did not admit the repoint, so this tamper proves nothing: ${tampered.output}`,
        ).toBe(true);

        const moved = superuserRows<{ id: string }>(`SELECT id FROM users WHERE username = 'selfwrite-lone'`);
        expect(
          moved[0]?.id,
          'the repoint reported success but the row did not move, so the row count was measuring something else',
        ).toBe(UNUSED_UUID);
      } finally {
        // The row is moved back through the ESCALATION BOUNDARY, not the owner: `users` is
        // `FORCE ROW LEVEL SECURITY`, so the owner is bound by `users_update` like anybody
        // else, and `authz.actor()` is NULL in a claimless owner session — a repair written
        // through the owner would silently update zero rows and leave this case's own fixture
        // broken. `app_admin` is the identity the admin branch admits, which is the same
        // reason the erasure path works.
        await asAdmin(async (client) => {
          await client.query('UPDATE users SET id = $1 WHERE id = $2', [subject, UNUSED_UUID]);
        });
        await asOwner(async (client) => {
          await client.query('REVOKE UPDATE (id) ON public.users FROM app_member');
          await restoreShippedUpdatePolicy(client);
        });
      }

      assertShippedCatalogState();

      const restored = attemptAsRole('app_member', claims(subject, 'app_member'), [
        `UPDATE users SET id = '${UNUSED_UUID}' WHERE id = '${subject}'`,
      ]);
      // The grant is back first, so this refusal is `42501 permission denied for table users`
      // (`aclcheck_error` in `aclchk.c`, which reports the relation name when a column-level
      // UPDATE check fails) rather than the policy's `new row violates row-level security
      // policy` — which is exactly the state case 4 widens on purpose, and the reason case 4's
      // assertion cannot be resting on the grant alone.
      expect(restored.ok, `the restored controls did not refuse the repoint: ${restored.output}`).toBe(false);
      expect(restored.code, `expected 42501, got ${restored.code ?? 'none'}: ${restored.output}`).toBe('42501');
      expect(
        restored.message ?? '',
        `the restored refusal was not a grant-layer permission denial, so it is not the grant doing the work: ${restored.output}`,
      ).toMatch(/permission denied for (?:table users|column id)/i);

      const back = superuserRows<{ id: string }>(`SELECT id FROM users WHERE username = 'selfwrite-lone'`);
      expect(back[0]?.id, 'the fixture was not returned to its shipped state').toBe(subject);
    },
    TIMEOUT,
  );
});