import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { startSmtpSink, type SmtpSink } from '../../scripts/smtp-sink.js';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
// TYPE-only. Importing `ErasureService` for its *value* at module scope would bind
// the class as it existed BEFORE the `vi.resetModules()` in `beforeAll`, and the
// dynamic `import()` of `app.module.js` that follows would then re-evaluate
// `erasure.service.js` into a SECOND, distinct class object. The container registers
// the post-reset class, so a lookup by the pre-reset reference fails with "could not
// find ErasureService element" — which reads exactly like a DI wiring bug and is not
// one. The runtime class is taken from the same post-reset graph as `AppModule`.
import type { ErasureService } from '../../src/privacy/erasure.service.js';
import { isAnonymizedRecipient } from '../../src/privacy/tombstone.js';
import { BACKEND_ROOT } from '../support/paths.js';

// =============================================================================
// WRITTEN ON A MACHINE WITH NO POSTGRESQL REACHABLE, AND SINCE RUN AGAINST ONE.
//
// Every statement below was UNRUN when it was written: `npm run test:e2e` had
// never executed it, no assertion had been observed to pass or to fail, and
// nothing about it was evidence that the control it describes held. It has since
// been run, and running it is what found the two defects recorded in
// `src/privacy/erasure.service.ts`: the read ran without the escalation boundary,
// and `CLOSE_OPEN_REQUESTS_SQL` matches nothing on PostgreSQL 18.
//
// It lives in `test/e2e/` and NOT in `test/rls/`, because
// `test/rls/support/fixture.ts` rebuilds its proof database from
// `0001_rls_foundation.sql` ALONE — there is no `users` table in that database, so
// no erasure test can run there. The erasure needs migrations 0002 through 0017.
// =============================================================================

const TEST_DB = 'erasure_cross_user_e2e';
const SEED_PASSWORD = 'seed-test-password-123';
const TEST_JWT_SECRET = 'erasure-e2e-signing-secret-key-for-tests-0123456789';
const PROOF_TIMEOUT = 600_000;

const AUTHENTICATOR_PASSWORD = loadTestEnvironment().authenticator.password;

loadTestEnvironment();

function psqlAsSuperuser(database: string, sql: string): string {
  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', database, '-c', sql],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`superuser psql failed against ${database}: ${sql}\n${result.stderr}`);
  }
  return result.stdout;
}

function recreateDatabase(name: string): void {
  const devDb = databaseConfig().database;
  if (name === devDb || name === 'app_dev') {
    throw new Error(`refusing to run the erasure e2e against the development database (${name})`);
  }
  psqlAsSuperuser(
    'postgres',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
  );
  psqlAsSuperuser('postgres', `DROP DATABASE IF EXISTS ${name}`);
  psqlAsSuperuser('postgres', `CREATE DATABASE ${name} OWNER ${databaseConfig().user}`);
}

function runSeed(database: string): SpawnSyncReturns<string> {
  return spawnSync('node', ['--experimental-strip-types', 'database/seed.ts'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DB_NAME: database, SEED_ADMIN_PASSWORD: SEED_PASSWORD },
    encoding: 'utf8',
    timeout: 300_000,
  });
}

type UserRow = {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  deleted_at: Date | null;
  deletion_reason: string | null;
  email_anonymized: boolean;
  created_at: Date;
};

/** The escalation boundary the erasure itself uses, so the assertions read the rows the server could read. */
async function withAdminClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const config = loadTestEnvironment().database;
  const client = new Client({
    host: config.host,
    port: config.port,
    user: 'pgrst_authenticator',
    password: AUTHENTICATOR_PASSWORD,
    database: TEST_DB,
  });
  await client.connect();
  try {
    await client.query('SET ROLE app_admin');
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Every case gets ITS OWN subject.
//
// The first version of this file ran all six cases against one account, in
// declaration order. Three of them are then vacuous and one is simply wrong: the
// erasure is idempotent by design, so by case three `USER_A` is already
// anonymised, `eraseSelf` returns at the idempotency branch and issues no
// statement at all — so "the receipt reached the live address" observed an empty
// outbox, "the sessions were revoked" counted zero rows in a table that never
// held one, and "the telemetry was anonymised" planted a login attempt AFTER the
// statement that rewrites them had already run. A control that cannot fail is not
// a control (§2.2, §B8), so each case now plants its own account and erases it
// for real.
const USER_A = '44444444-0000-0000-0000-00000000000a';
const USER_B = '44444444-0000-0000-0000-00000000000b';
const USER_RECEIPT = '44444444-0000-0000-0000-00000000000c';
const USER_RETRY = '44444444-0000-0000-0000-00000000000d';
const USER_AUTHORITY = '44444444-0000-0000-0000-00000000000e';
const USER_TELEMETRY = '44444444-0000-0000-0000-00000000000f';

/**
 * A hash that is a syntactically valid bcrypt string and verifies nothing.
 *
 * The erasure replaces it with a real hash of its own; what matters to these cases
 * is that the planted value and the replacement are distinguishable.
 */
const PLANTED_HASH = '$2b$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV';

/** One account, planted the way the seed plants a user. */
async function plantSubject(id: string, username: string): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query(
      `INSERT INTO users (id, username, email, password_hash) VALUES ($1, $2, $3, $4)`,
      [id, username, `${username}@example.test`, PLANTED_HASH],
    );
  });
}

