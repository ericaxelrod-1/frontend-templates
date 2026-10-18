import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import { Client } from 'pg';
import { startSmtpSink, type SmtpSink } from '../../scripts/smtp-sink.js';
import { parseSmtpMessage } from '../../scripts/smtp-message.js';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';
import { startPostgrestProcess, type PostgrestProcess } from '../support/postgrest-process.js';

/**
 * The member's own profile routes, and the administrator's user creation, against a
 * real seed, a real Nest app, a real SMTP server and **a real PostgREST**.
 *
 * ## THE THINGS THIS SUITE EXISTS TO PROVE, AND THE IMPLEMENTATION EACH ONE RULES OUT
 *
 * | attack or defect | the wrong implementation it passes on |
 * |---|---|
 * | a password reset requested after an address change reaches the real owner | the naive "set `email`, mail the new address" change — which is an account takeover in two requests |
 * | a superseded link cannot be redeemed after a newer one | minting without closing the outstanding set, so the second link silently wins |
 * | a mistyped current password does not end the session | answering `401`, which the frontend's interceptor reads as the end of the token |
 * | a member sees their own sign-in history and nobody else's | reading `login_attempts` as the member, which `0022` forbids as an enumeration oracle |
 * | an attempt against a username that does not exist is visible to nobody | filtering by a caller-supplied username, which is the same route as the leak above |
 * | a member cannot create an account | omitting the refusal, on the argument that the database would stop the row |
 *
 * The first two are the point of the feature. **The old address is the one in force until
 * redemption, and that ordering is asserted on the DATABASE rather than on the response
 * body** — a test that only checked "the email changed after confirming" would pass on the
 * unsafe implementation too, which is exactly what the brief warns about.
 *
 * ## WHY PostgREST IS STARTED HERE
 *
 * `GET /api/users/me` is read through the identity seam: the caller's own bearer token
 * is replayed into PostgREST so PostgreSQL resolves `authz.actor()` to them and the
 * member's COLUMN GRANT plus `users_read_scope` decide what comes back. Asserting that
 * route without a real PostgREST would be asserting against a stand-in for the API
 * layer — §2.2, and §B8's "mocks hide schema and policy bugs". See
 * `test/support/postgrest-process.ts` for why that launcher is not the RLS fixture's.
 *
 * ## THE MAIL IS READ, NEVER BYPASSED
 *
 * The pending address lives inside the one-time token, so the only way a test can hold
 * a working token is to read the link out of a message a real server received — which
 * is also the only way to prove the link **in the mail** is the link that works.
 *
 * ## FIXTURES
 *
 * `createMember` plants a user with the `member` role and a group, because `0023`'s
 * twelve-column read is bounded by `authz.can_read_user()` and a user with no role rows
 * reads ZERO rows. That is no longer something a route produces: `POST /api/users` now
 * requires `role` and `group` and writes both membership rows in the transaction that
 * creates the account, and its own case below asserts a created account CAN read its own
 * profile rather than 404-ing on it.
 */

const TEST_DB = 'profile_e2e';
const SEED_PASSWORD = 'seed-test-password-123';
const TEST_JWT_SECRET = 'profile-e2e-signing-secret-0123456789abcd';
/** 3017 is free and, unlike PostgREST's own default, nothing else in this tree uses it. */
const POSTGREST_PORT = 3017;
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

/** Superuser SQL against TEST_DB, returned as parsed JSON rows. */
function superuserRows<T>(sql: string): readonly T[] {
  const stdout = psqlAsSuperuser(
    TEST_DB,
    `SELECT coalesce(json_agg(_q)::text, '[]') FROM (${sql.replace(/;\s*$/, '')}) AS _q`,
  );
  const trimmed = stdout.trim();
  return trimmed === '' ? [] : (JSON.parse(trimmed) as readonly T[]);
}

/**
 * `users`, `refresh_tokens` and `login_attempts` are all reachable through this
 * boundary, which is the same one the application uses.
 *
 * `email_messages` is NOT: it is FORCE-RLS and its read policy has no
 * `current_user = 'app_admin'` branch, so ground truth on it goes through
 * `superuserRows` — the same split `password-reset.e2e-spec.ts` documents.
 * `auth_tokens` likewise: `app_admin` holds no privileges on it at all (`0018` §2).
 */
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

/** `auth_tokens` only — through the owner role, which is the only one that may read it. */
async function withOwnerClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const config = loadTestEnvironment().database;
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: TEST_DB,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function scalar<T>(sql: string, values: readonly unknown[] = []): Promise<T | undefined> {
  return withAdminClient(async (client) => {
    const result = await client.query<{ readonly value: T }>(sql, values as unknown[]);
    return result.rows[0]?.value;
  });
}

async function count(sql: string, values: readonly unknown[] = []): Promise<number> {
  return (await scalar<number>(sql, values)) ?? 0;
}

async function tokenCount(sql: string, values: readonly unknown[] = []): Promise<number> {
  return withOwnerClient(async (client) => {
    const result = await client.query<{ readonly value: number }>(sql, values as unknown[]);
    return result.rows[0]?.value ?? 0;
  });
}

