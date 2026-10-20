import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../../src/auth/auth.service.js';
import { CaptchaRequiredException } from '../../../src/auth/captcha-required.exception.js';
import type { CaptchaService } from '../../../src/auth/captcha.service.js';
import type { TokenService } from '../../../src/token/token.service.js';
import { loadTestEnvironment } from '../../support/database.js';
import { BACKEND_ROOT } from '../../support/paths.js';
import {
  authenticatorClient,
  dropProofDatabase,
  LOGIN_CAPTCHA_PROOF_DATABASE,
  rebuildProofDatabase,
} from '../notifications/proof-database.js';

/**
 * **The gate's challenge decision: when a sign-in has to carry one, and where in
 * the login path it sits.**
 *
 * ## WHY THIS IS A SEPARATE FILE FROM THE CHALLENGE PROOF
 *
 * `captcha.service.spec.ts` proves the issuer and the verifier. This file proves
 * the DECISION — which sign-ins are asked for a challenge — and the POSITION of
 * the check, and those are properties of `AuthService`, not of the challenge.
 *
 * ## WHY A REAL DATABASE
 *
 * The decision is a count over `login_attempts` rows, and the count is the whole
 * mechanism: a threshold compared against a number the application made up would
 * be a threshold over nothing. So the rows are real rows, written through the
 * same boundary the application writes them through, and the counter reads them
 * back.
 *
 * ## WHY EVERY TEST USES ITS OWN ADDRESS
 *
 * The gate counts the address as well as the account, and the address count
 * drives the DELAY and the BLOCK. One address shared by five tests would
 * accumulate failures across them, and the fifth would be refused by the block
 * before it ever reached the challenge decision — a test that fails for a reason
 * that has nothing to do with what it is testing. A fresh address per test keeps
 * the other axis at zero, and the delay each test pays is the one failure it
 * planted.
 *
 * ## WHY THE THRESHOLD IS 1 HERE
 *
 * The shipped threshold is three failures. This suite sets it to one so that a
 * single planted failure crosses it — the decision is the property under test,
 * not the number, and the number is `environment.ts`'s business. The planted rows
 * carry `ip_normalized`, because the counter ignores rows without it: an
 * allowlisted or untracked row is a row the counters never see.
 */

const DB = LOGIN_CAPTCHA_PROOF_DATABASE;

let pool: Pool;
let owner: Client;
let service: AuthService;
let verifyCalls: { token: string; answer: string }[];

beforeAll(async () => {
  await rebuildProofDatabase(DB);
  const env = loadTestEnvironment();
  owner = await authenticatorClient(DB);
  pool = new Pool({
    host: env.database.host,
    port: env.database.port,
    user: env.authenticator.user,
    password: env.authenticator.password,
    database: DB,
  });
  const thresholdEnvironment = {
    ...env,
    security: { ...env.security, captchaThreshold: 1 },
  };
  const config = {
    getOrThrow: <T>(key: string): T => ({ environment: thresholdEnvironment })[key] as T,
  } as ConfigService;
  verifyCalls = [];
  const captcha = {
    verify: (token: string, answer: string): Promise<boolean> => {
      verifyCalls.push({ token, answer });
      return Promise.resolve(false);
    },
  } as unknown as CaptchaService;
  service = new AuthService(
    config,
    new JwtService({ secret: 'a'.repeat(32) }),
    {} as unknown as TokenService,
    captcha,
    { connect: () => pool.connect() },
  );
}, 300_000);

afterAll(async () => {
  await pool?.end().catch(() => undefined);
  await owner?.end().catch(() => undefined);
  dropProofDatabase(DB);
}, 120_000);

/**
 * A failed attempt against a name, exactly as the gate writes one.
 *
 * **Through the boundary, as `app_admin`.** `pgrst_authenticator` holds no grant
 * on `login_attempts` of its own — it reaches the table by impersonating a
 * serving role, exactly as the application does — so the planted row is written
 * the same way the gate writes its own.
 */
