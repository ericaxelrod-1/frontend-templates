import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * Privacy/DSAR — migrations `0009_anonymisation.sql` and `0010_privacy_requests.sql`.
 *
 * ## What this suite is proving
 *
 * Three claims, each stated as an attack rather than as a table.
 *
 *  1. **A soft-deleted user resolves to NOTHING.** `0008` gave `user_roles` and
 *     `user_groups` `ON DELETE CASCADE` to `users` — but a referential action fires on
 *     `DELETE` and anonymisation is an `UPDATE`, so every anonymisation leaves the
 *     membership rows behind. `has_permission()` seeds its ancestor set from
 *     `user_roles` and `authz.visible_user_ids()` anchors on `user_groups`, so without
 *     a choke point an "erased" account keeps its full former scope AND its full former
 *     capability with nothing anywhere reporting it. The choke point is a BEFORE
 *     trigger removing both row sets in the same transaction; these tests prove it
 *     resolves to zero on both axes rather than proving that a timestamp was written.
 *
 *  2. **A member reads their OWN request and nobody else's**, including a colleague in
 *     the same group. Capability cannot be the discriminator for that: `has_permission()`
 *     walks UP the role tree (`0001:373-387`), so a user holding `member` resolves the
 *     ancestor set {member, manager, admin} and holds EVERY row `admin` holds. The
 *     discriminator is the branch in the policy, so this suite plants two requests in
 *     ONE group — a policy filtering by the group closure fails here rather than
 *     passing on an empty fixture.
 *
 *  3. **The compliance record is append-only and outlives its subject.** Every serving
 *     role including `app_admin` is refused INSERT/UPDATE/DELETE/TRUNCATE, and the
 *     admin ROLE demonstrably still holds `privacy_request:read` and
 *     `privacy_request:update` — so append-only is a property of the GRANTS, not an
 *     accident of a thin role that was never granted much.
 *
 * ## The database
 *
 * A throwaway one built by the REAL pipeline — bootstrap, every migration in the
 * directory, then the real `database/seed.ts` — so the grant-subset trigger, the
 * policies and the seeded three-tier role tree are genuinely in force. It REFUSES the
 * development database by name.
 *
 * ## Execution, and the two assertions that documented a hole in `0010`
 *
 * **These tests have now been run** against a real provisioned database — bootstrap, all
 * fourteen migrations, the real `database/seed.ts`. Getting them to execute
 * required one fixture fix (the `noCap` user was never created, so `privacy_requests`'s
 * foreign key refused the INSERT and all 38 were skipped) and five corrections where the
 * spec asserted something the schema does not do — a column that lives on the parent
 * table, a collation-dependent `ORDER BY`, an `UPDATE` whose RLS refusal is `UPDATE 0`
 * rather than an exception, a SQLSTATE psql never prints, and two row-vs-value
 * comparisons. Each is recorded at its site.
 *
 * **Two of them were red against a real defect in applied migration `0010`, and both are
 * green against `0014_privacy_request_audit_subject_gate.sql`.** `authz.append_
 * privacy_request_audit` gated "may this caller act on this subject?" on
 * `has_permission(actor, 'privacy_request', 'update')` ALONE, while the
 * `privacy_request_update` policy it claimed to mirror required `user_id = authz.actor()`
 * AND that permission; and its operator-event gate was the same bare capability. Since
 * `member` demonstrably holds `privacy_request:update` (conferred on all three tiers at
 * `0010:373-374`), an ordinary member could (a) append a compliance record naming a
 * COLLEAGUE as the subject and (b) append a `responded`/`fulfilled` event — a
 * self-certified compliance claim, which is precisely what `0010:552-556` says the
 * policy's `WITH CHECK` exists to prevent.
 *
 * The expectations were NOT relaxed to match the implementation, which is the failure
 * mode this file exists to detect. `0014` closed the hole in the schema and this file
 * changed in two places only, both of which make an assertion STRONGER and are recorded
 * at their sites: the `toContain('42501')` pair now asserts on the refusal MESSAGE —
 * which names the conjunct that fired, where `42501` is also what a missing GRANT
 * raises — and a NEW `pg`-transport assertion keeps the numeric SQLSTATE covered,
 * because `psql` at its default `VERBOSITY` never prints one (the property this file
 * already records where it asserts on a CHECK's constraint name instead of `23514`).
 */

const TIMEOUT = 240_000;
const PROOF_DB = 'privacy_requests_proof';

const AUTHENTICATOR_PASSWORD = loadTestEnvironment().authenticator.password;
const BOOTSTRAP_SQL = join(BACKEND_ROOT, 'database', 'bootstrap', '001_roles.sql');
const MIGRATIONS_DIR = join(BACKEND_ROOT, 'database', 'migrations');

/**
 * Read from the directory rather than listed here. A hand-kept list goes stale the
 * moment a migration is added, and every assertion below then passes against a
 * baseline the application no longer ships.
 */
function migrationFiles(): readonly string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4,}_.*\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort();
}

// =============================================================================
// Database plumbing
// =============================================================================

/**
 * Superuser SQL, fed on stdin.
 *
 * stdin rather than `-c` because psql wraps a multi-statement `-c` in ONE
 * transaction, and `CREATE DATABASE` / `DROP DATABASE` cannot run inside a transaction
 * block. Fed on stdin each statement gets its own implicit transaction.
 */
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

/** Superuser SQL applied from a FILE. */
function superuserFile(database: string, path: string): void {
  const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', database, '-f', path], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`applying ${path} as superuser failed:\n${result.stderr}`);
  }
}

/** Superuser SQL against the `postgres` database. */
function superuserCluster(sql: string): void {
  superuserExec('postgres', sql);
}

/** Superuser SQL against the proof database, returned as parsed JSON rows. */
function superuserRows<T>(sql: string): readonly T[] {
  const stdout = superuserExec(
    PROOF_DB,
    `SELECT coalesce(json_agg(_q)::text, '[]') FROM (${sql.replace(/;\s*$/, '')}) AS _q;`,
  );
  const trimmed = stdout.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
}

