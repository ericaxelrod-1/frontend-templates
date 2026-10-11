import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { psqlAsSuperuser } from '../../support/cluster.js';
import { loadTestEnvironment } from '../../support/database.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * The live fixture for the two-axis authorization proof (W27).
 *
 * Everything here talks to a real PostgreSQL and a real PostgREST process. There is
 * no in-memory substitute and no skip path: if Postgres is unreachable the suite
 * fails with the driver's own error, because a security suite that passes when its
 * subject is absent is worse than no suite at all (AGENTS.md §2.2).
 *
 * Four identities, and keeping them distinct is the whole point:
 *
 *   - `postgres` via `sudo -u postgres psql` — applies the role bootstrap, because
 *     CREATE ROLE needs CREATEROLE and nothing else has it. Also the only role that
 *     can borrow another role, which is how the out-of-band policy checks run.
 *   - `app`, from backend/.env — the migration/owner role. Owns every table, never
 *     receives a request, and writes the membership rows (no serving role may).
 *   - `app_anon` / `app_member` / `app_admin` — the three roles a token may assume.
 *   - `pgrst_authenticator` — the only role PostgREST ever logs in as.
 *
 * THE FIXTURE IS AN ORG CHART, because the design is a hierarchy:
 *
 *   HQ ── EU ── UK          admin ......... sees all 6 groups
 *      │    └── FR          hq   .......... sees the 5 beneath HQ
 *      └── APAC             eu   .......... sees EU, UK, FR — not HQ, not US
 *   US                       uk   .......... sees UK only
 *   (separate root)         union .......... EU + UK + FR + US, the UNION of two
 *                                         disjoint groups
 *                            none ......... no membership row at all
 */

/**
 * The PROOF's own password for `pgrst_authenticator`, set on the cluster by
 * `rebuildDatabase` and used by the proof's PostgREST process for the whole run.
 *
 * Named for what it is rather than simply `AUTHENTICATOR_PASSWORD`, because the
 * configured password with that name is a DIFFERENT value, loaded from
 * `.env.test`, and the two being confused is precisely how this cluster-scoped
 * mutation went unnoticed. A test that only knows the configured value cannot
 * prove the proof password was replaced; one that knows both can.
 */
export const PROOF_AUTHENTICATOR_PASSWORD = 'w26-proof-authenticator';
export const PROOF_JWT_SECRET = 'w26-proof-signing-secret-0123456789abcdef';

/**
 * Deliberately not 3002 or 3012 — both are held by other PostgREST servers that are
 * not ours to disturb, and a proof that attaches to somebody else's server tests
 * nothing. 3005 is the port the superseded suite used and may still be held by, and
 * 3009/3010 have been used before. 3016 is free and the fixture refuses to start if
 * anything is already answering on it.
 */
export const PROOF_PORT = 3016;
const PROOF_DATABASE = 'rls_proof';
const POSTGREST_BINARY = '/usr/local/bin/postgrest';

export const MIGRATION_SQL = join(BACKEND_ROOT, 'database', 'migrations', '0001_rls_foundation.sql');
export const BOOTSTRAP_SQL = join(BACKEND_ROOT, 'database', 'bootstrap', '001_roles.sql');

export const SERVING_ROLES = ['app_anon', 'app_member', 'app_admin', 'pgrst_authenticator'] as const;

/** The roles a token may assume, in the order the boundary assertion prints them. */
export const ASSUMABLE_ROLES = ['app_anon', 'app_member', 'app_admin'] as const;

/** The role that owns every table. A token naming it is the escalation attempt. */
export const OWNING_ROLE = 'app';

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

export function proofDatabase(): string {
  return PROOF_DATABASE;
}

/**
 * Recreates the proof database from nothing and applies both SQL files.
 *
 * The migration is applied as the owner role, TWICE, because "applies cleanly" and
 * "is idempotent" are different claims and a file that only ever runs once has not
 * been shown to do either. `ON_ERROR_STOP=1` is not optional: psql continues past an
 * error and still exits 0 by default, so without it a failed grant in the middle of
 * the file is indistinguishable from success.
 */
