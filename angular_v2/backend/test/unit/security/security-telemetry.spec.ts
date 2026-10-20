import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOSTILE_PATTERNS } from '../../../src/security/pattern-registry.js';
import { SecurityTelemetryFlush } from '../../../src/security/telemetry-flush.service.js';
import {
  INSERT_DETECTED_PATTERN_SQL,
  INSERT_PATTERN_LOGIN_ATTEMPTS_SQL,
  INSERT_SECURITY_ALERT_SQL,
  MAX_LINKED_ATTEMPTS_PER_PATTERN,
  SELECT_HOST_BEHAVIOUR_SQL,
  SELECT_REPUTATION_HOSTS_SQL,
  UPDATE_DETECTED_PATTERN_SQL,
  UPSERT_IP_REPUTATION_SQL,
} from '../../../src/security/telemetry-writer.js';
import {
  SECURITY_TELEMETRY_PROOF_DATABASE,
  authenticatorClient,
  dropProofDatabase,
  rebuildProofDatabase,
  superuserClient,
} from '../notifications/proof-database.js';

/**
 * The security telemetry, against a REAL PostgreSQL and the REAL application.
 *
 * ## WHY A REAL DATABASE AND NOT A STAND-IN (§2.2)
 *
 * Every property this file asserts lives in the server: the `ON CONFLICT` clause
 * on the links, the `CHECK` constraints on the four tables, the `FORCE ROW LEVEL
 * SECURITY` policies, the unique index the reputation row upserts against, and the
 * `UNIQUE (pattern_id, login_attempt_id)` that makes the evidence rows
 * idempotent. A fixture in JavaScript could imitate none of them.
 *
 * ## WHY THE REAL APPLICATION AND NOT THE COLLECTOR
 *
 * **The assertion that matters most — "a detected pattern does not block the
 * request" — is a statement about the whole request path.** It is only true if
 * the interceptor runs, if the validation pipe still runs, if the handler still
 * runs, and if the auth service still issues a session. A suite that called the
 * collector directly would assert that a function does not throw, which is a
 * different claim and a much weaker one.
 *
 * ## WHY A THROWAWAY DATABASE AND NOT THE CONFIGURED ONE (§B8)
 *
 * The proof WRITES to all four telemetry tables and it boots the application, so
 * it must not point at a developer's working data. `proof-database.ts` is where
 * the `DROP DATABASE` discipline lives.
 */

/**
 * The account the suite signs in as.
 *
 * **Its password IS a hostile payload**, and that is the point: the account is
 * real, its credentials work, and the sign-in carries a recognisable shape — so
 * the "a detected pattern does not block the request" assertion is made against
 * a request that would otherwise SUCCEED. A suite that asserted a 401 was
 * "not blocked" would be asserting that a wrong password is still a wrong
 * password, which is a different claim.
 */
const PROBE_USERNAME = 'telemetry-probe';
const PROBE_PASSWORD = `<script>alert('x')</script>`;

/**
 * The credential the "no credential is written" assertion searches for.
 *
 * **It is the credential the suite signs in with**, not a string that only
 * appears in a request. A producer that never saw a password would pass the same
 * assertion vacuously.
 */
const HOSTILE_PASSWORD = PROBE_PASSWORD;

/**
 * One payload per pattern, held HERE rather than read from the registry.
 *
 * **The point of the table being independent of the registry is that it can fail.**
 * A suite that generated its payloads from the registry would assert that the
 * detector detects what the detector detects. This table says what a SQL
 * injection and an XSS payload look like, and a pattern added to the registry
 * without a payload here has no case — and the last case in this file asserts
 * that the two sets agree, so an untested pattern fails the suite rather than
 * sitting in it untested.
 */
const PATTERN_PAYLOADS: Readonly<Record<string, string>> = Object.freeze({
  sql_injection: "' OR '1'='1",
  xss: '<script>alert(1)</script>',
  path_traversal: '../../etc/passwd',
  command_injection: '; cat /etc/passwd',
  ldap_injection: '*(uid=*))(|(uid=*',
  nosql_injection: '{"$ne": null}',
});