function recreateDatabase(name: string): void {
  const devDb = databaseConfig().database;
  if (name === devDb) {
    throw new Error(`refusing to run the privacy proof against the development database (${devDb})`);
  }
  superuserCluster(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid();`);
  superuserCluster(`DROP DATABASE IF EXISTS ${name};`);
  superuserCluster(`CREATE DATABASE ${name} OWNER ${databaseConfig().user};`);
  // The call-count measurement reads `pg_stat_user_functions`, which is empty unless
  // `track_functions` is on and the cluster default is `none`. Scoped to this
  // throwaway database it is hermetic: the setting dies with the database.
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

/** A statement expected to SUCCEED, as a serving role, as parsed JSON rows. */
function rowsAsRole<T>(role: ServingRole, sub: string | undefined, sql: string): readonly T[] {
  const outcome = runRoleScript(
    role,
    sub,
    [`SELECT coalesce(json_agg(_r)::text, '[]') FROM (${sql.replace(/;\s*$/, '')}) AS _r;`],
    true,
  );
  if (!outcome.ok) {
    throw new Error(`query as ${role} (sub ${sub ?? 'unset'}) failed — the policy raised rather than denying:\n${outcome.output}`);
  }
  const trimmed = outcome.output.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
}

/**
 * A statement expected to FAIL, as a serving role.
 *
 * `-q` is off so psql's command TAGS (`INSERT 0 0`, `DELETE 0`) survive: a write that
 * matched zero rows is a different outcome from a refused write, and §B2 records that a
 * status-only assertion passes on a real leak.
 */
function attemptAsRole(role: ServingRole, sub: string | undefined, statements: readonly string[]): ScriptOutcome {
  return runRoleScript(role, sub, statements, false);
}

/** A client for the migration/owner role — the only writer of membership rows. */
function ownerClient(): Client {
  return new Client({ ...loadTestEnvironment().database, database: PROOF_DB });
}

/** A client for `pgrst_authenticator`, i.e. the escalation boundary. */
function authenticatorClient(): Client {
  return new Client({
    host: 'localhost',
    port: 5432,
    user: 'pgrst_authenticator',
    password: AUTHENTICATOR_PASSWORD,
    database: PROOF_DB,
  });
}

/** Everything `app_admin` may write, THROUGH the boundary rather than around it. */
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
    await client.end();
  }
}

/**
 * The SQLSTATE of a MEMBER's refusal, over the transport that carries one.
 *
 * `runRoleScript` drives `psql`, and `psql` at its default `VERBOSITY` prints `ERROR:`
 * and the message and NEVER the SQLSTATE — the property this file already records where
 * it asserts on `privacy_request_audits_response_is_complete` rather than on `23514`.
 * So `expect(output).toContain('42501')` over that output cannot pass at all, and
 * turning `VERBOSITY verbose` on for the whole file would change the output every other
 * assertion here reads, several of which assert on the ABSENCE of a code.
 *
 * `pg` puts the code on the error, so the numeric assertion survives without touching
 * the shared harness. This goes through `pgrst_authenticator` and `SET LOCAL ROLE
 * app_member` — the escalation boundary, exactly as `asAdmin` does — so the identity is
 * the one a request carries and never the owner's.
 *
 * `undefined` means NOTHING was refused, which is an outcome a caller must not confuse
 * with a refusal; the assertions pair it with the message for exactly that reason.
 */
async function sqlstateOfMemberRefusal(
  sub: string,
  statements: readonly string[],
): Promise<string | undefined> {
  const client = authenticatorClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_member');
    await client.query('SELECT set_config($1, $2, true)', [
      'request.jwt.claims',
      claimsFor(sub, 'app_member'),
    ]);
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query('COMMIT');
    return undefined;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return (error as { code?: string }).code;
  } finally {
    await client.end();
  }
}

// =============================================================================
// The fixture
// =============================================================================

/**
 * Fixed ids, because every assertion reads them.
 *
 *   root ──┬── EU ──┬── FR        adminProbe   ── member of EU, role `admin`, so its
 *          │        └── DEEP                    closure includes FR
 *          └── US               managerUser   ── member of EU, role `manager`
 *                              subject       ── member of FR, role `member`
 *                              peer          ── member of FR, role `member`
 *                              noCap         ── member of FR, holds NO privacy capability
 *                              erasedSubject ── member of FR, role `member`
 *                              tombstone     ── member of FR, role `manager`
 *                              usUser        ── member of US, role `member`  (out of scope)
 *                              narrowAdmin   ── member of EU, holds NO privacy capability
 *
 * `subject` and `peer` share ONE GROUP on purpose: a read policy filtering by the group
 * closure would return both, and that is the assertion which must fail.
 */
const IDS = {
  usGroup: 'b1000000-0000-0000-0000-000000000001',
  users: {
    subject: 'b2000000-0000-0000-0000-000000000001',
    peer: 'b2000000-0000-0000-0000-000000000002',
    managerUser: 'b2000000-0000-0000-0000-000000000003',
    usUser: 'b2000000-0000-0000-0000-000000000004',
    noCap: 'b2000000-0000-0000-0000-000000000005',
    erasedSubject: 'b2000000-0000-0000-0000-000000000006',
    tombstone: 'b2000000-0000-0000-0000-000000000007',
    adminProbe: 'b2000000-0000-0000-0000-000000000008',
    narrowAdmin: 'b2000000-0000-0000-0000-000000000009',
  },
  /** Holds `project.read` and nothing privacy — the capability "nobody" case. */
  noPrivacyRole: 'b3000000-0000-0000-0000-000000000001',
} as const;

function probeLabel(id: string): string {
  return `probe-${id.slice(-4)}`;
}

function probeEmail(id: string): string {
  return `${probeLabel(id)}@example.test`;
}

interface RequestRow {
  readonly id: string;
  readonly user_id: string;
  readonly status: string;
}

function requestSubjects(rows: readonly RequestRow[]): readonly string[] {
  return rows.map((row) => probeLabel(row.user_id)).sort();
}

/** Files a request as `user`, through the INSERT policy rather than beside it. */
function fileRequest(user: string, nature = 'access'): ScriptOutcome {
  return attemptAsRole('app_member', user, [
    `INSERT INTO privacy_requests (user_id, request_nature, request_channel) VALUES ('${user}', '${nature}', 'in_app')`,
  ]);
}

/** The users `sub` may see, by the derived scope — the choke point's own instrument. */
function visibleSubjects(sub: string): readonly string[] {
  return rowsAsRole<{ user_id: string }>(
    'app_member',
    sub,
    'SELECT u.user_id FROM authz.visible_user_ids() AS u (user_id) ORDER BY u.user_id',
  )
    .map((row) => probeLabel(row.user_id))
    .sort();
}

function auditRowsFor(requestKey: string): readonly { event_type: string; subject_user_id: string | null }[] {
  return superuserRows<{ event_type: string; subject_user_id: string | null }>(
    `SELECT event_type, subject_user_id FROM privacy_request_audits WHERE request_key = '${requestKey}' ORDER BY event_type`,
  );
}

let seedRun: { readonly code: number; readonly output: string };

function runSeed(): { readonly code: number; readonly output: string } {
  const result = spawnSync('node', ['--experimental-strip-types', 'database/seed.ts'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DB_NAME: PROOF_DB, SEED_ADMIN_PASSWORD: 'privacy-proof-admin-password' },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

beforeAll(async () => {
  recreateDatabase(PROOF_DB);
  applyBaseline();

  // The seed owns roles and permissions, so the extra capability role this fixture
  // needs is created through the escalation boundary as `app_admin` — which also puts
  // `assert_grant_subset()` (0004) on the write path.
  seedRun = runSeed();
  if (seedRun.code !== 0) {
    throw new Error(`database/seed.ts failed (exit ${seedRun.code}):\n${seedRun.output}`);
  }

  await asAdmin(async (client) => {
    // ROLES FIRST: `user_roles.role_id` is a real foreign key.
    await client.query('INSERT INTO roles (id, name, parent_id, is_system_role) VALUES ($1, $2, NULL, false)', [
      IDS.noPrivacyRole,
      'probe-role-no-privacy',
    ]);
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE resource = 'project' AND action_id = 'read'`,
      [IDS.noPrivacyRole],
    );

    // Then the USERS, then the roles they hold. The seeded three-tier tree is used as
    // it is: `member`, `manager` and `admin` are looked up by NAME rather than
    // hardcoded, so a change to the seed's ids cannot silently leave a probe holding
    // no role and turn every capability assertion below vacuously green.
    const roleOf = async (name: string): Promise<string> => {
      const result = await client.query<{ id: string }>('SELECT id FROM roles WHERE name = $1', [name]);
      const id = result.rows[0]?.id;
      if (id === undefined) {
        throw new Error(`the seed created no role named ${name}`);
      }
      return id;
    };
    const roleMember = await roleOf('member');
    const roleManager = await roleOf('manager');
    const roleAdmin = await roleOf('admin');

    for (const [user, role] of [
      [IDS.users.subject, roleMember],
      [IDS.users.peer, roleMember],
      [IDS.users.usUser, roleMember],
      [IDS.users.erasedSubject, roleMember],
      [IDS.users.managerUser, roleManager],
      [IDS.users.tombstone, roleManager],
      [IDS.users.adminProbe, roleAdmin],
      [IDS.users.narrowAdmin, IDS.noPrivacyRole],
      // `noCap` is here, not in the `member` tier: it is the CAPABILITY-axis actor, and a
      // fixture that gave it `member` would make "holds no privacy capability" vacuous
      // because `member` holds `privacy_request:read` directly. It was missing from this
      // list, so `privacy_requests.user_id`'s FK refused the INSERT below and the whole
      // suite — 38 tests — never ran.
      [IDS.users.noCap, IDS.noPrivacyRole],
    ] as const) {
      await client.query(
        `INSERT INTO users (id, username, email, password_hash) VALUES ($1, $2, $3, 'not-a-real-hash')
         ON CONFLICT (id) DO NOTHING`,
        [user, probeLabel(user), probeEmail(user)],
      );
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [user, role],
      );
    }

    // A request for each of the two actors who cannot file their own: a member holding
    // no privacy capability, and a subject in a group nobody in this fixture reads.
    await client.query(
      `INSERT INTO privacy_requests (user_id, request_nature, request_channel)
       VALUES ($1, 'access', 'in_app'), ($2, 'access', 'in_app')`,
      [IDS.users.noCap, IDS.users.usUser],
    );

    // Mail history, so the anonymisation suite's "zero readable mail" assertion is not
    // satisfied by an empty table. `email_messages` is the OTHER derived table, and it
    // resolves through the same `authz.visible_user_ids()` — so a tombstone that kept
    // its `user_groups` rows would keep reading colleagues' correspondence even if every
    // privacy_request policy were perfect.
    for (const user of [IDS.users.subject, IDS.users.peer]) {
      await client.query(
        `INSERT INTO email_messages (user_id, template, recipient, subject, status, content_class)
         VALUES ($1, 'password_reset', $2, $3, 'sent', 'metadata_only')`,
        [user, probeEmail(user), `mail-for-${probeLabel(user)}`],
      );
    }
  });

  // Membership, through the OWNER: no serving role holds a write grant on `user_groups`,
  // and that refusal is the control that fails open if forgotten.
  const owner = ownerClient();
  await owner.connect();
  try {
    const groups = await owner.query<{ id: string; name: string }>('SELECT id, name FROM groups');
    const byName = new Map(groups.rows.map((row) => [row.name, row.id]));
    const eu = byName.get('EU');
    const fr = byName.get('FR');
    if (eu === undefined || fr === undefined) {
      throw new Error(`the seed created no EU/FR group; it seeded ${[...byName.keys()].join(', ')}`);
    }
    // A sibling root, unrelated to EU, so "out of scope" is a real row in a real group
    // rather than an empty membership set.
    await owner.query('INSERT INTO groups (id, name, parent_id) VALUES ($1, $2, NULL)', [IDS.usGroup, 'probe-US']);
    for (const [user, group] of [
      [IDS.users.subject, fr],
      [IDS.users.peer, fr],
      [IDS.users.noCap, fr],
      [IDS.users.erasedSubject, fr],
      [IDS.users.tombstone, fr],
      [IDS.users.managerUser, eu],
      [IDS.users.adminProbe, eu],
      [IDS.users.narrowAdmin, eu],
      [IDS.users.usUser, IDS.usGroup],
    ] as const) {
      await owner.query('INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)', [user, group]);
    }
    await owner.query('COMMIT');
  } finally {
    await owner.end();
  }

  // Ground truth for the "two requests in ONE group" claim, filed through the INSERT
  // policy so the policy is on the path rather than beside it.
  for (const user of [IDS.users.subject, IDS.users.peer, IDS.users.erasedSubject]) {
    const filed = fileRequest(user);
    if (!filed.ok) {
      throw new Error(`seeding a request for ${probeLabel(user)} failed:\n${filed.output}`);
    }
  }

  // At least one compliance row before anything reads the audit table, written through
  // the write function so the fixtures never hand a green result to a table that is
  // merely empty.
  const subjectRequest = superuserRows<{ id: string; request_key: string }>(
    `SELECT id, request_key FROM privacy_requests WHERE user_id = '${IDS.users.subject}'`,
  )[0];
  if (subjectRequest === undefined) {
    throw new Error('the fixture filed no request for the subject');
  }
  const seeded = attemptAsRole('app_admin', IDS.users.adminProbe, [
    `SELECT authz.append_privacy_request_audit(
       'received', '${subjectRequest.request_key}', now(), 'access', 'in_app',
       NULL, NULL, NULL, NULL, convert_to('probe-subject', 'UTF8'), 'k1', '${IDS.users.subject}')`,
  ]);
  if (!seeded.ok) {
    throw new Error(`seeding a compliance record failed:\n${seeded.output}`);
  }
}, TIMEOUT);

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
// 0 — the fixture is really provisioned
// =============================================================================

