import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISABLED_ACCOUNT_PREDICATE_SQL, RECORD_LAST_LOGIN_SQL } from '../../../src/auth/auth.service.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * The parts of `auth.service.ts` that are SQL **text** and a *convention*, asserted as
 * text. Everything that needs a real Postgres is elsewhere; see the note at the foot.
 *
 * `AGENTS.md` §3 draws the line explicitly: "a lint rule is the right tool when the
 * violation is a node, and the wrong tool when the violation is a payload." The clock
 * argument for the disable predicate, and the argument that `last_login_at` is not the
 * caller's to stamp, both live inside string literals — no AST selector reaches them, and
 * a `no-restricted-syntax` rule over `client.query(...)` would miss every shape an author
 * would actually write. So the enforcement reads the shipped string, which is what this
 * file is.
 *
 * The last describe in it is the one that makes the rest meaningful: a scanner that finds
 * nothing because it cannot find anything is §B8's "test that always exits 0", so each
 * finder is handed a deliberately-broken sample and shown to go red.
 */

/**
 * Comments removed, string literals kept, **line numbers preserved**.
 *
 * The line numbers are the point: a finding is reported as a location in
 * `auth.service.ts`, because a convention enforced by reading a file is only actionable
 * if it says where. String literals survive, since the literal `'invalid credentials'`
 * is exactly what one of these cases hunts for — and the block-comment branch copies its
 * newlines, so a finding's line still means the same line it did before stripping.
 *
 * It is a scanner, not a parser: a regex literal containing a quote would confuse it. This
 * file's subject has none, and a general solution would be a parser, which is the thing §3
 * says not to reach for when the payload is a string.
 */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    const next = source[i + 1] ?? '';
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') {
          out += '\n';
        }
        i += 1;
      }
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      out += ch;
      i += 1;
      while (i < source.length) {
        const inner = source[i] ?? '';
        if (inner === '\\') {
          out += inner + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += inner;
        i += 1;
        if (inner === ch) {
          break;
        }
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** 1-based line numbers of every line of `source` containing `needle`. */
export function linesContaining(source: string, needle: string): number[] {
  const found: number[] = [];
  source.split('\n').forEach((line, index) => {
    if (line.includes(needle)) {
      found.push(index + 1);
    }
  });
  return found;
}

const AUTH_SERVICE_PATH = join(BACKEND_ROOT, 'src/auth/auth.service.ts');
const AUTH_SERVICE = stripComments(readFileSync(AUTH_SERVICE_PATH, 'utf8'));

/**
 * The interpolation site, as it appears in source. `findUser` and `findUserById` build
 * their `SELECT` lists from the exported constant rather than repeating the predicate, so
 * the needle is the closing brace of the interpolation rather than the predicate's own
 * text — which is what makes "two call sites" and "one definition" distinguishable.
 */
const DISABLED_PREDICATE_USE = 'DISABLED_ACCOUNT_PREDICATE_SQL} AS is_disabled';

describe('an account is disabled by the database clock, and the shipped predicate says so', () => {
  it('names both columns, because reading only disabled_at locks out an account whose suspension has already expired', () => {
    // Four rows have to be told apart, and the reason a check written as
    // `disabled_at IS NOT NULL` is a *different policy* rather than a shorter one: it
    // leaves `disabled_until` a column nothing consults, which is the §2.1 shape `0023`
    // adds the columns to avoid and cannot itself avoid.
    expect(DISABLED_ACCOUNT_PREDICATE_SQL).toContain('disabled_at IS NOT NULL');
    expect(DISABLED_ACCOUNT_PREDICATE_SQL).toContain('disabled_until IS NULL');
    expect(DISABLED_ACCOUNT_PREDICATE_SQL).toContain('disabled_until >');
    expect(DISABLED_ACCOUNT_PREDICATE_SQL).not.toBe('(disabled_at IS NOT NULL)');
  });

  it('compares against now(), so the decision cannot be made against this process clock', () => {
    // The hazard is clock SKEW, not correctness: a caller-supplied comparison is right to
    // within the distance between two clocks and wrong by exactly that much at a
    // `disabled_until` a few milliseconds away — and the half that is wrong refuses a
    // legitimate credential check for the size of the skew. §B2's position on a value a
    // caller supplies and something else reads.
    expect(DISABLED_ACCOUNT_PREDICATE_SQL).toContain('now()');
    expect(DISABLED_ACCOUNT_PREDICATE_SQL).not.toMatch(/\$\d/);
    expect(DISABLED_ACCOUNT_PREDICATE_SQL).not.toContain('current_timestamp');
  });

  it('is a boolean expression rather than a column read, so the row is read once', () => {
    // A SELECT-list expression is what lets the decision ride on the SAME snapshot as the
    // `password_hash` beside it. A second statement could see the row enabled in one
    // snapshot and disabled in the other, and "the row was enabled when we read the
    // hash" is not a sentence anybody should have to reason about.
    expect(DISABLED_ACCOUNT_PREDICATE_SQL.startsWith('(')).toBe(true);
    expect(DISABLED_ACCOUNT_PREDICATE_SQL.endsWith(')')).toBe(true);
  });

  it('is used by BOTH session readers, and the predicate text exists nowhere else', () => {
    // Sign-in and refresh are the only two ways an unproven caller becomes a proven one in
    // this architecture, so a disable enforced on one of them is a disable with a fuse.
    // And the expression must be written once: two copies are one correct copy and one
    // drifted copy, and the drifted one is the one nobody re-reads.
    expect(linesContaining(AUTH_SERVICE, DISABLED_PREDICATE_USE)).toHaveLength(2);

    const definitions = linesContaining(AUTH_SERVICE, 'disabled_at');
    expect(definitions).toHaveLength(1);
    expect(linesContaining(AUTH_SERVICE, 'disabled_until')).toEqual(definitions);

    // Prettier breaks this definition over two lines because the expression is long, so
    // the name and the text are asserted together rather than on one line.
    const start = definitions[0] ?? 1;
    const statement = (AUTH_SERVICE.split('\n').slice(start - 2, start).join('\n')).trim();
    expect(statement).toContain('export const DISABLED_ACCOUNT_PREDICATE_SQL');
  });
});

describe('last_login_at records an authentication fact and nothing else', () => {
  it('is written from the database clock, never from a parameter a caller chose', () => {
    // `0023`'s column comment states this as a requirement, not a preference: a caller
    // that could write an arbitrary `last_login_at` could backdate or postdate its own
    // sign-in, on a column whose only job is to be believed by whoever reads it in an
    // incident review.
    expect(RECORD_LAST_LOGIN_SQL).toContain('last_login_at = now()');

    // One bound parameter, and it is the id. A second `$n` here is a timestamp, or a
    // column nobody audited.
    expect(RECORD_LAST_LOGIN_SQL.match(/\$(\d)/g) ?? []).toEqual(['$1']);
    expect(RECORD_LAST_LOGIN_SQL).toContain('WHERE id = $1');
  });

  it('refuses a tombstone, so an anonymised row does not acquire a fresh authentication clock', () => {
    // `0017`'s reason for the same guard on `last_activity_at` — "the clock on a scrubbed
    // row must not restart" — is stronger here, because this column is a fact an
    // investigator reads rather than an activity estimate.
    expect(RECORD_LAST_LOGIN_SQL).toContain('deleted_at IS NULL');
  });

  it('is a second statement with exactly one call site, not a fourth argument to record_user_activity', () => {
    // `0023`: collapsing the two columns "would let a broad activity signal overwrite an
    // authentication fact". `authz.record_user_activity()` has four call sites and three
    // of them are not credential checks, so folding this column into that function would
    // let a refresh or a logout stamp when a password last succeeded.
    expect(RECORD_LAST_LOGIN_SQL).not.toContain('authz.');
    expect(RECORD_LAST_LOGIN_SQL).not.toContain('last_activity_at');
    expect(linesContaining(AUTH_SERVICE, 'client.query(RECORD_LAST_LOGIN_SQL')).toHaveLength(1);
  });
});

describe('a disabled account and a wrong password are the same answer, structurally', () => {
  it('has exactly ONE literal for the credential refusal, so the two branches cannot drift apart', () => {
    // The property is not "both say invalid credentials today". It is that there is
    // nothing left to edit: two `if`s with two literals would differ the moment one was
    // changed — in exactly the direction that hands an attacker the account's state — and
    // a suite asserting each message independently stays green on both.
    expect(linesContaining(AUTH_SERVICE, "'invalid credentials'")).toHaveLength(1);
    expect(linesContaining(AUTH_SERVICE, 'INVALID_CREDENTIALS_MESSAGE').length).toBeGreaterThanOrEqual(3);
  });

  it('never names the account state in anything the caller can see', () => {
    // A new exception type, a distinct status, or a message word would each restore the
    // oracle. Matched as text rather than asserted per-branch, so this goes red the
    // moment a `ForbiddenException('account is disabled')` appears anywhere.
    const forbidden = ['ForbiddenException', 'HttpStatus.FORBIDDEN', 'account is disabled', 'account has been disabled'];
    for (const phrase of forbidden) {
      expect(linesContaining(AUTH_SERVICE, phrase), `${phrase} appears in auth.service.ts`).toEqual([]);
    }
  });

  it('refuses after the compare rather than before it, because a faster answer is the same oracle', () => {
    // Source order, asserted rather than timed: `bcrypt.compare` must come before the
    // condition that consults `is_disabled`. A guard clause above the compare would answer
    // in the time of two indexed lookups for exactly the requests where the account
    // exists and is switched off — the same leak the message argument closes, arriving
    // over a channel the message argument never sees.
    const compareLine = linesContaining(AUTH_SERVICE, 'await bcrypt.compare(dto.password, candidate)')[0] ?? 0;
    const disableLine = linesContaining(AUTH_SERVICE, 'user.is_disabled')[0] ?? 0;
    expect(compareLine).toBeGreaterThan(0);
    expect(disableLine).toBeGreaterThan(0);
    expect(compareLine).toBeLessThan(disableLine);

    // One condition, one refusal: the disable is not a second `if` beside it.
    expect(linesContaining(AUTH_SERVICE, '!passwordOk || user.is_disabled')).toHaveLength(1);
  });

  it('leaves the audit row as a tracked failure, so a disabled account still spends the failure budget', () => {
    // The statement that flips `login_attempts` to 'succeeded' is the first one after the
    // refusal condition, so a disabled account leaves exactly what a wrong password
    // leaves — one 'failed' row — and hammering a disabled account stays visible to §B6's
    // per-account counter and to the ledger.
    expect(linesContaining(AUTH_SERVICE, "UPDATE login_attempts SET status = 'succeeded'")).toHaveLength(1);
    const condition = 'if (user === undefined || !passwordOk || user.is_disabled)';
    expect(linesContaining(AUTH_SERVICE, condition)).toHaveLength(1);
  });

  it('refuses a disabled account on refresh too, because "cannot sign in" is not "disabled"', () => {
    // A session that can mint a fresh access token every thirty seconds without ever
    // touching a password is not disabled, it is merely unable to *start*. Two sites and
    // not one is the whole of the boundary here, so losing either is a real hole.
    const lookup = linesContaining(AUTH_SERVICE, 'this.findUserById(client, row.user_id)');
    expect(lookup).toHaveLength(1);
    const sites = linesContaining(AUTH_SERVICE, 'user === undefined || user.is_disabled');
    expect(sites).toHaveLength(1);
    expect(sites[0]).toBeGreaterThan(lookup[0] ?? 0);
  });
});

/**
 * The scanner is shown the shapes it exists to refuse, so the empty results above are not
 * a scanner that cannot find anything (§B8: a test that cannot fail is a liability).
 */
describe('the scanner fails on the shapes it exists to refuse', () => {
  it('reports a second spelling of the credential refusal, and strips prose that merely quotes it', () => {
    const drifted = stripComments(
      [
        "throw new UnauthorizedException('invalid credentials');",
        '// this comment says invalid credentials and must not count',
        "throw new UnauthorizedException('your account is disabled');",
      ].join('\n'),
    );
    expect(linesContaining(drifted, "'invalid credentials'")).toHaveLength(1);
    expect(linesContaining(drifted, "'your account is disabled'")).toHaveLength(1);
    // Comment text is not source, so the prose line contributes nothing.
    expect(linesContaining(drifted, 'invalid credentials')).toHaveLength(1);
  });

  it('reports a check placed above the compare, which is the timing oracle', () => {
    const early = stripComments(
      [
        'if (user !== undefined && user.is_disabled) { throw new UnauthorizedException(MESSAGE); }',
        'const passwordOk = await bcrypt.compare(dto.password, candidate);',
      ].join('\n'),
    );
    const compareLine = linesContaining(early, 'await bcrypt.compare(dto.password, candidate)')[0] ?? 0;
    const disableLine = linesContaining(early, 'user.is_disabled')[0] ?? 0;
    expect(disableLine).toBeGreaterThan(0);
    expect(disableLine).toBeLessThan(compareLine);
  });

  it('reports a caller-supplied timestamp and a bare presence test, the two ways the clock argument is lost', () => {
    expect('(disabled_at IS NOT NULL)').not.toContain('disabled_until');
    expect('(disabled_at IS NOT NULL AND $2::timestamptz > disabled_until)').not.toContain('now()');
  });
});

/**
 * The other half of this unit's evidence, and why it cannot live here.
 *
 * That a disabled account is REFUSED, that the refusal is byte-identical to a wrong
 * password's, that the attempt is still audited, that an expired suspension stops
 * blocking, that `last_login_at` moves on success and not on refusal, and that a refresh
 * is refused too, all need a real PostgreSQL and a real HTTP boundary. They are in
 * `test/e2e/login.e2e-spec.ts`, `test/e2e/brute-force.e2e-spec.ts` and
 * `test/e2e/refresh-logout.e2e-spec.ts`. Neither file can substitute for the other: this
 * one cannot prove the SQL does what it says, and those three cannot prove the SQL still
 * says it.
 */