function recreateDatabase(name: string): void {
  const devDb = databaseConfig().database;
  if (name === devDb || name === 'app_dev') {
    throw new Error(`refusing to run the profile e2e against the development database (${name})`);
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

let app: NestFastifyApplication;
let moduleRef: TestingModule;
let sink: SmtpSink;
let postgrest: PostgrestProcess;

beforeAll(async () => {
  recreateDatabase(TEST_DB);
  const seed = runSeed(TEST_DB);
  if (seed.status !== 0) {
    throw new Error(`seed failed:\n${seed.stdout}\n${seed.stderr}`);
  }

  sink = await startSmtpSink({ port: 0 });
  postgrest = await startPostgrestProcess({
    port: POSTGREST_PORT,
    database: TEST_DB,
    authenticatorPassword: AUTHENTICATOR_PASSWORD,
    jwtSecret: TEST_JWT_SECRET,
  });

  process.env['DB_NAME'] = TEST_DB;
  process.env['JWT_SECRET'] = TEST_JWT_SECRET;
  process.env['PGRST_JWT_SECRET'] = TEST_JWT_SECRET;
  process.env['AUTHENTICATOR_PASSWORD'] = AUTHENTICATOR_PASSWORD;
  process.env['EMAIL_HOST'] = sink.host;
  process.env['EMAIL_PORT'] = String(sink.port);
  process.env['EMAIL_SECURE'] = 'false';
  // The address-change link is the only flow this suite drives end to end, and it must
  // not wait behind the brute-force ladder the reset suite needs. The thresholds are the
  // `.env.test` values; nothing here depends on them being large.
  process.env['SECURITY_DELAY_SCHEDULE_SECONDS'] = '0';
  process.env['SECURITY_BLOCK_THRESHOLD'] = '50';
  process.env['SECURITY_IP_ALLOWLIST'] = '';
  // The identity seam's own origin. `POSTGREST_URL` is required in every mode with no
  // default (`src/config/environment.ts` refuses a relative or query-bearing value), so
  // it is pointed at the process this suite just started rather than at whatever is on
  // 3001.
  process.env['POSTGREST_URL'] = postgrest.baseUrl;
  // `src/app.module.ts` and `src/token/token.module.ts` read their environment at
  // MODULE-EVALUATION time, so the module registry has to be reset after the overrides
  // above or the application keeps the values from `backend/.env.test` — which names a
  // PostgREST on 3001 that this suite did not start.
  vi.resetModules();
}, PROOF_TIMEOUT);

beforeAll(async () => {
  const { AppModule } = await import('../../src/app.module.js');
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, PROOF_TIMEOUT);

afterAll(async () => {
  try {
    sink?.clear();
    postgrest?.stop();
    await app?.close();
    await moduleRef?.close();
  } finally {
    // `database/seed.ts` runs a CLUSTER-scoped `ALTER ROLE … PASSWORD`, so the cluster is
    // only restored once this runs — and it must run even when teardown throws, because a
    // suite that dies here is exactly when the cluster would be left behind.
    restoreAuthenticatorPassword();
  }
});

// =============================================================================
// Helpers
// =============================================================================

function inject(options: {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly url: string;
  readonly token?: string;
  readonly payload?: Record<string, unknown>;
  readonly ip?: string;
}) {
  return app.inject({
    method: options.method,
    url: options.url,
    headers: options.token === undefined ? {} : { authorization: `Bearer ${options.token}` },
    payload: options.payload,
    remoteAddress: options.ip ?? '198.51.100.7',
  });
}

/** Sign in through the real route, so the token under test is one the guard accepts. */
async function signIn(username: string, password: string): Promise<string> {
  const response = await inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username, password },
    ip: '198.51.100.70',
  });
  if (response.statusCode !== 200) {
    throw new Error(`sign-in for ${username} failed with ${String(response.statusCode)}: ${response.body}`);
  }
  return (response.json<{ readonly accessToken: string }>()).accessToken;
}

/**
 * A member with a role and a group.
 *
 * **Both are required and that is the point.** `users_read_scope` is
 * `id IN (SELECT authz.actor() WHERE authz.can_read_user())`, and `can_read_user()` is
 * `has_permission(actor, 'user', 'read')` — false for a user with no `user_roles` row.
 * So a user without a role reads ZERO rows of their own profile. That shape used to be
 * what `POST /api/users` produced; it now has to be built by hand, which is what this
 * fixture is, and which is why the created-account case below asserts the opposite.
 */
async function createMember(username: string, email: string, password: string): Promise<string> {
  return withAdminClient(async (client) => {
    const hash = await bcrypt.hash(password, 12);
    const inserted = await client.query<{ readonly id: string }>(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [username, email, hash],
    );
    const id = inserted.rows[0]?.id;
    if (id === undefined) {
      throw new Error(`the fixture for ${username} was not created`);
    }
    await client.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'member'",
      [id],
    );
    await client.query(
      'INSERT INTO user_groups (user_id, group_id) SELECT $1, id FROM groups WHERE name = $2',
      [id, 'EU'],
    );
    return id;
  });
}

/**
 * The address-change token out of the link the mail actually carried.
 *
 * Read from the `text/plain` part the sink took, so the assertion is on the bytes a mail
 * client would show. **A test that reached past the mail and minted its own token would
 * pass against a broken URL builder** — and would also pass against a token format that
 * carries no address at all, which is the property under test.
 */
function changeTokenFromMail(recipient: string): string {
  const mine = sink.deliveries.filter((delivery) => delivery.recipients.includes(recipient));
  const last = mine[mine.length - 1];
  if (last === undefined) {
    throw new Error(
      `no message reached the sink for ${recipient}; it accepted ${String(sink.deliveries.length)}. ` +
        'This is a delivery that never arrived, not a message that was refused.',
    );
  }
  const match = /[?&]token=([A-Za-z0-9._-]+)/.exec(parseSmtpMessage(last.raw).text);
  const token = match?.[1];
  if (token === undefined) {
    throw new Error(`the message to ${recipient} carried no token link`);
  }
  return decodeURIComponent(token);
}

/**
 * Live ADDRESS-CHANGE tokens for a member, counted by the key the supersede uses.
 *
 * The `subject_hmac` is the domain-separated HMAC the primitive computes for
 * `email-change:<userId>`, and it is reproduced here from the test environment's pepper —
 * a test reproducing one line of production arithmetic rather than reaching into the
 * service, and the only way to count this population without one. Counting by
 * `user_id` alone would not do: a member holds OTHER live tokens (a reset link, a
 * verification link), and the property under test is about the change set specifically.
 *
 * `auth_tokens` is read through the OWNER role because `app_admin` holds no privileges on
 * it at all (`0018` §2) — the same split `password-reset.e2e-spec.ts` documents.
 */
function outstandingChangeLinks(userId: string): Promise<number> {
  const pepper = process.env['AUTH_TOKEN_PEPPER'];
  if (pepper === undefined || pepper === '') {
    throw new Error('AUTH_TOKEN_PEPPER is not set; the test environment is unusable');
  }
  const subjectHmac = createHmac('sha256', pepper)
    .update(`auth.token.subject.v1:email-change:${userId}`)
    .digest();
  return tokenCount(
    'SELECT count(*)::int AS value FROM auth_tokens WHERE subject_hmac = $1 AND consumed_at IS NULL',
    [subjectHmac],
  );
}

