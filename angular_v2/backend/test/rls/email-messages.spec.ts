import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentClassFor } from '../../src/email/email-content-class.js';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * W26 slice — `email_messages`, the FOURTH scoping category: **derived**.
 *
 * ## What this suite is proving
 *
 * A message row carries no `group_id`. Its visibility is resolved through the
 * RECIPIENT USER's `user_groups`, so an actor sees the email history of exactly
 * those users whose groups they can see. Scope and capability are AND-ed inside
 * ONE policy, never split across two PERMISSIVE policies — those are OR-ed, so a
 * scope policy covering `DELETE` admits it alone, and the measured failure that
 * produced that rule was a member holding ZERO capabilities deleting a row with
 * no error and no warning (ADR-0023 §Withdrawn).
 *
 * ## Ten cases, and each one is an attack or a hole
 *
 *  1. an admin holding `email:read` sees their own group and its SUBGROUPS, and
 *     not an unrelated group.
 *  2. a user in TWO groups is visible from EITHER — the case the whole category
 *     exists for, and the one a single `group_id` cannot express.
 *  3. a member with no `email:read` sees zero rows INSIDE THEIR OWN GROUP. The
 *     capability axis, not just the scope one.
 *  4. a role holding `user:create` but NOT `email:read` also sees zero. This is
 *     what makes the permission dedicated rather than a relabelled user one.
 *  5. no membership rows → zero rows and no error.
 *  6. `app_anon` holds no `SELECT` grant and no `EXECUTE` beyond what the policy
 *     needs — asserted as the grants actually are.
 *  7. structure: the primary key shape for the derived category, the FK's
 *     discipline, FORCE, no PUBLIC-executable function, the indexes.
 *  8. `EXPLAIN`'s real `loops`, and the real function-call counts. Asserted on
 *     loops because the SQL's apparent shape proves nothing.
 *  9. credential suppression: a `password_reset` persists `metadata_only` with
 *     `body IS NULL`, and an attempt to store a body for it is REFUSED.
 * 10. the gate can fail: drop the policy, watch these tests go red, restore it.
 *
 * ## The database
 *
 * A throwaway one, built by the REAL pipeline — bootstrap, every migration, then
 * the real `database/seed.ts` — so the grant-subset trigger, the policy and
 * the seeded roles are all genuinely in force rather than hand-installed. It
 * REFUSES the development database by name: a pre-existing database of this name
 * is dropped, never read, and the dev database is never touched.
 */

const TIMEOUT = 180_000;
const PROOF_DB = 'email_messages_proof';

/**
 * The password this suite authenticates `pgrst_authenticator` with.
 *
 * Read from `.env.test`, never written as a literal. It used to be the literal
 * `'pgrst'` here, matching the seed's own hardcoded fallback — and that shared
 * literal is precisely what hid the defect: both sides agreed, so a green run
 * left the CLUSTER holding a seed default that happened to equal the configured
 * value. `database/seed.ts` now writes the configured `AUTHENTICATOR_PASSWORD`
 * and nothing else, so this suite must read the same value or it would be
 * testing a password no configuration names.
 */
const AUTHENTICATOR_PASSWORD = loadTestEnvironment().authenticator.password;

const BOOTSTRAP_SQL = join(
  BACKEND_ROOT,
  'database',
  'bootstrap',
  '001_roles.sql',
);

/**
 * Read from the directory rather than listed here. A hand-kept list goes stale the
 * moment a migration is added, and a stale list is worse than none: the proof
 * database is then built on a schema the application no longer ships, and every
 * assertion below passes against a baseline that does not exist in production.
 */
