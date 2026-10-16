import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Client } from 'pg';
import type * as ThrottleModule from '../../src/auth/throttle.js';
import { startSmtpSink, type SmtpSink } from '../../scripts/smtp-sink.js';
import { parseSmtpMessage } from '../../scripts/smtp-message.js';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * Password reset and address verification, proven against the whole pipeline: a
 * real seed (which applies the migrations), the real Nest app, real Postgres
 * writes, and a **real SMTP server** that the delivered link is then read back out
 * of. Throwaway database (`password_reset_e2e`), same discipline as
 * `login.e2e-spec.ts`.
 *
 * ## Why the mail is read rather than bypassed
 *
 * The token is never stored — `auth_tokens.token_hash` is an HMAC, and there is no
 * code path that hands the raw value back. So the only way a test can hold a
 * working token is to read the link out of a message a real server received, which
 * is also the only way to prove the link **in the mail** is the link that works. A
 * test that reached past the mail and minted its own token would pass against a
 * broken URL builder.
 *
 * ## What this suite is really asserting
 *
 * §B8 asks for the attack in the test name, and the attacks here are:
 *
 * | case | the defect it would miss |
 * |---|---|
 * | registered vs unregistered: identical status, body and floor | the route is a user-enumeration service |
 * | the throttle trips at the same request number for both | the rate limit is the *better* oracle |
 * | a reset-request flood does not spend a login's delay budget | five requests lock an office out of sign-in |
 * | a valid link changes the password and the new one works | a 200 over a reset that did nothing |
 * | a second use is refused exactly as an expired one is | the link is single-use *and* the refusal does not say which |
 * | a password-reset link is refused by the verification route | purpose separation is a comment |
 *
 * ## Timing, and why almost nothing here is asserted against a clock
 *
 * `login.e2e-spec.ts` and `brute-force.e2e-spec.ts` both record the wall-clock
 * lesson: a bcrypt cost-12 compare is ~324 ms idle and over a second on a loaded
 * machine, so any assertion of the shape "took less than X" measures the box rather
 * than the code. So the two timing claims here are stated as **lower bounds against
 * `SECURITY_ENUMERATION_FLOOR_MS`** — a value this suite pins and the code applies
 * unconditionally — and the throttle claims are asserted on the DECISION the pure
 * function made, recorded by the same `vi.mock` wrapper `brute-force.e2e-spec.ts`
 * uses, which delegates to the real function so no request's latency changes.
 */

const TEST_DB = 'password_reset_e2e';
const SEED_PASSWORD = 'seed-test-password-123';
const TEST_JWT_SECRET = 'password-reset-e2e-signing-secret-0123456789abcd';
const PROOF_TIMEOUT = 600_000;

/**
 * The enumeration floor, pinned rather than defaulted: the assertions read this
 * number, so reading the default instead would let the default and the assertion
 * move together.
 */
const FLOOR_MS = 250;
/**
 * A two-bucket delay schedule. Short enough not to dominate the suite, long enough
 * that a decision of `0` and a decision of `1000` are distinguishable by the
 * recorder — which is the whole discrimination the isolation case needs.
 */
const DELAY_SCHEDULE_SECONDS = '0,1';
const BLOCK_THRESHOLD = '5';

const AUTHENTICATOR_PASSWORD = loadTestEnvironment().authenticator.password;

loadTestEnvironment();

/**
 * Records how long a delay the gate DECIDED to impose — the technique from
 * `brute-force.e2e-spec.ts`, kept because it is the only way to observe the gate's
 * decision without a clock. Delegates to the real function, so nothing about a
 * request's latency changes.
 */
const delayStats = vi.hoisted(() => ({ decided: [] as number[] }));

vi.mock('../../src/auth/throttle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ThrottleModule>();
  const realDelayForFailures = actual.delayForFailures;
  return {
    ...actual,
    delayForFailures: (failures: number, schedule: readonly number[], capSeconds: number): number => {
      const decided = realDelayForFailures(failures, schedule, capSeconds);
      delayStats.decided.push(decided);
      return decided;
    },
  };
});

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