async function plantFailure(username: string, ip: string): Promise<void> {
  await owner.query('BEGIN');
  await owner.query('SET LOCAL ROLE app_admin');
  await owner.query(
    `INSERT INTO login_attempts (attempt_kind, username, ip, ip_normalized, ip_subnet, status)
     VALUES ('login', $1, $2, $2, $2, 'failed')`,
    [username, ip],
  );
  await owner.query('COMMIT');
}

beforeEach(() => {
  verifyCalls = [];
});

describe('the challenge is asked for only above the threshold', () => {
  it('asks for nothing when the account has no failures', async () => {
    const ip = '198.51.100.1';

    await expect(service.login({ username: 'below-threshold', password: 'wrong' }, ip)).rejects.toThrow(
      'invalid credentials',
    );
    expect(verifyCalls, 'a challenge was demanded below the threshold').toEqual([]);
  });

  it('demands one when the account is over the threshold', async () => {
    const ip = '198.51.100.2';
    await plantFailure('over-threshold', ip);

    await expect(
      service.login({ username: 'over-threshold', password: 'wrong' }, ip),
    ).rejects.toBeInstanceOf(CaptchaRequiredException);
    expect(verifyCalls.length, 'the challenge was not demanded').toBe(1);
  });

  it('counts the ACCOUNT and not the address, because a shared address must not challenge everybody behind it', async () => {
    // One failure against a DIFFERENT name, from this address. The address count
    // is at the threshold; the account count is zero. A challenge here would be
    // the blanket challenge `docs/security.md` names as the anti-pattern — one
    // corporate NAT challenging everyone behind it.
    const ip = '198.51.100.3';
    await plantFailure('somebody-else', ip);

    await expect(service.login({ username: 'innocent-bystander', password: 'wrong' }, ip)).rejects.toThrow(
      'invalid credentials',
    );
    expect(verifyCalls, 'the address count demanded a challenge').toEqual([]);
  });

  it('presents the answer the client sent, and nothing else', async () => {
    const ip = '198.51.100.4';
    await plantFailure('answer-carrier', ip);

    await expect(
      service.login(
        { username: 'answer-carrier', password: 'wrong', captchaToken: 'a-token', captchaAnswer: '11' },
        ip,
      ),
    ).rejects.toBeInstanceOf(CaptchaRequiredException);
    expect(verifyCalls).toEqual([{ token: 'a-token', answer: '11' }]);
  });
});

describe('the challenge is demanded BEFORE the credential is examined', () => {
  it('answers 428 rather than the credential refusal, which is only possible if the check ran first', async () => {
    const ip = '198.51.100.5';
    await plantFailure('ordering', ip);

    // The credential refusal is a `401` and the challenge refusal is a `428`.
    // A login over the threshold that answers `428` therefore never reached the
    // password comparison — and the password here is wrong, so a credential check
    // that ran first would have answered `401`.
    const failure = await service
      .login({ username: 'ordering', password: 'wrong' }, ip)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CaptchaRequiredException);
    expect((failure as CaptchaRequiredException).getStatus()).toBe(428);
  });

  it('calls the verifier before it calls the credential check, in the shipped source', () => {
    // The behavioural assertion above is the strong one; this is the one that
    // keeps it true if somebody moves the check. `AGENTS.md` §3: "a lint rule is
    // the right tool when the violation is a node, and the wrong tool when the
    // violation is a payload" — the ORDER of two calls is a node, but the rule
    // that would express it is a bespoke scanner, and the shipped text is what
    // a test can read without a database.
    const source = readFileSync(join(BACKEND_ROOT, 'src', 'auth', 'auth.service.ts'), 'utf8');
    const verifyAt = source.indexOf('this.captcha.verify(');
    const sessionAt = source.indexOf('this.issueSession(');

    expect(verifyAt, 'the challenge is not verified anywhere in auth.service.ts').toBeGreaterThan(-1);
    expect(sessionAt, 'the credential check is not called anywhere in auth.service.ts').toBeGreaterThan(-1);
    expect(
      verifyAt,
      'the challenge is verified AFTER the credential check, so a correct password would skip it',
    ).toBeLessThan(sessionAt);
  });
});