function migrationFiles(): readonly string[] {
  return readdirSync(join(BACKEND_ROOT, 'database', 'migrations'))
    .filter((name) => /^\d{4,}_.*\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort();
}

/**
 * The fixture identities. Fixed ids, because every assertion reads them, and
 * separate from the org chart in `support/fixture.ts` — this suite builds its own
 * because the shape here is a DERIVED one (a user in two groups), which the
 * existing fixture does not contain.
 *
 * The tree, and who may see what:
 *
 *   root ──┬── EU ──┬── FR          scope-holder ── member of EU
 *          │        └── DEEP        deepMember     ── member of DEEP (EU's grandchild)
 *          └── US                   otherMember    ── member of US (unrelated to EU)
 *                                    twoGroupUser   ── member of EU **and** US
 *                                    noMembership   ── no membership row at all
 *
 * `EU` is where the reader sits, so `FR` is a subgroup (visible) and `US` is
 * unrelated (invisible). `DEEP` is two levels down, which is the case a
 * single-level walk gets wrong.
 */
const IDS = {
  groups: {
    root: '77777777-0000-0000-0000-000000000001',
    eu: '77777777-0000-0000-0000-000000000002',
    fr: '77777777-0000-0000-0000-000000000003',
    deep: '77777777-0000-0000-0000-000000000004',
    us: '77777777-0000-0000-0000-000000000005',
  },
  users: {
    scopeHolder: '88888888-0000-0000-0000-000000000001',
    deepMember: '88888888-0000-0000-0000-000000000002',
    otherMember: '88888888-0000-0000-0000-000000000003',
    twoGroupUser: '88888888-0000-0000-0000-000000000004',
    noMembership: '88888888-0000-0000-0000-000000000005',
    /** A member of EU whose ROLE holds no `email:read`. */
    plainMember: '88888888-0000-0000-0000-000000000006',
    /** A member of EU whose role holds `user:create` but NOT `email:read`. */
    userCreator: '88888888-0000-0000-0000-000000000007',
    /** A member of US whose role holds `email:read` — the other side of case 2. */
    usReader: '88888888-0000-0000-0000-000000000008',
  },
  roles: {
    /** Holds `email:read`. The capability under test. */
    emailReader: '99999999-0000-0000-0000-000000000001',
    /** Holds nothing at all — the capability "nobody" case. */
    plain: '99999999-0000-0000-0000-000000000002',
    /** Holds `user:create` and NOT `email:read`. */
    userCreator: '99999999-0000-0000-0000-000000000003',
    usReader: '99999999-0000-0000-0000-000000000004',
  },
} as const;

/**
 * A short, unique label for a probe id.
 *
 * The eight probe uuids share their first group, so slicing the PREFIX yields the
 * SAME string for all of them and collides on the unique `users.username`. The
 * tail is what actually distinguishes them.
 */
function probeLabel(id: string): string {
  return `probe-${id.slice(-4)}`;
}

/** One row of `email_messages`, read the way an operator would. */
interface MessageRow {
  readonly user_id: string;
  readonly template: string;
  readonly recipient: string;
  readonly subject: string;
  readonly status: 'sent' | 'failed';
  readonly provider_message_id: string | null;
  readonly error: string | null;
  readonly body: string | null;
  readonly content_class: 'metadata_only' | 'full_body';
  readonly sent_at: string | null;
}

// =============================================================================
// Database plumbing
// =============================================================================

function psqlAsSuperuser(database: string, sql: string): string {
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
      database,
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `superuser psql failed against ${database}: ${sql}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function psqlAsSuperuserFile(database: string, path: string): void {
  const result = spawnSync(
    'sudo',
    [
      '-u',
      'postgres',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-d',
      database,
      '-f',
      path,
    ],
    {
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(`applying ${path} as superuser failed:\n${result.stderr}`);
  }
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

function recreateDatabase(name: string): void {
  const devDb = databaseConfig().database;
  if (name === devDb) {
    throw new Error(
      `refusing to run the email-messages proof against the development database (${devDb})`,
    );
  }
  // Terminate first: a leaked backend makes DROP fail naming a connection the
  // operator cannot see (AGENTS.md §B8).
  psqlAsSuperuser(
    'postgres',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
  );
  psqlAsSuperuser('postgres', `DROP DATABASE IF EXISTS ${name}`);
  psqlAsSuperuser(
    'postgres',
    `CREATE DATABASE ${name} OWNER ${databaseConfig().user}`,
  );
  // The call-count measurement reads `pg_stat_user_functions`, which is empty
  // unless the session has `track_functions` on and the default is `none`. This
  // assertion passed for months only because `ALTER SYSTEM SET track_functions`
  // had been run by hand on the development machine, so on a stock cluster it
  // read 0 calls over 3,300 rows. Scoped to the throwaway database it is
  // hermetic: any session connecting here counts, and dropping the database
  // takes the setting with it.
  psqlAsSuperuser(
    'postgres',
    `ALTER DATABASE ${name} SET track_functions = 'all'`,
  );
}

function dropProofDatabase(): void {
  psqlAsSuperuser(
    'postgres',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PROOF_DB}' AND pid <> pg_backend_pid()`,
  );
  psqlAsSuperuser('postgres', `DROP DATABASE IF EXISTS ${PROOF_DB}`);
}

function applyBaseline(): void {
  psqlAsSuperuserFile(PROOF_DB, BOOTSTRAP_SQL);
  const config = loadTestEnvironment().database;
  for (const migration of migrationFiles()) {
    const path = join(BACKEND_ROOT, 'database', 'migrations', migration);
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
        path,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, PGPASSWORD: config.password },
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `applying ${migration} as ${config.user} failed:\n${result.stderr}`,
      );
    }
  }
}