function recreateDatabase(name: string): void {
  const devDb = databaseConfig().database;
  if (name === devDb || name === 'app_dev') {
    throw new Error(`refusing to run the password-reset e2e against the development database (${name})`);
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

/**
 * Three readers for this suite's assertions:
 *
 * 1. `auth_tokens` is unreadable through the application boundary (`0018` §2
 *    revokes all from serving roles), but its table has no FORCE RLS, so it is
 *    read through **the owner role** (`withOwnerClient`), matching
 *    `test/rls/auth-tokens.spec.ts`.
 *
 * 2. `email_messages` has `FORCE ROW LEVEL SECURITY` (`0005` line 263) and its
 *    `email_read_scope` policy has no `current_user = 'app_admin'` branch
 *    (test/rls/email-messages.spec.ts:1236). Reading as the boundary admin with no
 *    claims applies `visible_user_ids()` to a NULL actor and sees nothing — a
 *    correct denial under RLS, but not what an audit assertion is measuring. And
 *    under FORCE RLS, the owner is bound too. Ground truth on `email_messages`
 *    therefore goes through **superuser** (`superuserRows`), exactly as every
 *    assertion in `test/rls/email-messages.spec.ts` does.
 *
 * 3. Everything else this suite reads (`users`, `refresh_tokens`, `login_attempts`)
 *    has `current_user = 'app_admin'` in its policy and is granted to `app_admin`
 *    in full, so it goes through the boundary the server itself uses
 *    (`withAdminClient`).
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

/** For `auth_tokens` only — see the note above. */
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
    const result = await client.query<{ value: T }>(sql, values as unknown[]);
    return result.rows[0]?.value;
  });
}

async function count(sql: string, values: readonly unknown[] = []): Promise<number> {
  return (
    (await scalar<number>(sql, values)) ?? 0
  );
}

/** `auth_tokens` counts, through the owner. Named so the reader cannot mistake it for the boundary path. */
async function tokenCount(sql: string, values: readonly unknown[] = []): Promise<number> {
  return withOwnerClient(async (client) => {
    const result = await client.query<{ value: number }>(sql, values as unknown[]);
    return result.rows[0]?.value ?? 0;
  });
}

let app: NestFastifyApplication;
let moduleRef: TestingModule;
let sink: SmtpSink;

beforeAll(async () => {
  recreateDatabase(TEST_DB);
  const seed = runSeed(TEST_DB);
  if (seed.status !== 0) {
    throw new Error(`seed failed:\n${seed.stdout}\n${seed.stderr}`);
  }

  sink = await startSmtpSink({ port: 0 });

  process.env['DB_NAME'] = TEST_DB;
  process.env['JWT_SECRET'] = TEST_JWT_SECRET;
  process.env['PGRST_JWT_SECRET'] = TEST_JWT_SECRET;
  process.env['AUTHENTICATOR_PASSWORD'] = AUTHENTICATOR_PASSWORD;
  // A real sink on a real port, so the mail this suite reads is mail a server took.
  process.env['EMAIL_HOST'] = sink.host;
  process.env['EMAIL_PORT'] = String(sink.port);
  process.env['EMAIL_SECURE'] = 'false';
  process.env['SECURITY_DELAY_SCHEDULE_SECONDS'] = DELAY_SCHEDULE_SECONDS;
  process.env['SECURITY_BLOCK_THRESHOLD'] = BLOCK_THRESHOLD;
  process.env['SECURITY_ENUMERATION_FLOOR_MS'] = String(FLOOR_MS);
  // Empty, so no source address in this suite is exempt from the gate — an
  // allowlisted row carries NULL canonical keys and would never be counted.
  process.env['SECURITY_IP_ALLOWLIST'] = '';
  vi.resetModules();

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
    await app?.close();
    await moduleRef?.close();
  } finally {
    // `database/seed.ts` runs a CLUSTER-scoped `ALTER ROLE … PASSWORD`, so the
    // cluster is only restored once this runs — and it must run even when closing
    // the app throws, because a suite that dies in teardown is exactly when the
    // cluster would be left behind.
    restoreAuthenticatorPassword();
  }
});