describe('the proof is a real provision, so no denial below is a vacuous one', () => {
  it(
    'the real seed ran against this database and created the three-tier role tree',
    () => {
      // Without this, every "sees zero rows" assertion below would also pass against an
      // empty database, an un-applied migration or a failed seed.
      expect(seedRun.code, seedRun.output).toBe(0);
      expect(
        superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM roles WHERE name IN ('admin', 'manager', 'member')`)[0]
          ?.count,
      ).toBe(3);
      expect(
        superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM privacy_requests`)[0]?.count,
      ).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 1 — the scope axis on privacy_requests
// =============================================================================

describe('privacy_requests · a member reads their own request and nobody else', () => {
  it(
    'a member sees exactly the one request they filed, inside a group that holds several',
    () => {
      // The permitted half, and it needs a positive control: this actor really does
      // hold `privacy_request:read` through the seeded `member` role, so a zero-row
      // answer here would be a capability denial rather than a scope denial.
      const visible = rowsAsRole<RequestRow>('app_member', IDS.users.subject, 'SELECT id, user_id, status FROM privacy_requests');
      expect(requestSubjects(visible)).toEqual([probeLabel(IDS.users.subject)]);

      // The fixture's whole point: MORE THAN ONE request exists in FR. A policy filtering
      // by the group closure would return them all, so this assertion can fail.
      const inGroup = superuserRows<RequestRow>(
        `SELECT r.id, r.user_id, r.status
           FROM privacy_requests r
           JOIN user_groups ug ON ug.user_id = r.user_id
          WHERE ug.group_id = (SELECT g.group_id FROM user_groups g WHERE g.user_id = '${IDS.users.subject}')
          ORDER BY r.user_id`,
      );
      expect(inGroup.length, 'the fixture must plant several requests in one group').toBeGreaterThan(1);
      expect(inGroup.map((row) => probeLabel(row.user_id))).toContain(probeLabel(IDS.users.peer));
    },
    TIMEOUT,
  );

  it(
    'a member cannot read a colleague request filed in the SAME group — the group closure is not the member scope',
    () => {
      // The named attack. `peer` is in FR, `subject` is in FR, and both hold
      // `privacy_request:read`, so the only thing that can deny this is the policy's
      // subject branch. Asserted from BOTH sides, because a policy that only worked in
      // one direction would pass a single assertion.
      const asSubject = requestSubjects(rowsAsRole<RequestRow>('app_member', IDS.users.subject, 'SELECT id, user_id, status FROM privacy_requests'));
      const asPeer = requestSubjects(rowsAsRole<RequestRow>('app_member', IDS.users.peer, 'SELECT id, user_id, status FROM privacy_requests'));

      expect(asSubject).not.toContain(probeLabel(IDS.users.peer));
      expect(asPeer).not.toContain(probeLabel(IDS.users.subject));

      // Ground truth, so the denial above is a denial and not an empty fixture.
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM privacy_requests WHERE user_id = '${IDS.users.peer}'`,
        )[0]?.count,
      ).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'a member in one group cannot read a request about a user in an UNRELATED group',
    () => {
      // `usUser` holds a real request, filed by the operator because a member cannot
      // file for a subject in a group they are not in. `managerUser` sits in EU and
      // holds every privacy capability in the tree; it still sees nothing, because
      // `probe-US` is a separate root and nothing about it is in EU's closure.
      expect(
        requestSubjects(
          rowsAsRole<RequestRow>('app_member', IDS.users.managerUser, 'SELECT id, user_id, status FROM privacy_requests'),
        ),
      ).toEqual([]);

      // …and `managerUser` holds no request of its own, so this is a scope answer rather
      // than a self-branch answer.
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM privacy_requests WHERE user_id = '${IDS.users.managerUser}'`,
        )[0]?.count,
      ).toBe(0);
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM privacy_requests WHERE user_id = '${IDS.users.usUser}'`,
        )[0]?.count,
      ).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'a member holding NO privacy capability sees zero rows — the capability axis, not just scope',
    () => {
      // `noCap` is in FR, so a scope-only policy would return their row. Only the
      // capability conjunct denies it.
      expect(
        requestSubjects(rowsAsRole<RequestRow>('app_member', IDS.users.noCap, 'SELECT id, user_id, status FROM privacy_requests')),
      ).toEqual([]);

      // …and the row is really there.
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM privacy_requests WHERE user_id = '${IDS.users.noCap}'`,
        )[0]?.count,
      ).toBe(1);

      // The role really holds a capability, and a real one: `project:read`. This is what
      // makes `privacy_request:read` a dedicated row rather than a relabelled user
      // capability — a count, so the assertion cannot pass on a role that holds nothing
      // at all.
      const held = superuserRows<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = '${IDS.noPrivacyRole}'
            AND ((p.resource = 'project' AND p.action_id = 'read') OR p.resource LIKE 'privacy%')`,
      );
      expect(held[0]?.count).toBe(1);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 2 — the operator branch, and that it is not a bypass
// =============================================================================

describe('privacy_requests · the operator branch is current_user AND capability', () => {
  it(
    'an admin in EU sees the requests for users in its group closure, and NOT for a user outside it',
    () => {
      // The permitted half of the breadth claim, asserted as an exact SET: a filter
      // returning a different set of the same size would satisfy a count.
      const subjects = requestSubjects(
        rowsAsRole<RequestRow>('app_admin', IDS.users.adminProbe, 'SELECT id, user_id, status FROM privacy_requests'),
      );

      // Every FR member with a request is in EU's closure …
      expect(subjects).toContain(probeLabel(IDS.users.subject));
      expect(subjects).toContain(probeLabel(IDS.users.peer));
      expect(subjects).toContain(probeLabel(IDS.users.erasedSubject));
      expect(subjects).toContain(probeLabel(IDS.users.noCap));
      // … and `probe-US` is a separate root, so its subject is out. A `USING (true)`
      // admin branch would return it, which is what this assertion catches.
      expect(subjects).not.toContain(probeLabel(IDS.users.usUser));
      expect(subjects).toHaveLength(4);
    },
    TIMEOUT,
  );

  it(
    'an admin whose role lacks privacy_request:read sees ZERO rows, so the branch is not a bypass',
    () => {
      // The positive half of a capability denial. `narrowAdmin` reaches this as
      // `current_user = 'app_admin'` — the branch IS taken — and is still refused, which
      // is only possible because the capability conjunct is AND-ed with it.
      expect(
        requestSubjects(
          rowsAsRole<RequestRow>('app_admin', IDS.users.narrowAdmin, 'SELECT id, user_id, status FROM privacy_requests'),
        ),
      ).toEqual([]);

      // And the role genuinely holds nothing privacy, asserted from the catalog rather
      // than inferred from the denial.
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count
             FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = (SELECT role_id FROM user_roles WHERE user_id = '${IDS.users.narrowAdmin}')
              AND p.resource LIKE 'privacy%'`,
        )[0]?.count,
      ).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'a manager is not the operator: holding every privacy capability does not reach a colleague request',
    () => {
      // `has_permission()` walks UP, so `managerUser` holds `privacy_request:read` AND
      // `privacy_request_audit:read`, which is granted to `admin` alone. The scope
      // branch is `current_user`, so the manager sees nothing beyond their own row —
      // and they have none. This is the assertion that says the two axes were not
      // collapsed into one.
      expect(
        requestSubjects(
          rowsAsRole<RequestRow>('app_member', IDS.users.managerUser, 'SELECT id, user_id, status FROM privacy_requests'),
        ),
      ).toEqual([]);
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count
             FROM role_permissions rp
             JOIN user_roles ur ON ur.role_id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = '${IDS.users.managerUser}'
              AND p.resource = 'privacy_request' AND p.action_id = 'read'`,
        )[0]?.count,
      ).toBe(1);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 3 — the write path on privacy_requests
// =============================================================================

describe('privacy_requests · a member may file only for themselves, and may only withdraw', () => {
  it(
    'a member cannot file a request about a colleague, so the privacy path is not a way to start an administrative process against one',
    () => {
      const attempt = attemptAsRole('app_member', IDS.users.subject, [
        `INSERT INTO privacy_requests (user_id, request_nature, request_channel) VALUES ('${IDS.users.peer}', 'correction', 'in_app')`,
      ]);

      expect(attempt.ok, attempt.output).toBe(false);
      // The POLICY refused it — not the foreign key and not the grant. `23503` would
      // mean the FK found it, and would also be an existence oracle over `users.id`.
      expect(attempt.output).toContain('row-level security policy');
      expect(attempt.output).not.toContain('violates foreign key');

      // Ground truth: nothing was written.
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM privacy_requests WHERE request_nature = 'correction'`,
        )[0]?.count,
      ).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'a member can mark their own request withdrawn and CANNOT mark it fulfilled — a self-certified compliance claim',
    () => {
      const mine = superuserRows<{ id: string }>(`SELECT id FROM privacy_requests WHERE user_id = '${IDS.users.subject}'`)[0];
      if (mine === undefined) {
        throw new Error('the fixture filed no request for the subject');
      }
      const storedStatus = (): string | undefined =>
        superuserRows<{ status: string }>(`SELECT status FROM privacy_requests WHERE id = '${mine.id}'`)[0]?.status;

      // `in_progress` is a legal value of the column and violates NO table CHECK, so the
      // only thing that can refuse it is the policy's `WITH CHECK`. That distinguishes
      // the control from the constraints, which a status-only assertion cannot do.
      const escalated = attemptAsRole('app_member', IDS.users.subject, [
        `UPDATE privacy_requests SET status = 'in_progress' WHERE id = '${mine.id}'`,
      ]);
      expect(escalated.ok, escalated.output).toBe(false);
      expect(escalated.output).toContain('row-level security policy');

      // …and the manufactured compliance claim, whichever control refuses it. A member
      // who could mark their own request fulfilled could manufacture a claim that the
      // business honoured it, and nothing else in the schema would notice.
      const fulfilled = attemptAsRole('app_member', IDS.users.subject, [
        `UPDATE privacy_requests SET status = 'fulfilled', closed_at = now() WHERE id = '${mine.id}'`,
      ]);
      expect(fulfilled.ok, fulfilled.output).toBe(false);
      expect(storedStatus(), 'the member manufactured a fulfilled request').toBe('open');

      // Withdrawal IS the member's one reachable end state.
      const withdrawn = attemptAsRole('app_member', IDS.users.subject, [
        `UPDATE privacy_requests SET status = 'withdrawn', closed_at = now() WHERE id = '${mine.id}'`,
      ]);
      expect(withdrawn.ok, withdrawn.output).toBe(true);
      expect(storedStatus()).toBe('withdrawn');
    },
    TIMEOUT,
  );

  it(
    'no serving role holds DELETE on privacy_requests, and the refusal is proven — the record must survive 24 months',
    () => {
      for (const role of ['app_anon', 'app_member', 'app_admin']) {
        expect(
          superuserRows<{ holds: boolean }>(
            `SELECT has_table_privilege('${role}', 'public.privacy_requests', 'DELETE') AS holds`,
          )[0]?.holds,
          `${role} holds DELETE on privacy_requests`,
        ).toBe(false);
      }

      const attempt = attemptAsRole('app_admin', IDS.users.adminProbe, ['DELETE FROM privacy_requests']);
      expect(attempt.ok, attempt.output).toBe(false);
      expect(attempt.output).toContain('permission denied');

      expect(superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM privacy_requests`)[0]?.count).toBeGreaterThan(
        0,
      );
    },
    TIMEOUT,
  );

  it(
    'no privacy_request permission row carries a delete verb, so the capability to erase the record does not exist at all',
    () => {
      const verbs = superuserRows<{ action_id: string }>(
        `SELECT action_id FROM permissions WHERE resource = 'privacy_request' ORDER BY action_id`,
      );
      expect(verbs.map((row) => row.action_id)).toEqual(['create', 'read', 'update']);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 4 — the per-regulation clocks
// =============================================================================

describe('privacy_request_regulations · GDPR and CCPA are independent clocks on one request', () => {
  it(
    'a subject adds both statutes to their own request, each with its own deadline, and adding CCPA twice is a no-op',
    () => {
      // Not filtered on `status`: the withdrawal test above has already closed this row,
      // and a fixture that only worked because of the declaration order of this file is
      // not a fixture.
      const request = superuserRows<{ id: string }>(
        `SELECT id FROM privacy_requests WHERE user_id = '${IDS.users.subject}' ORDER BY requested_at, id`,
      )[0];
      if (request === undefined) {
        throw new Error('the fixture filed no OPEN request for the subject');
      }

      const added = attemptAsRole('app_member', IDS.users.subject, [
        `INSERT INTO privacy_request_regulations (request_id, regulation, sla_deadline)
         VALUES ('${request.id}', 'gdpr', now() + interval '30 days'),
                ('${request.id}', 'ccpa', now() + interval '45 days')`,
      ]);
      expect(added.ok, added.output).toBe(true);

      // DEDUP BY CONSTRUCTION: the composite primary key drops the second CCPA row, so
      // there is no dedup logic to get wrong. The command TAG is the assertion — a second
      // row would read `INSERT 0 1`.
      const again = attemptAsRole('app_member', IDS.users.subject, [
        `INSERT INTO privacy_request_regulations (request_id, regulation, sla_deadline)
         VALUES ('${request.id}', 'ccpa', now() + interval '999 days')
         ON CONFLICT (request_id, regulation) DO NOTHING`,
      ]);
      expect(again.ok, again.output).toBe(true);
      expect(again.output).toContain('INSERT 0 0');

      // The two deadlines stay INDEPENDENT — the duplicate did not overwrite the first,
      // which is what `DO NOTHING` rather than `DO UPDATE` buys.
      // The clock is measured from the REQUEST's `requested_at`, which lives on
      // `privacy_requests` — `privacy_request_regulations` carries `sla_deadline` and
      // nothing else that could be a start instant. Joining rather than reading a
      // `requested_at` off this table is also what makes the assertion independent of
      // which row the join picks.
      const rows = superuserRows<{ regulation: string; days: number }>(
        `SELECT g.regulation, EXTRACT(DAY FROM (g.sla_deadline - r.requested_at))::int AS days
           FROM privacy_request_regulations g
           JOIN privacy_requests r ON r.id = g.request_id
          WHERE g.request_id = '${request.id}' ORDER BY g.regulation`,
      );
      expect(rows.map((row) => `${row.regulation}:${String(row.days)}`)).toEqual(['ccpa:45', 'gdpr:30']);
    },
    TIMEOUT,
  );

  it(
    'a member cannot add a clock to a colleague request, and cannot move ANY clock — the clocks are the operator answer',
    () => {
      const peersRequest = superuserRows<{ id: string }>(
        `SELECT id FROM privacy_requests WHERE user_id = '${IDS.users.peer}'`,
      )[0];
      if (peersRequest === undefined) {
        throw new Error('the fixture filed no request for the peer');
      }

      const onPeers = attemptAsRole('app_member', IDS.users.subject, [
        `INSERT INTO privacy_request_regulations (request_id, regulation, sla_deadline)
         VALUES ('${peersRequest.id}', 'gdpr', now() + interval '30 days')`,
      ]);
      expect(onPeers.ok, onPeers.output).toBe(false);
      expect(onPeers.output).toContain('row-level security policy');

      // Even on their OWN request: `privacy_request_regulation_update` is
      // `current_user = 'app_admin'` and nothing else, which is the narrowest predicate
      // in the migration.
      //
      // **The refusal here is `UPDATE 0`, not an error, and the difference is the
      // point.** An UPDATE's `USING` clause filters candidate rows, so a predicate that
      // is false for every row produces a successful statement that matched nothing —
      // whereas the INSERT above goes straight to `WITH CHECK` and RAISES. §B8 records
      // that `UPDATE 0` and a refused write are different outcomes, so the assertion
      // names the command TAG rather than the absence of an exception: an assertion that
      // only checked `ok === true` would pass on the leak as readily as on the denial.
      const own = superuserRows<{ request_id: string }>(
        `SELECT request_id FROM privacy_request_regulations WHERE regulation = 'gdpr' LIMIT 1`,
      )[0];
      if (own === undefined) {
        throw new Error('the fixture added no GDPR clock to anybody');
      }
      const moved = attemptAsRole('app_member', IDS.users.subject, [
        `UPDATE privacy_request_regulations SET extension_used = true WHERE request_id = '${own.request_id}' AND regulation = 'gdpr'`,
      ]);
      expect(moved.ok, moved.output).toBe(true);
      expect(moved.output).toContain('UPDATE 0');
      expect(moved.output).not.toContain('UPDATE 1');
      expect(
        superuserRows<{ extension_used: boolean }>(
          `SELECT extension_used FROM privacy_request_regulations WHERE request_id = '${own.request_id}' AND regulation = 'gdpr'`,
        )[0]?.extension_used,
        'a member moved their own clock — the narrowest predicate in the schema was not the narrowest thing reached',
      ).toBe(false);

      // And the operator can, which is the permitted half.
      const byOperator = attemptAsRole('app_admin', IDS.users.adminProbe, [
        `UPDATE privacy_request_regulations SET extension_used = true WHERE request_id = '${own.request_id}' AND regulation = 'gdpr'`,
      ]);
      expect(byOperator.ok, byOperator.output).toBe(true);
      expect(byOperator.output).toContain('UPDATE 1');
      expect(
        superuserRows<{ extension_used: boolean }>(
          `SELECT extension_used FROM privacy_request_regulations WHERE request_id = '${own.request_id}' AND regulation = 'gdpr'`,
        )[0]?.extension_used,
      ).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'a subject reads only the clocks of their own request, and the two statutes together',
    () => {
      const visible = rowsAsRole<{ regulation: string; request_id: string }>(
        'app_member',
        IDS.users.subject,
        'SELECT request_id, regulation FROM privacy_request_regulations ORDER BY regulation',
      );
      // Two statutes, ONE request. Had the policy followed the group closure this would
      // be two request ids the moment the peer added a clock of their own.
      expect(visible.map((row) => row.regulation)).toEqual(['ccpa', 'gdpr']);
      expect([...new Set(visible.map((row) => row.request_id))]).toHaveLength(1);
      expect(visible[0]?.request_id).toBe(
        superuserRows<{ id: string }>(
          `SELECT id FROM privacy_requests WHERE user_id = '${IDS.users.subject}' ORDER BY requested_at, id`,
        )[0]?.id,
      );
    },
    TIMEOUT,
  );
});

// =============================================================================
// 5 — the compliance record
// =============================================================================

describe('privacy_request_audits · the compliance record is append-only', () => {
  it(
    'INSERT, UPDATE, DELETE and TRUNCATE are refused for EVERY serving role, app_admin included',
    () => {
      for (const role of ['app_anon', 'app_member', 'app_admin']) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
          const held = superuserRows<{ holds: boolean }>(
            `SELECT has_table_privilege('${role}', 'public.privacy_request_audits', '${privilege}') AS holds`,
          );
          expect(
            held[0]?.holds,
            `${role} holds ${privilege} on privacy_request_audits, so the record can be edited after the fact`,
          ).toBe(privilege === 'SELECT' && role === 'app_admin');
        }
      }

      // The refusal is PROVEN, not merely absent from the catalog. `app_admin` is the
      // half that is load-bearing: it holds the full verb set on every other table in
      // this schema, so "it cannot write" here is a decision rather than a coincidence.
      for (const statement of [
        `INSERT INTO privacy_request_audits (request_key, event_type, requested_at, request_nature, request_channel, subject_hmac, pepper_kid)
         VALUES (gen_random_uuid(), 'received', now(), 'access', 'in_app', convert_to('probe', 'UTF8'), 'k1')`,
        'UPDATE privacy_request_audits SET denial_basis = 42',
        'DELETE FROM privacy_request_audits',
        'TRUNCATE privacy_request_audits',
      ]) {
        const attempt = attemptAsRole('app_admin', IDS.users.adminProbe, [statement]);
        expect(attempt.ok, `app_admin was allowed to run ${statement}:\n${attempt.output}`).toBe(false);
        expect(attempt.output).toContain('permission denied');
      }
    },
    TIMEOUT,
  );

  it(
    'the table carries no INSERT, UPDATE or DELETE POLICY, so a future table-level grant still cannot open it',
    () => {
      // Both halves of the control are asserted: the GRANT and the missing policy. A
      // single forgotten word in either is invisible to the other.
      const policies = superuserRows<{ cmd: string }>(
        `SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'privacy_request_audits' ORDER BY cmd`,
      );
      expect(policies.map((row) => row.cmd)).toEqual(['SELECT']);
    },
    TIMEOUT,
  );

  it(
    'the admin role really does hold the privacy_request capabilities, so append-only is the GRANTS and not a thin role',
    () => {
      // The positive half. Without it, "app_admin cannot write" would be satisfied by a
      // role nobody granted anything to, and the control would evaporate the first time
      // somebody widened it — which is exactly the failure §2.3 calls silent degradation.
      // `ORDER BY p.resource, p.action_id`, NOT `ORDER BY 1` on the concatenated string.
      // Sorting `'privacy_request:read'` and `'privacy_request_audit:read'` as one text
      // value depends on the cluster's collation: under `C` the `:` (0x3A) beats the `_`
      // (0x5F), and under a locale collation punctuation is ignored at the primary
      // strength, so `privacy_request_audit:read` sorts FIRST. The same query gives two
      // different answers on two machines, and the expected list would be right on one
      // and red on the other. Sorting the two columns is collation-independent and says
      // the same thing about the SET.
      const held = superuserRows<{ held: string }>(
        `SELECT p.resource || ':' || p.action_id AS held
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = 'admin'
            AND ((p.resource = 'privacy_request' AND p.action_id IN ('read', 'update'))
              OR (p.resource = 'privacy_request_audit' AND p.action_id = 'read'))
          ORDER BY p.resource, p.action_id`,
      );
      expect(held.map((row) => row.held)).toEqual([
        'privacy_request:read',
        'privacy_request:update',
        'privacy_request_audit:read',
      ]);
    },
    TIMEOUT,
  );

  it(
    'a member reads no audit row, an admin holding the capability reads them, and an admin without it reads zero — the whole read path',
    () => {
      // PERMITTED: the admin, through the boundary, holding `privacy_request_audit:read`.
      const asAdmin = rowsAsRole<{ event_type: string }>(
        'app_admin',
        IDS.users.adminProbe,
        'SELECT event_type FROM privacy_request_audits ORDER BY event_type',
      );
      expect(asAdmin.length).toBeGreaterThan(0);

      // DENIED at the GRANT layer: `app_member` holds no SELECT, so the refusal names the
      // TABLE — and specifically NOT `permission denied for function`, which would mean
      // a caller had reached the policy.
      const asMember = attemptAsRole('app_member', IDS.users.subject, ['SELECT count(*) FROM privacy_request_audits']);
      expect(asMember.ok, asMember.output).toBe(false);
      expect(asMember.output).toContain('permission denied for table');
      expect(asMember.output).not.toContain('permission denied for function');

      // DENIED at the POLICY layer: `narrowAdmin` HOLDS the table grant as `app_admin`
      // and the branch is true, so the capability conjunct is the only thing between it
      // and the statutory basis of every consumer request in the database.
      expect(
        rowsAsRole<{ event_type: string }>('app_admin', IDS.users.narrowAdmin, 'SELECT event_type FROM privacy_request_audits'),
      ).toEqual([]);
    },
    TIMEOUT,
  );
});

describe('privacy_request_audits · the write function is the only door', () => {
  it(
    'the write function refuses a member recording a request about another user, and writes nothing',
    async () => {
      // THIS WAS RED AGAINST A REAL DEFECT IN `0010`, AND IT IS GREEN AGAINST `0014`.
      //
      // `authz.append_privacy_request_audit` as `0010` shipped it (`0010:736-743`)
      // refused writing about another subject only when `NOT has_permission(actor,
      // 'privacy_request', 'update')` — the capability ALONE. The `privacy_request_update`
      // policy it says it mirrors (`0010:567-576`) requires `user_id = authz.actor()`
      // AND that capability, so the function's gate was strictly the weaker of the two,
      // and since `0010:373-374` confers `privacy_request:update` on `member`, `manager`
      // AND `admin` an ordinary member satisfied it, the RAISE never fired and the row
      // was written.
      //
      // `0014` changed the schema, not this expectation. The gate is now
      // `privacy_request_update`'s `USING` conjunct for conjunct. The one expression it
      // could not reuse verbatim is the admin branch: `current_user` REBINDS TO THE
      // OWNER inside a `SECURITY DEFINER` function, so `current_user = 'app_admin'` here
      // would be false for every caller including `app_admin` — a denial-only test cannot
      // see that, and the operator branch is precisely why the positive control below
      // (the fixture's own admin writes, and the second test's `byOperator`) exists.
      // `0014` keys it on `current_setting('role', true)`, which is the same fact.
      const before = superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM privacy_request_audits`)[0]?.count ?? 0;

      const statement = `SELECT authz.append_privacy_request_audit(
         'received', gen_random_uuid(), now(), 'access', 'in_app',
         NULL, NULL, NULL, NULL, convert_to('probe', 'UTF8'), 'k1', '${IDS.users.peer}')`;

      const attempt = attemptAsRole('app_member', IDS.users.subject, [statement]);
      expect(attempt.ok, attempt.output).toBe(false);

      // STRONGER THAN `toContain('42501')`, which is what this asserted. `42501` is
      // ALSO what a missing GRANT raises, so the code alone cannot say which control
      // refused or whether this function's gate is even on the path; the message names
      // the caller, the colleague and the gate, and would go red if the refusal came
      // from somewhere else. The numeric assertion is not lost — it is kept below over
      // a transport that carries it.
      expect(attempt.output).toContain(
        `append_privacy_request_audit: ${IDS.users.subject} is not permitted to write a privacy record about ${IDS.users.peer}`,
      );
      expect(await sqlstateOfMemberRefusal(IDS.users.subject, [statement])).toBe('42501');

      // A write function that swallowed the refusal would leave a compliance record with
      // a row that describes somebody else's request — so the count is the assertion.
      expect(superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM privacy_request_audits`)[0]?.count).toBe(
        before,
      );
    },
    TIMEOUT,
  );

  it(
    'a member may record their own intake; the operator events are refused to a member and permitted to an operator',
    async () => {
      // THE POSITIVE CONTROL, and the half that matters most here. A gate that refuses
      // everybody passes every denial assertion in this file, so the member's own
      // intake must still be permitted — and the operator's write in the same test must
      // still succeed — or "refused" would only ever have meant "broken".
      const own = attemptAsRole('app_member', IDS.users.subject, [
        `SELECT authz.append_privacy_request_audit(
           'received', gen_random_uuid(), now(), 'access', 'in_app',
           NULL, NULL, NULL, NULL, convert_to('probe', 'UTF8'), 'k1', '${IDS.users.subject}')`,
      ]);
      expect(own.ok, own.output).toBe(true);

      // `responded` is the business's answer ABOUT somebody, so a member may not write
      // one even about themselves — the manufactured-compliance-claim that `0010:552-556`
      // names as the reason the `privacy_requests` UPDATE policy has a `WITH CHECK` at
      // all, and which the audit path had no equivalent for.
      //
      // `0010`'s gate here was `p_event_type <> 'received' AND NOT has_permission(…)`,
      // which never evaluated true for a member, because `privacy_request:update` is
      // conferred on all three tiers precisely so that WITHDRAWAL is self-service.
      // `0014` gates on the superset PRINCIPAL instead, which is what
      // `privacy_request_update`'s `WITH CHECK` does.
      const statement = `SELECT authz.append_privacy_request_audit(
         'responded', gen_random_uuid(), now(), 'access', 'in_app',
         now(), 'fulfilled', NULL, NULL, convert_to('probe', 'UTF8'), 'k1', '${IDS.users.subject}')`;

      const answered = attemptAsRole('app_member', IDS.users.subject, [statement]);
      expect(answered.ok, answered.output).toBe(false);
      // Stronger than the `toContain('42501')` this replaces, for the reason recorded on
      // the previous test: the code is also what a missing GRANT raises, and the message
      // names the operator gate and the event that was refused.
      expect(answered.output).toContain(
        `append_privacy_request_audit: ${IDS.users.subject} attempted to write the responded event, which is an operator's to make`,
      );
      expect(await sqlstateOfMemberRefusal(IDS.users.subject, [statement])).toBe('42501');

      const byOperator = attemptAsRole('app_admin', IDS.users.adminProbe, [
        `SELECT authz.append_privacy_request_audit(
           'received', gen_random_uuid(), now(), 'deletion', 'email',
           NULL, NULL, NULL, NULL, convert_to('probe', 'UTF8'), 'k1', '${IDS.users.subject}')`,
      ]);
      expect(byOperator.ok, byOperator.output).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'a responded row with no response, and a denial with no statutory basis, are refused by the tables own CHECKs',
    () => {
      // The shape is the TABLE's business, so the refusals are `check_violation`
      // (SQLSTATE 23514) and come from the constraints rather than from a second copy of
      // the vocabulary in the function — §2.4: one mechanism per concern.
      //
      // Asserted on the CONSTRAINT NAME, not on the numeric class, and the reason is the
      // transport: psql at its default `VERBOSITY` prints `ERROR:` plus the message and
      // never prints the SQLSTATE, so no `toContain('23514')` over this harness can pass —
      // it would have to be satisfied by turning on `VERBOSITY verbose` for the whole
      // file. The name is the stronger assertion anyway: 23514 also covers a foreign key
      // and a not-null violation, whereas `privacy_request_audits_response_is_complete`
      // says WHICH control fired and would go red if the refusal came from somewhere
      // else. §B8: assert the body, not the shape of the failure.
      const noResponse = attemptAsRole('app_admin', IDS.users.adminProbe, [
        `SELECT authz.append_privacy_request_audit(
           'responded', gen_random_uuid(), now(), 'access', 'in_app',
           NULL, NULL, NULL, NULL, convert_to('probe', 'UTF8'), 'k1', '${IDS.users.subject}')`,
      ]);
      expect(noResponse.ok, noResponse.output).toBe(false);
      expect(noResponse.output).toContain('privacy_request_audits_response_is_complete');

      // A denial with NO statutory basis: both halves NULL. Supplying a basis with no
      // citation would instead trip `privacy_request_audits_denial_basis_is_paired` first
      // — a different control, and naming it is the point of asserting on the constraint
      // rather than on `23514`.
      const noBasis = attemptAsRole('app_admin', IDS.users.adminProbe, [
        `SELECT authz.append_privacy_request_audit(
           'responded', gen_random_uuid(), now(), 'access', 'in_app',
           now(), 'denied', NULL, NULL, convert_to('probe', 'UTF8'), 'k1', '${IDS.users.subject}')`,
      ]);
      expect(noBasis.ok, noBasis.output).toBe(false);
      expect(noBasis.output).toContain('privacy_request_audits_denial_needs_a_basis');
    },
    TIMEOUT,
  );

  it(
    'the write function is unreachable by app_anon and by PUBLIC — a SECURITY DEFINER writer reachable anonymously is an escalation',
    () => {
      const signature =
        'authz.append_privacy_request_audit(text, uuid, timestamptz, text, text, timestamptz, text, text, text, bytea, text, uuid)';
      for (const role of ['app_anon', 'public']) {
        const held = superuserRows<{ holds: boolean }>(
          `SELECT has_function_privilege('${role}', '${signature}', 'EXECUTE') AS holds`,
        );
        expect(held[0]?.holds, `${role} can execute the audit writer`).toBe(false);
      }
      for (const role of ['app_member', 'app_admin']) {
        const held = superuserRows<{ holds: boolean }>(
          `SELECT has_function_privilege('${role}', '${signature}', 'EXECUTE') AS holds`,
        );
        expect(held[0]?.holds, `${role} cannot execute the audit writer`).toBe(true);
      }
    },
    TIMEOUT,
  );
});