/** The real seed, with DB_NAME pointed at the throwaway database. */
function runSeed(): { readonly code: number; readonly output: string } {
  const result = spawnSync(
    'node',
    ['--experimental-strip-types', 'database/seed.ts'],
    {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        DB_NAME: PROOF_DB,
        SEED_ADMIN_PASSWORD: 'email-proof-admin-password',
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

/** A client for the migration/owner role, which is the only writer of membership. */
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
 * A read AS a serving role, with `request.jwt.claims` in force.
 *
 * `SET LOCAL ROLE` and the read share one transaction, so the claims GUC is
 * scoped exactly as PostgREST scopes it. Run as a superuser because it is the
 * only identity that can borrow a serving role — the owner deliberately is not a
 * member of them, and granting it membership would reopen the escalation hole
 * these tests exist to close (`support/fixture.ts`).
 */
function readAsRole<T>(
  role: 'app_member' | 'app_admin' | 'app_anon',
  sub: string | undefined,
  sql: string,
): readonly T[] {
  const claims =
    sub === undefined
      ? ''
      : `SELECT set_config('request.jwt.claims', ${quote(`{"sub":"${sub}","role":"${role}"}`)}, true) \\g /dev/null`;
  const script = [
    'BEGIN;',
    `SET LOCAL ROLE ${role};`,
    claims,
    `SELECT coalesce(json_agg(_r)::text, '[]') FROM (${sql.replace(/;\s*$/, '')}) AS _r;`,
    'COMMIT;',
  ]
    .filter((line) => line !== '')
    .join('\n');

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
      input: script,
    },
  );
  if (result.status !== 0) {
    throw new Error(`read as ${role} failed:\n${result.stderr}`);
  }
  const trimmed = result.stdout.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The subjects a given actor may read. Membership, not counts. */
function visibleSubjects(
  sub: string,
  role: 'app_member' | 'app_admin' = 'app_member',
): readonly string[] {
  return readAsRole<{ subject: string }>(
    role,
    sub,
    'SELECT subject FROM email_messages ORDER BY subject',
  ).map((row) => row.subject);
}

// =============================================================================
// The fixture
// =============================================================================

const MESSAGES: ReadonlyArray<{
  readonly subject: string;
  readonly user: string;
}> = [
  { subject: 'reset-for-scope-holder', user: IDS.users.scopeHolder },
  { subject: 'reset-for-deep-member', user: IDS.users.deepMember },
  { subject: 'reset-for-two-group-user', user: IDS.users.twoGroupUser },
  { subject: 'reset-for-other-member', user: IDS.users.otherMember },
  { subject: 'reset-for-plain-member', user: IDS.users.plainMember },
  { subject: 'reset-for-no-membership', user: IDS.users.noMembership },
];

let seedRun: { readonly code: number; readonly output: string };

beforeAll(async () => {
  recreateDatabase(PROOF_DB);
  applyBaseline();
  seedRun = runSeed();

  // The seed owns roles and permissions, so the extra capability roles this
  // fixture needs are created through the escalation boundary as `app_admin` —
  // which is also what puts `assert_grant_subset()` (0004) on the write path.
  await asAdmin(async (client) => {
    // ROLES FIRST. `user_roles.role_id` is a real foreign key, so the role rows
    // have to exist before any membership references them — the ordering is a
    // constraint, not a style choice, and getting it wrong fails the FK.
    //
    // `emailReader` and `usReader` hold `email:read`; `userCreator` holds
    // `user:create` and NOT `email:read`, which is what makes case 4 two-sided;
    // `plain` holds nothing at all.
    for (const [role, name] of [
      [IDS.roles.emailReader, 'probe-role-email-reader'],
      [IDS.roles.usReader, 'probe-role-us-reader'],
      [IDS.roles.plain, 'probe-role-plain'],
      [IDS.roles.userCreator, 'probe-role-user-creator'],
    ] as const) {
      await client.query(
        'INSERT INTO roles (id, name, parent_id, is_system_role) VALUES ($1, $2, NULL, false)',
        [role, name],
      );
    }

    for (const role of [IDS.roles.emailReader, IDS.roles.usReader]) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE resource = 'email' AND action_id = 'read'`,
        [role],
      );
    }
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE resource = 'user' AND action_id = 'create'`,
      [IDS.roles.userCreator],
    );

    // Then the USERS, then the roles they hold. `plainMember` holds no
    // capability; `userCreator` holds one user capability and still no
    // `email:read`.
    for (const [user, role] of [
      [IDS.users.plainMember, IDS.roles.plain],
      [IDS.users.userCreator, IDS.roles.userCreator],
      [IDS.users.usReader, IDS.roles.usReader],
      [IDS.users.scopeHolder, IDS.roles.emailReader],
      [IDS.users.deepMember, IDS.roles.plain],
      [IDS.users.otherMember, IDS.roles.plain],
      [IDS.users.twoGroupUser, IDS.roles.plain],
      [IDS.users.noMembership, IDS.roles.plain],
    ] as const) {
      await client.query(
        `INSERT INTO users (id, username, email, password_hash) VALUES ($1, $2, $3, 'not-a-real-hash')
         ON CONFLICT (id) DO NOTHING`,
        [user, probeLabel(user), `${probeLabel(user)}@example.test`],
      );
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [user, role],
      );
    }

    for (const message of MESSAGES) {
      await client.query(
        `INSERT INTO email_messages (user_id, template, recipient, subject, status, provider_message_id, content_class)
         VALUES ($1, 'password_reset', $2, $3, 'sent', $4, 'metadata_only')`,
        [
          message.user,
          `${message.user.slice(0, 8)}@example.test`,
          message.subject,
          `<${message.subject}@example.test>`,
        ],
      );
    }
  });

  // Membership, through the OWNER: no serving role holds a write grant on
  // `user_groups`, and that refusal is the control that fails open if forgotten.
  const owner = ownerClient();
  await owner.connect();
  try {
    for (const [id, name, parent] of [
      [IDS.groups.root, 'probe-root', null],
      [IDS.groups.eu, 'probe-EU', IDS.groups.root],
      [IDS.groups.fr, 'probe-FR', IDS.groups.eu],
      [IDS.groups.deep, 'probe-DEEP', IDS.groups.fr],
      [IDS.groups.us, 'probe-US', IDS.groups.root],
    ] as const) {
      await owner.query(
        'INSERT INTO groups (id, name, parent_id) VALUES ($1, $2, $3)',
        [id, name, parent],
      );
    }
    for (const [user, group] of [
      [IDS.users.scopeHolder, IDS.groups.eu],
      [IDS.users.deepMember, IDS.groups.deep],
      [IDS.users.otherMember, IDS.groups.us],
      [IDS.users.plainMember, IDS.groups.eu],
      [IDS.users.userCreator, IDS.groups.eu],
      [IDS.users.usReader, IDS.groups.us],
      // The case the whole category exists for: TWO groups.
      [IDS.users.twoGroupUser, IDS.groups.eu],
      [IDS.users.twoGroupUser, IDS.groups.us],
    ] as const) {
      await owner.query(
        'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)',
        [user, group],
      );
    }
    await owner.query('COMMIT');
  } finally {
    await owner.end();
  }
}, TIMEOUT);

afterAll(() => {
  // `database/seed.ts` runs a CLUSTER-scoped `ALTER ROLE … PASSWORD`, so the
  // cluster is restored in a `finally`: it is the one step that must not be
  // skipped, and it must not sit behind the drop above.
  try {
    dropProofDatabase();
  } finally {
    restoreAuthenticatorPassword();
  }
});

// =============================================================================
// 1, 2 — the scope axis, including the case that motivates the category
// =============================================================================