export function rebuildDatabase(): void {
  // Terminate anything still attached before dropping. A stale PostgREST or a
  // leaked `pg` pool makes DROP DATABASE fail with "database is being accessed by
  // other users", and the resulting error names a connection the operator cannot see.
  psqlAsSuperuser(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PROOF_DATABASE}' AND pid <> pg_backend_pid()`,
    'postgres',
  );
  psqlAsSuperuser(`DROP DATABASE IF EXISTS ${PROOF_DATABASE}`, 'postgres');
  psqlAsSuperuser(`CREATE DATABASE ${PROOF_DATABASE} OWNER ${OWNING_ROLE}`, 'postgres');

  // The authenticator needs a password because PostgREST authenticates with a login
  // role. It is set here rather than in the committed bootstrap because a committed
  // file must not carry a credential.
  //
  // `ALTER ROLE` is CLUSTER-scoped, so this one statement rewrites the password of
  // every database in the cluster — including `app_dev`, the development database
  // nothing in this suite is allowed to touch. `rebuildDatabase` therefore creates
  // a leak, and `restoreAuthenticatorPassword()` — `test/support/cluster.ts`, shared
  // with the suites that run `database/seed.ts` — is the only thing that undoes it.
  // Every suite that reaches this function calls it from `afterAll`, `test/rls/rls.spec.ts`
  // gates that wiring by scanning the spec directories rather than a hand-written list,
  // and the smoke check that runs after them asserts the outcome from the outside. Read
  // the comment on that function before assuming a green run left the machine as it
  // found it.
  psqlAsSuperuser(
    `ALTER ROLE pgrst_authenticator LOGIN PASSWORD ${quoteSqlLiteral(PROOF_AUTHENTICATOR_PASSWORD)}`,
    PROOF_DATABASE,
  );

  psqlAsSuperuserFile(BOOTSTRAP_SQL, PROOF_DATABASE);
  applyMigrationAsOwner();
  applyMigrationAsOwner();
}

/**
 * Drops the proof database.
 *
 * `rebuildDatabase` creates it from nothing on every run, so without this each
 * `verify` leaves a stale copy of a schema behind — and a leftover database is
 * indistinguishable from a correct one to whoever inspects the cluster next.
 * Terminate first, for the reason `rebuildDatabase` gives: a leaked PostgREST child
 * or an unclosed pool makes DROP fail naming a connection the operator cannot see.
 */
export function dropProofDatabase(): void {
  psqlAsSuperuser(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PROOF_DATABASE}' AND pid <> pg_backend_pid()`,
    'postgres',
  );
  psqlAsSuperuser(`DROP DATABASE IF EXISTS ${PROOF_DATABASE}`, 'postgres');
}

/**
 * Applies the migration as the owner role. Read from `.env`, so the suite proves the
 * same connection the application uses rather than a private one.
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
 * Some assertions must impersonate a serving role (`SET LOCAL ROLE app_member`) to
 * exercise a policy from the outside, with `request.jwt.claims` set to a
 * deliberately hostile value. The migration role cannot do that: it is deliberately
 * not a member of the serving roles, and granting it membership would reopen exactly
 * the escalation hole these tests exist to close. Only a superuser can borrow any
 * role, so these checks go through one.
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

/**
 * Runs `sql` as `role`, with `request.jwt.claims` set to `claims`, in ONE
 * transaction, and returns the rows as JSON objects.
 *
 * `claims === undefined` means the setting is never touched, which is itself one of
 * the shapes under test: the case where a policy used to raise instead of denying.
 *
 * A single `psql` invocation fed on stdin, because `SET LOCAL ROLE` and the read
 * must share one transaction to be scoped correctly, and because the script needs
 * `\g /dev/null` to discard the row that `set_config` itself emits — without it
 * every count is off by one, which is the kind of error that turns a real leak into
 * a green test. The claims values below are deliberately malformed, and a
 * shell-quoted literal is not a safe way to carry a string designed to be hostile.
 */