// =============================================================================
// Helpers
// =============================================================================

function post(url: string, payload: Record<string, unknown>, remoteAddress: string) {
  return app.inject({ method: 'POST', url, payload, remoteAddress });
}

const requestReset = (email: string, ip: string) => post('/auth/password-reset/request', { email }, ip);
const requestVerification = (email: string, ip: string) =>
  post('/auth/email-verification/request', { email }, ip);
const confirmReset = (token: string, password: string) =>
  post('/auth/password-reset/confirm', { token, password }, '198.51.100.99');
const confirmVerification = (token: string) =>
  post('/auth/email-verification/confirm', { token }, '198.51.100.99');
const loginAs = (username: string, password: string, ip: string) =>
  post('/auth/login', { username, password }, ip);

/**
 * A user this suite owns, with a password it knows.
 *
 * **Not the seeded `admin`.** These cases change a password and kill sessions, and
 * doing that to the account the brute-force and login suites share would couple three
 * files through a mutable fixture — the second one to run would fail for a reason
 * that has nothing to do with it. The insert goes through the same
 * authenticator + `SET ROLE app_admin` boundary the application uses, so a fixture
 * that could not be written in production fails here too.
 */
async function createUser(username: string, email: string, password: string): Promise<string> {
  const bcrypt = (await import('bcrypt')).default;
  return withAdminClient(async (client) => {
    const result = await client.query<{ id: string }>(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [username, email, await bcrypt.hash(password, 12)],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error(`the fixture for ${username} was not created`);
    }
    return id;
  });
}

/**
 * The token out of the link the mail actually carried, read from the **last**
 * message the sink received for this recipient.
 *
 * Read from the `text/plain` part the sink took, so the assertion is on the bytes a
 * mail client would show. A test that reached past the mail and minted its own token
 * would pass against a broken URL builder.
 *
 * **Synchronous, and the sink has already recorded the message by the time the
 * request returns.** `smtp-server` pushes the delivery inside `onData`'s `end`
 * handler and only then calls back, which is what makes it send the final `250` —
 * and nodemailer does not resolve until that `250` arrives. So `deliver()` cannot
 * have returned before the message is in the array, and "last match" is a fact rather
 * than a race. `waitForDelivery` exists for the case where it is not; this is not it.
 */
function tokenFromMail(recipient: string): string {
  const mine = sink.deliveries.filter((delivery) => delivery.recipients.includes(recipient));
  const last = mine[mine.length - 1];
  if (last === undefined) {
    throw new Error(
      `no message reached the sink for ${recipient}; it accepted ${String(sink.deliveries.length)}. ` +
        'This is a delivery that never arrived, not a message that was refused.',
    );
  }
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(parseSmtpMessage(last.raw).text);
  const token = match?.[1];
  if (token === undefined) {
    throw new Error(`the message to ${recipient} carried no token link`);
  }
  return decodeURIComponent(token);
}

/**
 * An expired token, inserted directly with its `expires_at` in the past.
 *
 * **Written through the owner, not the boundary.** `app_admin` holds no privileges
 * on `auth_tokens` at all — `0018` revoked them and routes every mutation through an
 * `authz` function — so this is a row the application deliberately cannot create
 * directly. The alternative, `authz.mint_auth_token` with a one-second TTL, would
 * put a `sleep(1100)` in the suite to reach a state the row states outright:
 * `redeem_auth_token`'s predicate is `expires_at > clock_timestamp()`.
 *
 * **The pepper is read from the test environment** because `token_hash` is the
 * domain-separated HMAC and there is no other way to construct a row the primitive
 * will match. That is a test reproducing one line of production arithmetic, not a
 * test reaching into the service — and it is the only way to fabricate the state
 * under test without waiting.
 */