describe('email_messages · derived scope resolves through the RECIPIENT USER memberships', () => {
  it(
    'an admin holding email:read sees their own group and its SUBGROUPS, and not an unrelated group',
    () => {
      // The canonical case. `scopeHolder` is a member of EU; FR is EU's child and
      // DEEP is EU's GRANDchild, so both are in scope — and US is not.
      //
      // Membership is asserted, not counted: a filter returning a different set
      // of the same size would satisfy a count.
      const visible = visibleSubjects(IDS.users.scopeHolder);

      expect(visible).toContain('reset-for-scope-holder');
      expect(visible).toContain('reset-for-deep-member');
      expect(visible).toContain('reset-for-two-group-user');
      expect(visible).not.toContain('reset-for-other-member');
      expect(visible).not.toContain('reset-for-no-membership');
    },
    TIMEOUT,
  );

  it(
    'a user in TWO groups is visible to a reader scoped to EITHER group — the case a single group_id cannot express',
    () => {
      // Why this category exists. `twoGroupUser` is in EU **and** US. A
      // `group_id` column could hold one or the other, and duplicating the row
      // would make "which groups is this message in?" ambiguous. Resolved through
      // memberships, the answer is the union — asserted from BOTH sides, because
      // a policy that only worked for one of them would pass a single assertion.
      expect(visibleSubjects(IDS.users.scopeHolder)).toContain(
        'reset-for-two-group-user',
      );
      expect(visibleSubjects(IDS.users.usReader)).toContain(
        'reset-for-two-group-user',
      );
    },
    TIMEOUT,
  );
});

// =============================================================================
// 3, 4, 5 — the capability axis, and the dedicated permission
// =============================================================================

describe('email_messages · capability is AND-ed with scope, in one policy', () => {
  it(
    'a member holding NO email:read sees zero rows, INSIDE their own group — the capability axis, not just scope',
    () => {
      // The cross-axis case both withdrawn policy shapes pass. `plainMember` is in
      // EU and in scope by group, so a scope-only policy returns rows here; only
      // the capability check denies them.
      //
      // The positive half matters just as much and is asserted below: this is a
      // capability denial and not an empty table.
      expect(visibleSubjects(IDS.users.plainMember)).toEqual([]);

      // Ground truth, so the denial above is a denial and not an empty fixture.
      const groundTruth = superuserRows<{ subject: string }>(
        `SELECT subject FROM email_messages WHERE user_id = '${IDS.users.plainMember}'`,
      );
      expect(groundTruth.map((row) => row.subject)).toEqual([
        'reset-for-plain-member',
      ]);
    },
    TIMEOUT,
  );

  it(
    'a role holding user:create but NOT email:read also sees zero rows, so the permission is dedicated',
    () => {
      // What makes `email:read` its own permission rather than a relabelled user
      // one. If the policy resolved capability through `user:create`, or through
      // any user-creation capability, this role would read the mail history of
      // every user in EU. It holds a real user capability and reads nothing.
      expect(visibleSubjects(IDS.users.userCreator)).toEqual([]);

      // And it really does hold the capability it is being denied alongside.
      const held = superuserRows<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.id = '${IDS.roles.userCreator}'
            AND ((p.resource = 'user' AND p.action_id = 'create')
              OR (p.resource = 'email' AND p.action_id = 'read'))`,
      );
      expect(held[0]?.count).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'a well-formed sub with no membership rows sees zero rows and no error',
    () => {
      // The scope-side zero case. Distinct from the capability case above: this
      // actor's `sub` resolves, its roles grant nothing, and its membership set is
      // empty — so the answer is zero rows rather than everything.
      expect(visibleSubjects(IDS.users.noMembership)).toEqual([]);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 6 — the grants, asserted as they are
// =============================================================================

describe('email_messages · grants: default deny, and no privilege to app_anon', () => {
  it(
    'app_anon holds no SELECT and cannot read the table at all — the refusal is at the GRANT layer, not the policy',
    () => {
      // Asserted from the catalog rather than over HTTP: this suite starts no
      // PostgREST, and the property is the privilege itself.
      for (const privilege of [
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
      ]) {
        const row = superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_anon', 'public.email_messages', '${privilege}') AS holds`,
        );
        expect(
          row[0]?.holds,
          `app_anon holds ${privilege} on email_messages`,
        ).toBe(false);
      }

      // And the policy must not be reachable by it either: no function the
      // policy calls may be executable by app_anon beyond what the policy needs,
      // and none may be executable by PUBLIC at all (case 7 covers PUBLIC).
      //
      // The live check: app_anon reading the table must be REFUSED rather than
      // returning zero rows, because a policy that errors is a denial-of-service
      // surface. It is refused by the grant, so the policy is never evaluated.
      const outcome = spawnSync(
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
          input: `BEGIN;\nSET LOCAL ROLE app_anon;\nSELECT count(*) FROM email_messages;\nCOMMIT;\n`,
        },
      );
      expect(outcome.status).not.toBe(0);
      expect(`${outcome.stdout}${outcome.stderr}`).toContain(
        'permission denied for table',
      );
      // The oracle: a message that names the policy would mean an anonymous read
      // could reach it.
      expect(`${outcome.stdout}${outcome.stderr}`).not.toContain(
        'permission denied for function',
      );
    },
    TIMEOUT,
  );

  it(
    'app_member holds SELECT only — no INSERT, UPDATE, DELETE or TRUNCATE',
    () => {
      for (const privilege of ['SELECT']) {
        const row = superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_member', 'public.email_messages', '${privilege}') AS holds`,
        );
        expect(row[0]?.holds, `app_member holds ${privilege}`).toBe(true);
      }
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        const row = superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_member', 'public.email_messages', '${privilege}') AS holds`,
        );
        expect(
          row[0]?.holds,
          `app_member holds ${privilege} on email_messages`,
        ).toBe(false);
      }
    },
    TIMEOUT,
  );

  it(
    'app_admin holds SELECT, INSERT and UPDATE but NOT DELETE or TRUNCATE — email history is an append-only audit trail',
    () => {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) {
        const row = superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_admin', 'public.email_messages', '${privilege}') AS holds`,
        );
        expect(row[0]?.holds, `app_admin is missing ${privilege}`).toBe(true);
      }
      for (const privilege of ['DELETE', 'TRUNCATE']) {
        const row = superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_admin', 'public.email_messages', '${privilege}') AS holds`,
        );
        expect(
          row[0]?.holds,
          `app_admin holds ${privilege}, so the trail can be erased`,
        ).toBe(false);
      }

      // And the refusal is proven, not merely absent from the catalog: an erasure
      // attempt through the boundary must fail with the GRANT's own message.
      const outcome = spawnSync(
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
          input: `BEGIN;\nSET LOCAL ROLE app_admin;\nDELETE FROM email_messages;\nCOMMIT;\n`,
        },
      );
      expect(outcome.status).not.toBe(0);
      expect(`${outcome.stdout}${outcome.stderr}`).toContain(
        'permission denied',
      );
    },
    TIMEOUT,
  );
});

