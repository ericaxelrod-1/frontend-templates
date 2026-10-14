import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLAIM_DUE_PURGE_SQL,
  COMPLETE_PURGE_SQL,
  FAIL_PURGE_SQL,
  REQUEUE_PURGE_SQL,
  toPurgeClaim,
  writtenRows,
} from '../../../src/purge/purge-claim.js';
import type { PurgeClaimRow } from '../../../src/purge/purge-claim.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * The claim, asserted on the SQL itself — which now lives in the migration.
 *
 * ## Why the assertions moved rather than disappeared
 *
 * `FOR UPDATE SKIP LOCKED` in a statement of its own is not a design here; it is
 * the fix for the legacy defect that four lines apart got the claim right and the
 * follow-up read wrong, and every assertion below exists because a claim split in
 * two lets two sweepers disagree about which row they hold.
 *
 * Those properties are properties of the STATEMENT, and migration `0016` moved
 * the statement into `authz.claim_due_purge()` — a narrowly-granted
 * `SECURITY DEFINER` function — because the bare `UPDATE` this file used to
 * assert on matched zero rows in production: its inner `SELECT` was governed by
 * `privacy_purge_read`, which is a capability call on `authz.actor()`, and
 * `PurgeSweeper` has no claims document in scope by design (`AGENTS.md` §B2 F1).
 *
 * So the assertions below read the migration that owns the statement. **Every
 * property that was asserted before is still asserted**, against the file that
 * now carries the text, and the set has grown: the seam itself is now asserted
 * too — that each function is `SECURITY DEFINER` with a pinned `search_path`,
 * that `EXECUTE` is revoked from `PUBLIC` and granted to `app_admin` and to
 * nobody else, and that no serving role can write the queue table directly any
 * more. A test that stopped when the code moved would have left the properties
 * unasserted for exactly as long as the move took to be forgotten.
 *
 * The behavioural proof that the claim works with **no claims document in scope**
 * is `test/rls/purge-machine-path.spec.ts`, which runs it against a real
 * provisioned database; this file is the structural one, and it reads from disk so
 * it needs no running server.
 */

const MIGRATION_DIR = join(BACKEND_ROOT, 'database', 'migrations');
const MACHINE_PATH_MIGRATION = join(MIGRATION_DIR, '0016_purge_machine_path.sql');

/** Comment-stripped, so a comment that NAMES the forbidden construct is not a finding. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('--');
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join('\n');
}

/**
 * One function's executable SQL, read from the migration.
 *
 * Throws rather than returning `''` for a function this build does not define:
 * a checker handed an empty string asserts `not.toContain('FOR UPDATE SKIP
 * LOCKED')` and passes, which is the §2.1 shape reached through a test — a
 * migration that lost the claim entirely would report the claim's properties as
 * intact.
 */
function functionSql(name: string): string {
  const migration = stripComments(readFileSync(MACHINE_PATH_MIGRATION, 'utf8'));
  const declaration = `CREATE OR REPLACE FUNCTION ${name}(`;
  const start = migration.indexOf(declaration);
  if (start === -1) {
    throw new Error(`${MACHINE_PATH_MIGRATION} does not define ${name}, so its properties cannot be asserted`);
  }
  const body = migration.slice(start);
  const open = body.indexOf('AS $$');
  const close = body.indexOf('$$;', open);
  if (open === -1 || close === -1) {
    throw new Error(`${name} has no dollar-quoted body this reader can find`);
  }
  return body.slice(open + 'AS $$'.length, close);
}

/** The statements after the argument guards — the work, as opposed to the validation. */
function returnQueryBody(name: string): string {
  const sql = functionSql(name);
  const start = sql.indexOf('RETURN QUERY');
  if (start === -1) {
    throw new Error(`${name} does no work: it has no RETURN QUERY`);
  }
  return sql.slice(start);
}

function tsFilesUnder(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.endsWith('.ts')) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found;
}