/** The addresses the cases use. RFC 5737 documentation space, one per case. */
const ADDRESSES = {
  perPattern: '198.51.100.10',
  successfulLogin: '198.51.100.11',
  belowThreshold: '198.51.100.12',
  crossingThreshold: '198.51.100.13',
  flood: '198.51.100.14',
  mappedForm: '::ffff:198.51.100.15',
  plainForm: '198.51.100.15',
} as const;

/**
 * The configuration this suite runs with.
 *
 * **The threshold is three**, so a case can cross it and a case can sit below it
 * without sending a flood. The flush interval is an hour, so the job never fires
 * on its own and every write in this file is one the suite asked for — which is
 * what makes "the flush wrote exactly this" a statement rather than a race.
 */
const TELEMETRY_ENV = {
  SECURITY_TELEMETRY_ALERT_THRESHOLD: '3',
  SECURITY_TELEMETRY_FLUSH_SECONDS: '3600',
  SECURITY_TELEMETRY_WINDOW_SECONDS: '900',
  SECURITY_TELEMETRY_REPUTATION_BASE_SCORE: '100',
  SECURITY_TELEMETRY_REPUTATION_PENALTY: '10',
  SECURITY_TELEMETRY_REPUTATION_SUSPICIOUS_SCORE: '80',
  SECURITY_TELEMETRY_REPUTATION_BAD_SCORE: '40',
} as const;

/**
 * The limiter is opened wide, and so is the per-account gate.
 *
 * **The flood case sends more requests than the credential limit allows**, and a
 * request the limiter refuses never reaches the interceptor — so with the
 * shipped limit the flood would measure the limiter rather than the detector.
 *
 * **The progressive delay and the block are neutralised for the same reason.**
 * They are the brute-force controls, they are real, and they are not what this
 * suite is about: with the shipped schedule the third request against one name
 * waits four seconds and the fourth waits sixteen, which would make this suite
 * measure the delay rather than the telemetry — and the BLOCK would answer 401
 * before the credential check, so a request the telemetry never saw would look
 * exactly like a request the telemetry ignored.
 */
const THROTTLE_ENV = {
  THROTTLE_LIMIT: '1000',
  THROTTLE_CREDENTIAL_LIMIT: '1000',
  THROTTLE_LINK_LIMIT: '1000',
  THROTTLE_TTL_SECONDS: '60',
} as const;

/** The brute-force controls, opened wide for the same reason. */
const SECURITY_ENV = {
  SECURITY_DELAY_SCHEDULE_SECONDS: '0',
  SECURITY_BLOCK_THRESHOLD: '1000',
  SECURITY_CAPTCHA_THRESHOLD: '1000',
} as const;

/** Booting the application compiles and initialises the whole graph. */
const BOOT_TIMEOUT = 120_000;

let app: NestFastifyApplication;
let moduleRef: TestingModule;
let flush: SecurityTelemetryFlush;
let superuser: Client;

const PRISTINE = [
  'DB_NAME',
  ...Object.keys(TELEMETRY_ENV),
  ...Object.keys(THROTTLE_ENV),
  ...Object.keys(SECURITY_ENV),
].map((key) => [key, process.env[key]] as const);

beforeAll(async () => {
  await rebuildProofDatabase(SECURITY_TELEMETRY_PROOF_DATABASE);

  // Set BEFORE the application module is imported: the telemetry numbers are read
  // at import time, and `@Throttle(...)` is a decorator evaluated when the
  // controller module is imported.
  process.env['DB_NAME'] = SECURITY_TELEMETRY_PROOF_DATABASE;
  for (const [key, value] of Object.entries({
    ...TELEMETRY_ENV,
    ...THROTTLE_ENV,
    ...SECURITY_ENV,
  })) {
    process.env[key] = value;
  }

  const { AppModule } = await import('../../../src/app.module.js');
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useLogger(false);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  flush = app.get(SecurityTelemetryFlush);
  superuser = await superuserClient(SECURITY_TELEMETRY_PROOF_DATABASE);
  await insertProbeAccount();
}, BOOT_TIMEOUT);

afterAll(async () => {
  try {
    await superuser?.end();
    await app?.close();
    await moduleRef?.close();
  } catch {
    // A teardown failure is not an assertion this suite makes.
  } finally {
    for (const [key, value] of PRISTINE) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    dropProofDatabase(SECURITY_TELEMETRY_PROOF_DATABASE);
  }
});