export function queryAsRole<T>(role: string, claims: string | undefined, sql: string): readonly T[] {
  const script = [
    'BEGIN;',
    `SET LOCAL ROLE ${role};`,
    claims === undefined ? '' : `SELECT set_config('request.jwt.claims', ${quoteSqlLiteral(claims)}, true) \\g /dev/null`,
    `SELECT coalesce(json_agg(_probe)::text, '[]') FROM (${sql.replace(/;\s*$/, '')}) AS _probe;`,
    'COMMIT;',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', PROOF_DATABASE], {
    encoding: 'utf8',
    input: script,
  });
  if (result.status !== 0) {
    throw new Error(
      `query as ${role} with claims ${claims ?? '(unset)'} failed — the policy raised rather than denying:\n${result.stderr}`,
    );
  }
  const trimmed = result.stdout.trim();
  if (trimmed === '') {
    return [];
  }
  return JSON.parse(trimmed) as readonly T[];
}

/**
 * Runs EXPLAIN as `role` with `claims` in force and returns the plan TEXT.
 *
 * Its own helper because EXPLAIN is a utility statement and cannot be wrapped in the
 * json_agg the row helpers use — a subquery may not contain it. Reading the plan is
 * the only way to assert the once-per-statement property, because that property lives
 * in the planner's output and not in the SQL text.
 */