// =============================================================================
// 6 — the no-FK claim, asserted rather than commented
// =============================================================================

describe('the compliance record survives the erasure it documents', () => {
  it(
    'deleting the users row deletes their request rows and NOT their audit rows, and is not blocked by them',
    () => {
      const request = superuserRows<{ id: string; request_key: string }>(
        `SELECT id, request_key FROM privacy_requests WHERE user_id = '${IDS.users.erasedSubject}'`,
      )[0];
      if (request === undefined) {
        throw new Error('the fixture filed no request for the erased subject');
      }

      // Two audit rows correlated by `request_key`, NOT by a foreign key.
      for (const event of ['received', 'responded'] as const) {
        const written = attemptAsRole('app_admin', IDS.users.adminProbe, [
          `SELECT authz.append_privacy_request_audit(
             '${event}', '${request.request_key}', now(), 'deletion', 'in_app',
             ${event === 'responded' ? 'now()' : 'NULL'},
             ${event === 'responded' ? "'denied'" : 'NULL'},
             ${event === 'responded' ? "'interests outweighed'" : 'NULL'},
             ${event === 'responded' ? "'1798.100(b) and 1798.121'" : 'NULL'},
             convert_to('erased-subject', 'UTF8'), 'k1', '${IDS.users.erasedSubject}')`,
        ]);
        expect(written.ok, written.output).toBe(true);
      }
      expect(auditRowsFor(request.request_key)).toHaveLength(2);

      // THE CLAIM. A foreign key here would either CASCADE the evidence away or, with
      // SET NULL, need an UPDATE nobody holds — and then `DELETE FROM users` would die
      // with 23503 and block the erasure for the whole 24-month retention window. So the
      // delete must SUCCEED and the audit rows must still be there afterwards.
      const erased = attemptAsRole('app_admin', IDS.users.adminProbe, [
        `DELETE FROM users WHERE id = '${IDS.users.erasedSubject}'`,
      ]);
      expect(erased.ok, `the erasure was blocked by the compliance record:\n${erased.output}`).toBe(true);
      expect(erased.output).not.toContain('23503');

      // The request rows DID cascade — proving the FK on `privacy_requests` is real, and
      // the no-FK claim on the audit table is a contrast rather than an omission.
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM privacy_requests WHERE user_id = '${IDS.users.erasedSubject}'`,
        )[0]?.count,
      ).toBe(0);

      // …and the compliance record survived, twice, with the subject id still on it.
      const survivors = auditRowsFor(request.request_key);
      expect(survivors.map((row) => row.event_type)).toEqual(['received', 'responded']);
      expect(survivors.every((row) => row.subject_user_id === IDS.users.erasedSubject)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'privacy_request_audits holds no foreign key at all, asserted from the catalog',
    () => {
      const fks = superuserRows<{ name: string }>(
        `SELECT conname AS name
           FROM pg_constraint
          WHERE conrelid = 'public.privacy_request_audits'::regclass AND contype = 'f'
          ORDER BY 1`,
      );
      expect(fks.map((row) => row.name)).toEqual([]);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 7 — the anonymisation choke point
// =============================================================================

describe('anonymisation · a soft-deleted user resolves to NOTHING, on both axes', () => {
  it(
    'BEFORE anonymisation the tombstone holds real scope and real capability, so the assertion after it can fail',
    () => {
      // The positive control, and the half almost every "the trigger deleted the rows"
      // test omits. A tombstone that was never authorised proves nothing when it is later
      // found to hold nothing.
      expect(visibleSubjects(IDS.users.tombstone)).toContain(probeLabel(IDS.users.subject));

      // The mail half of the positive control, because `email_messages` resolves through
      // the SAME `authz.visible_user_ids()`. A tombstone that kept its `user_groups` rows
      // would keep reading colleagues' correspondence even if every privacy_request
      // policy were perfect — so the mail table is the second instrument on the choke
      // point, not a decoration on it.
      //
      // `rowsAsRole` yields one OBJECT per row, so the comparison maps to the column
      // rather than expecting bare strings: `[{ subject: 'x' }]` and `['x']` are
      // different values, and `toEqual` on the raw rows could only have been satisfied by
      // rewriting the expectation rather than the query.
      expect(
        rowsAsRole<{ subject: string }>('app_member', IDS.users.tombstone, 'SELECT subject FROM email_messages').map(
          (row) => row.subject,
        ),
      ).toEqual([`mail-for-${probeLabel(IDS.users.subject)}`, `mail-for-${probeLabel(IDS.users.peer)}`].sort());

      const held = rowsAsRole<{ can_email: boolean; can_request: boolean; can_purge: boolean }>(
        'app_member',
        IDS.users.tombstone,
        `SELECT authz.can_read_email() AS can_email,
                public.has_permission(authz.actor(), 'privacy_request', 'create') AS can_request,
                public.has_permission(authz.actor(), 'privacy_purge', 'read') AS can_purge`,
      )[0];
      expect(held?.can_email).toBe(true);
      expect(held?.can_request).toBe(true);
      expect(held?.can_purge).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'after anonymisation the tombstone resolves to ZERO scope — zero visible users, zero readable requests, zero readable mail',
    () => {
      const anonymised = attemptAsRole('app_admin', IDS.users.adminProbe, [
        `UPDATE users SET deleted_at = now(), deletion_reason = 'rtbf' WHERE id = '${IDS.users.tombstone}'`,
      ]);
      expect(anonymised.ok, anonymised.output).toBe(true);

      // SCOPE, asserted as MEMBERSHIP rather than as a count.
      expect(visibleSubjects(IDS.users.tombstone)).toEqual([]);

      // …and every derived table routes through that set, so they are empty too.
      expect(
        requestSubjects(rowsAsRole<RequestRow>('app_member', IDS.users.tombstone, 'SELECT id, user_id, status FROM privacy_requests')),
      ).toEqual([]);
      expect(rowsAsRole<{ subject: string }>('app_member', IDS.users.tombstone, 'SELECT subject FROM email_messages')).toEqual([]);

      // …while the rows are still in the table, so both answers above are DENIALS and not
      // an empty fixture. An UNFILTERED superuser read: a filtered count cannot tell
      // "nothing is there" from "I can see nothing", which makes every denial assertion
      // vacuous.
      expect(
        superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM email_messages`)[0]?.count,
      ).toBe(2);
    },
    TIMEOUT,
  );

  it(
    'after anonymisation the tombstone resolves to ZERO capability — every resource it used to hold',
    () => {
      // The other axis, and the one a timestamp-only implementation passes. `email:read`
      // is the sharpest case: the `manager` role holds it directly and it is inherited
      // UPWARD by every role in the tree, so an account that kept its `user_roles` rows
      // would keep it however the policies are written.
      const held = rowsAsRole<{ can_email: boolean; can_request: boolean; can_purge: boolean }>(
        'app_member',
        IDS.users.tombstone,
        `SELECT authz.can_read_email() AS can_email,
                public.has_permission(authz.actor(), 'privacy_request', 'create') AS can_request,
                public.has_permission(authz.actor(), 'privacy_purge', 'read') AS can_purge`,
      )[0];
      expect(held?.can_email).toBe(false);
      expect(held?.can_request).toBe(false);
      expect(held?.can_purge).toBe(false);

      // The row sets are gone, which is the MECHANISM, asserted so a future edit that
      // moves the check somewhere cheaper still leaves the evidence visible.
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM user_roles WHERE user_id = '${IDS.users.tombstone}'`,
        )[0]?.count,
      ).toBe(0);
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM user_groups WHERE user_id = '${IDS.users.tombstone}'`,
        )[0]?.count,
      ).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'a tombstone cannot read its own users row, while the admin still can — the retention scan depends on it',
    () => {
      expect(rowsAsRole<{ id: string }>('app_member', IDS.users.tombstone, 'SELECT id FROM users')).toEqual([]);

      // The admin branch comes FIRST and is deliberately untouched: the inactivity scan
      // is `WHERE deleted_at IS NOT NULL`, and a policy that hid those rows would
      // silently empty the purge queue.
      expect(
        rowsAsRole<{ id: string }>('app_admin', IDS.users.adminProbe, `SELECT id FROM users WHERE id = '${IDS.users.tombstone}'`),
      ).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'un-deleting a tombstone restores NO authority — the tombstone is inert, not merely hidden',
    () => {
      // The reason the choke point removes rows rather than consulting `users`: restoring
      // the timestamp is a two-column write any caller with UPDATE can perform, and if
      // authority came back with it, `deleted_at = NULL` would be a privilege-escalation
      // statement with no database signal.
      const restored = attemptAsRole('app_admin', IDS.users.adminProbe, [
        `UPDATE users SET deleted_at = NULL, deletion_reason = NULL WHERE id = '${IDS.users.tombstone}'`,
      ]);
      expect(restored.ok, restored.output).toBe(true);

      expect(visibleSubjects(IDS.users.tombstone)).toEqual([]);
      expect(
        rowsAsRole<{ can_email: boolean }>('app_member', IDS.users.tombstone, 'SELECT authz.can_read_email() AS can_email')[0]
          ?.can_email,
      ).toBe(false);

      // Put it back, so the declaration order of this file never becomes load-bearing.
      const reAnonymised = attemptAsRole('app_admin', IDS.users.adminProbe, [
        `UPDATE users SET deleted_at = now(), deletion_reason = 'rtbf' WHERE id = '${IDS.users.tombstone}'`,
      ]);
      expect(reAnonymised.ok, reAnonymised.output).toBe(true);
    },
    TIMEOUT,
  );
});