/** Every live token of any purpose for a member. */
function allLiveLinks(userId: string): Promise<number> {
  return tokenCount(
    'SELECT count(*)::int AS value FROM auth_tokens WHERE user_id = $1 AND consumed_at IS NULL',
    [userId],
  );
}

/** The ids of every `login_attempts` row keyed on one username, through the boundary. */
async function attemptIdsFor(username: string): Promise<readonly string[]> {
  return withAdminClient(async (client) => {
    const result = await client.query<{ readonly id: string }>(
      'SELECT id FROM login_attempts WHERE username = $1 ORDER BY created_at DESC, id DESC',
      [username],
    );
    return result.rows.map((row) => row.id);
  });
}

function emailOf(userId: string): Promise<string | undefined> {
  return scalar<string>('SELECT email AS value FROM users WHERE id = $1', [userId]);
}

// =============================================================================
// 1 + 2. GET /api/users/me and PATCH /api/users/me
// =============================================================================

describe('the member profile read is bounded by the column grant and by the caller, not by the request', () => {
  it('returns exactly the twelve granted columns, and refuses an unauthenticated caller', async () => {
    const userId = await createMember('read-member', 'read-member@example.test', 'read-password-0001');
    const token = await signIn('read-member', 'read-password-0001');

    const response = await inject({ method: 'GET', url: '/users/me', token });

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    // The list, exactly — asserted as a SET EQUALITY so a thirteenth field fails as loudly
    // as a missing one. `0023:687-692` is the grant this mirrors, and the frontend's
    // `ProfileMe` is a `Pick` of precisely these twelve.
    expect(Object.keys(body).sort()).toEqual([
      'city',
      'country_code',
      'created_at',
      'email',
      'first_name',
      'geo_accuracy_km',
      'geo_source',
      'geo_updated_at',
      'id',
      'last_name',
      'region_code',
      'username',
    ]);
    expect(body['id']).toBe(userId);
    expect(body['email']).toBe('read-member@example.test');

    // The columns a member may not read are absent, not null: a `password_hash` in this
    // body would mean the grant is not what the migration says it is, and §B8's rule is
    // that a status-only assertion passes on a real leak.
    expect(JSON.stringify(body)).not.toContain('password_hash');
    expect(JSON.stringify(body)).not.toContain('deleted_at');
    expect(JSON.stringify(body)).not.toContain('disabled_at');

    // Default deny: no token, no route. `JwtAuthGuard` is registered through APP_GUARD,
    // so the omission of `@Public()` is what makes this unreachable rather than open.
    expect((await inject({ method: 'GET', url: '/users/me' })).statusCode).toBe(401);
    // …and a garbage token is the same generic 401.
    expect((await inject({ method: 'GET', url: '/users/me', token: 'not.a.jwt' })).statusCode).toBe(401);
  });

  it('writes only the member\'s own name, on their own row, and answers with what the DATABASE stored', async () => {
    const userId = await createMember('name-member', 'name-member@example.test', 'name-password-0002');
    const bystanderId = await createMember('name-bystander', 'name-bystander@example.test', 'name-password-0003');
    const token = await signIn('name-member', 'name-password-0002');

    // The positive case first, so a suite of refusals cannot pass against something that
    // refuses everything.
    const named = await inject({ method: 'PATCH', url: '/users/me', token, payload: { first_name: 'Ada' } });
    expect(named.statusCode).toBe(200);
    // …and the response is the DATABASE's row, not the submitted body echoed back: the
    // last_name is still whatever the row held, and the twelve keys are the grant's.
    expect(Object.keys(named.json<Record<string, unknown>>()).sort()).toHaveLength(12);

    // A whitespace-only name is refused BY THE DATABASE (`users_last_name_not_blank`,
    // `0023:241`) and surfaced as a 422, not a 500. "The database refused a value" is a
    // validation answer about the member's own input; a 500 would report a server fault
    // for the most ordinary thing a person can get wrong on a form.
    const blank = await inject({ method: 'PATCH', url: '/users/me', token, payload: { last_name: '   ' } });
    expect(blank.statusCode).toBe(422);
    expect(blank.json<{ readonly message: string }>().message).toContain('whitespace');

    // A body naming somebody else's id is refused by the pipe (`forbidNonWhitelisted`),
    // and there is no parameter this route could be given to express "update user B"
    // anyway: the id comes from the verified token and from nowhere else.
    const smuggled = await inject({
      method: 'PATCH',
      url: '/users/me',
      token,
      payload: { first_name: 'Mallory', id: bystanderId },
    });
    expect(smuggled.statusCode).toBe(400);

    // …and the assertion that matters: the row is the actor's, and the other member's
    // row was never touched.
    const stored = await scalar<string>('SELECT first_name AS value FROM users WHERE id = $1', [userId]);
    expect(stored).toBe('Ada');
    expect(
      await scalar<string>('SELECT first_name AS value FROM users WHERE id = $1', [bystanderId]),
    ).toBeNull();
  });

  it('answers 422 for a body that names no column, rather than 200 over a write that did nothing', async () => {
    const token = await signIn('name-member', 'name-password-0002');
    const empty = await inject({ method: 'PATCH', url: '/users/me', token, payload: {} });
    expect(empty.statusCode).toBe(422);
    expect(empty.json<{ readonly message: string }>().message).toContain('nothing to change');
  });
});

// =============================================================================
// 3 + 4. THE ADDRESS CHANGE
// =============================================================================

