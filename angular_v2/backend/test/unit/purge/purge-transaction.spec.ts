import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * The transaction shape of one purge, asserted on the source.
 *
 * ## Why source rather than a fake `PoolClient`
 *
 * A behavioural test here would need a stand-in for `pg.PoolClient` — a type with
 * six method overloads — and §2.2 is unforgiving about a second fake of something
 * real. `pg.Pool` is never substituted in application code, and a test double for
 * a pg client is exactly the shape §B8 rejects for the integration tier. So the
 * shape is asserted the way `purge-claim.spec.ts` asserts SQL text: by reading the
 * file, stripping comments, and checking the ORDER of the statements. An ordered
 * sequence of statements is the property; a bag of statements is not.
 *
 * ## The defect these assertions exist for
 *
 * The failure write ran **after** a whole-transaction `ROLLBACK`, on a SECOND
 * connection. The rollback restores the row to `pending` with `claimed_by = NULL`,
 * so `WHERE status = 'claimed' AND claimed_by = $instance` matched **zero rows**:
 *
 *   - the error was recorded nowhere;
 *   - `attempt` never advanced, because it had rolled back with the claim;
 *   - a purge whose delete always failed was retried forever;
 *   - `RETENTION_PURGE_MAX_ATTEMPTS` was unreachable code;
 *   - and the tick reported `failed: true` for every one of those attempts — a
 *     success-shaped outcome for work that did not happen (§2.3).
 *
 * Nothing about that is visible at runtime: the sweeper logged a failure for a
 * purge it never stopped retrying, and every log line was true.
 */

/** Comment-stripped, so a comment that NAMES a statement is not a finding. */
function sweeperSource(): string {
  const raw = readFileSync(join(BACKEND_ROOT, 'src', 'purge', 'purge-sweeper.service.ts'), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('//');
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join('\n');
}

const SOURCE = sweeperSource();

/**
 * The class body, past the import list.
 *
 * The import lines mention every statement constant, so searching the whole file
 * would find `RELEASE_PURGE_WORK` and `CLAIM_DUE_PURGE_SQL` at the top and order
 * the statements by their imports rather than by where they run.
 */
const BODY = SOURCE.slice(SOURCE.lastIndexOf("} from './purge-claim.js';"));

/** Index of the first occurrence of a statement in the class body, or `Infinity`. */
function at(statement: string): number {
  const index = BODY.indexOf(statement);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

describe('one purge is one transaction, in this order', () => {
  it('opens the transaction before it writes anything', () => {
    expect(at("client.query('BEGIN')")).toBeLessThan(at("client.query('SET LOCAL ROLE app_admin')"));
    expect(at("client.query('SET LOCAL ROLE app_admin')")).toBeLessThan(at('this.claimOne(client)'));
    // Claims alone cannot buy write access: the admin branch of a policy
    // discriminates on `current_user`, never on a token field (`AGENTS.md` §B2).
    expect(at('this.claimOne(client)')).toBeLessThan(at('CLAIM_DUE_PURGE_SQL'));
  });

  it('wraps the deletion in a savepoint, so a failure can be recorded without losing the claim', () => {
    const savepoint = at('PURGE_WORK_SAVEPOINT');
    const executor = at('this.executor.execute(client, claim)');
    const release = at('RELEASE_PURGE_WORK');
    const complete = at('COMPLETE_PURGE_SQL');
    const rollbackTo = at('ROLLBACK_TO_PURGE_WORK');

    expect(savepoint).toBeLessThan(executor);
    expect(executor).toBeLessThan(release);
    expect(release).toBeLessThan(complete);
    // The failure path unwinds the DELETE alone. Without this the claim would go
    // with it and the failure write would have no ownership predicate to match.
    expect(rollbackTo).toBeLessThan(at('this.recordFailure(client, claim, error)'));
  });

  it('records the failure inside the SAME transaction, before its COMMIT', () => {
    const record = at('this.recordFailure(client, claim, error)');
    const commit = BODY.indexOf("client.query('COMMIT')", record);

    // The failure write is between the savepoint rollback and the commit of the
    // claim's own transaction — not after a commit, and not on another connection.
    expect(record).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(record);
    expect(at('ROLLBACK_TO_PURGE_WORK')).toBeLessThan(record);
    expect(at("client.query('ROLLBACK')")).toBeGreaterThan(-1);
  });

  it('opens exactly ONE connection per purge, because the claim is uncommitted work', () => {
    // The whole defect in one number. Two `connect()` calls in this file means a
    // second transaction that cannot see the claim, so every statement predicated
    // on ownership matches nothing.
    const connects = SOURCE.split('this.pool.connect()').length - 1;
    expect(connects).toBe(1);
  });

  it('never writes the failure outside a transaction of its own', () => {
    // `recordFailure` takes the caller's client and opens nothing: no BEGIN, no
    // COMMIT, no ROLLBACK, no connection. The old shape had all four.
    const start = BODY.indexOf('private async recordFailure');
    expect(start).toBeGreaterThan(-1);
    const body = BODY.slice(start, BODY.indexOf('\n  }\n}', start));
    expect(body).not.toContain('BEGIN');
    expect(body).not.toContain('COMMIT');
    expect(body).not.toContain('ROLLBACK');
    expect(body).not.toContain('pool.connect');
  });

  it('still rolls the WHOLE transaction back when the purge is aborted, claim included', () => {
    // The other half of the contract, and the one the savepoint must not weaken:
    // an aborted transaction leaves the row `pending` and untouched, which is what
    // "aborting leaves no partial state" means for this job. There is no window in
    // which a row is left `claimed` by a sweeper that has stopped.
    expect(BODY).toContain('if (!settled)');
    expect(BODY).toContain("client.query('ROLLBACK')");
    // And a whole-transaction rollback is still reachable on the failure path —
    // when the failure write itself throws, which the caller does NOT swallow.
    expect(BODY).toContain('await this.recordFailure(client, claim, error);');
  });
});