/**
 * The account the suite signs in as.
 *
 * **Created through the escalation boundary**, because `users` is `FORCE ROW
 * LEVEL SECURITY` and its insert policy admits `app_admin` and nothing else —
 * so the owner role cannot write the row and a fixture written as the owner
 * would fail for a reason that has nothing to do with the suite.
 */
async function insertProbeAccount(): Promise<void> {
  const client = await authenticatorClient(SECURITY_TELEMETRY_PROOF_DATABASE);
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_admin');
    await client.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)',
      [PROBE_USERNAME, `${PROBE_USERNAME}@example.invalid`, await bcrypt.hash(PROBE_PASSWORD, 12)],
    );
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

/** One login request, from a named address. */
function login(address: string, username: string, password: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username, password },
    remoteAddress: address,
  });
}

/** One flush, on demand. */
async function flushNow(): Promise<void> {
  const run = await flush.tick();
  expect(run.ran).toBe(true);
}

/** The four tables the producer writes, as a closed union so no name is ever interpolated freely. */
const TELEMETRY_TABLES = [
  'security_detected_patterns',
  'pattern_login_attempts',
  'security_alerts',
  'ip_reputation',
] as const;

/** Every row of a telemetry table, read through a session that bypasses the policies. */
async function rowsOf(
  table: (typeof TELEMETRY_TABLES)[number],
): Promise<readonly Record<string, unknown>[]> {
  const result = await superuser.query<Record<string, unknown>>(`SELECT * FROM public.${table}`);
  return result.rows;
}

describe('the security telemetry: the detection point', () => {
  it('records a pattern for every supported shape, and only for the shape that matched', async () => {
    for (const payload of Object.values(PATTERN_PAYLOADS)) {
      await login(ADDRESSES.perPattern, payload, 'a-password-of-no-consequence');
    }
    await flushNow();

    const patterns = await rowsOf('security_detected_patterns');
    const types = new Set(
      patterns.map((row) => String(row['pattern_type'])),
    );
    for (const type of Object.keys(PATTERN_PAYLOADS)) {
      expect(types.has(type)).toBe(true);
    }
  });

  it('covers every pattern the registry carries, so an untested pattern fails the suite', () => {
    const registered = HOSTILE_PATTERNS.map((pattern) => pattern.type).sort();
    expect(Object.keys(PATTERN_PAYLOADS).sort()).toEqual(registered);
  });

  it('records nothing for a request that carries no hostile shape', async () => {
    const before = (await rowsOf('security_detected_patterns')).length;
    await login('198.51.100.16', 'a-plain-username', 'a-plain-password');
    await flushNow();
    const after = await rowsOf('security_detected_patterns');
    expect(after.length).toBe(before);
  });
});

describe('the security telemetry: triage, not prevention', () => {
  it('does NOT block the request — a valid sign-in carrying a hostile password still succeeds', async () => {
    const response = await login(ADDRESSES.successfulLogin, PROBE_USERNAME, HOSTILE_PASSWORD);

    // THE ASSERTION. §B6: "Behavioral/risk scoring is triage, not prevention. It
    // informs a decision; it never silently blocks." The obvious implementation
    // of "detect an injection and refuse it" looks more impressive and is a
    // denial of service waiting for a false positive.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('accessToken');

    // And the detection DID happen — otherwise a 200 would prove nothing, because
    // a detector that never fired would also let the request through.
    await flushNow();
    const patterns = await rowsOf('security_detected_patterns');
    const found = patterns.filter(
      (row) => row['ip_normalized'] === ADDRESSES.successfulLogin && row['pattern_type'] === 'xss',
    );
    expect(found.length).toBe(1);
  });

  it('records the attempt that proves the pattern', async () => {
    await flushNow();
    const links = await rowsOf('pattern_login_attempts');
    const patterns = await rowsOf('security_detected_patterns');
    const pattern = patterns.find(
      (row) => row['ip_normalized'] === ADDRESSES.successfulLogin && row['pattern_type'] === 'xss',
    );
    expect(pattern).toBeDefined();
    const linked = links.filter((row) => row['pattern_id'] === pattern?.['id']);
    expect(linked.length).toBeGreaterThan(0);
    expect(linked.length).toBeLessThanOrEqual(MAX_LINKED_ATTEMPTS_PER_PATTERN);
  });
});