describe('an address change does not move the address until the new mailbox has answered', () => {
  /**
   * THE TEST THAT THE WHOLE FEATURE EXISTS FOR.
   *
   * The unsafe implementation is one line: `UPDATE users SET email = $new`, then mail the
   * new address. It is an account takeover in two requests — repoint the account at a
   * mailbox the attacker controls, then request a password reset, and the reset link
   * arrives at the attacker. This case walks the sequence and asserts the state at every
   * step, on the DATABASE, because a test that only checked "the email changed after
   * confirming" would pass on the unsafe implementation too.
   */
  it('keeps the OLD address in force until redemption, so a reset requested in between reaches the real owner', async () => {
    const username = 'change-victim';
    const oldAddress = 'change-victim@example.test';
    const newAddress = 'attacker-owned@example.test';
    const password = 'change-password-0004';
    const userId = await createMember(username, oldAddress, password);
    const token = await signIn(username, password);

    // STEP 1 — the member asks for the new address.
    const accepted = await inject({
      method: 'POST',
      url: '/users/me/email',
      token,
      payload: { email: newAddress },
    });
    expect(accepted.statusCode).toBe(202);
    // `accepted: true` and NOTHING ELSE. A body echoing the pending address would invite
    // a client to render it as the account's own — the mistake the two-phase flow exists
    // to prevent.
    expect(accepted.json()).toEqual({ accepted: true });

    // STEP 2 — the address on file has NOT moved, and neither has its verification.
    expect(await emailOf(userId)).toBe(oldAddress);
    expect(await scalar('SELECT email_verified_at AS value FROM users WHERE id = $1', [userId])).toBeNull();

    // STEP 3 — the link went to the NEW address, not the old one. Asserted by reading
    // the message the real SMTP sink received, which is also the only way a test can
    // hold a token at all: the database stores an HMAC and there is no code path that
    // hands the raw value back.
    expect(sink.deliveries.some((delivery) => delivery.recipients.includes(newAddress))).toBe(true);
    const link = changeTokenFromMail(newAddress);
    expect(await outstandingChangeLinks(userId)).toBe(1);

    // STEP 4 — the attack the ordering defeats. A password reset requested NOW must go
    // to the OLD address, because `TokenService.deliver` looks the account up by the
    // address on file and that is still the owner's. This is the assertion that fails on
    // the naive implementation and on nothing else.
    const reset = await inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: oldAddress },
      ip: '198.51.100.71',
    });
    expect(reset.statusCode).toBe(202);
    expect(sink.deliveries.some((delivery) => delivery.recipients.includes(oldAddress))).toBe(true);
    expect(
      sink.deliveries.some((delivery) => delivery.recipients.includes(newAddress) && delivery.recipients.length > 1),
      'the new address received more than the one change message',
    ).toBe(false);

    // STEP 5 — redemption is the only thing that moves it, and the verification stamp is
    // set in the same statement because opening the link out of the new mailbox IS the
    // proof of control.
    const confirmed = await inject({
      method: 'POST',
      url: '/users/me/email/confirm',
      payload: { token: link },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toEqual({ status: 'email_changed' });

    expect(await emailOf(userId)).toBe(newAddress);
    expect(await scalar('SELECT email_verified_at AS value FROM users WHERE id = $1', [userId])).not.toBeNull();
    expect(await outstandingChangeLinks(userId)).toBe(0);

    // The old address's verification stamp did NOT carry over: it described a mailbox
    // mail no longer goes to, so keeping it would record a verified fact about the wrong
    // address. The column is single-valued, so this is the whole assertion.
    expect(await emailOf(userId)).not.toBe(oldAddress);
  });

  it('SUPERSEDES an outstanding request, so two links for two addresses cannot both be redeemed', async () => {
    const username = 'supersede-victim';
    const password = 'supersede-password-0005';
    const userId = await createMember(username, 'supersede-victim@example.test', password);
    const token = await signIn(username, password);

    const first = 'supersede-first@example.test';
    const second = 'supersede-second@example.test';

    await inject({ method: 'POST', url: '/users/me/email', token, payload: { email: first } });
    const firstLink = changeTokenFromMail(first);
    expect(await outstandingChangeLinks(userId)).toBe(1);

    await inject({ method: 'POST', url: '/users/me/email', token, payload: { email: second } });
    const secondLink = changeTokenFromMail(second);

    // The whole set, not just the newest: single-use is a statement about ONE link, so
    // the control has to be a statement about the set.
    expect(await outstandingChangeLinks(userId)).toBe(1);
    expect(firstLink).not.toBe(secondLink);

    // The older link is dead, and it is dead for the SAME reason a replay is: the token
    // was consumed by the supersede, so the redemption matches no row.
    const stale = await inject({
      method: 'POST',
      url: '/users/me/email/confirm',
      payload: { token: firstLink },
    });
    expect(stale.statusCode).toBe(422);
    expect(await emailOf(userId)).toBe('supersede-victim@example.test');

    // …and the newer one works, so the two failures above are the supersede and not a
    // token that was never good.
    expect(
      (await inject({ method: 'POST', url: '/users/me/email/confirm', payload: { token: secondLink } })).statusCode,
    ).toBe(200);
    expect(await emailOf(userId)).toBe(second);
  });

  it('keeps the two token flows apart, so neither route consumes the other\'s link', async () => {
    const username = 'flow-victim';
    const password = 'flow-password-0006';
    const userId = await createMember(username, 'flow-victim@example.test', password);
    const token = await signIn(username, password);

    // A real verification link for the CURRENT address.
    const verification = await inject({
      method: 'POST',
      url: '/auth/email-verification/request',
      payload: { email: 'flow-victim@example.test' },
      ip: '198.51.100.72',
    });
    expect(verification.statusCode).toBe(202);
    const verifyLink = changeTokenFromMail('flow-victim@example.test');
    // One live link: the verification one.
    expect(await allLiveLinks(userId)).toBe(1);
    expect(await outstandingChangeLinks(userId)).toBe(0);

    // And a real address-change link. Both rows carry `purpose = 'email_verification'`,
    // because `auth_tokens.purpose` is a three-value CHECK that cannot name a fourth kind
    // without a migration — so the two flows are separated by the token's FORMAT and by a
    // domain-separated subject instead, and THIS is the test that says the separation
    // works.
    //
    // Two live links now, and the supersede that just ran closed none of them: the change
    // token's subject is `email-change:<userId>` and the verification token's is the
    // lowercased address, so the two namespaces cannot meet. A supersede that reached the
    // verification link would be a member's own confirmation destroyed by asking for an
    // address change.
    await inject({
      method: 'POST',
      url: '/users/me/email',
      token,
      payload: { email: 'flow-new@example.test' },
    });
    const changeLink = changeTokenFromMail('flow-new@example.test');
    expect(await allLiveLinks(userId)).toBe(2);
    expect(await outstandingChangeLinks(userId)).toBe(1);

    // Presenting the change link at the VERIFICATION route must fail — and must not
    // consume it, or the pending change is destroyed by a request that was refused. The
    // primitive refuses a composite value in `isPlausibleRawToken`, before any digest is
    // computed, so it never reaches `authz.redeem_auth_token`.
    expect(
      (await inject({ method: 'POST', url: '/auth/email-verification/confirm', payload: { token: changeLink } })).statusCode,
    ).toBe(400);
    expect(await allLiveLinks(userId)).toBe(2);
    expect(await outstandingChangeLinks(userId)).toBe(1);

    // Presenting the verification link at the CHANGE route must fail too, and must not
    // consume it either: `readEmailChangeToken` refuses a value with no `ec1.` prefix, so
    // that route never reaches the primitive at all.
    expect(
      (await inject({ method: 'POST', url: '/users/me/email/confirm', payload: { token: verifyLink } })).statusCode,
    ).toBe(422);
    expect(await allLiveLinks(userId)).toBe(2);
    expect(await outstandingChangeLinks(userId)).toBe(1);

    // …and both still work through their own route, so the two failures are the flow
    // separation and not a token that was never good.
    expect(
      (await inject({ method: 'POST', url: '/auth/email-verification/confirm', payload: { token: verifyLink } })).statusCode,
    ).toBe(200);
    expect(await outstandingChangeLinks(userId)).toBe(1);
    expect(
      (await inject({ method: 'POST', url: '/users/me/email/confirm', payload: { token: changeLink } })).statusCode,
    ).toBe(200);
    expect(await outstandingChangeLinks(userId)).toBe(0);
    expect(await emailOf(userId)).toBe('flow-new@example.test');
  });

  it('refuses the address that is already on file, and one another live account holds', async () => {
    const username = 'collision-victim';
    const password = 'collision-password-0007';
    await createMember(username, 'collision-victim@example.test', password);
    await createMember('collision-other', 'collision-other@example.test', 'collision-password-0008');
    const token = await signIn(username, password);

    // A no-op request mints nothing and mails nothing. The address differs from the one on
    // file only in CASE, which `normalizePendingEmail` folds. It is NOT padded with
    // whitespace: `@IsEmail` refuses a padded address with a 400 before the service runs,
    // as `TokenRequestDto` does on the reset and verification routes, so a padded fixture
    // would be testing the format rule and not the "already on file" comparison.
    const same = await inject({
      method: 'POST',
      url: '/users/me/email',
      token,
      payload: { email: 'Collision-Victim@Example.Test' },
    });
    expect(same.statusCode).toBe(422);
    expect(same.json<{ readonly message: string }>().message).toContain('already the address on file');

    // Another live account's address is refused. `users.email` is NOT UNIQUE, so the
    // database would accept it — and `TokenService.deliver` resolves an address with
    // `LIMIT 1`, so two accounts on one mailbox make the reset link go to whichever row
    // the planner reaches first. Refusing keeps that subject unambiguous.
    const taken = await inject({
      method: 'POST',
      url: '/users/me/email',
      token,
      payload: { email: 'collision-other@example.test' },
    });
    expect(taken.statusCode).toBe(422);
    expect(taken.json<{ readonly message: string }>().message).toContain('already uses that address');
  });

  it('stores no rendered body for the address-change message, so a dump is not a list of live links', async () => {
    const username = 'no-body-victim';
    await createMember(username, 'no-body-victim@example.test', 'no-body-password-0009');
    const token = await signIn(username, 'no-body-password-0009');
    await inject({
      method: 'POST',
      url: '/users/me/email',
      token,
      payload: { email: 'no-body-target@example.test' },
    });
    changeTokenFromMail('no-body-target@example.test');

    // The stored `template` value is the ONLY place the audit trail distinguishes an
    // address-change message from a first-time verification one, because the `auth_tokens`
    // purpose cannot name the flow. So the row's identity is load-bearing here.
    const rows = superuserRows<{
      readonly rows: number;
      readonly bodies: number;
      readonly classes: string;
      readonly status: string;
    }>(
      `SELECT count(*)::int AS rows, count(body)::int AS bodies,
              min(content_class) AS classes, min(status) AS status
         FROM email_messages WHERE recipient = 'no-body-target@example.test' AND template = 'email_change'`,
    )[0];

    expect(rows?.rows, 'the attempt was not recorded at all').toBeGreaterThan(0);
    expect(rows?.status).toBe('sent');
    expect(rows?.classes).toBe('metadata_only');
    expect(rows?.bodies, 'a credential-bearing message stored a rendered body').toBe(0);
  });
});