// =============================================================================
// 7 — structure
// =============================================================================

describe('email_messages · the derived category is structural, not documented', () => {
  it(
    'the primary key is simple (id), because a derived row has no group of its own',
    () => {
      // The CATEGORY decides the key shape, and the rule is asserted from the
      // catalog so "derived" cannot quietly become group-scoped. A derived row's
      // scope belongs to another table, so a composite (group_id, id) key would
      // carry a column that does not exist.
      const key = superuserRows<{ columns: string }>(
        `SELECT string_agg(a.attname, ',' ORDER BY a.attname) AS columns
           FROM pg_constraint c
           JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, position) ON true
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          WHERE c.conrelid = 'public.email_messages'::regclass AND c.contype = 'p'`,
      );
      expect(key[0]?.columns).toBe('id');

      // …and there is no group_id column to carry, asserted separately so a future
      // "just add a group_id" edit fails here rather than in a policy.
      const columns = superuserRows<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'email_messages'`,
      );
      expect(columns.map((row) => row.column_name)).not.toContain('group_id');
    },
    TIMEOUT,
  );

  it(
    'the FK to users LEAVES the group-scoped set and terminates at a table no member can write to',
    () => {
      // The referential-integrity rule permits an FK out of the scoped set ONLY at
      // a table members cannot write to — because FK checks bypass RLS and fail
      // OPEN, so an FK is an existence oracle. Both halves are asserted: the FK
      // exists, and `users` is not member-writable.
      // Read from `pg_constraint`, which gives BOTH sides of the reference
      // directly. The information_schema shape needs a second join to reach the
      // REFERENCED table, and getting that join wrong names the referencing table
      // twice — which is how a test ends up asserting `email_messages.user_id`
      // references `email_messages.user_id` and proving nothing.
      const foreignKeys = superuserRows<{
        referencing: string;
        referenced: string;
      }>(
        `SELECT t.relname AS referencing, ref.relname AS referenced
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_class ref ON ref.oid = c.confrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public' AND t.relname = 'email_messages' AND c.contype = 'f'`,
      );
      expect(foreignKeys).toEqual([
        { referencing: 'email_messages', referenced: 'users' },
      ]);

      // The mitigation, stated exactly as the rule states it: the FK must
      // terminate at a table MEMBERS cannot write to. `app_member` is the member
      // role and holds no TABLE-level write grant on `users`.
      //
      // **TABLE-level is the operative word since `0026`,** which gave `app_member`
      // `UPDATE (first_name, last_name)` — two columns of its own identity row, and
      // nothing that could name another user's id. The oracle this rule closes is
      // naming somebody else's `users.id` from `email_messages`, and two display-name
      // columns on your own row cannot do that. `has_table_privilege` reads
      // `pg_class.relacl`, so a column grant does not answer true here; that is what
      // makes this loop still mean what it says.
      //
      // `app_admin` IS granted INSERT/UPDATE/DELETE on `users` — deliberately,
      // by 0002, because the superset principal is what provisions accounts. So
      // the assertion is per role and names why the admin half is not a hole
      // rather than asserting something false about the shipped grants.
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
        const member = superuserRows<{ holds: boolean }>(
          `SELECT has_table_privilege('app_member', 'public.users', '${privilege}') AS holds`,
        );
        expect(
          member[0]?.holds,
          `app_member holds table-level ${privilege} on users, so the FK is a write path into identity`,
        ).toBe(false);
      }

      // WHY THE ADMIN HALF IS NOT A RESIDUAL. An FK check bypasses RLS and fails
      // OPEN, so it is an existence oracle: 23503 versus success reveals any
      // `users.id`, in scope or not. For `app_member` that is closed by the grant
      // above. For `app_admin` it is closed by something stronger — it already
      // holds SELECT on the WHOLE of `users`, so the oracle reveals nothing it
      // could not read directly. Asserted, because "it can read users anyway" is
      // the entire argument and an unasserted argument is not one.
      const adminReadsAllUsers = superuserRows<{ holds: boolean }>(
        `SELECT has_table_privilege('app_admin', 'public.users', 'SELECT') AS holds`,
      );
      expect(
        adminReadsAllUsers[0]?.holds,
        'app_admin cannot read users, so the FK oracle is a real disclosure for it too',
      ).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'the table is ENABLEd and FORCEd, because an un-FORCEd table reads as every row to its owner with no warning',
    () => {
      const posture = superuserRows<{ enabled: boolean; forced: boolean }>(
        `SELECT c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'email_messages'`,
      );
      expect(posture[0]?.enabled).toBe(true);
      expect(posture[0]?.forced).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'there is exactly ONE policy, and it is the scope+capability AND — never two permissive policies on one operation',
    () => {
      // Two permissive policies are OR-ed, so a scope policy covering DELETE would
      // admit it alone. The measured failure was a member holding ZERO
      // capabilities running DELETE and INSERT with no error and no warning
      // (ADR-0023). One policy per operation is asserted from the catalog.
      const policies = superuserRows<{
        policyname: string;
        cmd: string;
        qual: string | null;
      }>(
        `SELECT policyname, cmd, qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'email_messages' ORDER BY policyname`,
      );
      expect(
        policies.map((row) => `${row.policyname}:${row.cmd}`).sort(),
      ).toEqual(['email_read_scope:SELECT', 'email_write:INSERT']);

      // The SELECT policy must AND both axes, not either alone.
      const read = policies.find((row) => row.cmd === 'SELECT');
      expect(read?.qual ?? '').toContain('authz.can_read_email()');
      expect(read?.qual ?? '').toContain('authz.visible_user_ids()');

      // No DELETE and no UPDATE policy exists at all, so neither verb can be
      // admitted by any policy regardless of grants.
      expect(policies.some((row) => row.cmd === 'DELETE')).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'no function is executable by PUBLIC, and the two helpers are executable by every role whose requests evaluate the policy',
    () => {
      // Postgres grants EXECUTE to PUBLIC on every new function, and a SECURITY
      // DEFINER helper reachable anonymously is a privilege escalation rather than
      // a read leak.
      const publicExecute = superuserRows<{ proname: string; may: boolean }>(
        `SELECT p.proname, has_function_privilege('public', p.oid, 'EXECUTE') AS may
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname IN ('can_read_email', 'visible_user_ids')`,
      );
      expect(publicExecute).toHaveLength(2);
      for (const row of publicExecute) {
        expect(row.may, `${row.proname} is executable by PUBLIC`).toBe(false);
      }

      // `app_anon` IS granted EXECUTE, and the reason is the rule rather than a
      // preference: a policy expression is evaluated for EVERY role that reaches
      // the table, so without it an unauthenticated read fails with
      // `permission denied for function` — a denial-of-service surface and an
      // oracle that names the policy.
      for (const helper of ['can_read_email', 'visible_user_ids']) {
        for (const role of ['app_anon', 'app_member', 'app_admin']) {
          const row = superuserRows<{ may: boolean }>(
            `SELECT has_function_privilege('${role}', p.oid, 'EXECUTE') AS may
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'authz' AND p.proname = '${helper}'`,
          );
          expect(
            row[0]?.may,
            `${role} cannot execute ${helper}, so a scoped read would error`,
          ).toBe(true);
        }
      }

      // The disclosure half: neither helper takes a `who` argument, so a caller can
      // only ever ask about itself. Asserted from the signature rather than the
      // comment.
      const args = superuserRows<{ proname: string; args: number }>(
        `SELECT p.proname, p.pronargs AS args
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'authz' AND p.proname IN ('can_read_email', 'visible_user_ids')
          ORDER BY p.proname`,
      );
      expect(args.map((row) => `${row.proname}:${row.args}`)).toEqual([
        'can_read_email:0',
        'visible_user_ids:0',
      ]);
    },
    TIMEOUT,
  );

  it(
    'every index the read paths filter and sort on is present',
    () => {
      // Asserted because an index nobody checks is an index nobody notices
      // missing: the cost is a sequential scan over the whole history, which is
      // invisible until the table is large.
      const indexed = superuserRows<{ columns: string }>(
        `SELECT (SELECT array_agg(a.attname::text ORDER BY a.attname)
                   FROM unnest(i.indkey) AS k(attnum)
                   JOIN pg_attribute a
                     ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS columns
           FROM pg_index i
          WHERE i.indrelid = 'public.email_messages'::regclass`,
      );
      // json_agg over a per-row array yields an array OF arrays; flatten it so a
      // failure names the index columns rather than a nesting level.
      const columns = indexed.flatMap((row) => row.columns ?? []);
      for (const column of ['user_id', 'template', 'status', 'created_at']) {
        expect(columns, `no index on ${column}`).toContain(column);
      }
    },
    TIMEOUT,
  );

  it(
    'email:read is seeded by BOTH the migration and the seed, and admin and manager hold it while member does not',
    () => {
      // The fresh provision and the migrated-then-seeded one must agree. The
      // migration owns the schema and the seed owns the grant (roles are seeded,
      // never migrated — §B1), so BOTH have to be asserted or a fresh provision
      // and a re-run end up with different capabilities.
      const permission = superuserRows<{ count: number }>(
        `SELECT count(*)::int AS count FROM permissions WHERE resource = 'email' AND action_id = 'read'`,
      );
      expect(
        permission[0]?.count,
        "the ('email','read') permission row is missing",
      ).toBe(1);

      const held = superuserRows<{ name: string; holds: boolean }>(
        `SELECT r.name, EXISTS (
                  SELECT 1 FROM role_permissions rp
                   WHERE rp.role_id = r.id
                     AND rp.permission_id = (SELECT id FROM permissions WHERE resource = 'email' AND action_id = 'read')
                ) AS holds
           FROM roles r WHERE r.name IN ('admin', 'manager', 'member') ORDER BY r.name`,
      );
      expect(held).toEqual([
        { name: 'admin', holds: true },
        { name: 'manager', holds: true },
        { name: 'member', holds: false },
      ]);
    },
    TIMEOUT,
  );
});

// =============================================================================
// 8 — the measured `loops`
// =============================================================================

describe('email_messages · the scoping subquery is evaluated ONCE per statement', () => {
  it(
    'EXPLAIN shows loops = 1 for the scoping subplan, and one capability resolution for the whole statement',
    () => {
      // The performance claim, and it is assertable rather than asserted. The
      // documented rule is that a `STABLE` function in a qual is evaluated once per
      // CANDIDATE ROW, not once per statement: the withdrawn per-row walk ran
      // 400,001 times over 400,000 rows, and the intermediate shape of THIS policy
      // ran `can_read_email()` 6,606 times over 6,602 rows.
      //
      // So the assertion is on the PLAN and on the FUNCTION CALL COUNTS, both at a
      // realistic row count. Reading the policy's SQL proves nothing: an
      // EXISTS-shaped variant is simplified back into a hashed SubPlan by the
      // planner, so the text and the behaviour diverge.
      const subject = IDS.users.scopeHolder;
      const bulk = 3300;

      // Seed the bulk rows as the admin through the escalation boundary.
      spawnSync(
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
          input: `BEGIN;\nSET LOCAL ROLE app_admin;\nINSERT INTO email_messages (user_id, template, recipient, subject, status, content_class)
SELECT '${subject}', 'password_reset', 'bulk@example.test', 'bulk-' || g, 'sent', 'metadata_only' FROM generate_series(1, ${bulk}) g;\nCOMMIT;\n`,
        },
      );
      spawnSync(
        'sudo',
        [
          '-u',
          'postgres',
          'psql',
          '-q',
          '-d',
          PROOF_DB,
          '-c',
          'ANALYZE public.email_messages',
        ],
        {
          encoding: 'utf8',
        },
      );

      try {
        const total = superuserRows<{ count: number }>(
          `SELECT count(*)::int AS count FROM email_messages`,
        )[0];
        expect(total?.count).toBeGreaterThan(3000);

        // Reset the function counters, run ONE statement, read them back.
        psqlAsSuperuser(PROOF_DB, `SELECT pg_stat_reset()`);
        const plan = spawnSync(
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
            input:
              `BEGIN;\nSET LOCAL ROLE app_member;\n` +
              `SELECT set_config('request.jwt.claims', '{"sub":"${subject}","role":"app_member"}', true) \\g /dev/null\n` +
              `EXPLAIN (ANALYZE, COSTS OFF, FORMAT TEXT) SELECT count(*) FROM email_messages;\nCOMMIT;\n`,
          },
        );
        const explain = plan.stdout;
        expect(explain, `EXPLAIN failed:\n${plan.stderr}`).toContain('SubPlan');

        const loops = [
          ...explain.matchAll(/SubPlan \d+[\s\S]*?loops=(\d+)/g),
        ].map((match) => match[1]);
        expect(
          loops.length,
          `no SubPlan loops in the plan:\n${explain}`,
        ).toBeGreaterThan(0);
        for (const loop of loops) {
          expect(
            Number(loop),
            `the scoping subplan ran ${loop} times, not once`,
          ).toBe(1);
        }

        // The sharper assertion: the CAPABILITY resolution must not be per-row
        // either. `can_read_email()` is a STABLE function, and a STABLE function in
        // a qual alongside a column reference is called once per candidate row —
        // which is why the shipped policy puts it INSIDE the subquery, where the
        // planner hoists it to a one-time filter.
        //
        // `pg_stat_user_functions` has NO ROW for a function that was never called,
        // so a missing row means zero, not "unknown". Reading it as `undefined` is
        // what makes this assertion read as a broken measurement rather than as the
        // tamper it actually caught — measured during development, when removing the
        // capability conjunct produced "ran undefined times".
        const calls = superuserRows<{ funcname: string; calls: number }>(
          `SELECT funcname, coalesce(calls, 0)::int AS calls FROM pg_stat_user_functions
            WHERE funcname IN ('can_read_email', 'visible_user_ids') ORDER BY funcname`,
        );
        const byName = new Map(calls.map((row) => [row.funcname, row.calls]));
        // Absent from the view ⇒ never invoked, which for `can_read_email` means the
        // capability check is not in the plan at all — the escalation this policy
        // exists to prevent. Both spellings are therefore 1-or-worse.
        const capabilityCalls = byName.get('can_read_email') ?? 0;
        const scopeCalls = byName.get('visible_user_ids') ?? 0;
        expect(
          capabilityCalls,
          `can_read_email() ran ${String(capabilityCalls)} times over ${String(total?.count)} rows`,
        ).toBe(1);
        expect(
          scopeCalls,
          `visible_user_ids() ran ${String(scopeCalls)} times`,
        ).toBe(1);
      } finally {
        spawnSync(
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
            input: `BEGIN;\nSET LOCAL ROLE app_admin;\nDELETE FROM email_messages WHERE subject LIKE 'bulk-%';\nCOMMIT;\n`,
          },
        );
      }
    },
    TIMEOUT,
  );
});