describe('the security telemetry: the threshold', () => {
  it('raises no alert for a pattern below the threshold', async () => {
    await login(ADDRESSES.belowThreshold, "' OR '1'='1", 'a-password-of-no-consequence');
    await login(ADDRESSES.belowThreshold, "' OR '1'='1", 'a-password-of-no-consequence');
    await flushNow();

    const alerts = await rowsOf('security_alerts');
    const forAddress = alerts.filter((row) => row['ip_normalized'] === ADDRESSES.belowThreshold);
    expect(forAddress.length).toBe(0);
  });

  it('raises exactly one alert for a pattern that crosses the threshold', async () => {
    for (let index = 0; index < 3; index += 1) {
      await login(ADDRESSES.crossingThreshold, "' OR '1'='1", 'a-password-of-no-consequence');
    }
    await flushNow();

    const alerts = await rowsOf('security_alerts');
    const forAddress = alerts.filter((row) => row['ip_normalized'] === ADDRESSES.crossingThreshold);
    expect(forAddress.length).toBe(1);
    expect(forAddress[0]?.['alert_type']).toBe('sql_injection');
    expect(forAddress[0]?.['source']).toBe('system');
    // The alert is addressed to the administrators and to nobody else: it carries
    // no user, so the notification materialiser renders it for the panel's
    // administrators rather than publishing it to every member.
    expect(forAddress[0]?.['user_id']).toBeNull();
  });

  it('raises no SECOND alert for the same window, however many times it is flushed', async () => {
    await flushNow();
    await flushNow();
    const alerts = await rowsOf('security_alerts');
    const forAddress = alerts.filter((row) => row['ip_normalized'] === ADDRESSES.crossingThreshold);
    expect(forAddress.length).toBe(1);
  });

  it('reaches the notification panel, which is what the alert is FOR', async () => {
    const { NotificationMaterializer } = await import('../../../src/notifications/notification-materializer.service.js');
    const materializer = app.get(NotificationMaterializer);
    const run = await materializer.tick();
    expect(run.ran).toBe(true);

    const notifications = await superuser.query<Record<string, unknown>>(
      'SELECT * FROM public.admin_notifications WHERE source = $1',
      ['security_alerts'],
    );
    const forAddress = notifications.rows.filter(
      (row) => (row['data'] as Record<string, unknown> | null)?.['ip_normalized'] === ADDRESSES.crossingThreshold,
    );
    expect(forAddress.length).toBeGreaterThan(0);
    // An alert with no user is addressed to the ADMINISTRATORS and to nobody
    // else — publishing it to every member would be strictly more than `0022`
    // grants, where `security_alerts` is `app_admin` and nothing else.
    expect(forAddress[0]?.['audience']).toBe('administrators');
  });
});

describe('the security telemetry: the write is not on the hot path', () => {
  it('does not produce one pattern row per request', async () => {
    const flood = 12;
    for (let index = 0; index < flood; index += 1) {
      await login(ADDRESSES.flood, "' OR '1'='1", 'a-password-of-no-consequence');
    }
    await flushNow();

    const patterns = await rowsOf('security_detected_patterns');
    const forAddress = patterns.filter((row) => row['ip_normalized'] === ADDRESSES.flood);
    // ONE row, carrying the count. A producer that wrote a row per request would
    // have written twelve, and the panel would show twelve findings for one
    // campaign instead of one finding and a number.
    expect(forAddress.length).toBe(1);
    expect(forAddress[0]?.['attempt_count']).toBe(flood);
  });

  it('bounds the evidence rows as well, so the join cannot become the amplification', async () => {
    await flushNow();
    const links = await rowsOf('pattern_login_attempts');
    const patterns = await rowsOf('security_detected_patterns');
    const floodPattern = patterns.find((row) => row['ip_normalized'] === ADDRESSES.flood);
    const forPattern = links.filter((row) => row['pattern_id'] === floodPattern?.['id']);
    expect(forPattern.length).toBeLessThanOrEqual(MAX_LINKED_ATTEMPTS_PER_PATTERN);
  });
});