describe('anonymisation · email_anonymized is DERIVED, not stored', () => {
  it(
    'the column is a STORED generated column, and writing it directly is refused',
    () => {
      // A stored boolean can drift from the fact that produced it, and the failure is
      // invisible from the row: an account whose email WAS erased but whose flag says
      // false is counted as still holding personal data, and one that says true when the
      // email is intact is counted as erased. `GENERATED ALWAYS … STORED` makes the drift
      // unrepresentable rather than merely unlikely.
      expect(
        superuserRows<{ attgenerated: string }>(
          `SELECT attgenerated FROM pg_attribute
            WHERE attrelid = 'public.users'::regclass AND attname = 'email_anonymized'`,
        )[0]?.attgenerated,
      ).toBe('s');

      const readFlag = (): boolean | null =>
        superuserRows<{ anonymized: boolean | null }>(
          `SELECT email_anonymized AS anonymized FROM users WHERE id = '${IDS.users.usUser}'`,
        )[0]?.anonymized ?? null;

      // BEFORE, so the assertion after the refusal is about UNCHANGED rather than about
      // a particular rendering of "not erased". `usUser` is a live row, and 0009 derives
      // the column from `deletion_reason`, so the generator yields NULL — not `false` —
      // for a user who has never been deleted. Pinning the literal `false` would have
      // asserted a value the expression never produces; reading it first and comparing
      // afterwards proves the actual claim, which is that the refused write changed
      // nothing, and it stays true if the derivation is ever tightened to a NOT NULL
      // boolean.
      const before = readFlag();

      const attempt = attemptAsRole('app_admin', IDS.users.adminProbe, [
        `UPDATE users SET email_anonymized = true WHERE id = '${IDS.users.usUser}'`,
      ]);
      expect(attempt.ok, attempt.output).toBe(false);
      // The message is version-dependent — PostgreSQL 18 allows a generated column to be
      // set to DEFAULT, so the refusal became "can only be updated to DEFAULT" — and both
      // spellings are the same control.
      expect(attempt.output).toMatch(/cannot update a generated column|can only be updated to DEFAULT/);
      expect(readFlag(), 'the refused write still moved the generated column').toBe(before);
      expect(readFlag(), 'a generated column must never report an erasure that did not happen').not.toBe(true);
    },
    TIMEOUT,
  );

  it(
    'email_anonymized is true only for an RTBF erasure — a row soft-deleted inactive still HAS its email, and is still inert',
    () => {
      // Derived from `deletion_reason` and NOT from `deleted_at IS NOT NULL`, because a
      // row retired for inactivity was never erased: counting it as erased would
      // overstate how much personal data this system still holds.
      const soft = attemptAsRole('app_admin', IDS.users.adminProbe, [
        `UPDATE users SET deleted_at = now(), deletion_reason = 'inactive' WHERE id = '${IDS.users.managerUser}'`,
      ]);
      expect(soft.ok, soft.output).toBe(true);

      const rows = superuserRows<{ username: string; deleted: boolean; anonymized: boolean; reason: string }>(
        `SELECT username, deleted_at IS NOT NULL AS deleted, email_anonymized AS anonymized,
                coalesce(deletion_reason, '-') AS reason
           FROM users WHERE id IN ('${IDS.users.tombstone}', '${IDS.users.managerUser}') ORDER BY username`,
      );
      const tombstone = rows.find((row) => row.username === probeLabel(IDS.users.tombstone));
      const inactive = rows.find((row) => row.username === probeLabel(IDS.users.managerUser));

      expect(tombstone?.deleted).toBe(true);
      expect(tombstone?.anonymized).toBe(true);
      expect(inactive?.deleted).toBe(true);
      expect(inactive?.anonymized, 'an inactivity retirement is not an erasure').toBe(false);

      // …and the inactivity retirement REVOKED authority anyway, which is the property
      // the derived column deliberately does NOT carry: zero scope and zero capability
      // is keyed on `deleted_at`, not on the reason.
      expect(visibleSubjects(IDS.users.managerUser)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'a deletion_reason outside the closed vocabulary is refused, and so is a reason with no timestamp',
    () => {
      const attempt = attemptAsRole('app_admin', IDS.users.adminProbe, [
        `UPDATE users SET deleted_at = now(), deletion_reason = 'because' WHERE id = '${IDS.users.usUser}'`,
      ]);
      expect(attempt.ok, attempt.output).toBe(false);
      expect(attempt.output).toContain('users_deletion_reason_check');

      // …and the statement rolled back WHOLE, so the trigger's DELETEs of `usUser`'s
      // membership rows went with it. A choke point whose DELETEs outlived a failed
      // anonymisation would authorise nobody for a row that still claims to be alive.
      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM user_groups WHERE user_id = '${IDS.users.usUser}'`,
        )[0]?.count,
      ).toBe(1);

      // A reason with no timestamp is a record of a decision nobody took, at no instant.
      const dangling = attemptAsRole('app_admin', IDS.users.adminProbe, [
        `UPDATE users SET deletion_reason = 'rtbf' WHERE id = '${IDS.users.usUser}'`,
      ]);
      expect(dangling.ok, dangling.output).toBe(false);
      expect(dangling.output).toContain('users_deletion_reason_requires_deleted_at');
    },
    TIMEOUT,
  );
});

// =============================================================================
// 8 — the plan, and the shape of the schema
// =============================================================================

describe('privacy_requests · the scoping subquery is evaluated ONCE per statement', () => {
  it(
    'EXPLAIN shows loops = 1 for the scoping subplan, and one capability resolution for the whole statement',
    () => {
      // The performance claim, assertable rather than asserted. The documented rule is
      // that a `STABLE` function in a qual is evaluated once per CANDIDATE ROW, not once
      // per statement: the withdrawn per-row walk ran 400,001 times over 400,000 rows,
      // and the intermediate shape of `email_read_scope` ran `can_read_email()` 6,606
      // times over 6,602 rows. So the assertion is on the PLAN and on the FUNCTION CALL
      // COUNTS, both at a realistic row count — reading the policy's SQL proves nothing,
      // because an EXISTS-shaped variant is simplified back into a hashed SubPlan and the
      // text and the behaviour diverge.
      const bulk = 1_200;
      const seeded = attemptAsRole('app_admin', IDS.users.adminProbe, [
        `INSERT INTO privacy_requests (user_id, request_nature, request_channel)
         SELECT '${IDS.users.subject}', 'access', 'in_app' FROM generate_series(1, ${String(bulk)})`,
      ]);
      expect(seeded.ok, seeded.output).toBe(true);
      superuserExec(PROOF_DB, 'ANALYZE public.privacy_requests;');

      try {
        expect(
          superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM privacy_requests`)[0]?.count,
        ).toBeGreaterThan(1_000);

        superuserExec(PROOF_DB, 'SELECT pg_stat_reset();');
        const explain = runRoleScript(
          'app_member',
          IDS.users.subject,
          ['EXPLAIN (ANALYZE, COSTS OFF, FORMAT TEXT) SELECT count(*) FROM privacy_requests'],
          true,
        );
        expect(explain.ok, `EXPLAIN failed:\n${explain.output}`).toBe(true);
        expect(explain.output).toContain('SubPlan');

        const loops = [...explain.output.matchAll(/SubPlan \d+[\s\S]*?loops=(\d+)/g)].map((match) => match[1]);
        expect(loops.length, `no SubPlan loops in the plan:\n${explain.output}`).toBeGreaterThan(0);
        for (const loop of loops) {
          expect(Number(loop), `the scoping subplan ran ${loop} times, not once`).toBe(1);
        }

        // The sharper assertion: the CAPABILITY resolution must not be per-row either.
        // `pg_stat_user_functions` has NO ROW for a function that was never called, so a
        // missing row means zero, not "unknown" — and reading it as undefined is what
        // makes this assertion read as a broken measurement rather than as the tamper it
        // actually catches.
        const calls = superuserRows<{ funcname: string; calls: number }>(
          `SELECT funcname, coalesce(calls, 0)::int AS calls
             FROM pg_stat_user_functions
            WHERE funcname IN ('can_read_privacy_request', 'visible_user_ids')
            ORDER BY funcname`,
        );
        const byName = new Map(calls.map((row) => [row.funcname, row.calls]));
        expect(byName.get('can_read_privacy_request') ?? 0).toBe(1);
        expect(byName.get('visible_user_ids') ?? 0).toBe(1);
      } finally {
        // Teardown goes through the OWNER: no serving role holds DELETE on
        // privacy_requests, which is the very control under test, and a teardown that
        // disabled it would prove nothing about anything.
        superuserExec(
          PROOF_DB,
          `DELETE FROM privacy_requests WHERE user_id = '${IDS.users.subject}';`,
        );
      }
    },
    TIMEOUT,
  );
});