export function explainAsRole(role: string, claims: string, statement: string): string {
  const script = [
    'BEGIN;',
    `SET LOCAL ROLE ${role};`,
    `SELECT set_config('request.jwt.claims', ${quoteSqlLiteral(claims)}, true) \\g /dev/null`,
    `EXPLAIN (ANALYZE, COSTS OFF, FORMAT TEXT) ${statement.replace(/;\\s*$/, '')};`,
    'COMMIT;',
  ].join('\n');

  const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', PROOF_DATABASE], {
    encoding: 'utf8',
    input: script,
  });
  if (result.status !== 0) {
    throw new Error(`EXPLAIN as ${role} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

/** The names of the projects `role` can see with `claims` in force. */
export function projectNamesVisibleTo(role: string, claims: string | undefined): readonly string[] {
  return queryAsRole<{ name: string }>(role, claims, 'SELECT name FROM projects ORDER BY name').map((row) => row.name);
}

/** A claims document for `sub` under `role` — the shape a real token carries. */
export function claimsFor(sub: string, role: string): string {
  return JSON.stringify({ sub, role });
}

/** Escapes a value for a single-quoted SQL literal. These values are hostile by design. */
function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The outcome of a scripted psql run, without the throw.
 *
 * Every other helper here fails LOUDLY on a non-zero exit, which is right when the
 * script is supposed to succeed and useless when the assertion is that it must NOT:
 * "this is refused" cannot be expressed by a helper that reports refusal as an
 * exception and then tells the caller nothing about which refusal it was. So the two
 * `attempt*` helpers below hand back the status and the output, and the tests assert
 * on the MESSAGE — because `permission denied to set parameter` and
 * `query would be affected by row-level security policy` are two different controls
 * and a status code cannot tell them apart.
 */
export interface ScriptOutcome {
  /** psql's exit status. `ON_ERROR_STOP=1`, so a non-zero status is a real failure. */
  readonly ok: boolean;
  /** stdout and stderr, so the assertion can name the error the way the user sees it. */
  readonly output: string;
}

function runScript(argv: readonly string[], statements: readonly string[]): ScriptOutcome {
  // Each statement is terminated here rather than at every call site. psql reads a
  // script from stdin and buffers until a semicolon, so a caller that omits one does
  // not get a missing-terminator error — it gets its next statement swallowed into the
  // same query and a `syntax error at or near "<the next statement>"` that names the
  // wrong line. Terminating centrally is what makes these helpers safe to use from a
  // test that is not thinking about psql's framing at all.
  //
  // `-q` is deliberately NOT passed: these helpers assert on command TAGS (`DELETE 1`),
  // and -q suppresses exactly those. The other helpers here json-aggregate their
  // result instead and do pass -q; two shapes for two assertions, both explicit.
  const script = ['BEGIN;', ...terminate(statements), 'COMMIT;'].join('\n');
  const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-t', '-A', ...argv], {
    encoding: 'utf8',
    input: script,
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/**
 * Appends a semicolon to every statement that does not already end in one.
 *
 * Any statement carrying a psql backslash meta-command is passed through untouched,
 * and the check is for the meta-command anywhere in the line rather than at the start
 * because the idiomatic shape is `SELECT set_config(...); \g /dev/null`. Terminating
 * that turns the `\g` target into the filename `/dev/null;`, which psql then tries to
 * OPEN — `/dev/null;: Permission denied`, with the real error never reached. A line
 * ending in `;` before the meta-command fails differently (`\g: cannot \g with no
 * query`), so neither spelling can be repaired after the fact.
 */
function terminate(statements: readonly string[]): readonly string[] {
  return statements
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
    .map((statement) => (/\\[a-z]/.test(statement) || statement.endsWith(';') ? statement : `${statement};`));
}

/**
 * Runs `statements` as `role`, with `request.jwt.claims` set, inside one transaction,
 * and reports whether it was refused rather than throwing.
 *
 * The claims are set through `set_config` exactly as `queryAsRole` does it, so a
 * caller-supplied hostile claim string is carried safely. The transaction is explicit
 * because the interesting cases — `SET row_security = off`, `SET
 * session_replication_role = replica` — are session-level settings that must not
 * outlive the probe.
 */
export function attemptAsRole(role: string, claims: string | undefined, statements: readonly string[]): ScriptOutcome {
  const preamble = [
    `SET LOCAL ROLE ${role}`,
    ...(claims === undefined
      ? []
      : [`SELECT set_config('request.jwt.claims', ${quoteSqlLiteral(claims)}, true) \\g /dev/null`]),
  ];

  return runScript(['-d', PROOF_DATABASE], [...preamble, ...statements]);
}

/**
 * Runs `statements` as the cluster superuser and reports whether it was refused.
 *
 * The superuser half of the administrative-floor tests needs this and not
 * `queryAsSuperuser`: the assertion is that a multi-statement BEGIN/…/ROLLBACK
 * sequence SUCCEEDS and touched the expected number of rows, which is a property of
 * the command tags rather than of a result set.
 */
export function attemptAsSuperuser(statements: readonly string[]): ScriptOutcome {
  return runScript(['-d', PROOF_DATABASE], statements);
}

// =============================================================================
// THE SEEDED FIXTURE — fixed ids, because every assertion below reads them
// =============================================================================

export const GROUPS = {
  hq: '11111111-0000-0000-0000-000000000001',
  eu: '11111111-0000-0000-0000-000000000002',
  uk: '11111111-0000-0000-0000-000000000003',
  fr: '11111111-0000-0000-0000-000000000004',
  apac: '11111111-0000-0000-0000-000000000005',
  us: '11111111-0000-0000-0000-000000000006',
} as const;

/** Every seeded group as a row, in the order the fixture creates them. */
export const GROUP_ROWS: ReadonlyArray<{ readonly id: string; readonly name: string }> = [
  { id: GROUPS.hq, name: 'HQ' },
  { id: GROUPS.eu, name: 'EU' },
  { id: GROUPS.uk, name: 'UK' },
  { id: GROUPS.fr, name: 'FR' },
  { id: GROUPS.apac, name: 'APAC' },
  { id: GROUPS.us, name: 'US' },
];

export const GROUP_NAMES: readonly string[] = GROUP_ROWS.map((group) => group.name);

export const USERS = {
  /** member of EU, role contributor (whose parent holds project.read). */
  euMember: '33333333-0000-0000-0000-000000000001',
  /** member of HQ, role viewer. */
  hqMember: '33333333-0000-0000-0000-000000000002',
  /** member of UK, role viewer. */
  ukMember: '33333333-0000-0000-0000-000000000003',
  /** member of EU *and* US — two disjoint groups, so the union case. */
  disjointMember: '33333333-0000-0000-0000-000000000004',
  /** holds a role and NO membership row: the zero-rows case. */
  noMembership: '33333333-0000-0000-0000-000000000005',
  /** member of HQ, role administrator — the superset role. */
  administrator: '33333333-0000-0000-0000-000000000006',
  /** holds NO role and NO membership: the capability "nobody" case. */
  noRole: '33333333-0000-0000-0000-000000000007',
} as const;

export const ROLES = {
  viewer: '22222222-0000-0000-0000-000000000001',
  contributor: '22222222-0000-0000-0000-000000000002',
  manager: '22222222-0000-0000-0000-000000000003',
  administrator: '22222222-0000-0000-0000-000000000004',
} as const;

/** Every permission row the fixture creates, as `resource.action`. */
export const PERMISSIONS = [
  'project.read',
  'project.create',
  'project.update',
  'project.delete',
  'customer.read',
  'page.read',
  'page.update',
] as const;

/**
 * Seeds the fixture.
 *
 * Two connections, and the split is the point rather than an inconvenience:
 *
 *   - as `pgrst_authenticator` assuming `app_admin`, for everything app_admin may
 *     write. The owner role is subject to its own policies under FORCE and is
 *     rejected outright, and the documented workaround — disabling
 *     `row_security` — would reopen the owner bypass, so seeding goes THROUGH the
 *     escalation boundary instead of around it.
 *   - as the owner role, for `user_groups`. No serving role holds a write grant on
 *     membership at all, which is the control that stops a member widening their own
 *     scope; seeding it is the consequence, not a workaround.
 */
export async function seed(): Promise<void> {
  const admin = authenticatorClient();
  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE app_admin');

    for (const group of GROUP_ROWS) {
      await admin.query('INSERT INTO groups (id, name) VALUES ($1, $2)', [group.id, group.name]);
    }
    await admin.query('UPDATE groups SET parent_id = $1 WHERE id = ANY($2)', [
      GROUPS.hq,
      [GROUPS.eu, GROUPS.apac],
    ]);
    await admin.query('UPDATE groups SET parent_id = $1 WHERE id = ANY($2)', [
      GROUPS.eu,
      [GROUPS.uk, GROUPS.fr],
    ]);

    // One tenant row per group, with a recognisable secret in the hidden column so a
    // leaked column is unmistakable in an assertion and not merely "present".
    for (const group of GROUP_ROWS) {
      await admin.query(`INSERT INTO projects (group_id, name) VALUES ($1, $2)`, [group.id, `project-${group.name}`]);
      await admin.query(
        `INSERT INTO customers (group_id, name, internal_notes) VALUES ($1, $2, $3)`,
        [group.id, `customer-${group.name}`, `SECRET-${group.name}`],
      );
    }

    for (const action of ['create', 'read', 'update', 'delete']) {
      await admin.query('INSERT INTO actions (name) VALUES ($1)', [action]);
    }
    for (const permission of PERMISSIONS) {
      const [resource, action] = permission.split('.');
      await admin.query('INSERT INTO permissions (resource, action_id) VALUES ($1, $2)', [resource, action]);
    }

    await admin.query(
      `INSERT INTO roles (id, name, parent_id, is_system_role) VALUES
         ($1, 'viewer',        NULL,    true),
         ($2, 'contributor',   $1,     false),
         ($3, 'manager',       $2,     false),
         ($4, 'administrator', NULL,    true)`,
      [ROLES.viewer, ROLES.contributor, ROLES.manager, ROLES.administrator],
    );

    await grant(admin, ROLES.viewer, ['project.read', 'page.read']);
    await grant(admin, ROLES.contributor, ['project.create', 'customer.read']);
    await grant(admin, ROLES.manager, ['project.update', 'project.delete']);
    // The superset role holds EVERY permission row that exists, so "app_admin holds
    // every capability" is a fact about the fixture rather than a hope.
    await admin.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions', [
      ROLES.administrator,
    ]);

    for (const [user, role] of [
      [USERS.euMember, ROLES.contributor],
      [USERS.hqMember, ROLES.viewer],
      [USERS.ukMember, ROLES.viewer],
      [USERS.disjointMember, ROLES.viewer],
      [USERS.noMembership, ROLES.contributor],
      [USERS.administrator, ROLES.administrator],
    ] as const) {
      await admin.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [user, role]);
    }

    await admin.query('COMMIT');
  } finally {
    await admin.end();
  }

  const owner = new Client({
    ...loadTestEnvironment().database,
    database: PROOF_DATABASE,
  });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    for (const [user, group] of [
      [USERS.euMember, GROUPS.eu],
      [USERS.hqMember, GROUPS.hq],
      [USERS.ukMember, GROUPS.uk],
      [USERS.disjointMember, GROUPS.eu],
      [USERS.disjointMember, GROUPS.us],
      [USERS.administrator, GROUPS.hq],
    ] as const) {
      await owner.query('INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)', [user, group]);
    }
    await owner.query('COMMIT');
  } finally {
    await owner.end();
  }
}

async function grant(client: Client, roleId: string, permissions: readonly string[]): Promise<void> {
  for (const permission of permissions) {
    const [resource, action] = permission.split('.');
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE resource = $2 AND action_id = $3`,
      [roleId, resource, action],
    );
  }
}