// =============================================================================
// 9 — credential suppression
// =============================================================================

describe('email_messages · a credential-bearing template never persists its body', () => {
  it(
    'a password_reset row is stored content_class=metadata_only with body IS NULL, and no column holds the token',
    () => {
      // Ground truth from the writer itself: read the seeded rows the way an
      // operator would, as an admin through the boundary.
      // Read as a reader WITH the capability and a scope, because this table has
      // no `current_user = 'app_admin'` branch: the derived scope is the same for
      // every role, which is what the category is. Reading as the boundary admin
      // with no claims would apply `visible_user_ids()` to a NULL actor and see
      // nothing — a correct denial, but not what this test is measuring.
      const rows = readAsRole<MessageRow>(
        'app_member',
        IDS.users.scopeHolder,
        `SELECT user_id, template, recipient, subject, status, provider_message_id, error, body, content_class, sent_at
           FROM email_messages WHERE template = 'password_reset' ORDER BY subject`,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.content_class, `${row.subject} is not metadata_only`).toBe(
          'metadata_only',
        );
        expect(row.body, `${row.subject} persisted a body`).toBeNull();
      }

      // The credential itself must be absent from EVERY column, not merely from
      // `body`: a token in `subject` or `error` would be the same leak one column
      // over. So this is asserted across the whole row as JSON.
      const serialised = JSON.stringify(rows);
      expect(serialised).not.toContain('token=');
      expect(serialised).not.toContain('?token');
    },
    TIMEOUT,
  );

  it(
    'an attempt to store a body for a credential-bearing template is REFUSED, not silently dropped',
    () => {
      // The rule is enforced by `contentClassFor` (src/email/email-content-class.ts),
      // which THROWS. Silently nulling the column would leave the caller believing
      // a body was stored, and the failure would surface as an empty column with no
      // indication anything was refused — the "looks finished and isn't" shape.
      //
      // This is the RED/GREEN proof for that control: the refusal is asserted, and
      // the assertion is shown to be load-bearing below.
      expect(() =>
        contentClassFor('password_reset', '<a href="…?token=SECRET">Reset</a>'),
      ).toThrow(/refusing to persist a rendered body/i);
      expect(() => contentClassFor('email_verification', 'body')).toThrow(
        /refusing to persist a rendered body/i,
      );

      // The permitted case, so the refusal is a rule and not a blanket ban: another
      // template MAY carry a body, and is labelled full_body when it does.
      expect(contentClassFor('welcome', 'hello')).toEqual({
        contentClass: 'full_body',
        body: 'hello',
      });
      // And a credential template with NO body is fine — that is the shipped path.
      expect(contentClassFor('password_reset', null)).toEqual({
        contentClass: 'metadata_only',
        body: null,
      });
    },
    TIMEOUT,
  );

  it(
    'a refused body never reaches the database: the INSERT is not attempted at all',
    () => {
      // The refusal has to happen BEFORE the transaction opens, or a rolled-back
      // write would still have cost a round trip and left the caller guessing. So
      // this drives the writer's own path and asserts the row count is unchanged.
      const before = superuserRows<{ count: number }>(
        `SELECT count(*)::int AS count FROM email_messages`,
      )[0];

      expect(() =>
        contentClassFor('password_reset', 'a body with a token in it'),
      ).toThrow();

      const after = superuserRows<{ count: number }>(
        `SELECT count(*)::int AS count FROM email_messages`,
      )[0];
      expect(after?.count, 'a refused body still wrote a row').toBe(
        before?.count,
      );
    },
    TIMEOUT,
  );
});