const CLAIM_COLUMN = (row: PurgeClaimRow): PurgeClaimRow => row;

describe('the claim statement', () => {
  it('is the one statement the migration ships, and it selects and locks in one step', () => {
    // The defect this replaces: an atomic conditional UPDATE as the claim, then an
    // unguarded re-read by primary key. There is no interval between them here
    // because there is only one statement.
    const claim = returnQueryBody('authz.claim_due_purge');
    expect(claim).toContain('FOR UPDATE SKIP LOCKED');
    expect(claim).toContain("WHERE status = 'pending'");
    expect(claim).toContain("SET status     = 'claimed'");
    expect(claim).toContain('claimed_by');
    expect(claim).toContain('attempt    = q.attempt + 1');

    // Exactly one statement: after the guards, the work is one `;`-terminated
    // command. A second command in here is a window between selecting a row and
    // marking it, which is the shape this design exists to remove.
    expect(claim.split(';').length - 1).toBe(1);
  });

  it('is bounded by LIMIT, so a single claim can never take the whole queue', () => {
    expect(returnQueryBody('authz.claim_due_purge')).toContain('LIMIT 1');
  });

  it('only ever claims work that is DUE', () => {
    const claim = returnQueryBody('authz.claim_due_purge');
    expect(claim).toContain('scheduled_for <= now()');
    // The tie-break must be stable across two sweepers or two of them contend for
    // one row and one of them does nothing.
    expect(claim).toContain('ORDER BY scheduled_for, id');
  });

  it('returns the ownership key, so every later statement can predicate on it', () => {
    // `locked_at` recorded WHEN and never WHO, so two sweepers were
    // indistinguishable and no read could predicate on ownership even when it
    // wanted to.
    expect(returnQueryBody('authz.claim_due_purge')).toContain('RETURNING');

    // Every write after the claim carries the SAME ownership predicate, including
    // the two failure writes. A duplicated `WHERE` clause is where the legacy's
    // unguarded re-read came from, so there is one text per operation and all
    // three assert on it.
    for (const write of [completeBody(), failBody(), requeueBody()]) {
      expect(write).toContain("status = 'claimed'");
      expect(write).toContain('claimed_by = p_instance');
    }
    // …and the primary key alone is never the predicate.
    expect(completeBody()).not.toMatch(/WHERE id = p_id\s*;/);
  });

  it('keeps the error on a requeue, so the reason survives into the next attempt', () => {
    // Below the attempt limit the row returns to `pending` WITH its error. An
    // attempt that loses its reason is an attempt nobody can debug.
    expect(requeueBody()).toContain("status     = 'pending'");
    expect(requeueBody()).toContain('error      = p_error');
    // Clearing the owner is what keeps the table's `pending ⇒ unowned` CHECK true,
    // and a `pending` row that still named a sweeper would let that sweeper's next
    // write match a row it no longer holds.
    expect(requeueBody()).toContain('claimed_by = NULL');
    // And the poison pill is terminal and keeps its error too — a `failed` row an
    // operator cannot read the reason off is a silent data loss.
    expect(failBody()).toContain("status = 'failed'");
    expect(failBody()).toContain('error  = p_error');
  });

  it('carries no staleness column, because there is no window to strand a row in', () => {
    // Claim, delete and mark-done are one transaction, so a process death cannot
    // leave a row in `claimed` with nothing to reclaim it. That is why there is no
    // `locked_at` here and no staleness monitor that could be written wrong.
    expect(returnQueryBody('authz.claim_due_purge')).not.toContain('locked_at');
  });

  it('refuses a claim with no ownership key rather than writing an ownerless claim', () => {
    // `claimed_by` is `text` and the table's CHECK only requires it to be non-NULL,
    // so an EMPTY ownership key would satisfy every constraint while making "does
    // this sweeper still own the row" a question two sweepers answer the same way.
    for (const name of [
      'authz.claim_due_purge',
      'authz.complete_purge',
      'authz.fail_purge',
      'authz.requeue_purge',
    ]) {
      expect(functionSql(name)).toContain("p_instance IS NULL OR p_instance = ''");
    }
  });
});