async function insertExpiredResetToken(userId: string): Promise<string> {
  const pepper = process.env['AUTH_TOKEN_PEPPER'];
  if (pepper === undefined || pepper === '') {
    throw new Error('AUTH_TOKEN_PEPPER is not set; the test environment is unusable');
  }
  const raw = randomBytes(32).toString('base64url');
  const hash = createHmac('sha256', pepper).update(`auth.token.hash.v1:${raw}`).digest();

  await withOwnerClient(async (client) => {
    await client.query(
      `INSERT INTO public.auth_tokens (user_id, subject_hmac, pepper_kid, token_hash, purpose, expires_at)
       VALUES ($1, decode(repeat('00', 32), 'hex'), $2, $3, 'password_reset', now() - interval '1 minute')`,
      [userId, process.env['AUTH_TOKEN_PEPPER_KID'] ?? 'test-v1', hash],
    );
  });
  return raw;
}

/** The largest delay the gate decided for one request, read from the recorder. */
function largestDecision(): number {
  return delayStats.decided.length === 0 ? 0 : Math.max(...delayStats.decided);
}

// =============================================================================
// THE ENUMERATION PROPERTY
// =============================================================================

describe('a request for a registered address must be indistinguishable from one for an empty mailbox', () => {
  it('answers both with the same status and the same body, and the empty one still pays the floor', async () => {
    const registered = 'enumeration-hit@example.test';
    const empty = 'enumeration-nobody@example.test';
    const userId = await createUser('enumeration-hit', registered, 'irrelevant-password-0001');
    const ip = '198.51.100.1';

    const hit = await requestReset(registered, ip);
    const miss = await requestReset(empty, ip);

    // The body, asserted rather than the status alone: §B8's rule is that a
    // status-only assertion passes on a real leak, and `202` is exactly the status a
    // leak would wear. The two bodies must be the same OBJECT.
    expect(miss.statusCode).toBe(hit.statusCode);
    expect(miss.json()).toEqual(hit.json());
    expect(miss.json()).toEqual({ status: 'accepted' });
    expect(miss.headers['content-type']).toBe(hit.headers['content-type']);

    // The floor is a LOWER BOUND on both, never a ceiling, and never a comparison
    // between the two — a load-dependent "these are within X of each other" is the
    // assertion `login.e2e-spec.ts` and `brute-force.e2e-spec.ts` both had to remove.
    // What it proves is that the code applied `SECURITY_ENUMERATION_FLOOR_MS` on the
    // path where nothing else happened, which is the only branch that can be fast.
    // A different address, so this measures the miss path and not a repeat.
    const secondMiss = 'enumeration-second-miss@example.test';
    const startedMiss = Date.now();
    const timedMiss = await requestReset(secondMiss, ip);
    expect(timedMiss.statusCode).toBe(202);
    expect(Date.now() - startedMiss).toBeGreaterThanOrEqual(FLOOR_MS);

    // …and that the empty answer did strictly LESS work. Scoped to the fixture user
    // and to the never-attributed rows rather than to the whole table, so this
    // stays true whatever order the cases in this file happen to run in: exactly one
    // token exists for the registered address, and no token was ever minted without
    // a subject — which is the row population a miss would have had to add.
    expect(await tokenCount('SELECT count(*)::int AS value FROM auth_tokens WHERE user_id = $1', [userId])).toBe(1);
    expect(await tokenCount('SELECT count(*)::int AS value FROM auth_tokens WHERE user_id IS NULL')).toBe(0);
  });

  it('never puts the token, an identifier or a timestamp in the response', async () => {
    // One field, one value. Named here because it is the property a single
    // well-meaning field destroys, and because the e2e is where "the body is
    // identical" is checked against real bytes rather than a constructed object.
    const response = await requestReset('enumeration-hit@example.test', '198.51.100.1');
    const serialised = JSON.stringify(response.json<Record<string, unknown>>());

    expect(Object.keys(response.json<Record<string, unknown>>())).toEqual(['status']);
    for (const forbidden of ['token', 'tokenId', 'expiresAt', 'recipient', 'email', 'userId']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('refuses a malformed address with a 400 that is a statement about format only', async () => {
    // The one asymmetry the route has, and it is safe: every registered address is a
    // well-formed one, so the 400 partitions the input space by shape and never by
    // existence. A CRLF address is refused here rather than reaching a header parser.
    const garbage = await requestReset('not-an-address', '198.51.100.1');
    const injected = await requestReset('victim@example.test\nBcc: attacker@evil.test', '198.51.100.1');

    expect(garbage.statusCode).toBe(400);
    expect(injected.statusCode).toBe(400);
    expect(sink.deliveries.some((delivery) => delivery.recipients.includes('attacker@evil.test'))).toBe(false);
  });
});

// =============================================================================
// THE RATE LIMIT
// =============================================================================

describe('an unbounded reset endpoint is an email-bombing tool', () => {
  it('reaches the block threshold at the same request number for a registered address and an empty one', async () => {
    // The oracle this closes: a rate limit keyed on accounts is the MOST reliable
    // enumeration signal on the route, because only a registered address ever
    // accumulates a count. `AuthService.gate` therefore counts ROWS and runs before
    // any lookup, so both sequences walk the same ladder and `429` says only "you
    // have asked too often".
    const registered = 'throttle-hit@example.test';
    const empty = 'throttle-nobody@example.test';
    await createUser('throttle-hit', registered, 'irrelevant-password-0002');

    // Two subnets, so the two sequences cannot contaminate each other's IP axis. Each
    // has its own subject as well, which is why a sequence's own history is the only
    // thing it reads.
    const drive = async (email: string, ip: string) => {
      const statuses: number[] = [];
      delayStats.decided.length = 0;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        statuses.push((await requestReset(email, ip)).statusCode);
      }
      return { statuses, decisions: [...delayStats.decided] };
    };

    const hit = await drive(registered, '198.51.100.20');
    const miss = await drive(empty, '198.51.100.21');

    expect(hit.statuses).toEqual([202, 202, 202, 202, 202, 429]);
    expect(miss.statuses).toEqual(hit.statuses);

    // The decisions, element for element. `delayForFailures` is pure, so this is a
    // comparison of two pure functions over two equal counters — no clock anywhere,
    // and a stronger statement than the status list because it also pins the DELAY
    // ladder, which a status list cannot see.
    expect(miss.decisions).toEqual(hit.decisions);
    // Positive control on the recorder: a list that was never written compares equal
    // to another empty list, so the assertion above would pass against a gate that
    // never fired.
    expect(hit.decisions.length).toBeGreaterThan(0);
  });

  it('does not let a reset flood spend a login attempt budget from the same network', async () => {
    // The attack: five unauthenticated requests that never touch a credential, and
    // every sign-in from that network afterwards is refused. It needs `attempt_kind`
    // (`0019`) — with one undivided counter, four reset requests would already have
    // put the next login into the delayed bucket, and a fifth would block it.
    const ip = '198.51.100.30';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await requestReset('isolation@example.test', ip)).statusCode).toBe(202);
    }

    delayStats.decided.length = 0;
    const login = await loginAs('admin', SEED_PASSWORD, ip);

    expect(login.statusCode).toBe(200);
    // The claim, and the thing that distinguishes it: with a shared counter the IP
    // axis would hold 4 and this decision would be 1000. With separate counters the
    // login's own population is empty and the decision is 0.
    expect(delayStats.decided.length).toBeGreaterThan(0);
    expect(largestDecision()).toBe(0);

    // Both populations are on the table and separately labelled, which is the
    // isolation as data rather than as a timing inference. One login row, not two:
    // the gate writes a 'failed' row for every attempt and `issueSession` flips it
    // to 'succeeded' on success, so a successful login leaves exactly one row.
    expect(await count("SELECT count(*)::int AS value FROM login_attempts WHERE ip_subnet = $1 AND attempt_kind = 'token_request'", [ip])).toBe(4);
    expect(await count("SELECT count(*)::int AS value FROM login_attempts WHERE ip_subnet = $1 AND attempt_kind = 'login'", [ip])).toBe(1);
  });

  it('counts a refused request as an attempt, so a blocked caller cannot reset the penalty by retrying', async () => {
    const ip = '198.51.100.40';
    const email = 'blocked-attempts@example.test';
    await createUser('blocked-attempts', email, 'irrelevant-password-0003');

    for (let attempt = 0; attempt < 7; attempt += 1) {
      await requestReset(email, ip);
    }
    // Six refused-or-admitted requests plus the seventh: the count is the number of
    // ROWS, and a `429` writes one like any other attack surface — otherwise a
    // blocked caller could probe by retrying until it stopped being blocked.
    expect(await count("SELECT count(*)::int AS value FROM login_attempts WHERE ip_subnet = $1 AND attempt_kind = 'token_request'", [ip])).toBe(7);
  });
});