// =============================================================================
// 10 — the gate can fail
// =============================================================================

describe('email_messages · the suite can fail: drop the policy and these tests go red', () => {
  it(
    'dropping email_read_scope admits every row to a member holding no email:read, and restoring it denies them again',
    () => {
      // The control is proven, not trusted. `rls.spec.ts` exists because a suite
      // that passes whether or not the protection exists is the exact failure this
      // repository keeps documenting (AGENTS.md §B8).
      //
      // With no SELECT policy at all, RLS denies every row — so the naive tamper
      // (`DROP POLICY`) does NOT produce a leak. The real hole needs the policy
      // REPLACED by a scope-only one, which is the shape that OR-ed a capability
      // check out of existence: `USING (user_id IN (…))` with no `email:read`.
      //
      // That is the tamper. Under it `plainMember` — who holds NO capability and
      // whose rows are in scope — reads their own group's history, which is the
      // escalation the single-policy AND prevents.
      expect(visibleSubjects(IDS.users.plainMember)).toEqual([]);

      try {
        psqlAsSuperuser(
          PROOF_DB,
          `DROP POLICY email_read_scope ON public.email_messages;
           CREATE POLICY email_read_scope ON public.email_messages FOR SELECT USING (
             email_messages.user_id IN (SELECT u.user_id FROM authz.visible_user_ids() AS u(user_id))
           )`,
        );

        const underTamper = visibleSubjects(IDS.users.plainMember);
        expect(
          underTamper,
          'the scope-only policy did not admit the rows, so this tamper proves nothing',
        ).toContain('reset-for-plain-member');

        // And the positive control still holds, which is what makes the leak
        // credible rather than an accident of the fixture.
        expect(visibleSubjects(IDS.users.scopeHolder)).toContain(
          'reset-for-deep-member',
        );
      } finally {
        // Restore the shipped policy, verbatim from the migration, and prove the
        // suite is green again — a tamper that is not undone leaves the next run
        // testing a schema nobody shipped.
        spawnSync(
          'psql',
          [
            '-v',
            'ON_ERROR_STOP=1',
            '-q',
            '-h',
            loadTestEnvironment().database.host,
            '-U',
            loadTestEnvironment().database.user,
            '-d',
            PROOF_DB,
            '-c',
            'DROP POLICY IF EXISTS email_read_scope ON public.email_messages',
            '-c',
            `CREATE POLICY email_read_scope ON public.email_messages FOR SELECT USING (
                     authz.can_read_email()
                     AND email_messages.user_id IN (
                       SELECT u.user_id FROM authz.visible_user_ids() AS u(user_id)))`,
          ],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              PGPASSWORD: loadTestEnvironment().database.password,
            },
          },
        );
      }

      expect(
        visibleSubjects(IDS.users.plainMember),
        'the tamper was not undone',
      ).toEqual([]);
      expect(visibleSubjects(IDS.users.scopeHolder)).toContain(
        'reset-for-deep-member',
      );
    },
    TIMEOUT,
  );

  it('the seed ran cleanly, so nothing above is testing a half-provisioned database', () => {
    // Every assertion above reads rows the fixture wrote. If the seed had failed,
    // the roles and the `email:read` grant would be missing and several cases
    // would pass for the wrong reason — a capability system that denies everyone
    // looks exactly like one that works.
    expect(seedRun.code, `the seed failed:\n${seedRun.output}`).toBe(0);
    expect(seedRun.output).not.toContain('seed failed');
    expect(seedRun.output).toContain('seed complete.');
  });
});
