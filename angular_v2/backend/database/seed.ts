import { execSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import bcrypt from 'bcrypt';
import { Client } from 'pg';
import type { QueryResult } from 'pg';

// Load .env the same way the application does (but it only runs if the file exists).
import '../src/config/load-env-file.ts';

const backendRoot = dirname(fileURLToPath(import.meta.url));
const bootstrapPath = join(backendRoot, 'bootstrap', '001_roles.sql');
const adminPassword =
  process.env['SEED_ADMIN_PASSWORD'] ?? 'changeme-on-first-login';

interface DatabaseCoordinates {
  readonly DB_HOST: string;
  readonly DB_PORT: string;
  readonly DB_USER: string;
  readonly DB_PASSWORD: string;
  readonly DB_NAME: string;
}

/** The only column any statement in this file reads back. */
interface IdRow {
  readonly id: string;
}

/**
 * What the admin-user lookup reads: the id its memberships hang off, and the
 * stored hash. The hash is read so a re-run can tell "same password" from "new
 * password" — comparing the incoming value against it is the only way a re-run
 * can rotate without re-hashing on every invocation.
 */
interface AdminRow extends IdRow {
  readonly password_hash: string;
}

/**
 * Every coordinate is required and there is no default for any of them: a guess
 * would write a tenant's seed into whatever database happened to answer. All
 * problems are named in one throw, so a misconfigured checkout is fixed in one
 * pass rather than one variable per run. A value already in the real environment
 * wins over `backend/.env`, because `process.loadEnvFile` does not overwrite —
 * that is what lets the seed be pointed at a throwaway database without an edit.
 */
function env(): DatabaseCoordinates {
  const keys = [
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
  ] as const;
  const missing = keys.filter(
    (k) => process.env[k] === undefined || process.env[k] === '',
  );
  if (missing.length > 0) {
    throw new Error(
      `database coordinates required but unset: ${missing.join(', ')}`,
    );
  }
  return process.env as unknown as DatabaseCoordinates;
}

/**
 * The LOGIN password the seed sets on `pgrst_authenticator`, and the value it
 * connects with while it seeds through the escalation boundary.
 *
 * ## Why there is no literal here
 *
 * `ALTER ROLE … PASSWORD` is CLUSTER-scoped: one statement rewrites the login
 * password for every database on the cluster, including `app_dev`, the
 * development database. This used to default to the literal `'pgrst'`, which is
 * a hardcoded credential that has no relationship to anything the operator
 * configured (§2.3: no default fallbacks for security-critical config). The
 * consequence was invisible on a machine whose `.env*` happened to say `pgrst`
 * and a live defect everywhere else: after any green `npm run verify` — every
 * `test/rls` suite and every `test/e2e` suite runs this file — the cluster was
 * left holding a password the application was not configured to use, so the
 * next `npm run dev` answered `POST /auth/login` → HTTP 500, `password
 * authentication failed for user "pgrst_authenticator"`. Changing
 * `AUTHENTICATOR_PASSWORD` to anything other than `pgrst` brought it straight
 * back.
 *
 * ## The value it writes is therefore the CONFIGURED value
 *
 * `AUTHENTICATOR_PASSWORD` is what the thin app authenticates with and what
 * `scripts/postgrest-connection.ts` puts into `PGRST_DB_URI`, so it is the only
 * password the cluster can usefully hold afterwards. Writing it makes this
 * statement idempotent with respect to configuration: there is no longer a
 * value here that can outlive the run, so the leak cannot come back from a
 * seed, and it does not matter how the seed exits.
 *
 * ## `SEED_AUTHENTICATOR_PASSWORD` is a DURABLE provisioning instruction
 *
 * It is the one input that may legitimately differ from the configured value —
 * bootstrapping a cluster whose login password is not the one this checkout
 * uses. It is left in place, deliberately, because that is what the operator
 * asked for. Anything that sets it OWNS putting the configured value back:
 * `test/rls/rls.spec.ts` gates every spec that runs the seed on an `afterAll`
 * that calls `restoreAuthenticatorPassword()`, so a suite cannot opt into the
 * override without also opting into the undo.
 */
function seedAuthenticatorPassword(): string {
  const chosen =
    process.env['SEED_AUTHENTICATOR_PASSWORD'] ??
    process.env['AUTHENTICATOR_PASSWORD'];
  if (chosen === undefined || chosen === '') {
    throw new Error(
      'the seed needs a LOGIN password for pgrst_authenticator and has no ' +
        'default for it. Set AUTHENTICATOR_PASSWORD (the password the ' +
        'application and PostgREST are configured with, loaded from the ' +
        'environment file for this NODE_ENV), or SEED_AUTHENTICATOR_PASSWORD ' +
        'for an explicit provisioning override. Refusing here rather than ' +
        'substituting a literal: ALTER ROLE is cluster-scoped, so a guess would ' +
        'be written to every database on the cluster and would outlive the run.',
    );
  }
  return chosen;
}

/**
 * Escapes a value for a single-quoted SQL literal.
 *
 * The password is operator-supplied and lands in a superuser DDL statement, so a
 * value carrying a quote must not be able to terminate the literal. The same
 * helper the RLS fixture uses; one implementation of the rule (§2.4).
 */
function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The `psql` invocation that every **superuser** statement in this file needs,
 * resolved once for this platform.
 *
 * `AGENTS.md` §B1 records why this is a shell-out at all: `CREATE ROLE` needs
 * `CREATEROLE`, roles are cluster-scoped while migrations are database-scoped,
 * and the escalation-boundary `GRANT` needs `ADMIN OPTION` and therefore cannot
 * run inside a migration. So statements in this repository are necessarily
 * superuser statements, and they have to be invoked as one. **All** of them go
 * through here — a second spelling of "run psql as a superuser" is a second
 * mechanism that will drift, and it already had: the bootstrap used a shell
 * string while everything else used argv arrays spelled out by hand, so on Windows
 * only some of them could ever be right.
 *
 * **Linux is byte-identical to what it always was**: `sudo -u postgres psql`. That
 * is not incidental. The provisioning docs tell operators to run the bootstrap as
 * `sudo -u postgres`, and where `postgres` is a peer-authenticated system user that
 * is the correct escalation. Changing it would alter documented behaviour on the
 * platform this template primarily targets, for no gain. It is verified **by
 * execution** rather than by reading this file — the resolved argv is asserted
 * against the real spawn, because a comment about a call site is not evidence about
 * a call site.
 *
 * **Windows has no `sudo -u`.** Windows 11 ships its own `sudo`, which rejects `-u`
 * outright (`error: unexpected argument '-u' found`), so the Linux spelling fails
 * with a usage error that reads like a broken install rather than a wrong platform.
 * There is also no local socket, so the session is a TCP one like any other and
 * `-U postgres` is what selects the role.
 *
 * `-w` on the Windows spelling is not decoration: without it `psql` **prompts on
 * stdin** for a password and hangs forever, which turns a provisioning step into an
 * overnight stall. `-w` makes it fail instead.
 *
 * Returned as `command` + `prefixArgs` so callers pass an **argv array** to
 * `spawnSync` rather than a shell string. A string needs quoting rules that differ
 * between the two platforms, and the password here is operator-supplied.
 */
function superuserPsqlInvocation(): { command: string; prefixArgs: string[] } {
  if (process.platform === 'win32') {
    return { command: 'psql', prefixArgs: ['-w', '-U', 'postgres'] };
  }
  return { command: 'sudo', prefixArgs: ['-u', 'postgres', 'psql'] };
}

/**
 * The argv for one superuser statement against the seed's database.
 *
 * `outputFlags` are the `-q -t -A` shape a caller needs when it reads a value back;
 * they are parameters rather than a second hand-written array because a second
 * literal is a second place the platform prefix can be forgotten.
 */
function superuserPsqlArgs(statement: string, ...outputFlags: string[]): string[] {
  const { prefixArgs } = superuserPsqlInvocation();
  return [...prefixArgs, '-d', env().DB_NAME, '-v', 'ON_ERROR_STOP=1', ...outputFlags, '-c', statement];
}

/** The argv for one superuser statement read from a file on stdin. */
function superuserPsqlStdinArgs(): string[] {
  const { prefixArgs } = superuserPsqlInvocation();
  return [...prefixArgs, '-d', env().DB_NAME, '-v', 'ON_ERROR_STOP=1', '-f', '-'];
}

async function bootstrapRoles(): Promise<void> {
  console.log('bootstrapping database roles (superuser)...');
  const sql = await readFile(bootstrapPath, 'utf8');
  const { command } = superuserPsqlInvocation();
  const result = spawnSync(command, superuserPsqlStdinArgs(), {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    throw new Error(
      `role bootstrap failed (exit ${String(result.status)}): ${superuserPsqlInvocation().command} ` +
        'could not run 001_roles.sql as a superuser. On Linux that is ' +
        '`sudo -u postgres psql`; if you are not root, run the bootstrap as a ' +
        'superuser yourself — the escalation-boundary GRANT needs ADMIN OPTION ' +
        'and therefore cannot live in a migration (AGENTS.md §B1).',
    );
  }
  console.log('roles bootstrapped');
}

/**
 * A prerequisite the seed depends on is missing, so there is nothing to do but
 * stop and say which one. Named rather than formatted into a message because a
 * name survives `JSON.stringify(err)` and a regex, so a wrapper script can tell
 * this apart from an ordinary database error without matching prose. §2.3: a
 * missing prerequisite must not surface later as an unrelated-looking failure
 * from inside a statement that happens to touch it.
 */
class PrerequisiteMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrerequisiteMissingError';
  }
}