describe('privacy_requests · the derived category is structural, not documented', () => {
  it(
    'the primary key is simple (id), because a derived row has no group of its own, and there is no group_id',
    () => {
      // The CATEGORY decides the key shape, and the rule is asserted from the catalog so
      // "derived" cannot quietly become group-scoped.
      expect(
        superuserRows<{ columns: string }>(
          `SELECT string_agg(a.attname, ',' ORDER BY a.attname) AS columns
             FROM pg_constraint c
             JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, position) ON true
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
            WHERE c.conrelid = 'public.privacy_requests'::regclass AND c.contype = 'p'`,
        )[0]?.columns,
      ).toBe('id');

      expect(
        superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_attribute
            WHERE attrelid = 'public.privacy_requests'::regclass AND attname = 'group_id' AND NOT attisdropped`,
        )[0]?.count,
      ).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'both tables a serving role writes are ENABLEd and FORCEd; the audit table is ENABLEd and deliberately NOT FORCEd',
    () => {
      // The audit table is not FORCEd because its writers are SECURITY DEFINER
      // functions running as the OWNER: under FORCE, `current_user` inside them would be
      // the owner, the predicate false, and EVERY audit write would fail — the
      // compliance record unreadable by construction. The trade is asserted rather than
      // left in a comment, because a later "FORCE everything" sweep would close it with
      // no test to stop it.
      const rows = superuserRows<{ relname: string; rowsecurity: boolean; forcerowsecurity: boolean }>(
        `SELECT c.relname, c.relrowsecurity AS rowsecurity, c.relforcerowsecurity AS forcerowsecurity
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname IN ('privacy_requests', 'privacy_request_regulations', 'privacy_request_audits')`,
      );
      const byName = new Map(rows.map((row) => [row.relname, row]));
      expect(byName.get('privacy_requests')?.rowsecurity).toBe(true);
      expect(byName.get('privacy_requests')?.forcerowsecurity).toBe(true);
      expect(byName.get('privacy_request_regulations')?.forcerowsecurity).toBe(true);
      expect(byName.get('privacy_request_audits')?.rowsecurity).toBe(true);
      expect(byName.get('privacy_request_audits')?.forcerowsecurity).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'no function these policies call is executable by PUBLIC, and each is executable by every role that reaches the policy',
    () => {
      // Postgres grants EXECUTE to PUBLIC on every new function, and a SECURITY DEFINER
      // helper reachable anonymously is an escalation rather than a read leak. A revoke
      // without a grant back would be worse: every scoped read would die with
      // `permission denied for function` and row scoping would be 100% non-functional
      // while every policy, grant and comment still looked correct.
      const helpers = [
        'can_create_privacy_request',
        'can_read_privacy_request',
        'can_update_privacy_request',
        'can_read_privacy_request_audit',
      ];
      const publicExecute = superuserRows<{ proname: string; may: boolean }>(
        `SELECT p.proname, has_function_privilege('public', p.oid, 'EXECUTE') AS may
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'authz' AND p.proname = ANY(ARRAY[${helpers.map((name) => `'${name}'`).join(', ')}])`,
      );
      expect(publicExecute).toHaveLength(helpers.length);
      for (const row of publicExecute) {
        expect(row.may, `${row.proname} is executable by PUBLIC`).toBe(false);
      }

      for (const helper of helpers) {
        for (const role of ['app_anon', 'app_member', 'app_admin']) {
          expect(
            superuserRows<{ may: boolean }>(
              `SELECT has_function_privilege('${role}', p.oid, 'EXECUTE') AS may
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'authz' AND p.proname = '${helper}'`,
            )[0]?.may,
            `${role} cannot execute ${helper}, so a scoped read would ERROR rather than deny`,
          ).toBe(true);
        }
      }
    },
    TIMEOUT,
  );

  it(
    'the capability rows and their grants are written by BOTH the migration and database/seed.ts',
    () => {
      // Asserted from the live catalog rather than from a file read: the property is that
      // these rows EXIST after the real pipeline, which is what a fork provisions. The
      // count is three because the seed grants the three tiers — and because the role
      // tree inherits upward, the grant count is the only thing that says which tier was
      // conferred the row, so it is asserted rather than inferred.
      const rows = superuserRows<{ resource: string; action_id: string; grants: number }>(
        `SELECT p.resource, p.action_id, count(rp.role_id)::int AS grants
           FROM permissions p
           LEFT JOIN role_permissions rp ON rp.permission_id = p.id
          WHERE p.resource IN ('privacy_request', 'privacy_request_audit')
          GROUP BY p.resource, p.action_id
          ORDER BY 1, 2`,
      );
      expect(rows.map((row) => `${row.resource}:${row.action_id}=${String(row.grants)}`)).toEqual([
        'privacy_request:create=3',
        'privacy_request:read=3',
        'privacy_request:update=3',
        // Admin alone: the denial basis is compliance-review material.
        'privacy_request_audit:read=1',
      ]);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 9 — the RLS posture of the compliance record: ENABLEd, deliberately NOT
//     FORCEd, and the residual is bounded rather than open
// =============================================================================
//
// `0010` records the same posture `0011` records for `privacy_purge_queue`, and
// `privacy-purge-queue.spec.ts` §8 already asserts what makes *that* trade
// bounded: no role reaching the table is SUPERUSER or BYPASSRLS, and the narrow
// `SECURITY DEFINER` writers are callable by one role with EXECUTE revoked from
// PUBLIC. **None of those three assertions existed for `privacy_request_audits`**,
// so a migration that granted `BYPASSRLS` to anything, added a second
// owner-privileged writer, or widened the table's ACL would have failed nothing.
//
// The fourth test pins the residual itself — the reason the trade is a trade and
// not a mistake — with row counts on both sides of it, because "the owner reads
// every row" is only half a claim without the capability gate's answer beside it.
describe('privacy_request_audits · ENABLEd, NOT FORCEd, and the residual is bounded rather than open', () => {
  it(
    'every role that can reach the table is NOSUPERUSER and NOBYPASSRLS, PUBLIC holds nothing, and the role list is read from the table ACL',
    () => {
      // AGENTS.md §B2's rule: FORCE does not bind a superuser or a BYPASSRLS role,
      // so these two attributes are the only thing between a serving role and every
      // compliance record in the database — and this table is *not* FORCEd, which
      // makes them even more load-bearing here than on a FORCEd one.
      //
      // Read from the table's OWN ACL rather than from a list of roles somebody
      // remembered, and expanded through `aclexplode` so a fourth grantee is a red
      // line instead of a silent extension. `COALESCE(relacl, acldefault('r',
      // relowner))` means a table whose ACL was never touched is expanded through
      // PostgreSQL's DEFAULT rather than skipped, and the LEFT JOIN keeps grantee 0
      // so a `PUBLIC` grant appears as the literal string.
      //
      // The counterpart assertion — `relrowsecurity` and `relforcerowsecurity` — is
      // NOT repeated here. It is asserted in §8 above ('both tables a serving role
      // writes are ENABLEd and FORCEd; the audit table is ENABLEd and deliberately
      // NOT FORCEd'), and a second copy of it would be a second thing to update
      // when the posture changes (§2.4).
      const grantees = superuserRows<{ grantee: string; rolsuper: boolean; rolbypassrls: boolean | null }>(
        `SELECT coalesce(r.rolname, 'PUBLIC') AS grantee, r.rolsuper, r.rolbypassrls
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
           LEFT JOIN pg_roles r ON r.oid = acl.grantee
          WHERE n.nspname = 'public' AND c.relname = 'privacy_request_audits'
          GROUP BY 1, 2, 3
          ORDER BY 1`,
      );

      // Properties of the list, not the list: a hardcoded grantee list is a baseline
      // that goes stale the moment a role appears. `app_admin` must be in it — the
      // operator's read is the only reason SELECT is granted at all — so the
      // assertion cannot pass on an empty result.
      expect(grantees.length).toBeGreaterThan(0);
      expect(grantees.map((row) => row.grantee)).toContain('app_admin');

      // Checked separately and first, because its row has no `pg_roles` entry and its
      // attributes are NULL: a `PUBLIC` grant is the shape `0010`'s `REVOKE ALL …
      // FROM PUBLIC` exists to prevent, and reading it off the LEFT JOIN is the only
      // way it appears in this result at all.
      expect(
        grantees.filter((row) => row.grantee === 'PUBLIC').map((row) => row.grantee),
        'PUBLIC holds a privilege on privacy_request_audits, so every compliance record is anonymously readable',
      ).toEqual([]);

      for (const row of grantees.filter((candidate) => candidate.grantee !== 'PUBLIC')) {
        expect(row.rolsuper, `${row.grantee} reaches privacy_request_audits and is a superuser`).toBe(false);
        expect(row.rolbypassrls, `${row.grantee} reaches privacy_request_audits and bypasses RLS`).toBe(false);
      }
    },
    TIMEOUT,
  );

  it(
    'the two authz writers are SECURITY DEFINER functions, and PUBLIC may not call them — which is what makes not-FORCEing the table bounded',
    () => {
      // The half of the trade that actually decays, and the exact parallel of
      // `privacy-purge-queue.spec.ts` §8's writer assertion.
      //
      // Because the table is not FORCEd and its only policy is a SELECT capability
      // gate, the writer functions are subject to NO policy at all: they
      // run as the OWNER and write a table with no INSERT policy to pass. Their
      // narrowness is therefore carried ENTIRELY by `EXECUTE`. Grant them to PUBLIC, or
      // revoke the revoke, and every caller in the cluster inherits an
      // owner-privileged writer over the statutory record of every consumer request
      // the system holds — silently, with no error anywhere.
      const writerSignatures = [
        'authz.append_privacy_request_audit(text, uuid, timestamptz, text, text, timestamptz, text, text, text, bytea, text, uuid)',
        'authz.record_erasure_audit(uuid, bytea, text, uuid)',
      ] as const;

      // The DEFINER fact itself, which nothing asserted before: a SECURITY INVOKER
      // rewrite of these functions would run as their caller, hit the missing INSERT
      // privilege, and fail — while every denial assertion in §5 above still passed,
      // because §5 asserts who may CALL the function and not what it runs as.
      for (const signature of writerSignatures) {
        expect(
          superuserRows<{ prosecdef: boolean }>(
            `SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('${signature}')`,
          )[0]?.prosecdef,
          `${signature} is not SECURITY DEFINER, so it does not run as the owner and this table does not need the not-FORCEd trade at all`,
        ).toBe(true);

        // The grantee set, from the ACL rather than from `has_function_privilege`
        // probes: §5 checks four named roles, and this checks that there is no FIFTH.
        const callables = superuserRows<{ grantee: string }>(
          `SELECT coalesce(r.rolname, 'PUBLIC') AS grantee
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
             LEFT JOIN pg_roles r ON r.oid = acl.grantee
            WHERE n.nspname = 'authz' AND p.oid = to_regprocedure('${signature}')
            GROUP BY 1
            ORDER BY 1`,
        );
        // The owner is the identity these definers deliberately run as, so the
        // assertion is about the SECOND grantee set: PUBLIC holds nothing, and the only
        // non-owner callers are the two serving roles §5 already names.
        expect(callables.map((row) => row.grantee)).not.toContain('PUBLIC');
        const expectedGrantees = signature.startsWith('authz.record_erasure_audit')
          ? ['app_admin']
          : ['app_admin', 'app_member'];
        expect(
          callables.map((row) => row.grantee).filter((grantee) => grantee !== databaseConfig().user),
          `${signature} is granted to a role other than the expected role(s)`,
        ).toEqual(expectedGrantees);
      }

      // AND THERE ARE ONLY THESE TWO WRITERS. Read from the function bodies rather than from
      // a remembered list, so a third definable writer added without a grant is a
      // red line here rather than a silent extension of the set — the same argument
      // `privacy-purge-queue.spec.ts` makes about its six writers, and the reason
      // `to_regprocedure` above is paired with it: a signature the database does not
      // have returns NULL, which would drop the row rather than report the rename.
      const writers = superuserRows<{ writer: string }>(
        `SELECT n.nspname || '.' || p.proname AS writer
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prosrc ILIKE '%INSERT INTO%privacy_request_audits%'
          ORDER BY 1`,
      );
      expect(writers.map((row) => row.writer)).toEqual([
        'authz.append_privacy_request_audit',
        'authz.record_erasure_audit',
      ]);
    },
    TIMEOUT,
  );

  it(
    'the owner reads every compliance row with no claims in scope, and the same table through the boundary is capability-gated',
    async () => {
      // The residual, asserted as a FACT with row counts on both sides rather than
      // narrated. Not FORCEd means the owner bypasses `privacy_request_audit_read`,
      // so the capability gate is NOT the whole control on this table — the grants
      // above, and the fact that the owner never receives a request, are. A reader
      // who assumes FORCE here is wrong, and this is the assertion that says so.
      //
      // Ground truth first, read by the SUPERUSER: without it the owner count cannot
      // be told apart from an empty table, which is how a claimless zero reads when
      // it is not a control (§B5's rule, and this file's own claimless-session
      // section is the same argument from the other direction).
      const written = superuserRows<{ count: number }>(
        `SELECT count(*)::int AS count FROM privacy_request_audits`,
      )[0]?.count;
      expect(written, 'the fixture must hold compliance rows for this to mean anything').toBeGreaterThan(0);

      // The owner, through a real connection — the same owner-side read §8 uses to
      // prove `privacy_requests` IS bound, which is the contrast: one table FORCEd
      // and one deliberately not.
      const owner = ownerClient();
      await owner.connect();
      let ownerSaw: number;
      try {
        const result = await owner.query<{ count: number }>('SELECT count(*)::int AS count FROM privacy_request_audits');
        ownerSaw = result.rows[0]?.count ?? -1;
      } finally {
        await owner.end();
      }
      expect(ownerSaw, 'the owner read a different number of rows than the superuser').toBe(written);

      // …and the same table through the boundary is capability-gated. Without the two
      // answers side by side, "the owner reads them all" is only half a claim.
      const asAdmin = rowsAsRole<{ event_type: string }>(
        'app_admin',
        IDS.users.adminProbe,
        'SELECT event_type FROM privacy_request_audits',
      );
      expect(asAdmin.length, 'the operator holding privacy_request_audit:read reads nothing').toBeGreaterThan(0);
      expect(
        rowsAsRole<{ event_type: string }>('app_admin', IDS.users.narrowAdmin, 'SELECT event_type FROM privacy_request_audits'),
        'an admin without the capability reads rows the owner reads, so the residual is not the only gate',
      ).toEqual([]);
    },
    TIMEOUT,
  );
});

// =============================================================================
// THE CLAIMLESS SESSION, AND WHY IT IS ASSERTED HERE RATHER THAN FIXED
// =============================================================================
//
// A serving-role session that carries no `request.jwt.claims` is not an exotic
// shape — it is the shape of EVERY write the thin Nest app makes, because
// `request.jwt.claims` is a caller-writable custom GUC that §B2 F1 forbids any
// request-reachable path from setting (`test/unit/claims-write-surface.spec.ts`
// fails the build if `src/` writes it). `auth.service.ts`, `email-audit.writer.ts`,
// `purge-sweeper.service.ts` and `privacy/erasure.service.ts` all connect as
// `pgrst_authenticator`, `SET LOCAL ROLE app_admin`, and carry no claims.
//
// On every table whose READ policy opens with `current_user = 'app_admin'` —
// `users_read_scope` (`0008:399`) — that is irrelevant, because the superset
// principal is admitted by the read path itself. `privacy_requests` is the one
// table where it is not: `privacy_request_read` (`0010:531-548`) has no admin
// branch, and its only route is `authz.can_read_privacy_request()`, i.e.
// `has_permission(authz.actor(), …)`, and `actor()` is NULL without the claims
// GUC. `0010:528-530` states that as intended ("A CLAIMLESS READER GETS ZERO
// ROWS, and that falls out of the shape rather than being a separate guard").
//
// The consequence was measured, not derived, and it is the erasure gap:
//
//   EXPLAIN (ANALYZE) of `CLOSE_OPEN_REQUESTS_SQL` as a claimless `app_admin`
//   shows the read policy ANDed into the UPDATE's scan filter beside its own
//   UPDATE policy, with `Rows Removed by Filter: 1` and `UPDATE 0` — on a row
//   that exists, whose `WHERE` is proven to match it. No error anywhere.
//
// The assertions below pin that measurement as a CONTROL, in the sense §B2
// means by it: the claimless session is denied, the denial is a zero-row answer
// rather than an error, the OWNER is bound by the same policies so there is no
// owner-side seam either, and the same session WITH a caller identity is
// permitted. Each can fail. The positive one goes red if
// `can_read_privacy_request()` ever starts reading identity wrongly, which is
// the "denies everyone silently" defect §B2 records; the owner one goes red the
// moment anyone drops `FORCE` from this table, which is precisely the change a
// "just un-FORCE it" fix for the erasure would make; and the positive control's
// scope assertion is what the refused wide fix would break.
//
// ## WHAT IS DELIBERATELY NOT ASSERTED
//
// There is no assertion here that a claimless session CAN close a subject's open
// request, because it cannot, and adding one would be red against a schema change
// that has not been approved. The gap is not silently accepted: it is escalated in
// `src/privacy/erasure.service.ts` on `CLOSE_OPEN_REQUESTS_SQL`, and the candidate
// fixes were each BUILT AND MEASURED against this database before being refused —
//
//   · `SECURITY DEFINER authz.close_subject_privacy_requests(uuid)`, the narrow
//     privileged seam, updates 0 rows. Inside a DEFINER `current_user` rebinds to
//     the owner, and `privacy_requests` is FORCE ROW LEVEL SECURITY
//     (`0010:445`), so `privacy_request_update`'s `current_user = 'app_admin'`
//     branch cannot match — a fourth "denies everyone silently". `SET LOCAL
//     row_security = off` inside it does not rescue it either: on a FORCEd table
//     that raises `query would be affected by row-level security policy` rather
//     than bypassing anything.
//   · Adding `current_user = 'app_admin'` to `privacy_request_read` — the wide
//     fix — DOES work, and measured here it turns a claimless `app_admin` session
//     from 0 visible rows into every request in the table, across groups. That is
//     the whole reason it is refused: it hands a `role: app_admin` PostgREST token
//     the complete DSAR workload of the deployment. Measured 7 of 7 on a live
//     database, and the closure went from `UPDATE 0` to `UPDATE 1`.
//   · `ALTER TABLE privacy_requests NO FORCE ROW LEVEL SECURITY` makes the narrow
//     seam work (measured: 1 row updated), and it costs the MIGRATION role
//     unrestricted read and write of every request on the table — the most
//     sensitive personal data in the schema, belonging to exactly the people who
//     asked to be forgotten. This file already pins `forcerowsecurity = true` for
//     this table with that reasoning attached, and the owner assertion above makes
//     the cost executable rather than a matter of taste.
//
// All three are security decisions about what the migration role and the admin
// principal may reach. None of them is the erasure's to make.
// =============================================================================
describe('privacy_requests · a session with no caller identity is outside every path to this table', () => {
  it(
    'a claimless app_admin session reads ZERO requests and closes none, and the zero is a policy answer rather than an error',
    () => {
      // Ground truth first, read by the SUPERUSER. Without it a zero above cannot be
      // told apart from an empty fixture — the failure §B5 records for a claimless
      // owner read, which returns 0 rows under FORCE forever.
      expect(
        superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM privacy_requests`)[0]?.count,
        'the fixture must hold requests for this to mean anything',
      ).toBeGreaterThan(0);

      // The READ. Zero rows, no error: `rowsAsRole` throws if the statement is refused,
      // so reaching the assertion at all is the "a denial arrives as a denial" half.
      expect(
        rowsAsRole<RequestRow>('app_admin', undefined, 'SELECT id, user_id, status FROM privacy_requests'),
      ).toEqual([]);

      // A request planted HERE, so the closure below is about the statement and not
      // about whichever fixture row an earlier test in this file happened to leave
      // behind — one of them tears its own subject's request down in a `finally`, and
      // another has anonymised `tombstone`, which is why the plant is filed by the
      // subject that still holds a role. `usUser` already holds one from the
      // fixture, so the planted row is identified by the DIFFERENCE rather than by a
      // `max(id)`, which would be a uuid ordering assumption dressed up as an
      // identity.
      const plantedIdsBefore = new Set(
        superuserRows<{ id: string }>(`SELECT id FROM privacy_requests WHERE user_id = '${IDS.users.usUser}'`).map(
          (row) => row.id,
        ),
      );
      const planted = fileRequest(IDS.users.usUser);
      if (!planted.ok) {
        throw new Error(`planting a request for the closure case failed:\n${planted.output}`);
      }
      const plantedId = superuserRows<{ id: string }>(
        `SELECT id FROM privacy_requests
          WHERE user_id = '${IDS.users.usUser}'
            AND NOT (id IN (${[...plantedIdsBefore].map((id) => `'${id}'`).join(',') || 'NULL'}))`,
      )[0]?.id;
      if (plantedId === undefined) {
        throw new Error('the planted request could not be told apart from the fixture rows for the same subject');
      }

      try {
        // The WRITE, verbatim as the erasure issues it. `attemptAsRole` keeps psql's
        // tags so the distinction §B8 insists on is visible: `UPDATE 0` is a silent
        // no-op and is NOT the same outcome as a refused statement.
        const closure = attemptAsRole('app_admin', undefined, [
          `UPDATE privacy_requests
              SET status = 'fulfilled', closed_at = now()
            WHERE user_id = '${IDS.users.usUser}'
              AND status IN ('open', 'in_progress')`,
        ]);
        expect(closure.ok, `the claimless closure should SUCCEED and match nothing:\n${closure.output}`).toBe(true);
        expect(closure.output).toContain('UPDATE 0');
        expect(closure.output).not.toMatch(/ERROR/);

        // And it is still open, read from OUTSIDE the policy so the assertion is not
        // itself subject to it. This is the whole defect, as a value: the erasure
        // reports success and the statutory clock is still running.
        expect(
          superuserRows<{ status: string }>(`SELECT status FROM privacy_requests WHERE id = '${plantedId}'`).map(
            (row) => row.status,
          ),
        ).toEqual(['open']);
      } finally {
        // Teardown through the OWNER, which holds DELETE and every serving role does
        // not — the same asymmetry the plan-cost test above tears down through.
        superuserExec(PROOF_DB, `DELETE FROM privacy_requests WHERE id = '${plantedId}';`);
      }
    },
    TIMEOUT,
  );

  it(
    'the migration/owner role is bound by the same policies, so no owner-side seam into privacy_requests exists',
    async () => {
      // `privacy_requests` is FORCE ROW LEVEL SECURITY (`0010:445`), so the table's own
      // owner is bound by `privacy_request_read` like anybody else. This is what makes
      // the refusal of "just drop FORCE" mechanical rather than a matter of taste: an
      // owner session with no claims reads nothing, so a SECURITY DEFINER seam owned
      // by the migration role is bound by the same policy and updates nothing.
      const asOwner = ownerClient();
      await asOwner.connect();
      try {
        await asOwner.query('BEGIN');
        const result = await asOwner.query<{ id: string }>('SELECT id FROM privacy_requests');
        expect(result.rows).toEqual([]);
        await asOwner.query('ROLLBACK');
      } catch (error) {
        await asOwner.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        await asOwner.end();
      }

      // Not vacuous: the same query as the SUPERUSER returns rows. If this ever fails
      // alongside the assertion above, the fixture is empty and the owner assertion is
      // proving nothing — which is exactly how a claimless zero reads when it is not a
      // control.
      expect(
        superuserRows<{ count: number }>(`SELECT count(*)::int AS count FROM privacy_requests`)[0]?.count,
      ).toBeGreaterThan(0);

      // The catalog half, because a policy-behaviour statement and a posture statement
      // are different claims and either alone passes.
      expect(
        superuserRows<{ forced: boolean }>(
          `SELECT relforcerowsecurity AS forced FROM pg_class WHERE oid = 'public.privacy_requests'::regclass`,
        )[0]?.forced,
      ).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'POSITIVE CONTROL: the same app_admin session, WITH a caller identity, reads the requests in scope — the zero above is scope, not lockout',
    () => {
      // §B2: "Assert the positive case — a caller that HOLDS a permission PASSES;
      // denial tests cannot see this defect, and every one of them passed against it."
      // `adminProbe` is a member of EU holding the `admin` role, so its closure
      // includes FR.
      const visible = requestSubjects(
        rowsAsRole<RequestRow>('app_admin', IDS.users.adminProbe, 'SELECT id, user_id, status FROM privacy_requests'),
      );

      expect(visible).toContain(probeLabel(IDS.users.peer));
      // …and NOT the out-of-scope one, so the positive control is not "an admin sees
      // everything". That is the shape the refused wide fix would have produced: a
      // claimless `app_admin` session reading every request in the table.
      expect(visible).not.toContain(probeLabel(IDS.users.usUser));
    },
    TIMEOUT,
  );
});