// =============================================================================
// THE RESET ITSELF
// =============================================================================

describe('a valid link changes the password, and the change is complete', () => {
  it('sets the new password, kills every session, and the new password is the one that works', async () => {
    const username = 'reset-victim';
    const email = 'reset-victim@example.test';
    const original = 'original-password-0004';
    const chosen = 'chosen-password-0005';
    const ip = '198.51.100.50';
    const userId = await createUser(username, email, original);

    // Two live sessions before the reset, so "every session" means more than one and
    // the count below is a count rather than a boolean.
    const first = await loginAs(username, original, ip);
    const second = await loginAs(username, original, ip);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const refreshTokens = [first.json<{ refreshToken: string }>().refreshToken, second.json<{ refreshToken: string }>().refreshToken];
    expect(await count('SELECT count(*)::int AS value FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL', [userId])).toBe(2);

    expect((await requestReset(email, ip)).statusCode).toBe(202);
    const token = tokenFromMail(email);

    const confirmed = await confirmReset(token, chosen);
    // THE POSITIVE CONTROL: a valid link IS accepted. A suite of denials would pass
    // against something that refuses everything, and this assertion is what stops
    // that — it is reached before any of the denial cases below.
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toEqual({ status: 'password_reset' });
    expect(JSON.stringify(confirmed.json())).not.toContain(token);

    // Row counts, never "no error": the token is consumed, the sessions are revoked.
    expect(await tokenCount("SELECT count(*)::int AS value FROM auth_tokens WHERE user_id = $1 AND consumed_at IS NOT NULL", [userId])).toBe(1);
    expect(await count('SELECT count(*)::int AS value FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL', [userId])).toBe(0);
    expect(await count('SELECT count(*)::int AS value FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NOT NULL', [userId])).toBe(2);

    // A session that was live before the reset cannot be exchanged afterwards. This
    // is the property that makes the reset a recovery rather than a password change:
    // without it the legitimate user is locked out AND whoever prompted the reset
    // keeps working.
    const exchange = await post('/auth/refresh', { refreshToken: refreshTokens[0] }, ip);
    expect(exchange.statusCode).toBe(401);
    expect(exchange.json()).toEqual({ statusCode: 401, message: 'invalid refresh token', error: 'Unauthorized' });

    expect((await loginAs(username, original, ip)).statusCode).toBe(401);
    expect((await loginAs(username, chosen, ip)).statusCode).toBe(200);
  });

  it('closes every OTHER outstanding reset link, so an older mail cannot overwrite the password the user chose', async () => {
    const username = 'many-links';
    const email = 'many-links@example.test';
    const ip = '198.51.100.51';
    const userId = await createUser(username, email, 'original-password-0006');

    await requestReset(email, ip);
    const first = tokenFromMail(email);
    await requestReset(email, ip);
    const second = tokenFromMail(email);
    expect(second).not.toBe(first);

    // Two live links for one mailbox: single-use is a statement about ONE of them,
    // so the attack is holding an older mail and using it AFTER the user has chosen.
    expect(await tokenCount("SELECT count(*)::int AS value FROM auth_tokens WHERE user_id = $1 AND consumed_at IS NULL", [userId])).toBe(2);

    expect((await confirmReset(second, 'first-choice-0007')).statusCode).toBe(200);
    expect(await tokenCount("SELECT count(*)::int AS value FROM auth_tokens WHERE user_id = $1 AND consumed_at IS NULL", [userId])).toBe(0);

    // The first link is dead too. Without the burn it would still be live, and
    // "single-use" would have meant "each link once" rather than "once".
    expect((await confirmReset(first, 'second-choice-0008')).statusCode).toBe(400);
    expect((await loginAs(username, 'first-choice-0007', ip)).statusCode).toBe(200);
  });

  it('stores no rendered body for a credential-bearing message, so a dump of email_messages is not a list of live links', async () => {
    const email = 'no-stored-body@example.test';
    await createUser('no-stored-body', email, 'irrelevant-password-0009');
    await requestReset(email, '198.51.100.52');
    tokenFromMail(email);

    // The whole row, not just the body column. `email_messages` is a table an admin
    // reads over HTTP, appears in every backup, and outlives the account whose
    // history it is — so a link in it is a working credential in a place that has no
    // reason to hold credentials. The `metadata_only` class is the assertion that
    // the suppression rule fired rather than that someone happened not to pass a body.
    const rows = superuserRows<{ rows: number; bodies: number; classes: string; status: string }>(
      `SELECT count(*)::int AS rows,
              count(body)::int AS bodies,
              min(content_class) AS classes,
              min(status) AS status
         FROM email_messages WHERE recipient = '${email}' AND template = 'password_reset'`,
    )[0];

    expect(rows?.rows, 'the attempt was not recorded at all').toBeGreaterThan(0);
    expect(rows?.status).toBe('sent');
    expect(rows?.classes).toBe('metadata_only');
    expect(rows?.bodies, 'a credential-bearing message stored a rendered body').toBe(0);
  });
});