// =============================================================================
// 5. POST /api/users/me/password
// =============================================================================

describe('a wrong current password must NOT be answered 401', () => {
  /**
   * The status code IS the design. `401` on this application means the bearer token was
   * refused, and the frontend's `authInterceptor` treats exactly that as the end of the
   * session: it clears the tokens and navigates to `/access-denied`. A `401` here would
   * sign the member out for mistyping their own password, and would make "your current
   * password is wrong" and "your session has ended" the same screen.
   */
  it('answers 422 for a wrong current password, and the session keeps working', async () => {
    const username = 'pw-victim';
    const password = 'pw-password-0010';
    const userId = await createMember(username, 'pw-victim@example.test', password);
    const token = await signIn(username, password);

    const wrong = await inject({
      method: 'POST',
      url: '/users/me/password',
      token,
      payload: { current_password: 'not-the-password', new_password: 'pw-chosen-0011' },
    });

    expect(wrong.statusCode).toBe(422);
    expect(wrong.statusCode).not.toBe(401);
    expect(wrong.json<{ readonly message: string }>().message).toContain('current password');

    // The load-bearing half: the SESSION IS STILL ALIVE. If this route had answered 401,
    // the interceptor would have cleared the tokens and sent the browser to
    // /access-denied — so the proof that the mistake did not end the session is a
    // subsequent authenticated call, not the status code.
    expect((await inject({ method: 'GET', url: '/auth/me', token })).statusCode).toBe(200);
    // …and the password did not change.
    expect((await inject({ method: 'POST', url: '/auth/login', payload: { username, password }, ip: '198.51.100.73' })).statusCode).toBe(200);

    // The positive case, so a suite of refusals cannot pass against a route that refuses
    // everything.
    const changed = await inject({
      method: 'POST',
      url: '/users/me/password',
      token,
      payload: { current_password: password, new_password: 'pw-chosen-0012' },
    });
    expect(changed.statusCode).toBe(204);
    expect(changed.body).toBe('');

    // And every session died, INCLUDING the one that made the change. That is the
    // decision, not an accident: this is the route a member reaches BECAUSE something is
    // wrong with their account, so the session making the request is the one most likely
    // to be the attacker's. The count is the audit trail `logout` and the reset path
    // also write.
    //
    // Counted HERE, before the sign-ins below, because a successful sign-in with the new
    // password mints a fresh refresh token: counted afterwards, "zero live sessions"
    // would be asserting that the test's own new session does not exist.
    expect(await count('SELECT count(*)::int AS value FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL', [userId])).toBe(0);
    expect(await count('SELECT count(*)::int AS value FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NOT NULL', [userId])).toBeGreaterThanOrEqual(1);

    // The new password is the one that works and the old one is not.
    expect((await inject({ method: 'POST', url: '/auth/login', payload: { username, password }, ip: '198.51.100.73' })).statusCode).toBe(401);
    expect((await inject({ method: 'POST', url: '/auth/login', payload: { username, password: 'pw-chosen-0012' }, ip: '198.51.100.73' })).statusCode).toBe(200);
  });

  it('refuses an empty current_password with the same 422, so one mistake has one answer', async () => {
    const username = 'pw-empty';
    await createMember(username, 'pw-empty@example.test', 'pw-empty-password-0013');
    const token = await signIn(username, 'pw-empty-password-0013');

    const empty = await inject({
      method: 'POST',
      url: '/users/me/password',
      token,
      payload: { current_password: '', new_password: 'pw-chosen-0014' },
    });
    // A `MinLength(1)` on the DTO would have answered 400 here, which on a route whose
    // response IS the feedback is a second answer for the same mistake.
    expect(empty.statusCode).toBe(422);
    expect((await inject({ method: 'GET', url: '/auth/me', token })).statusCode).toBe(200);
  });
});

