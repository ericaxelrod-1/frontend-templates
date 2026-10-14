import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLAIM_DUE_PURGE_SQL, COMPLETE_PURGE_SQL, FAIL_PURGE_SQL, REQUEUE_PURGE_SQL, toPurgeClaim } from '../../../src/purge/purge-claim.js';
import type { PurgeClaimRow } from '../../../src/purge/purge-claim.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * The claim, asserted on the SQL itself.
 *
 * `FOR UPDATE SKIP LOCKED` in a statement of its own is not a design here; it is
 * the fix for the legacy defect that four lines apart got the claim right and the
 * follow-up read wrong. These assertions are on the *statement text* because the
 * property is structural — no second statement exists to disagree with the first —
 * and a behavioural test would need two live connections against a queue to prove
 * it, which is the integration suite's job rather than this one's.
 */

/** Comment-stripped, so a comment that NAMES the forbidden construct is not a finding. */
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
      continue;
    }
    if (entry.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}

const CLAIM_COLUMN = (row: PurgeClaimRow): PurgeClaimRow => row;

describe('the claim statement', () => {
  it('selects and locks in ONE statement, so the two cannot disagree', () => {
    // The defect this replaces: an atomic conditional UPDATE as the claim, then an
    // unguarded re-read by primary key. There is no interval between them here
    // because there is only one statement.
    expect(CLAIM_DUE_PURGE_SQL).toContain('FOR UPDATE SKIP LOCKED');
    expect(CLAIM_DUE_PURGE_SQL).toContain("WHERE status = 'pending'");
    expect(CLAIM_DUE_PURGE_SQL).toContain("SET status       = 'claimed'");
    expect(CLAIM_DUE_PURGE_SQL).toContain('claimed_by');
    expect(CLAIM_DUE_PURGE_SQL).toContain('attempt      = q.attempt + 1');

    // Exactly one statement: no second `;`-terminated command hides in the string.
    expect(CLAIM_DUE_PURGE_SQL.replace(/;\s*$/, '')).not.toContain(';');
  });

  it('is bounded by LIMIT, so a single claim can never take the whole queue', () => {
    expect(CLAIM_DUE_PURGE_SQL).toContain('LIMIT 1');
  });

  it('only ever claims work that is DUE', () => {
    expect(CLAIM_DUE_PURGE_SQL).toContain('scheduled_for <= now()');
    expect(CLAIM_DUE_PURGE_SQL).toContain('ORDER BY scheduled_for, id');
  });

  it('returns the ownership key, so every later statement can predicate on it', () => {
    // `locked_at` recorded WHEN and never WHO, so two sweepers were
    // indistinguishable and no read could predicate on ownership even when it
    // wanted to.
    expect(CLAIM_DUE_PURGE_SQL).toContain('RETURNING');
    expect(COMPLETE_PURGE_SQL).toContain("status = 'claimed'");
    expect(COMPLETE_PURGE_SQL).toContain('claimed_by = $2');
    expect(COMPLETE_PURGE_SQL).not.toMatch(/WHERE id = \$1\s*;/);

    // Every write after the claim carries the SAME ownership predicate, including
    // the two failure writes. A duplicated `WHERE` clause is where the legacy's
    // unguarded re-read came from, so there is one text per operation and all
    // three assert on it.
    expect(FAIL_PURGE_SQL).toContain("status = 'claimed'");
    expect(FAIL_PURGE_SQL).toContain('claimed_by = $2');
    expect(REQUEUE_PURGE_SQL).toContain("status = 'claimed'");
    expect(REQUEUE_PURGE_SQL).toContain('claimed_by = $2');
  });

  it('keeps the error on a requeue, so the reason survives into the next attempt', () => {
    // Below the attempt limit the row returns to `pending` WITH its error. An
    // attempt that loses its reason is an attempt nobody can debug.
    expect(REQUEUE_PURGE_SQL).toContain("status     = 'pending'");
    expect(REQUEUE_PURGE_SQL).toContain('error      = $3');
    expect(REQUEUE_PURGE_SQL).toContain('claimed_by = NULL');
    // And the poison pill is terminal and keeps its error too — a `failed` row an
    // operator cannot read the reason off is a silent data loss.
    expect(FAIL_PURGE_SQL).toContain("status = 'failed'");
    expect(FAIL_PURGE_SQL).toContain('error  = $3');
  });

  it('carries no staleness column, because there is no window to strand a row in', () => {
    // Claim, delete and mark-done are one transaction, so a process death cannot
    // leave a row in `claimed` with nothing to reclaim it. That is why there is no
    // `locked_at` here and no staleness monitor that could be written wrong.
    expect(CLAIM_DUE_PURGE_SQL).not.toContain('locked_at');
  });
});

describe('the claim row', () => {
  it('narrows target_kind to the closed set rather than passing an unknown value through', () => {
    const row = CLAIM_COLUMN({
      id: 'r1',
      target_kind: 'user',
      target_id: 'u1',
      target_ref: null,
      reason: 'inactivity_purge',
      attempt: 1,
    });

    expect(toPurgeClaim(row)).toEqual({
      id: 'r1',
      targetKind: 'user',
      targetId: 'u1',
      targetRef: null,
      reason: 'inactivity_purge',
      attempt: 1,
    });
  });

  it('refuses an unrecognised target_kind, so no downstream switch can grow a default branch', () => {
    expect(
      toPurgeClaim({
        id: 'r1',
        target_kind: 'bucket',
        target_id: null,
        target_ref: 's3://x',
        reason: 'retention_export_artefact',
        attempt: 1,
      }),
    ).toBeUndefined();
  });
});

describe('the abort handle has exactly one owner', () => {
  it('constructs an AbortController in the gate and nowhere else in src/', () => {
    // An `AbortController` that is constructed and never passed to its consumer is
    // not a timeout, it is a comment: it produces the complete appearance of a
    // recoverable abort and none of the behaviour, and it survives review because
    // the surrounding code is correct. `privacy.service.ts:209-217` is that shape.
    //
    // This is the enforcement behind `eslint.config.js`'s `no-restricted-syntax`
    // rule, asserted independently so the property holds even if somebody removes
    // the rule and forgets to restore it.
    const offenders = tsFilesUnder(join(BACKEND_ROOT, 'src'))
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => !file.endsWith(join('breaker', 'breaker-gate.ts')))
      .filter((file) => stripComments(readFileSync(file, 'utf8')).includes('new AbortController('))
      .map((file) => relative(BACKEND_ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('declares the rule that forbids it, so a new controller is a lint error rather than a review comment', () => {
    const config = readFileSync(join(BACKEND_ROOT, 'eslint.config.js'), 'utf8');
    expect(config).toContain("NewExpression[callee.name='AbortController']");
    expect(config).toContain('src/breaker/breaker-gate.ts');
  });
});