import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TokenService } from '../../../src/token/token.service.js';
import type { TokenEnvironment } from '../../../src/token/token-environment.js';
import type { EmailService } from '../../../src/email/email.service.js';
import { scriptedPool, type ScriptedPool, type ScriptedStatement } from '../../support/breaker-harness.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * The escalation boundary: `BEGIN` **then** `SET LOCAL ROLE app_admin`.
 *
 * ## The defect this exists to prevent, which shipped
 *
 * `TokenService` issued `SET LOCAL ROLE app_admin` on a bare connection with no
 * `BEGIN`. `SET LOCAL` outside a transaction block does not error — PostgreSQL
 * emits `WARNING: SET LOCAL can only be used in transaction blocks` and the
 * statement has **no effect**. Every statement therefore ran as
 * `pgrst_authenticator`, which holds no privileges on `users`, `refresh_tokens` or
 * `auth_tokens`, and the password-reset route answered with a logged
 * `permission denied for table users` while still returning `202`.
 *
 * It was invisible for three reasons, and each is a gap this file closes:
 *
 *  1. **The `authz.*` functions still worked** under the owner, so
 *     `test/rls/auth-tokens.spec.ts` — which calls them directly — stayed green.
 *  2. **The failing statement was not in the primitive**, so the primitive's own
 *     unit specs, which script the pool, passed: a scripted pool answers whatever
 *     it is asked, and `SET LOCAL` never raises.
 *  3. **The warning was easy to lose** among the `ERROR` lines the same run
 *     produced, and the error names a *permission*, which sends the next reader
 *     looking at the grants instead of at the transaction.
 *
 * So the control has to be **behavioural and about ordering**: the statements this
 * class issues, in the order it issues them, on a pool that records them. A check
 * that `SET LOCAL ROLE` appears says nothing — the broken version passed it, and
 * so does the version in this file.
 */

const TOKEN_ENV: TokenEnvironment = {
  pepper: 'test-pepper-token-secret-must-be-32-chars-long',
  pepperKid: 'test-kid-v1',
};

/**
 * The mail path is not what this file is about, and a rejecting fake would make
 * `deliver` throw before the assertions could read the statements. Resolved, and
 * carrying nothing, because no assertion here looks at a message.
 */
const NO_MAIL: EmailService = {
  sendPasswordResetEmail: () => Promise.resolve({ messageId: '<no-mail-this-suite>', accepted: [] }),
  sendVerificationEmail: () => Promise.resolve({ messageId: '<no-mail-this-suite>', accepted: [] }),
  sendErasureReceipt: () => Promise.resolve({ messageId: '<no-mail-this-suite>', accepted: [] }),
} as unknown as EmailService;

function serviceOver(pool: ScriptedPool): TokenService {
  return new TokenService(pool.source, TOKEN_ENV, NO_MAIL);
}

/** The first index of a statement matching, or -1. */
function at(statements: readonly ScriptedStatement[], fragment: string): number {
  return statements.findIndex((statement) => statement.text.includes(fragment));
}

/**
 * Every method that reaches the database, each driven once.
 *
 * A single shared assertion over one recorded sequence per method, because the
 * invariant is the same shape in all five: the elevation is scoped to a
 * transaction and the transaction ends before the connection is released.
 */
async function eachDatabaseCall(
  work: (service: TokenService) => Promise<unknown>,
): Promise<readonly ScriptedStatement[]> {
  const pool = scriptedPool([
    {
      when: (statement) => statement.includes('authz.mint_auth_token'),
      results: [{ rows: [{ id: '018f3c2a-1b4d-7c8e-9f01-23456789abcd' }], rowCount: 1 }],
    },
    {
      when: (statement) => statement.includes('SELECT id, username, email FROM public.users'),
      results: [{ rows: [{ id: '018f3c2a-1b4d-7c8e-9f01-000000000001', username: 'u', email: 'u@example.test' }], rowCount: 1 }],
    },
  ]);
  await work(serviceOver(pool));
  return pool.statements();
}

describe('every statement TokenService issues runs inside a transaction it opened first', () => {
  it('mint: BEGIN, then the elevation, then the call, then COMMIT', async () => {
    const statements = await eachDatabaseCall((service) =>
      service.mint({ purpose: 'password_reset', subjectIdentifier: 'u@example.test' }),
    );
    const texts = statements.map((statement) => statement.text);

    expect(texts.indexOf('BEGIN')).toBe(0);
    expect(texts.indexOf('SET LOCAL ROLE app_admin')).toBeGreaterThan(texts.indexOf('BEGIN'));
    expect(at(statements, 'authz.mint_auth_token')).toBeGreaterThan(texts.indexOf('SET LOCAL ROLE app_admin'));
    expect(texts.indexOf('COMMIT')).toBeGreaterThan(at(statements, 'authz.mint_auth_token'));
    // The connection goes back to the pool only after the transaction closed, so the
    // next borrower cannot inherit an elevated session.
    expect(texts.indexOf('COMMIT')).toBe(texts.length - 1);
  });

  it('redeem: the same shape, and the redemption is the only work inside it', async () => {
    const statements = await eachDatabaseCall((service) =>
      service.redeem({ rawToken: 'a-token-long-enough-to-pass-the-window', expectedPurpose: 'password_reset' }),
    );
    const texts = statements.map((statement) => statement.text);

    expect(texts.indexOf('BEGIN')).toBe(0);
    expect(at(statements, 'authz.redeem_auth_token')).toBeGreaterThan(texts.indexOf('SET LOCAL ROLE app_admin'));
    expect(texts.indexOf('COMMIT')).toBeGreaterThan(at(statements, 'authz.redeem_auth_token'));
  });

  it('invalidateSubjectTokens and purgeExpiredTokens both open one', async () => {
    for (const work of [
      (service: TokenService) => service.invalidateSubjectTokens('u@example.test', 'password_reset'),
      (service: TokenService) => service.purgeExpiredTokens(new Date(0)),
    ]) {
      const statements = await eachDatabaseCall(work);
      const texts = statements.map((statement) => statement.text);

      expect(texts.indexOf('BEGIN'), 'the elevation opened no transaction').toBe(0);
      expect(texts.indexOf('SET LOCAL ROLE app_admin')).toBeGreaterThan(0);
      expect(texts.indexOf('COMMIT')).toBe(texts.length - 1);
    }
  });

  it('deliver: the account lookup is elevated too, which is the statement that failed in production', async () => {
    // `pgrst_authenticator` holds no grant on `users` at all, so this one statement
    // is the difference between "unknown address" and `42501 permission denied`.
    const statements = await eachDatabaseCall((service) =>
      service.deliver({ purpose: 'password_reset', email: 'u@example.test' }),
    );
    const lookup = at(statements, 'SELECT id, username, email FROM public.users');

    expect(lookup).toBeGreaterThan(-1);
    expect(statements[lookup - 1]?.text).toBe('SET LOCAL ROLE app_admin');
    expect(statements.slice(0, lookup).some((statement) => statement.text === 'BEGIN')).toBe(true);
  });
});