// =============================================================================
// 6. GET /api/users/me/login-attempts
// =============================================================================

describe('a member sees their OWN sign-in history and nobody else\'s', () => {
  it('returns the caller\'s rows, newest first, and no other account\'s', async () => {
    const username = 'history-member';
    const password = 'history-password-0015';
    await createMember(username, 'history-member@example.test', password);
    await createMember('history-bystander', 'history-bystander@example.test', 'history-password-0016');
    const token = await signIn(username, password);

    // A failed attempt against this member, so the history is not one row of one kind, and
    // one against somebody else, plus one against a username that DOES NOT EXIST — the
    // rows §2 says must still be recorded, because an invalid username is both an attack
    // signal and a debugging aid.
    await inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username, password: 'wrong-password-0017' },
      ip: '198.51.100.80',
    });
    await inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'history-bystander', password: 'wrong-password-0018' },
      ip: '198.51.100.81',
    });
    await inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'no-such-account-anywhere', password: 'wrong-password-0019' },
      ip: '198.51.100.82',
    });

    // The ground truth, read through the boundary the application uses: the ids of every
    // row keyed on this member's username. §B8's rule is that a status-only assertion
    // passes on a real leak, so the comparison below is MEMBERSHIP, not a count.
    const mine = await attemptIdsFor(username);
    const others = await attemptIdsFor('history-bystander');
    const ghosts = await attemptIdsFor('no-such-account-anywhere');
    expect(mine.length, 'the fixture recorded no attempts for this member').toBeGreaterThanOrEqual(2);
    expect(others.length, 'the fixture recorded no attempts for the bystander').toBeGreaterThan(0);
    expect(ghosts.length, 'the fixture recorded no attempt against a username that does not exist').toBeGreaterThan(0);

    const response = await inject({ method: 'GET', url: '/users/me/login-attempts', token });
    expect(response.statusCode).toBe(200);
    const rows = response.json<readonly Record<string, unknown>[]>();

    // The shape, exactly — six fields, which is what `ProfileLoginAttempt` is a `Pick` of
    // out of the generated schema. `username` is not among them and cannot be: the
    // endpoint filters on it, so returning it would be the caller's own name repeated on
    // every row.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'attempt_kind',
        'created_at',
        'id',
        'ip',
        'ip_subnet',
        'status',
      ]);
    }

    // EVERY returned row is one of this member's, and EVERY one of this member's is
    // returned. Asserted in both directions, because one of the two leaks is invisible to
    // the other.
    const returned = rows.map((row) => String(row['id']));
    expect([...returned].sort()).toEqual([...mine].sort());
    // …and nothing that belongs to somebody else, or to a name that is not an account.
    for (const id of [...others, ...ghosts]) {
      expect(returned, `attempt ${id} belongs to another subject`).not.toContain(id);
    }

    // Newest first. `ORDER BY created_at DESC, id DESC` — and `id` is `uuidv7()`, so the
    // tie-break is minting time rather than an arbitrary tie.
    const times = rows.map((row) => Date.parse(String(row['created_at'])));
    expect(times).toEqual([...times].sort((a, b) => b - a));

    // The failed attempt is here, labelled as a failed LOGIN, so a member looking at this
    // page can see that something guessed their password.
    expect(
      rows.some((row) => row['status'] === 'failed' && row['attempt_kind'] === 'login'),
    ).toBe(true);
  });

  it('matches by USERNAME because login_attempts has no user_id, and does not fragment', () => {
    // The absence reads like an oversight and is the design: an attempt against a username
    // that does not exist still has to be recorded, so the ledger is UNSCOPED and keyed by
    // username (`0002:86-101`). What makes that safe for a member's own history is
    // `authz.guard_username_immutable` — the column cannot change except through the
    // erasure rewrite, which rewrites the attempts too.
    const columns = superuserRows<{ readonly column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'login_attempts'`,
    ).map((row) => row.column_name);
    expect(columns).not.toContain('user_id');
    expect(columns).toEqual(
      expect.arrayContaining(['id', 'username', 'ip', 'ip_normalized', 'ip_subnet', 'status', 'attempt_kind', 'created_at']),
    );

    const trigger = superuserRows<{ readonly tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.users'::regclass AND NOT tgisinternal`,
    ).map((row) => row.tgname);
    expect(trigger).toContain('users_guard_username_immutable');
  });

  it('is refused without a token, and the table itself is unreachable by a member over the API layer', async () => {
    // The grant is the reason this endpoint reads elevated. `0022:63-72`: grant a member
    // `SELECT` on `login_attempts` and they can enumerate which accounts exist by watching
    // for failed rows — an account-enumeration oracle built out of the security log.
    expect((await inject({ method: 'GET', url: '/users/me/login-attempts' })).statusCode).toBe(401);

    // Asserted from the LIVE CATALOG rather than from a comment, because PostgREST serves
    // `login_attempts` with `openapi-mode = "ignore-privileges"`: the relation is
    // ADDRESSABLE in the served spec regardless of grants, so a grant would make it a
    // working endpoint rather than a documented one.
    const privilege = superuserRows<{ readonly readable: boolean }>(
      "SELECT has_table_privilege('app_member', 'public.login_attempts', 'SELECT') AS readable",
    )[0];
    expect(privilege?.readable).toBe(false);
  });
});

