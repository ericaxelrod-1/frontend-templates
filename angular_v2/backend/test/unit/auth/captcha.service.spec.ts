import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CaptchaService } from '../../../src/auth/captcha.service.js';
import { loadTestEnvironment } from '../../support/database.js';
import {
  authenticatorClient,
  CAPTCHA_PROOF_DATABASE,
  dropProofDatabase,
  rebuildProofDatabase,
} from '../notifications/proof-database.js';

/**
 * **The CAPTCHA, against a real PostgreSQL, on the table `0022` shipped.**
 *
 * ## WHY THIS FILE EXISTS
 *
 * `0022_security_telemetry.sql` created `public.captcha` complete — `token_hash`,
 * a per-row `solution_salt` beside `solution_hash`, and an `is_used` / `used_at`
 * pair that makes single-use a property of the write — and said in its own words
 * that it was "the storage half of an unimplemented requirement". §B6 requires
 * that "captcha is validated server-side: the server issues a challenge, stores
 * the answer, and verifies it", and neither half of that existed.
 *
 * The migration also said what the missing code must be careful of:
 *
 *   * **the answer is never stored in the clear**, so a dump of the table is not
 *     a list of answers;
 *   * **the token is never stored in the clear either**, so a dump is not a set
 *     of replayable challenges;
 *   * **single-use is the write**, not the read: `UPDATE … WHERE id = $1 AND
 *     is_used = false`, asserting one row.
 *
 * All three are properties of the DATABASE, so all three are proven here against
 * the real table rather than against a stub. §2.2: no stand-in for a real
 * integration.
 *
 * ## WHY A THROWAWAY DATABASE
 *
 * §B8: "Use a dedicated test database or a throwaway schema per suite; never
 * point tests at a developer's working data." This suite writes to `public.captcha`
 * and reads the rows back, so it owns its database. The migrations are read from
 * disk and applied, exactly as `scripts/migrate.ts` does minus the ledger — and
 * that ledger is the only part a throwaway database does not need.
 */

const DB = CAPTCHA_PROOF_DATABASE;

let pool: Pool;
let service: CaptchaService;

beforeAll(async () => {
  await rebuildProofDatabase(DB);
  const env = loadTestEnvironment();
  pool = new Pool({
    host: env.database.host,
    port: env.database.port,
    user: env.authenticator.user,
    password: env.authenticator.password,
    database: DB,
  });
  const config = {
    getOrThrow: <T>(key: string): T => ({ environment: env })[key] as T,
  } as ConfigService;
  service = new CaptchaService(config, { connect: () => pool.connect() });
}, 300_000);

afterAll(async () => {
  await pool?.end().catch(() => undefined);
  dropProofDatabase(DB);
}, 120_000);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The answer to a challenge this build issues, recovered from the question.
 *
 * The question is the arithmetic one the issuer writes — "What is 7 + 5?" — and
 * the point of this helper is that the answer is NOT in the payload: it has to be
 * computed from what was sent.
 */
function answerOf(challenge: string): string {
  const match = /^What is (\d+) \+ (\d+)\?$/.exec(challenge);
  if (match === null) {
    throw new Error(`the challenge is not the shape this suite knows: '${challenge}'`);
  }
  return String(Number(match[1]) + Number(match[2]));
}

/** The row, read through the boundary — the same role the application writes as. */
async function readRow(tokenHash: string): Promise<Record<string, unknown> | undefined> {
  const client = await authenticatorClient(DB);
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_admin');
    const result = await client.query(
      'SELECT id, type, token_hash, challenge, solution_salt, solution_hash, is_used, used_at, issued_at, expires_at FROM public.captcha WHERE token_hash = $1',
      [tokenHash],
    );
    await client.query('COMMIT');
    return result.rows[0] as Record<string, unknown> | undefined;
  } finally {
    await client.end();
  }
}

/**
 * Plant a challenge row directly, through the boundary.
 *
 * **As `app_admin`, because the table is FORCEd.** `public.captcha` carries
 * `FORCE ROW LEVEL SECURITY` and its one policy admits `current_user =
 * 'app_admin'`, so the migration/owner role cannot write it either — a fixture
 * that reached around the boundary would fail, and a fixture that disabled
 * `row_security` would be the thing §B2 forbids.
 */