// =============================================================================
// THE UNIFORM REFUSAL
// =============================================================================

describe('a link that does not work must not say which kind of not-working it is', () => {
  it('refuses a replay, an expired link and a never-issued one identically', async () => {
    const username = 'refusal-victim';
    const email = 'refusal-victim@example.test';
    const ip = '198.51.100.53';
    const userId = await createUser(username, email, 'original-password-0010');

    await requestReset(email, ip);
    const used = tokenFromMail(email);
    expect((await confirmReset(used, 'first-choice-0011')).statusCode).toBe(200);

    const replayed = await confirmReset(used, 'second-choice-0012');
    const expired = await confirmReset(await insertExpiredResetToken(userId), 'third-choice-0013');
    const neverIssued = await confirmReset('z'.repeat(43), 'fourth-choice-0014');

    // Three failures, one answer — status AND body. A caller who can tell "you already
    // used this" from "this expired" has learned whether the link ever existed, which
    // is the distinction the single-use design spent its design to remove.
    expect(replayed.statusCode).toBe(400);
    expect(expired.statusCode).toBe(replayed.statusCode);
    expect(neverIssued.statusCode).toBe(replayed.statusCode);
    expect(expired.json()).toEqual(replayed.json());
    expect(neverIssued.json()).toEqual(replayed.json());
    expect(JSON.stringify(replayed.json())).not.toContain(email);

    // Exactly one token was consumed across all four confirmations: the refusal
    // path mints nothing and consumes nothing.
    expect(await tokenCount("SELECT count(*)::int AS value FROM auth_tokens WHERE user_id = $1 AND consumed_at IS NOT NULL", [userId])).toBe(1);
  });
});