/**
 * Runs one statement as the cluster superuser with its output on the terminal.
 * Every superuser statement in this file goes through here, so "did it succeed"
 * is decided in exactly one place and a failure always names the statement that
 * caused it.
 */
function superuserStatement(label: string, sql: string): void {
  const { command } = superuserPsqlInvocation();
  const result = spawnSync(command, superuserPsqlArgs(sql), {
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    console.error('cmd:', sql);
    console.error('error:', result.error);
    console.error('stderr:', result.stderr?.toString());
    throw new Error(
      `${label} failed (status ${result.status}, ${result.error?.message})`,
    );
  }
}

/**
 * The same superuser session, returning unaligned tuples-only output so the
 * caller can read a value back. Fails loudly rather than returning an empty
 * string: an empty string read as "false" would be indistinguishable from a
 * false answer, which is exactly the silent-degradation shape §2.3 forbids.
 */
function superuserScalar(label: string, sql: string): string {
  const { command } = superuserPsqlInvocation();
  const result = spawnSync(command, superuserPsqlArgs(sql, '-q', '-t', '-A'), {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    console.error('cmd:', sql);
    console.error('error:', result.error);
    console.error('stderr:', result.stderr);
    throw new Error(
      `${label} failed (status ${result.status}, ${result.error?.message ?? result.stderr})`,
    );
  }
  return result.stdout;
}

/**
 * `public.users` must already exist before anything below inserts the admin
 * user. It is asserted rather than assumed, because the failure this replaces
 * was a raw `relation "users" does not exist` from an INSERT several statements
 * into the seed — an operator reading that learns nothing about which command to
 * run first. Checked here, before the seed's own client connects, so the
 * prerequisite is named before any row is attempted.
 */
function assertUsersTableExists(): void {
  const present = superuserScalar(
    'users prerequisite check',
    "SELECT to_regclass('public.users') IS NOT NULL",
  ).trim();

  if (present !== 't') {
    throw new PrerequisiteMissingError(
      `public.users does not exist in database "${env().DB_NAME}". It is created by ` +
        'database/migrations/0002_refresh_tokens.sql — the seed does not create it and must not. ' +
        'Run `npm run migration:run` (from backend/) before `npm run db:seed`, or drop and recreate the database.',
    );
  }
}

/**
 * The seed does NOT create `users`. `database/migrations/0002_refresh_tokens.sql:29`
 * is the only definition: the same statement there also applies ENABLE + FORCE
 * ROW LEVEL SECURITY, the `row_scope` policy and the app_admin grant. Two CREATE
 * TABLE statements for one table made the resulting shape depend on run order —
 * on a fresh provision 0002 wins and the copy here is a silent no-op
 * (`NOTICE: relation "users" already exists, skipping`) whose `id` and
 * `created_at` have no DEFAULT, so which definition was in force depended on
 * which command ran first, and a column added to only one file produced a schema
 * that differed per provision. §2.4: one mechanism per concern.
 *
 * What legitimately stays is what only a superuser can do. On a pre-existing
 * database `users` is owned by `postgres`, so 0002's owner check takes its
 * WARNING branch and applies NO grants at all; this statement is the repair for
 * that branch. 0002 owns the grant (a migration is the schema authority, and on
 * a fresh database 0002's grant is already in force before this file runs), so
 * the verb list below is deliberately the SAME four verbs rather than
 * `GRANT ALL` — which is broader (it also conveys REFERENCES, TRIGGER and the
 * rest) and silently widened 0002's default-deny grant to app_admin on every
 * fresh provision. Identical verb lists are what keep the two from drifting; a
 * change to one is a change to the other, and both say so.
 */
function createAuthSchema(): void {
  console.log('verifying the migration-owned users table (superuser)...');
  assertUsersTableExists();
  console.log('users table present');

  // The admin branch needs read and write on users; granted while we still hold
  // superuser credentials (this is seed-time privilege configuration, not a
  // request-path bypass). Mirrors 0002 exactly — see above.
  superuserStatement(
    'users grant to app_admin',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users TO app_admin',
  );
  console.log('users table granted to app_admin');

  // Provisioning needs to write user role / group memberships. The serving role
  // boundary forbids this at runtime, but the seed is seed-time configuration;
  // grant it here while holding superuser credentials and revoke would be needed
  // in production (cluster-scoped grants do not roll back with the seed).
  grantSeedAccess();
}

/**
 * Grants the seed the table privileges it needs to write reference and
 * membership data. Revoking these is the production hardening step; they are
 * only present for the provisioning phase.
 */
function grantSeedAccess(): void {
  console.log('granting seed access...');
  for (const op of [
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_roles TO app_admin',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_groups TO app_admin',
  ]) {
    superuserStatement(`seed access grant: ${op}`, op);
  }
  console.log('seed access granted');
}

async function seed(): Promise<number> {
  const e = env();
  const now = new Date().toISOString();

  // 1. Role bootstrap — needs CREATEROLE, i.e. a superuser session.
  await bootstrapRoles();

  // 2. Apply the schema migration as the migration/owner role.
  console.log('applying migrations...');
  execSync(`node --experimental-strip-types scripts/migrate.ts`, {
    stdio: 'inherit',
  });

  // 3. Seed reference data and the admin user through the escalation boundary.
  // Connect as pgrst_authenticator (the only role allowed to SET ROLE app_admin)
  // rather than as the migration/owner role, so seeding always passes through the
  // boundary instead of around it.
  console.log('seeding reference data and admin user...');

  // Ensure the authenticator has a login password (in production this is set out of
  // band; here we bootstrap it locally so `npm run db:seed` works). Runs as a
  // superuser so it bypasses the escalation boundary by construction — this helper
  // is only ever invoked from the seed, which itself seeds through the boundary.
  //
  // The value is the configured one by default — see `seedAuthenticatorPassword` for
  // why the hardcoded `'pgrst'` this replaced was a cluster-scoped defect and not a
  // convenience. Because it writes the configured value, this statement leaves the
  // cluster exactly where the operator put it and needs no undo; only an explicit
  // `SEED_AUTHENTICATOR_PASSWORD` diverges, and that caller owns the undo.
  const authPass = seedAuthenticatorPassword();
  const { command: psqlCommand } = superuserPsqlInvocation();
  const result = spawnSync(
    psqlCommand,
    superuserPsqlArgs(`ALTER ROLE pgrst_authenticator WITH LOGIN PASSWORD ${quoteSqlLiteral(authPass)}`),
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(
      `failed to set authenticator password (exit ${result.status})`,
    );
  }
  console.log('authenticator authenticated and ready');

  // `users` is created by 0002, not here. This asserts it is present and applies
  // the superuser-only privilege configuration 0002 cannot perform; all actual
  // data insertion below goes through the escalation boundary instead.
  createAuthSchema();

  const client = new Client({
    host: e.DB_HOST,
    port: Number(e.DB_PORT),
    user: 'pgrst_authenticator',
    password: authPass,
    database: e.DB_NAME,
  });
  await client.connect();

  try {
    // === The seed's transaction boundary ===
    // BEGIN makes every data statement below one unit: COMMIT commits the seed as
    // a whole and ROLLBACK genuinely undoes a failed seed. Without it each
    // statement autocommits, a mid-seed failure leaves a partially seeded
    // database, and the ROLLBACK in the catch block is a no-op. SET LOCAL ROLE
    // is only meaningful as transaction-local; outside a transaction block it
    // degrades to SET ROLE and PostgreSQL warns "SET LOCAL can only be used in
    // transaction blocks", so the scoping the code intends never applies.
    //
    // Inside the boundary: every statement this function issues over this
    // client — actions, permissions, roles, role_permissions, groups,
    // user_roles, user_groups, users, projects, customers — including the
    // authz.org_closure refresh the groups statement-level trigger runs in the
    // same transaction.
    //
    // Outside the boundary, by necessity:
    //   * 001_roles.sql role bootstrap and the ALTER ROLE ... PASSWORD —
    //     CREATE ROLE is cluster-scoped and needs CREATEROLE, so they ran as
    //     a superuser through separate psql sessions and commit on their own.
    //   * The GRANTs — they need a superuser (ADMIN OPTION / table ownership),
    //     run through `sudo psql` in separate sessions, and are re-runnable
    //     seed-time privilege configuration, not tenant data.
    //   * scripts/migrate.ts — runs as the owner role in its own process
    //     with one transaction per migration; the schema must exist before
    //     this client opens.
    // Those three are idempotent, so every invocation re-establishes them
    // before the transaction below retries the data.
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_admin');

    // Every statement below either inserts and is not read back, or returns rows
    // that are read back through a declared interface. Typing the helper once is
    // what keeps `rows[0].id` off `any`: `pg` defaults to `QueryResult<any>`, so an
    // untyped helper silently makes every id in this file untyped.
    const q = async <R extends IdRow = IdRow>(
      label: string,
      sql: string,
      params?: unknown[],
    ): Promise<QueryResult<R>> => {
      console.log(`  [${label}]`);
      return client.query<R>(sql, params);
    };

    await q(
      'actions',
      "INSERT INTO actions (name) VALUES ('create'), ('read'), ('update'), ('delete') ON CONFLICT (name) DO NOTHING",
    );

    // `('email', 'read')` is here as well as in 0005, and both are needed —
    // but the SEED is what actually delivers it. `permissions.action_id` is a
    // real foreign key to `actions(name)`, and `actions` is seeded, never
    // migrated (§B1). So 0005's copy of this INSERT is guarded by
    // `WHERE EXISTS (SELECT 1 FROM actions WHERE name = 'read')`: on a
    // migrated-but-not-yet-seeded database that guard is false, 0005 inserts
    // nothing, and without it the insert would fail the foreign key outright.
    // This file therefore owns the row, the action it points at, and the grant.
    // Both statements are `ON CONFLICT DO NOTHING`, so whichever runs second is
    // a no-op and a fresh provision and a migrated-then-seeded one end up
    // identical. A migrated-only database has the table, the policy and the
    // grants, but no capability — `authz.can_read_email()` returns false there
    // and `email_messages` is unreadable until the seed runs. That is correct:
    // capability is data, and data is seeded.
    await q(
      'resources',
      `
      INSERT INTO permissions (resource, action_id) VALUES
        ('user', 'create'), ('user', 'read'), ('user', 'update'), ('user', 'delete'),
        ('role', 'create'), ('role', 'read'), ('role', 'update'), ('role', 'delete'),
        ('permission', 'create'), ('permission', 'read'), ('permission', 'update'), ('permission', 'delete'),
        ('group', 'create'), ('group', 'read'), ('group', 'update'), ('group', 'delete'),
        ('project', 'create'), ('project', 'read'), ('project', 'update'), ('project', 'delete'),
        ('customer', 'create'), ('customer', 'read'), ('customer', 'update'), ('customer', 'delete'),
        ('email', 'read'),
        -- The privacy/DSAR capabilities (migrations 0009-0011 own the matching
        -- copies of these rows; both statements are ON CONFLICT DO NOTHING, so
        -- whichever runs second is a no-op and a fresh provision and a
        -- migrated-then-seeded one end up identical).
        --
        -- 'privacy_request:delete' is ABSENT and deliberately so: CPRA
        -- 1798.105(c)(2) and 11 CCR 7101(a) require the record of a consumer
        -- request to be RETAINED for at least 24 months, and a 'delete' verb on
        -- the request resource would be a capability to erase a compliance
        -- obligation. It is also the first such capability anybody would reach
        -- for, because deleting the thing a user asked for is the most
        -- intuitive response to a user asking to be forgotten.
        --
        -- 'privacy_purge:create' and 'privacy_purge:delete' are absent for the
        -- opposite reason: enqueueing and deleting a purge row have no human
        -- path, and the control is structural rather than documentary - no
        -- serving role holds INSERT or DELETE on 'privacy_purge_queue', so these
        -- two rows could be granted to every role and still be unusable.
        ('privacy_request', 'create'), ('privacy_request', 'read'), ('privacy_request', 'update'),
        ('privacy_request_audit', 'read'),
        ('privacy_purge', 'read'), ('privacy_purge', 'update'),
        -- Company profile and addresses (migrations 0012-0013). The TABLE grants
        -- are what actually admit these: app_anon, app_member and app_admin all
        -- hold SELECT, because ccpa_applicable() reads the address list and a
        -- privacy policy owed to a signed-OUT visitor cannot be behind a login.
        --
        -- These rows exist to DESCRIBE the capability, not to admit the read. Two
        -- reasons they must never become the enforcement point for the public
        -- read: a page that answers 401 to an anonymous visitor because it checked
        -- a permission first is denying the very disclosure CCPA 1798.100(d) and
        -- GDPR 13/14 require, and 'company_profile:read' would then be a name that
        -- means two different things at once.
        --
        -- No role grant line is needed and none is written: 'admin' receives every
        -- permission row through the existing blanket grant, so manager and member
        -- hold none of these.
        ('company_profile', 'read'), ('company_profile', 'update'),
        ('company_addresses', 'read'), ('company_addresses', 'update')
      ON CONFLICT (resource, action_id) DO NOTHING
    `,
    );

    // Roles: three-tier hierarchy. admin (super, system) -> manager -> member.
    // Insert then select per role so both fresh seeds and re-runs get the right id;
    // on a re-run the insert is a no-op (ON CONFLICT) and the select re-uses it.
    const createRole = async (
      name: string,
      parentId: string | null,
    ): Promise<string> => {
      await q(
        `roles/${name}/insert`,
        'INSERT INTO roles (name, parent_id, is_system_role) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING',
        [name, parentId, name === 'admin'],
      );
      const row = await q(
        `roles/${name}/select`,
        'SELECT id FROM roles WHERE name = $1',
        [name],
      );
      return row.rows[0].id;
    };
    const adminRole = await createRole('admin', null);
    const managerRole = await createRole('manager', adminRole);
    const memberRole = await createRole('member', managerRole);
    await q(
      'role_permissions/admin',
      `
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT $1, p.id FROM permissions p
      ON CONFLICT DO NOTHING
    `,
      [adminRole],
    );

    // Manager role = read on admin tables, read+update on tenant rows, and
    // `email:read` — reading the email history of users in your scope is a
    // manager's job. `admin` needs no explicit grant here: the statement above
    // gives the admin role EVERY permission row, and `email/read` is one of them,
    // so the superset stays a superset without a second list to keep in step
    // (the test asserts the admin holds every row that exists).
    await q(
      'role_permissions/manager',
      `
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT $1, p.id
      FROM permissions p
      WHERE (p.resource IN ('user', 'role', 'permission', 'group')
        AND p.action_id = 'read')
        OR (p.resource IN ('project', 'customer')
        AND p.action_id IN ('read', 'update'))
        OR (p.resource = 'email'
        AND p.action_id = 'read')
        -- A manager runs a privacy case: they open one, they answer one, and
        -- they read the cases in their scope. NOT 'privacy_request_audit:read'
        -- and NOT 'privacy_purge:*' - the denial basis is compliance-review
        -- material and the purge queue is the admin surface, and neither is a
        -- manager's. The parentheses are not decoration: 'AND' binds tighter
        -- than 'OR', so an unparenthesised list reads as one predicate and
        -- silently widens with every clause appended to it.
        OR (p.resource = 'privacy_request'
        AND p.action_id IN ('create', 'read', 'update'))
      ON CONFLICT DO NOTHING
    `,
      [managerRole],
    );

    // Member role = read on tenant rows, plus the member's own privacy requests.
    // NOT `email:read`: a member holds no
    // capability over other people's correspondence, and the point of granting it
    // to manager and not to member is that the grant-subset trigger and the policy
    // both have to be told about it separately. Named here because a reader who
    // sees 'email' in the manager list and not here should be able to tell that
    // it was decided rather than forgotten.
    await q(
      'role_permissions/member',
      `
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT $1, p.id
      FROM permissions p
      WHERE (p.resource IN ('project', 'customer')
        AND p.action_id = 'read')
        -- 'privacy_request' IS the member's and it is not 'email:read'
        -- 's neighbour by accident. A mail history is another person's
        -- correspondence; a data-subject request is the subject's own legal act,
        -- and a subject who cannot read their own request cannot exercise the
        -- right they are exercising. All THREE verbs: 'create' to file one,
        -- 'read' to see it, 'update' to WITHDRAW it - and the update policy
        -- restricts what a member may reach with that third one to 'withdrawn',
        -- so a member can stop their own request and cannot mark it fulfilled.
        OR (p.resource = 'privacy_request'
        AND p.action_id IN ('create', 'read', 'update'))
      ON CONFLICT DO NOTHING
    `,
      [memberRole],
    );

    // Hierarchy: root -> EU -> FR, root -> KF, standalone HQ. Insert SEQUENTIALLY,
    // one row per statement, because a single multi-row INSERT is what broke this:
    // PostgreSQL evaluates every VALUES expression before it inserts any row, so
    // each `(SELECT id FROM groups WHERE name = 'root')` saw an empty table and
    // every parent_id resolved to NULL. The result was five sibling roots and an
    // org_closure holding only the five self-rows, which makes the RLS scope axis
    // return zero rows for every member — with no error anywhere. Same
    // insert-then-select shape as createRole: on a re-run the insert is a no-op
    // (ON CONFLICT) and the select re-uses the existing row.
    const createGroup = async (
      name: string,
      parentId: string | null,
      system = false,
    ): Promise<string> => {
      await q(
        `groups/${name}/insert`,
        'INSERT INTO groups (parent_id, name, is_system_group) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING',
        [parentId, name, system],
      );
      const row = await q(
        `groups/${name}/select`,
        'SELECT id FROM groups WHERE name = $1',
        [name],
      );
      return row.rows[0].id;
    };
    const rootId = await createGroup('root', null, true);
    const euId = await createGroup('EU', rootId);
    await createGroup('FR', euId);
    await createGroup('KF', rootId);
    const huId = await createGroup('HQ', null);

    // The admin user: admin role, member of HQ and EU (EU scope + full capability).
    // Insert-then-select for the same reason as createRole / createGroup: a
    // `DO NOTHING RETURNING id` returns ZERO rows on a re-run, so reading
    // `.rows[0].id` straight off it throws and a second seed cannot get as far as
    // its own memberships.
    //
    // `password_hash` is read alongside `id` because idempotency alone is not the
    // whole contract. An operator re-running with a DIFFERENT SEED_ADMIN_PASSWORD is
    // asking to rotate, and `ON CONFLICT (username) DO NOTHING` cannot answer that:
    // the incoming value is discarded while the completion line printed it anyway.
    // Measured before this branch existed — run 1 with alpha123, run 2 with
    // differentpass456: printed `differentpass456`, and the stored hash still
    // verified alpha123 only. A success-shaped report for a rotation that never
    // happened, which is §2.3, and it replaced a loud crash with a silent lie.
    // So: no row -> insert; row present -> `bcrypt.compare` and UPDATE only when
    // they differ. That keeps a same-password re-run byte-identical (no needless
    // re-hash) and makes the rotation real, so what is printed is what is stored.
    const readAdmin = async (label: string): Promise<AdminRow | undefined> => {
      const found = await q<AdminRow>(
        label,
        'SELECT id, password_hash FROM users WHERE username = $1',
        ['admin'],
      );
      return found.rows[0];
    };

    const existingAdmin = await readAdmin('users/admin/select');
    let adminId: string;
    let adminPasswordApplied: boolean;
    if (existingAdmin === undefined) {
      await q(
        'users/admin/insert',
        'INSERT INTO users (username, email, password_hash, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING',
        [
          'admin',
          'admin@example.com',
          await bcrypt.hash(adminPassword, 12),
          now,
        ],
      );
      // Read the row back rather than trusting the INSERT's own RETURNING: under a
      // concurrent seed the DO NOTHING can skip the write, and the id below then
      // belongs to the row that is actually there.
      const created = await readAdmin('users/admin/insert/verify');
      if (created === undefined) {
        throw new Error(
          'admin user absent after INSERT ... ON CONFLICT (username) DO NOTHING',
        );
      }
      adminId = created.id;
      adminPasswordApplied = true;
    } else if (
      await bcrypt.compare(adminPassword, existingAdmin.password_hash)
    ) {
      adminId = existingAdmin.id;
      adminPasswordApplied = false;
    } else {
      await q(
        'users/admin/rotate',
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [await bcrypt.hash(adminPassword, 12), existingAdmin.id],
      );
      adminId = existingAdmin.id;
      adminPasswordApplied = true;
    }
    await q(
      'user_roles/admin',
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [adminId, adminRole],
    );
    await q(
      'user_groups/admin/HQ',
      'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [adminId, huId],
    );
    await q(
      'user_groups/admin/EU',
      'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [adminId, euId],
    );

    // Demo tenant rows. `ON CONFLICT DO NOTHING` CANNOT make these idempotent, and
    // it looks like it does: projects and customers have no unique key over
    // (group_id, name). Their primary key is (group_id, id) and `id` is a fresh
    // `uuidv7()` from the column default on every run, so there is never a conflict
    // to do nothing about and a second seed silently doubles the tenant's data.
    // Measured on this pipeline: projects 2 -> 4 and customers 1 -> 2 across two
    // runs, with no error and exit 0 both times. The guard has to be an explicit
    // NOT EXISTS on the natural key, evaluated per candidate row.
    await q(
      'demo/projects',
      `
      INSERT INTO projects (group_id, name, budget_cents, created_at)
      SELECT $1, v.name, v.budget_cents::bigint, $2
      FROM (VALUES ('Q4 Roadmap', 450000), ('Compliance audit', 125000)) AS v(name, budget_cents)
      WHERE NOT EXISTS (
        SELECT 1 FROM projects p WHERE p.group_id = $1 AND p.name = v.name
      )
    `,
      [euId, now],
    );
    await q(
      'demo/customers',
      `
      INSERT INTO customers (group_id, name, internal_notes, created_at)
      SELECT $1, v.name, v.internal_notes, $2
      FROM (VALUES ('Acme Distribution Ltd', 'Strategic account')) AS v(name, internal_notes)
      WHERE NOT EXISTS (
        SELECT 1 FROM customers c WHERE c.group_id = $1 AND c.name = v.name
      )
    `,
      [euId, now],
    );

    await client.query('COMMIT');
    await client.end();
    if (adminPasswordApplied) {
      // Only here, and only because the value above is the value stored: on a fresh
      // insert or a rotation this IS the effective password. §2.5 forbids logging a
      // credential that has not been applied, and printing the incoming value
      // unconditionally is what made the old line a lie.
      console.log(`\nseed complete. admin / ${adminPassword}`);
    } else {
      // The stored hash already matches SEED_ADMIN_PASSWORD, so nothing was applied
      // and there is no password to report — the one already in use is a value the
      // seed never saw. Naming the variable that rotates it is what makes this
      // actionable instead of merely honest.
      console.log(
        '\nseed complete. admin already exists; its password is unchanged.',
      );
      console.log(
        'set SEED_ADMIN_PASSWORD to a new value and re-run to rotate it.',
      );
    }
    return 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
    console.error(`seed failed:`, err);
    return 1;
  }
}

seed()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