async function plantChallenge(
  token: string,
  salt: string,
  answer: string,
  issuedSecondsAgo: number,
  expiresSecondsAgo: number,
): Promise<void> {
  const client = await authenticatorClient(DB);
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_admin');
    await client.query(
      `INSERT INTO public.captcha
         (type, token_hash, challenge, solution_salt, solution_hash, issued_at, expires_at)
       VALUES ('text', $1, 'What is 5 + 6?', $2, $3,
               now() - make_interval(secs => $4::double precision),
               now() - make_interval(secs => $5::double precision))`,
      [
        sha256(token),
        salt,
        sha256(`${salt}:${answer}`),
        issuedSecondsAgo,
        expiresSecondsAgo,
      ],
    );
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

describe('the issuer stores nothing that answers the challenge', () => {
  it('keeps the token out of the row, so a dump of the table is not a set of replayable challenges', async () => {
    const issued = await service.issue('198.51.100.7');

    const row = await readRow(sha256(issued.token));
    expect(row, 'the challenge was not stored at all').toBeDefined();
    expect(row?.['token_hash']).not.toBe(issued.token);
    expect(row?.['token_hash']).toBe(sha256(issued.token));
  });

  it('keeps the answer out of the row, as a salted digest rather than as text', async () => {
    const issued = await service.issue('198.51.100.7');
    const answer = answerOf(issued.challenge);

    const row = await readRow(sha256(issued.token));
    expect(row?.['solution_hash']).not.toBe(answer);
    expect(row?.['solution_hash']).toBe(sha256(`${String(row?.['solution_salt'])}:${answer}`));
    // The salt is per row, so two challenges with the same answer do not share a
    // digest — which is what stops one precomputed table applying to every row.
    expect(String(row?.['solution_salt']).length).toBeGreaterThan(0);
  });

  it('sends the question and not the answer', async () => {
    const issued = await service.issue('198.51.100.7');

    expect(issued.challenge).toMatch(/^What is \d+ \+ \d+\?$/);
    expect(Object.keys(issued)).not.toContain('answer');
    expect(Object.keys(issued)).not.toContain('solution');
  });

  it('issues a text challenge, because an image challenge would exclude screen-reader users', async () => {
    const issued = await service.issue('198.51.100.7');
    expect(issued.type).toBe('text');
  });
});

describe('the verifier answers the server-side question', () => {
  it('accepts the right answer', async () => {
    const issued = await service.issue('198.51.100.7');
    await expect(service.verify(issued.token, answerOf(issued.challenge))).resolves.toBe(true);
  });

  it('refuses a wrong answer', async () => {
    const issued = await service.issue('198.51.100.7');
    await expect(service.verify(issued.token, answerOf(issued.challenge) + '0')).resolves.toBe(false);
  });

  it('refuses a token that was never issued', async () => {
    await expect(service.verify('never-issued-token', '12')).resolves.toBe(false);
  });

  it('tolerates the answer with whitespace around it, because a person types it', async () => {
    const issued = await service.issue('198.51.100.7');
    await expect(service.verify(issued.token, ` ${answerOf(issued.challenge)} `)).resolves.toBe(true);
  });
});

describe('single-use is a property of the write, not of the read', () => {
  it('refuses a second redemption of the same token', async () => {
    const issued = await service.issue('198.51.100.7');
    const answer = answerOf(issued.challenge);

    await expect(service.verify(issued.token, answer)).resolves.toBe(true);
    await expect(service.verify(issued.token, answer)).resolves.toBe(false);
  });

  it('records when the challenge was spent, because "used" alone cannot answer "used when"', async () => {
    const issued = await service.issue('198.51.100.7');
    await service.verify(issued.token, answerOf(issued.challenge));

    const row = await readRow(sha256(issued.token));
    expect(row?.['is_used']).toBe(true);
    expect(row?.['used_at']).not.toBeNull();
  });

  it('spends a challenge on a wrong answer too, so it cannot be brute-forced inside its window', async () => {
    const issued = await service.issue('198.51.100.7');
    const answer = answerOf(issued.challenge);

    await expect(service.verify(issued.token, '9999')).resolves.toBe(false);
    await expect(service.verify(issued.token, answer)).resolves.toBe(false);
  });
});

describe('an expired challenge is refused, on the database clock', () => {
  it('refuses a challenge whose window has closed', async () => {
    const token = 'an-expired-challenge-token';
    await plantChallenge(token, 'a-salt', '11', 7200, 3600);

    await expect(service.verify(token, '11')).resolves.toBe(false);
  });
});

describe('abandoned challenges are pruned', () => {
  it('removes the expired rows on the next issue, so the table does not grow for ever', async () => {
    const token = 'an-abandoned-challenge-token';
    await plantChallenge(token, 'salt', '11', 7200, 3600);
    expect(await readRow(sha256(token))).toBeDefined();

    await service.issue('198.51.100.7');

    expect(await readRow(sha256(token)), 'the abandoned row was not pruned').toBeUndefined();
  });
});