// =============================================================================
// EMAIL VERIFICATION
// =============================================================================

describe('verification confirms the address and gates nothing', () => {
  it('stamps the address, leaves login untouched, and is refused a second time', async () => {
    const username = 'verify-victim';
    const email = 'verify-victim@example.test';
    const password = 'original-password-0015';
    const ip = '198.51.100.60';
    const userId = await createUser(username, email, password);

    // Unverified to begin with. If this is ever not null the migration stamped
    // something by default, and every assertion below would be about a state the
    // account was never in.
    expect(await scalar('SELECT email_verified_at AS value FROM users WHERE id = $1', [userId])).toBeNull();

    expect((await requestVerification(email, ip)).statusCode).toBe(202);
    const token = tokenFromMail(email);

    const confirmed = await confirmVerification(token);
    // The positive control for this route too.
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toEqual({ status: 'verified' });
    expect(await scalar('SELECT email_verified_at AS value FROM users WHERE id = $1', [userId])).not.toBeNull();

    // **Login is not gated on the stamp, and that is the consistency claim.**
    // `issueSession` decides on the password and on nothing else, so a verified
    // address confers no capability and an unverified one costs none. A gate added
    // to either side would lock out every pre-existing account (all NULL in the new
    // column), which is why `0020` refuses to add one.
    expect((await loginAs(username, password, ip)).statusCode).toBe(200);

    expect((await confirmVerification(token)).statusCode).toBe(400);
  });

  it('refuses a password-reset link at the verification route, which is what the purpose CHECK is for', async () => {
    const email = 'purpose-victim@example.test';
    const ip = '198.51.100.61';
    await createUser('purpose-victim', email, 'original-password-0016');

    await requestReset(email, ip);
    const resetLink = tokenFromMail(email);
    await requestVerification(email, ip);
    const verifyLink = tokenFromMail(email);

    // Two live tokens, two purposes, one primitive. Presenting one to the other's
    // endpoint must fail — structurally, in `redeem_auth_token`'s `purpose` predicate,
    // rather than by a branch in the controller.
    expect((await confirmVerification(resetLink)).statusCode).toBe(400);
    expect((await confirmReset(verifyLink, 'irrelevant-0017')).statusCode).toBe(400);

    // …and both still work through their own endpoint, so the two failures above are
    // the purpose check and not a token that was never good.
    expect((await confirmVerification(verifyLink)).statusCode).toBe(200);
    expect((await confirmReset(resetLink, 'irrelevant-0018')).statusCode).toBe(200);
  });

  it('answers a request for an unregistered address exactly as it answers a registered one', async () => {
    const hit = await requestVerification('enumeration-hit@example.test', '198.51.100.62');
    const miss = await requestVerification('verification-nobody@example.test', '198.51.100.62');

    expect(miss.statusCode).toBe(hit.statusCode);
    expect(miss.json()).toEqual(hit.json());
    expect(miss.json()).toEqual({ status: 'accepted' });
  });
});

describe('the suite is looking at real mail, not a construction', () => {
  it('delivered every message it claims to have, and no delivery failed', () => {
    // Without this, `tokenFromMail` could be passing on a suite in which the send
    // quietly failed and the sink kept an older message from an earlier case — the
    // token would then belong to a different flow and every assertion above would be
    // about the wrong link.
    expect(sink.errors).toEqual([]);
    expect(sink.deliveries.length).toBeGreaterThan(6);
    expect(
      superuserRows<{ value: number }>("SELECT count(*)::int AS value FROM email_messages WHERE status = 'failed'")[0]?.value,
    ).toBe(0);
  });
});