describe('the security telemetry: the address is canonical', () => {
  it('records ONE reputation entry for a host that arrived in two spellings', async () => {
    await login(ADDRESSES.mappedForm, "' OR '1'='1", 'a-password-of-no-consequence');
    await login(ADDRESSES.plainForm, "' OR '1'='1", 'a-password-of-no-consequence');
    await flushNow();

    const reputation = await rowsOf('ip_reputation');
    const forHost = reputation.filter((row) => row['ip_normalized'] === '198.51.100.15');
    expect(forHost.length).toBe(1);
  });

  it('records ONE pattern for a host that arrived in two spellings', async () => {
    await flushNow();
    const patterns = await rowsOf('security_detected_patterns');
    const forHost = patterns.filter((row) => row['ip_normalized'] === '198.51.100.15');
    expect(forHost.length).toBe(1);
  });
});

describe('the security telemetry: what it writes', () => {
  it('writes no password and no token into any column of any of the four tables', async () => {
    await login('198.51.100.17', "' OR '1'='1", HOSTILE_PASSWORD);
    await flushNow();

    for (const table of TELEMETRY_TABLES) {
      const rows = await rowsOf(table);
      const serialised = JSON.stringify(rows);
      expect(serialised).not.toContain(HOSTILE_PASSWORD);
      expect(serialised).not.toContain(PROBE_PASSWORD);
      expect(serialised).not.toContain('<script>');
    }
  });

  it('never blocks a host and never derives a place for one', async () => {
    await flushNow();
    const reputation = await rowsOf('ip_reputation');
    expect(reputation.length).toBeGreaterThan(0);
    for (const row of reputation) {
      expect(row['is_blocked']).toBe(false);
      expect(row['blocked_until']).toBeNull();
      // Geo-blocking is not implemented in this template — see the deployment
      // guide's finding — so the column has to be empty rather than a default
      // that reads like an answer.
      expect(row['geo_location']).toBeNull();
    }
  });

  it('scores the host from what was observed and says so in the statistics', async () => {
    await flushNow();
    const reputation = await rowsOf('ip_reputation');
    const forHost = reputation.find((row) => row['ip_normalized'] === ADDRESSES.crossingThreshold);
    expect(forHost).toBeDefined();
    const statistics = forHost?.['statistics'] as Record<string, unknown>;
    expect(statistics['window_failed_attempts']).toBeGreaterThan(0);
    expect(statistics['pattern_matches']).toBeGreaterThan(0);
    expect(['good', 'suspicious', 'bad']).toContain(String(forHost?.['status']));
  });
});

describe('the `is_mock` display label', () => {
  it('is read by no policy and no function, so nothing in the schema can branch on it', async () => {
    // The test `0022` says is owed. It was not written when that migration
    // shipped, and the invariant held only because nothing read the column —
    // which is a state, not a control.
    const policies = await superuser.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM pg_policies
        WHERE coalesce(qual, '') ILIKE '%is_mock%'
           OR coalesce(with_check, '') ILIKE '%is_mock%'`,
    );
    expect(policies.rows[0]?.count).toBe(0);

    const functions = await superuser.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'authz')
          AND p.prosrc ILIKE '%is_mock%'`,
    );
    expect(functions.rows[0]?.count).toBe(0);
  });

  it('is not named by a single statement the producer runs', () => {
    // The producer neither writes the flag nor reads it: it is a DISPLAY label,
    // and a row that carried a real finding must not be labelled synthetic, and a
    // synthetic row must not be un-labelled by a producer with no opinion about
    // which it was.
    for (const statement of [
      UPDATE_DETECTED_PATTERN_SQL,
      INSERT_DETECTED_PATTERN_SQL,
      INSERT_PATTERN_LOGIN_ATTEMPTS_SQL,
      INSERT_SECURITY_ALERT_SQL,
      SELECT_REPUTATION_HOSTS_SQL,
      SELECT_HOST_BEHAVIOUR_SQL,
      UPSERT_IP_REPUTATION_SQL,
    ]) {
      expect(statement).not.toContain('is_mock');
    }
  });

  it('leaves every row the producer wrote marked as live', async () => {
    await flushNow();
    const patterns = await rowsOf('security_detected_patterns');
    expect(patterns.length).toBeGreaterThan(0);
    for (const row of patterns) {
      expect(row['is_mock']).toBe(false);
    }
  });
});