/** The role and group this suite's subjects belong to, read from the seed rather than assumed. */
async function seededAuthority(): Promise<{ roleId: string; groupId: string }> {
  return withAdminClient(async (client) => {
    const role = await client.query<{ id: string }>("SELECT id FROM roles WHERE name = 'member'");
    const group = await client.query<{ id: string }>("SELECT id FROM groups WHERE name = 'EU'");
    const roleId = role.rows[0]?.id;
    const groupId = group.rows[0]?.id;
    if (roleId === undefined || groupId === undefined) {
      throw new Error('the seed did not create the member role and EU group this suite reads back');
    }
    return { roleId, groupId };
  });
}

/** Everything an erasure is supposed to close over, counted. */
type Authority = {
  readonly liveSessions: number;
  readonly totalSessions: number;
  readonly roles: number;
  readonly groups: number;
};

async function authorityOf(userId: string): Promise<Authority> {
  return withAdminClient(async (client) => {
    const count = async (sql: string): Promise<number> => {
      const result = await client.query<{ n: number }>(sql, [userId]);
      return result.rows[0]?.n ?? -1;
    };
    return {
      liveSessions: await count('SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL'),
      totalSessions: await count('SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1'),
      roles: await count('SELECT count(*)::int AS n FROM user_roles WHERE user_id = $1'),
      groups: await count('SELECT count(*)::int AS n FROM user_groups WHERE user_id = $1'),
    };
  });
}

/**
 * A subject carrying a live session, a role and a group membership — the three
 * things the erasure revokes, and nothing else.
 *
 * **The returned "before" is the point.** An assertion that a count fell to zero
 * is worth nothing when it was already zero — and each of these tables is one the
 * erasure would leave completely untouched if the corresponding statement were
 * deleted, so an unplanted subject turns four live controls into four passes that
 * cannot fail. Asserting the fixture here makes that a setup failure rather than a
 * green lie.
 */
async function plantSubjectWithAuthority(id: string, username: string): Promise<Authority> {
  const { roleId, groupId } = await seededAuthority();
  await plantSubject(id, username);
  await withAdminClient(async (client) => {
    await client.query('BEGIN');
    // `jti` is a uuid with a `uuidv7()` default (0006); the token hash is the
    // opaque value and the two together are what a real session row looks like.
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [id, `hash-${username}`],
    );
    await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [id, roleId]);
    await client.query('INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)', [id, groupId]);
    await client.query('COMMIT');
  });
  return authorityOf(id);
}

/** A sign-in attempt, planted under a real username, with its forensic fields filled in. */
async function plantLoginAttempt(username: string, ip: string): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query(
      `INSERT INTO login_attempts (username, ip, ip_normalized, ip_subnet, status)
       VALUES ($1, $2, $2, $3, 'failed')`,
      [username, ip, `${ip.split('.').slice(0, 3).join('.')}.0/24`],
    );
  });
}