describe('a failure inside the elevated transaction rolls it back and releases the connection', () => {
  it('rolls back rather than leaving a transaction open on a pooled connection', async () => {
    const boom = new Error('the call failed');
    const pool = scriptedPool([], {
      raise: { when: (statement) => statement.includes('authz.mint_auth_token'), error: boom },
    });

    await expect(
      serviceOver(pool).mint({ purpose: 'password_reset', subjectIdentifier: 'u@example.test' }),
    ).rejects.toThrow(boom);

    const texts = pool.statements().map((statement) => statement.text);
    expect(texts.indexOf('ROLLBACK')).toBeGreaterThan(texts.indexOf('BEGIN'));
    expect(texts).not.toContain('COMMIT');
  });
});

/**
 * The tree-wide half.
 *
 * The behavioural cases above cover the class that actually had the bug. This
 * covers the *next* one: a new module that elevates and forgets the transaction.
 * A per-file check cannot see a method-level mistake inside a file that opens a
 * transaction elsewhere — the behavioural cases are what do that — but it does
 * catch a brand-new file written from the broken shape, which is the moment the
 * mistake is most likely.
 *
 * Non-vacuous by construction: the walk refuses to find no files at all, which is
 * the `down-script.spec.ts` failure shape where an empty enumeration makes every
 * assertion pass.
 */
describe('no module in src/ elevates without opening a transaction', () => {
  const ELEVATION = 'SET LOCAL ROLE';
  const BEGIN = "'BEGIN'";

  /**
   * Comments removed before the scan, for the same reason `claims-write-surface.spec.ts`
   * strips them: `src/purge/purge.module.ts` *describes* the escalation in prose and
   * never issues it, and a scanner that cannot tell a mention from a statement
   * reports it. Stripping is what makes the result a claim about code.
   */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => {
        const comment = line.indexOf('//');
        return comment === -1 ? line : line.slice(0, comment);
      })
      .join('\n');
  }

  function tsFilesUnder(root: string): readonly string[] {
    const found: string[] = [];
    for (const entry of readdirSync(root)) {
      const path = join(root, entry);
      if (statSync(path).isDirectory()) {
        found.push(...tsFilesUnder(path));
      } else if (entry.endsWith('.ts')) {
        found.push(path);
      }
    }
    return found.sort();
  }

  const SRC_ROOT = join(BACKEND_ROOT, 'src');
  const elevating = tsFilesUnder(SRC_ROOT).filter((file) =>
    stripComments(readFileSync(file, 'utf8')).includes(ELEVATION),
  );

  it('finds the modules to check, so an empty enumeration is not a pass', () => {
    expect(tsFilesUnder(SRC_ROOT).length).toBeGreaterThan(10);
    // Stated as a fact about the tree rather than left implicit: a future reader who
    // makes this list empty has not removed a risk, they have removed the check.
    expect(elevating.length, 'no module elevates any more; is this scanner still the right control?').toBeGreaterThan(2);
  });

  it('every module that names the elevation also opens a transaction', () => {
    const offenders: string[] = [];
    for (const file of elevating) {
      if (!stripComments(readFileSync(file, 'utf8')).includes(BEGIN)) {
        offenders.push(relative(BACKEND_ROOT, file));
      }
    }
    expect(
      offenders,
      'these modules issue SET LOCAL ROLE with no BEGIN anywhere, so the elevation is a warning and the statements run unelevated',
    ).toEqual([]);
  });

  it('the scanner can fail, so the empty list above is not vacuous', () => {
    // A file that elevates and never begins — the exact shape that shipped.
    const broken = stripComments("await client.query('SET LOCAL ROLE app_admin');");
    expect(broken.includes(ELEVATION)).toBe(true);
    expect(broken.includes(BEGIN)).toBe(false);

    // …and the fixed shape reads as clean.
    const fixed = stripComments("await client.query('BEGIN'); await client.query('SET LOCAL ROLE app_admin');");
    expect(fixed.includes(ELEVATION) && fixed.includes(BEGIN)).toBe(true);

    // …and a mention inside a comment is invisible to the scan, which is the
    // property that keeps `purge.module.ts` out of the offender list.
    const proseOnly = stripComments('// this module uses SET LOCAL ROLE app_admin, always');
    expect(proseOnly.includes(ELEVATION)).toBe(false);
  });
});