// =============================================================================
// 7. POST /api/users
// =============================================================================

describe('creating an account is an administrator action, and it creates a COMPLETE one', () => {
  it('refuses a member, and the database would refuse the row even if this did not', async () => {
    await createMember('creator-member', 'creator-member@example.test', 'creator-password-0020');
    const memberToken = await signIn('creator-member', 'creator-password-0020');

    const refused = await inject({
      method: 'POST',
      url: '/users',
      token: memberToken,
      payload: {
        username: 'member-made-this',
        email: 'member-made-this@example.test',
        password: 'made-up-0021',
        role: 'member',
        group: 'EU',
      },
    });

    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ readonly message: string }>().message).toContain('administrator');
    expect(await count("SELECT count(*)::int AS value FROM users WHERE username = 'member-made-this'")).toBe(0);

    // The refusal is a fast answer, not the boundary. The boundary is the schema:
    // `users_insert` is `WITH CHECK (current_user = 'app_admin')` and `GRANT INSERT ON
    // users` names only `app_admin`. Asserted from the live catalog so the argument does
    // not rest on this file's own reading of two migrations. `pg_policies` has no
    // `definition` column: an INSERT policy has no `USING`, so its whole predicate is
    // `with_check`.
    const policy = superuserRows<{ readonly definition: string }>(
      "SELECT with_check AS definition FROM pg_policies WHERE tablename = 'users' AND policyname = 'users_insert'",
    )[0]?.definition;
    expect(policy).toContain('app_admin');
    const grant = superuserRows<{ readonly may_insert: boolean }>(
      "SELECT has_table_privilege('app_admin', 'public.users', 'INSERT') AS may_insert",
    )[0];
    expect(grant?.may_insert).toBe(true);
  });

  it('refuses a body that names no role or group, because the account it would make cannot read itself', async () => {
    const adminToken = await signIn('admin', SEED_PASSWORD);

    // `400`, not `422`: the global pipe runs `forbidNonWhitelisted` and `@IsString()` is
    // false for an absent field, and the distinction from the `422` below is the point —
    // a `422` would say "we understood you and refused the content", which is not what a
    // missing required field is.
    for (const incomplete of [
      { username: 'no-authority-0025', email: 'no-authority-0025@example.test', password: 'created-password-0025' },
      {
        username: 'half-authority-0025',
        email: 'half-authority-0025@example.test',
        password: 'created-password-0026',
        role: 'member',
      },
    ]) {
      const refused = await inject({ method: 'POST', url: '/users', token: adminToken, payload: incomplete });
      expect(refused.statusCode, `${JSON.stringify(incomplete)} was accepted`).toBe(400);
      expect(
        await count(`SELECT count(*)::int AS value FROM users WHERE username = '${incomplete.username}'`),
        `${incomplete.username} was created despite the refusal`,
      ).toBe(0);
    }

    // An authority that DOES NOT EXIST is a `422` naming it, not a `500` from the foreign
    // key. A `uuid` would have made that failure silent; a name makes it a sentence.
    const unknownRole = await inject({
      method: 'POST',
      url: '/users',
      token: adminToken,
      payload: {
        username: 'unknown-role-0025',
        email: 'unknown-role-0025@example.test',
        password: 'created-password-0027',
        role: 'there-is-no-such-role',
        group: 'EU',
      },
    });
    expect(unknownRole.statusCode).toBe(422);
    expect(unknownRole.json<{ readonly message: string }>().message).toContain('there is no role named');
    expect(await count("SELECT count(*)::int AS value FROM users WHERE username = 'unknown-role-0025'")).toBe(0);

    const unknownGroup = await inject({
      method: 'POST',
      url: '/users',
      token: adminToken,
      payload: {
        username: 'unknown-group-0025',
        email: 'unknown-group-0025@example.test',
        password: 'created-password-0028',
        role: 'member',
        group: 'there-is-no-such-group',
      },
    });
    expect(unknownGroup.statusCode).toBe(422);
    expect(unknownGroup.json<{ readonly message: string }>().message).toContain('there is no group named');
    expect(await count("SELECT count(*)::int AS value FROM users WHERE username = 'unknown-group-0025'")).toBe(0);
  });

  it('creates the account for an administrator, refuses a duplicate username, and the new account can read its own profile', async () => {
    const adminToken = await signIn('admin', SEED_PASSWORD);

    const created = await inject({
      method: 'POST',
      url: '/users',
      token: adminToken,
      payload: {
        username: 'created-by-admin',
        email: 'Created-By-Admin@Example.Test',
        password: 'created-password-0022',
        first_name: 'Grace',
        role: 'member',
        group: 'EU',
      },
    });

    expect(created.statusCode).toBe(201);
    const body = created.json<Record<string, unknown>>();
    // Six fields — not the twelve of `UserProfileDto`, because this route creates the row
    // and `GET /users/me` is the creator's OWN row. A client that reused one shape for
    // both would be asserting they are the same account, and for a newly created account
    // they are not. `role` and `group` are INPUT, not output: they are names the route
    // resolved, and echoing them back would be a second copy of the caller's own request
    // rather than a statement about what the database stored.
    expect(Object.keys(body).sort()).toEqual(['created_at', 'email', 'first_name', 'id', 'last_name', 'username']);
    expect(body['username']).toBe('created-by-admin');
    // The address is stored NORMALISED, and the response reports what the database
    // stored rather than what the caller sent — `TokenService.deliver` matches on
    // `lower(email)`, so two spellings of one mailbox is one more thing its `LIMIT 1` has
    // to be lucky about.
    expect(body['email']).toBe('created-by-admin@example.test');
    expect(body['first_name']).toBe('Grace');
    expect(body['last_name']).toBeNull();
    expect(typeof body['created_at']).toBe('string');

    const userId = String(body['id']);
    // The password is real: it is hashed at the login path's cost and the login works.
    expect(
      (await inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'created-by-admin', password: 'created-password-0022' },
        ip: '198.51.100.90',
      })).statusCode,
    ).toBe(200);
    // A bcrypt hash is `$2b$12$<salt+digest>`: field 2 of a `$` split is the algorithm
    // (`2b`), field 3 is the cost.
    expect(
      await scalar<number>("SELECT split_part(password_hash, '$', 3)::int AS value FROM users WHERE id = $1", [userId]),
    ).toBe(12);

    // A duplicate USERNAME is a 422: `users.username` is UNIQUE (`0002:31`), and a
    // constraint refusing a value is a validation answer rather than a server fault.
    const duplicate = await inject({
      method: 'POST',
      url: '/users',
      token: adminToken,
      payload: {
        username: 'created-by-admin',
        email: 'somewhere-else@example.test',
        password: 'created-password-0023',
        role: 'member',
        group: 'EU',
      },
    });
    expect(duplicate.statusCode).toBe(422);
    expect(duplicate.json<{ readonly message: string }>().message).toContain('username is already taken');

    // A duplicate ADDRESS is ALLOWED, and that is deliberate rather than an oversight:
    // `users.email` is NOT NULL and NOT UNIQUE. The route does not invent a rule the
    // schema does not have — and it does not add one either, because a route that refuses
    // duplicates it has no basis to refuse is a new policy; a migration adding the
    // constraint is what settles that.
    const sharedAddress = await inject({
      method: 'POST',
      url: '/users',
      token: adminToken,
      payload: {
        username: 'created-with-shared-address',
        email: 'created-by-admin@example.test',
        password: 'created-password-0024',
        role: 'member',
        group: 'EU',
      },
    });
    expect(sharedAddress.statusCode).toBe(201);

    // …AND THE COMPLETION IS ASSERTED, NOT MERELY PROMISED.
    //
    // §B2's invariant is "every user has at least one role and at least one group". Nothing
    // was invented to fill it — an account silently holding `admin` would be a security
    // decision made by a route whose job is to make a row, which is why `role` and `group`
    // are REQUIRED on the body and resolved against the live tables before the row is
    // written. So this account holds exactly what the caller asked for and nothing more.
    expect(await count('SELECT count(*)::int AS value FROM user_roles WHERE user_id = $1', [userId])).toBe(1);
    expect(await count('SELECT count(*)::int AS value FROM user_groups WHERE user_id = $1', [userId])).toBe(1);

    // …and it names the authority it was given, so a `201` cannot be a `201` for an account
    // holding something other than what was asked for. Read through the admin boundary,
    // which is the only identity holding `SELECT` on `user_roles` — a member holds none,
    // and that absence is the control which stops a member widening their own scope.
    const conferred = await withAdminClient(async (client) => {
      const result = await client.query<{ readonly role: string; readonly group_name: string }>(
        `SELECT r.name AS role, g.name AS group_name
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           JOIN user_groups ug ON ug.user_id = ur.user_id
           JOIN groups g ON g.id = ug.group_id
          WHERE ur.user_id = $1`,
        [userId],
      );
      return result.rows;
    });
    expect(conferred).toEqual([{ role: 'member', group_name: 'EU' }]);

    // THE CONSEQUENCE, which is the whole point: the created account signs in and reads its
    // OWN profile. Before this change it read ZERO rows and answered 404, because
    // `users_read_scope` requires `authz.can_read_user()` and that is false with no
    // `user_roles` row — a success-shaped 201 for an account that could do nothing.
    const createdToken = await signIn('created-by-admin', 'created-password-0022');
    const ownProfile = await inject({ method: 'GET', url: '/users/me', token: createdToken });
    expect(ownProfile.statusCode, `the created account could not read itself: ${ownProfile.body}`).toBe(200);
    expect(ownProfile.json<{ readonly id: string; readonly first_name: string }>()).toMatchObject({
      id: userId,
      first_name: 'Grace',
    });
  });
});

// =============================================================================
// The suite is looking at real mail and a real API layer
// =============================================================================

describe('the suite is looking at real mail and a real PostgREST, not a construction', () => {
  it('delivered every message it claims to have, and no delivery failed', () => {
    // Without this, `changeTokenFromMail` could be passing on a suite in which the send
    // quietly failed and the sink kept an older message — the token would then belong to a
    // different case and every assertion above would be about the wrong link.
    expect(sink.errors).toEqual([]);
    expect(sink.deliveries.length).toBeGreaterThan(5);
    expect(
      superuserRows<{ readonly value: number }>(
        "SELECT count(*)::int AS value FROM email_messages WHERE status = 'failed'",
      )[0]?.value,
    ).toBe(0);
  });

  it('started a PostgREST that is still serving, because every profile read went through it', () => {
    // `UsersService.me` throws `PostgrestUnavailableError` when PostgREST cannot be
    // reached, so the `200`s above already prove it answered — this asserts that the
    // process is the one this suite started rather than something that appeared on the
    // port in between.
    expect(postgrest.baseUrl).toBe(`http://127.0.0.1:${String(POSTGREST_PORT)}`);
    expect(postgrest.log()).not.toContain('PGRST301');
  });
});