async function readUser(id: string): Promise<UserRow> {
  return withAdminClient(async (client) => {
    const result = await client.query<UserRow>(
      `SELECT id, username, email, password_hash, deleted_at, deletion_reason, email_anonymized, created_at
         FROM users WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`no users row for ${id}`);
    }
    return row;
  });
}

/** Everything about B that must be byte-identical afterwards, as one comparable value. */
async function fingerprintB(): Promise<string> {
  const b = await readUser(USER_B);
  return JSON.stringify([b.username, b.email, b.password_hash, b.deleted_at, b.deletion_reason, b.created_at]);
}

let app: NestFastifyApplication;
let moduleRef: TestingModule;
let erasure: ErasureService;
let sink: SmtpSink;

beforeAll(async () => {
  recreateDatabase(TEST_DB);
  const seed = runSeed(TEST_DB);
  if (seed.status !== 0) {
    throw new Error(`seed failed:\n${seed.stdout}\n${seed.stderr}`);
  }

  // The receipt crosses a real transport, and `ErasureService` refuses to
  // anonymise anybody it could not reach — so this suite points the application
  // at an in-process sink rather than asserting around a failed send.
  sink = await startSmtpSink({ port: 0 });

  process.env['DB_NAME'] = TEST_DB;
  process.env['JWT_SECRET'] = TEST_JWT_SECRET;
  process.env['PGRST_JWT_SECRET'] = TEST_JWT_SECRET;
  process.env['AUTHENTICATOR_PASSWORD'] = AUTHENTICATOR_PASSWORD;
  process.env['EMAIL_HOST'] = sink.host;
  process.env['EMAIL_PORT'] = String(sink.port);
  vi.resetModules();

  // Planted BEFORE the app module is imported, because the erasure pool opens on
  // first use and the fixtures must exist before the first `eraseSelf`.
  await plantSubject(USER_A, 'robin');
  await plantSubject(USER_B, 'sam');

  const { AppModule } = await import('../../src/app.module.js');
  // Same post-reset module graph as AppModule — see the type-only import at the top
  // of this file for why the class cannot be bound at module scope.
  const { ErasureService: ErasureServiceRef } = await import('../../src/privacy/erasure.service.js');
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  erasure = moduleRef.get(ErasureServiceRef, { strict: false });
}, PROOF_TIMEOUT);

afterAll(async () => {
  try {
    await app?.close();
    await moduleRef?.close();
  } finally {
    await sink?.close();
    // `database/seed.ts` runs a CLUSTER-scoped `ALTER ROLE … PASSWORD`, so the
    // cluster is only restored once this runs, and it must run even if closing
    // the app throws.
    restoreAuthenticatorPassword();
  }
}, PROOF_TIMEOUT);

// -----------------------------------------------------------------------------
// Case names are the attacks they prevent (AGENTS.md §B8).
// -----------------------------------------------------------------------------

describe('one account cannot be erased by another', () => {
  it('erasing the subject leaves every other account byte-identical, through the real service', async () => {
    const before = await fingerprintB();

    const outcome = await erasure.eraseSelf(USER_A);

    expect(outcome.userId).toBe(USER_A);
    // The control itself: B is not merely "still readable", it is unchanged down
    // to its password hash and its created_at.
    expect(await fingerprintB()).toBe(before);
  });

  it('anonymises ONLY the named subject: the address is a tombstone and the username is not a name', async () => {
    await erasure.eraseSelf(USER_A);

    const a = await readUser(USER_A);
    expect(a.email_anonymized).toBe(true);
    expect(a.deletion_reason).toBe('rtbf');
    expect(a.deleted_at).not.toBeNull();
    expect(isAnonymizedRecipient(a.email)).toBe(true);
    expect(a.username).not.toBe('robin');
    expect(a.username.startsWith('deleted-')).toBe(true);
    // The old password hash is gone: a tombstone that still verifies a password is
    // not an erasure, and `password_hash` is NOT NULL so it cannot be nulled.
    expect(a.password_hash).not.toBe('$2b$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV');
  });

  it('the receipt reached the address that was still live, and no tombstone ever receives mail', async () => {
    // Its OWN subject, erased for real — on an already-erased account the
    // idempotency branch returns before the transport is touched at all, so this
    // case would observe an empty outbox and pass.
    await plantSubject(USER_RECEIPT, 'casey');
    sink.clear();

    const outcome = await erasure.eraseSelf(USER_RECEIPT);

    expect(sink.deliveries).toHaveLength(1);
    expect(sink.deliveries[0]?.recipients).toEqual(['casey@example.test']);
    // The address it went to is the one that was live, and NOT the tombstone that
    // replaced it. If the two were the same value the ordering would be unobservable.
    expect(sink.deliveries[0]?.recipients).not.toContain(outcome.tombstoneAddress);
    expect(await readUser(USER_RECEIPT)).toMatchObject({ email: outcome.tombstoneAddress });

    // Post-condition of the exclusion rule, asserted on the wire rather than on a
    // return value: nothing this application sends is ever addressed to a shape
    // `isAnonymizedRecipient` recognises.
    for (const delivery of sink.deliveries) {
      for (const recipient of delivery.recipients) {
        expect(isAnonymizedRecipient(recipient), recipient).toBe(false);
      }
    }
  });

  it('a second erasure is a no-op, so a retried request cannot produce a second tombstone', async () => {
    await plantSubject(USER_RETRY, 'devon');

    const first = await erasure.eraseSelf(USER_RETRY);
    const aAfterFirst = await readUser(USER_RETRY);

    const second = await erasure.eraseSelf(USER_RETRY);
    const aAfterSecond = await readUser(USER_RETRY);

    // The first call really did the work, or nothing below says anything about the
    // second one: a "no-op" measured against an account that was never erased is
    // a tautology.
    expect(first.alreadyErased).toBe(false);
    expect(aAfterFirst.email_anonymized).toBe(true);
    expect(aAfterFirst.username.startsWith('deleted-')).toBe(true);

    expect(second.alreadyErased).toBe(true);
    expect(second.tombstoneAddress).toBe(first.tombstoneAddress);
    expect(aAfterSecond.username).toBe(aAfterFirst.username);
    expect(aAfterSecond.deleted_at).toEqual(aAfterFirst.deleted_at);
    expect(aAfterSecond.email).toBe(aAfterFirst.email);
  });

  it('revoked every session, and dropped the roles and groups the authority resolved from', async () => {
    const before = await plantSubjectWithAuthority(USER_AUTHORITY, 'emery');
    // The positive control, asserted BEFORE the erasure runs: every one of these
    // is non-zero, so the zeroes below are the erasure's doing and not a fixture
    // that was never there. Without this, deleting `REVOKE_SESSIONS_SQL` or
    // `CLOSE_OPEN_REQUESTS_SQL` entirely leaves every assertion below green.
    expect(before).toEqual({ liveSessions: 1, totalSessions: 1, roles: 1, groups: 1 });

    await erasure.eraseSelf(USER_AUTHORITY);

    // Row counts through an UNFILTERED read of the subject's own rows, never a
    // status code: a denial, a full leak and a partial leak are all HTTP 200, and
    // a filtered count cannot tell "nothing changed" from "I can see nothing".
    const after = await authorityOf(USER_AUTHORITY);
    expect(after.liveSessions).toBe(0);
    // Revoked, not deleted: the session row survives so the rotation chain stays
    // auditable, which is why `totalSessions` is asserted rather than left alone.
    expect(after.totalSessions).toBe(1);

    // `authz.revoke_subject_authority()` (0009) is the choke point; this asserts
    // it actually fired rather than that the function exists.
    expect(after.roles).toBe(0);
    expect(after.groups).toBe(0);
  });

  it('kept the login telemetry and anonymised only its username', async () => {
    await plantSubject(USER_TELEMETRY, 'frankie');
    // Planted BEFORE the erasure, under the real username, so the case is about the
    // statement and not about a fixture that predated or postdated it.
    await plantLoginAttempt('frankie', '203.0.113.9');
    // …and one belonging to somebody else, so "the username was rewritten" is not
    // satisfied by a statement that rewrote the whole table.
    await plantLoginAttempt('someoneelse', '198.51.100.4');

    await erasure.eraseSelf(USER_TELEMETRY);

    await withAdminClient(async (client) => {
      const rows = await client.query<{ username: string; ip: string | null; status: string }>(
        'SELECT username, ip, status FROM login_attempts WHERE ip = $1',
        ['203.0.113.9'],
      );
      expect(rows.rows).toHaveLength(1);
      // 11 CCR §7111: the forensic fields survive.
      expect(rows.rows[0]?.ip).toBe('203.0.113.9');
      expect(rows.rows[0]?.status).toBe('failed');
      // …and the name does not.
      expect(rows.rows[0]?.username).toMatch(/^deleted-[0-9a-f]{32}$/);

      const bystander = await client.query<{ username: string }>(
        'SELECT username FROM login_attempts WHERE ip = $1',
        ['198.51.100.4'],
      );
      expect(bystander.rows).toHaveLength(1);
      expect(bystander.rows[0]?.username).toBe('someoneelse');
    });
  });
});

/**
 * ## WHAT THIS FILE DELIBERATELY DOES NOT ASSERT, and why
 *
 * **`privacy_request_audits` has no row.** The statutory record is the whole point
 * of the feature and this suite cannot prove it, because its only writer,
 * `authz.append_privacy_request_audit()`, requires `authz.actor()` — and
 * `authz.actor()` reads `request.jwt.claims`, which the thin app has no legitimate
 * way to set (§B2 F1: it is a custom GUC any role may `SET`, and
 * `test/unit/claims-write-surface.spec.ts` fails the build if anything in `src/`
 * writes it). The erasure therefore anonymises the subject and closes the working
 * copy on `privacy_requests`, and the compliance row is left unwritten.
 *
 * Asserting "there is no audit row" would lock the gap in place as a requirement.
 * Asserting "there is an audit row" would be a red suite against a migration that
 * has not been written. So neither is asserted here, the gap is reported instead,
 * and the fix is a `SECURITY DEFINER` `authz.record_erasure(uuid, uuid, bytea,
 * text)` that takes the subject explicitly — a migration, and out of scope.
 *
 * **That migration was then scoped, and it is blocked on the same missing identity
 * as the closure above rather than on the audit table.** The write itself is
 * available: `privacy_request_audits` is ENABLEd and deliberately NOT FORCEd
 * (`0010:449-462`) precisely so a `SECURITY DEFINER` writer runs as the owner, and
 * a seam on that precedent inserts a row. What a seam cannot do is *gate* itself:
 * `authz.actor()` is NULL in this session, so there is no "is this caller the
 * subject?" to answer, and a grant-only gate lets any `app_admin` session certify a
 * discharge about a subject it merely named — the exact harm `0014` closed on the
 * existing writer. And the record cannot be written database-side at all, because
 * `subject_hmac` is an HMAC under `PRIVACY_HMAC_PEPPER`, a secret this application
 * deliberately never sends to PostgreSQL. Both are set out in full on
 * `CLOSE_OPEN_REQUESTS_SQL` in `src/privacy/erasure.service.ts`.
 *
 * **`CLOSE_OPEN_REQUESTS_SQL` is not exercised, and it is a silent no-op today.**
 * The first version of this file planted an open `privacy_requests` row and asserted
 * it became `fulfilled`. It does not, and it never could from this connection: on
 * PostgreSQL 18 an `UPDATE` whose `WHERE` names target columns has the table's
 * `SELECT` policy ANDed into the scan filter as well as its `UPDATE` policy, and
 * `privacy_request_read` (`0010:531-548`) has no `current_user = 'app_admin'`
 * branch — its only path is `has_permission(authz.actor(), …)`, and `actor()` is
 * NULL without the claims GUC this suite must not set. Measured against the real
 * database: `UPDATE 0` on a row that exists, with a `WHERE` proven to match it.
 *
 * **The narrow `SECURITY DEFINER` seam was then built and measured too, and it also
 * updates zero rows** — `privacy_requests` is FORCE ROW LEVEL SECURITY
 * (`0010:445`), so the owner a DEFINER body rebinds to is bound by the same read
 * policy. `test/rls/privacy-requests.spec.ts` now asserts that measurement as a
 * live control (claimless admin: zero rows, `UPDATE 0`, row still `open`) together
 * with the owner-side assertion that keeps the `NO FORCE` alternative honest, and
 * both go red under a tamper. See the comment on `CLOSE_OPEN_REQUESTS_SQL` in
 * `src/privacy/erasure.service.ts` for the plan, for what the two working fixes
 * each cost, and for why neither is taken.
 *
 * Neither assertion is written here for the same reason as the audits row above:
 * "the request stays open" would lock a schema defect in as a requirement, and
 * "the request is fulfilled" is red against a migration nobody has approved.
 * **This is the one control in the delivered feature that is described but not
 * working, and it is reported rather than papered over.**
 *
 * **There is no HTTP request.** The deletion-request route is not mounted, because
 * a mounted thin-app route must name a dispatch token in
 * `src/breaker/dispatch-token.ts` and `route-census.ts` refuses to boot a graph
 * whose routes it cannot name. When `privacy.submit` exists, this file gains a
 * case that presents A's token and asserts it cannot reach B's row at all — which
 * is the assertion that belongs at the trust boundary rather than in the service.
 */