describe('the claim is reached through a narrow seam, and through no other route', () => {
  it('each function is SECURITY DEFINER with a pinned search_path, or INVOKER by name', () => {
    // `SECURITY INVOKER` is not an oversight anywhere it appears: the tombstone
    // READ must run as `app_admin`, because `users` is FORCE RLS'd and a definer
    // body reads zero rows through it. Every other function here WRITES the queue,
    // and no serving role may do that with a grant, so each one must be DEFINER.
    const migration = stripComments(readFileSync(MACHINE_PATH_MIGRATION, 'utf8'));

    for (const name of [
      'authz.claim_due_purge',
      'authz.complete_purge',
      'authz.fail_purge',
      'authz.requeue_purge',
      'authz.enqueue_inactive_purges',
    ]) {
      const declaration = migration.slice(migration.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`));
      const signature = declaration.slice(0, declaration.indexOf('AS $$'));
      expect(signature, name).toContain('SECURITY DEFINER');
      // A later-searched schema could shadow anything the body names, so the path
      // is pinned in every definer in this schema (`0001`).
      expect(signature, name).toContain('SET search_path = pg_catalog, public');
    }

    const scan = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION authz.retention_due_tombstones('));
    expect(scan.slice(0, scan.indexOf('AS $$'))).toContain('SECURITY INVOKER');
  });

  it('EXECUTE is revoked from PUBLIC on every function and granted to app_admin alone', () => {
    // `EXECUTE` is granted to PUBLIC on every new function by default, so the
    // revoke is not optional. A revoke while granting to nobody is strictly worse
    // than doing nothing: every legitimate caller then dies with `permission denied
    // for function` while every policy and comment still looks correct.
    const migration = stripComments(readFileSync(MACHINE_PATH_MIGRATION, 'utf8'));

    for (const signature of [
      'authz.claim_due_purge(text)',
      'authz.complete_purge(uuid, text, integer)',
      'authz.fail_purge(uuid, text, text)',
      'authz.requeue_purge(uuid, text, text)',
      'authz.enqueue_inactive_purges(uuid[])',
      'authz.retention_due_tombstones(integer)',
    ]) {
      expect(migration, signature).toContain(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC`);
      expect(migration, signature).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO app_admin`);
    }

    // `app_anon` and `app_member` are named NOWHERE in a grant in this file: no
    // policy calls these functions, so the "every policy helper goes to app_anon"
    // rule does not apply, and a DEFINER writer reachable by a member is an
    // escalation.
    const grants = migration
      .split(';')
      .filter((statement) => /^\s*GRANT\s+EXECUTE\b/i.test(statement));
    expect(grants.length).toBe(6);
    for (const grant of grants) {
      expect(grant).not.toMatch(/app_anon/);
      expect(grant).not.toMatch(/app_member/);
      expect(grant).toMatch(/TO app_admin\s*$/);
    }
  });

  it('no serving role can write the queue table directly any more', () => {
    // With `UPDATE` still granted, the four bare statements remain a second,
    // WORKING route to the same job — and the one that is inert fails SILENTLY,
    // returning `UPDATE 0`, which reads exactly like an empty queue. The revoke
    // turns that into `permission denied for table`, which names itself.
    const migration = stripComments(readFileSync(MACHINE_PATH_MIGRATION, 'utf8'));
    expect(migration).toMatch(/REVOKE UPDATE ON public\.privacy_purge_queue FROM app_admin/);

    // And the UPDATE POLICY is kept anyway, as the second half of the control, so a
    // future table-level `GRANT UPDATE` cannot open a write by itself.
    expect(migration).not.toMatch(/DROP POLICY[^;]*privacy_purge_write/);
  });

  it('the application constants are one statement each and call the seam', () => {
    // Each constant is still exactly one command: a second one hidden in the
    // string is a second mechanism, and `purge-transaction.spec.ts` orders the ones
    // the sweeper runs.
    for (const statement of [CLAIM_DUE_PURGE_SQL, COMPLETE_PURGE_SQL, FAIL_PURGE_SQL, REQUEUE_PURGE_SQL]) {
      expect(statement.replace(/;\s*$/, '')).not.toContain(';');
    }

    expect(CLAIM_DUE_PURGE_SQL).toContain('authz.claim_due_purge($1)');
    expect(COMPLETE_PURGE_SQL).toContain('authz.complete_purge($1, $2, $3::integer)');
    expect(FAIL_PURGE_SQL).toContain('authz.fail_purge($1, $2, $3)');
    expect(REQUEUE_PURGE_SQL).toContain('authz.requeue_purge($1, $2, $3)');

    // The bare `UPDATE`s are gone from the application. They would still parse, and
    // on a database where the revoke had not been applied they would still "work"
    // — which is exactly how a second mechanism gets copied forward.
    for (const statement of [CLAIM_DUE_PURGE_SQL, COMPLETE_PURGE_SQL, FAIL_PURGE_SQL, REQUEUE_PURGE_SQL]) {
      expect(statement).not.toMatch(/^\s*UPDATE\s+privacy_purge_queue/m);
    }
  });
});

describe('a write that returns nothing readable is an error, not a row count', () => {
  it('reads the count the function RETURNED, because rowCount cannot distinguish the two outcomes', () => {
    // `pg` reports one row for a SELECT whether or not the function matched
    // anything, so `rowCount` is 1 for "wrote the row" and for "you no longer own
    // it". That distinction is the entire N-sweeper contract.
    expect(writtenRows({ rows: [1] })).toBe(1);
    expect(writtenRows({ rows: [0] })).toBe(0);
    // A text-returning driver configuration delivers the same count as a string.
    expect(writtenRows({ rows: ['2'] })).toBe(2);
    // And the shape `pg` actually hands back for a scalar function call: one column,
    // named after the function.
    expect(writtenRows({ rows: [{ complete_purge: 1 }] })).toBe(1);
    expect(writtenRows({ rows: [{ fail_purge: 0 }] })).toBe(0);
    // The claim's row is thirteen columns and is NOT a count; handing it here is a
    // programming error, not a zero.
    expect(() => writtenRows({ rows: [{ id: 'r1', attempt: 1 }] })).toThrow(/instead of the number of rows/);

    // Anything else is an error rather than a number this code invents — and `0`
    // is the worst available default, because `0` means "you no longer own the
    // row" and would turn every successful purge into a thrown error.
    expect(() => writtenRows({ rows: [] })).toThrow(/instead of the number of rows/);
    expect(() => writtenRows({ rows: [null] })).toThrow(/instead of the number of rows/);
    expect(() => writtenRows({ rows: [true] })).toThrow(/instead of the number of rows/);
    expect(() => writtenRows({ rows: ['null'] })).toThrow(/instead of the number of rows/);
    expect(() => writtenRows({ rows: [{ complete_purge: null }] })).toThrow(/instead of the number of rows/);
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

function completeBody(): string {
  return returnQueryBodyless('authz.complete_purge');
}

function failBody(): string {
  return returnQueryBodyless('authz.fail_purge');
}

function requeueBody(): string {
  return returnQueryBodyless('authz.requeue_purge');
}

/** The `UPDATE` of a settle function, which has no `RETURN QUERY` wrapper. */
function returnQueryBodyless(name: string): string {
  const sql = functionSql(name);
  const start = sql.indexOf('UPDATE public.privacy_purge_queue');
  if (start === -1) {
    throw new Error(`${name} performs no UPDATE, so its ownership predicate cannot be asserted`);
  }
  return sql.slice(start);
}