/** A client for the single role PostgREST connects as, i.e. the seeder's identity. */
export function authenticatorClient(): Client {
  return new Client({
    host: 'localhost',
    port: 5432,
    user: 'pgrst_authenticator',
    password: PROOF_AUTHENTICATOR_PASSWORD,
    database: PROOF_DATABASE,
  });
}

/** A client for the migration/owner role, which writes membership rows. */
export function ownerClient(): Client {
  return new Client({ ...loadTestEnvironment().database, database: PROOF_DATABASE });
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
 *
 * `db-schemas = "public"` is the other load-bearing line: the closure and the
 * identity accessor live in the `authz` schema precisely because this is the only
 * schema the API server serves.
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
    throw new Error(`${POSTGREST_BINARY} is not installed; the proof cannot run without a real PostgREST`);
  }

  // Refuse to start if the port is already answering. Without this the readiness
  // probe below succeeds against somebody else's server — a leftover instance from a
  // previous run, or a developer's own — and the entire suite silently tests a
  // database it did not create. That failure mode is invisible: every assertion
  // either passes against the right schema or fails confusingly, and the log line
  // says "listening" either way. Hit during development, not theorised.
  const contention = await probePort();
  if (contention !== undefined) {
    throw new Error(
      `port ${PROOF_PORT} is already serving. The proof starts its own PostgREST and must not attach to another one.\n${contention}`,
    );
  }

  const directory = mkdtempSync(join(tmpdir(), 'w26-pgrst-'));
  const config = writeConfig(directory);

  /**
   * The child environment, with every inherited PGRST_* override removed.
   *
   * `test/support/database.ts` imports the .env loader, so PGRST_JWT_SECRET from
   * backend/.env is in the parent environment — and PostgREST gives environment
   * variables precedence over the config file. The proof server was therefore
   * verifying tokens against the developer's application secret while the suite
   * minted them with the proof secret, and every request failed at authentication
   * with PGRST301 before reaching a single policy. Found by dumping the child's
   * environment, not by reading the config, which was byte-identical to a config
   * that worked.
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
    return {
      ...env,
      PGRST_DB_URI: `postgresql://pgrst_authenticator:${PROOF_AUTHENTICATOR_PASSWORD}@localhost:5432/${PROOF_DATABASE}`,
    };
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
      // Wait for the port to actually free. `kill` returns immediately and the child
      // holds the socket for a few hundred ms, so a suite killed mid-run leaves an
      // orphan that makes the NEXT run fail its port guard — reported as "port is
      // already serving" with nothing pointing at the process responsible.
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
 * Returns a description if something is already listening, undefined if the port is
 * free. Includes the holding PID where it can be found, because "port is already
 * serving" with nothing more actionable is the worst possible error message.
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
    return `(could not identify the process holding port ${PROOF_PORT}; try: ss -ltnp | grep ${PROOF_PORT})`;
  }
  const line = listeners.stdout.split('\n').find((entry) => entry.includes(`:${PROOF_PORT}`));
  return line ?? '(no listener found on the port)';
}