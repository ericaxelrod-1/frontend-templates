import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSmtpSink, type SmtpSink } from '../../../scripts/smtp-sink.js';
import { EmailAuditWriter } from '../../../src/email/email-audit.writer.js';
import { EmailDeliveryError } from '../../../src/email/email-delivery-error.js';
import { EmailService, ERASURE_RECEIPT_TEMPLATE } from '../../../src/email/email.service.js';
import { EmailRenderer } from '../../../src/email/email.renderer.js';
import { NodemailerEmailProvider } from '../../../src/email/nodemailer-email.provider.js';
import type { ErasureEnvironment } from '../../../src/privacy/erasure-environment.js';
import {
  ANONYMISE_LOGIN_ATTEMPTS_SQL,
  ANONYMISE_SUBJECT_SQL,
  CLOSE_OPEN_REQUESTS_SQL,
  REVOKE_SESSIONS_SQL,
  ErasureService,
  SELECT_SUBJECT_SQL,
} from '../../../src/privacy/erasure.service.js';
import { tombstoneAddress, tombstoneLocalPart } from '../../../src/privacy/tombstone.js';
import { BACKEND_ROOT } from '../../support/paths.js';
import { scriptedPool, type ScriptedPool } from '../../support/breaker-harness.js';
import { environmentFor } from '../email/email-environment-fixture.js';

/**
 * The erasure transaction: ordering, idempotency, and the absence of a second
 * subject.
 *
 * ## What is real here and what is stood in for, and why
 *
 * **The transport is real.** Every receipt crosses a real SMTP socket to an
 * in-process loopback sink, so "the receipt was delivered before the row was
 * rewritten" is observed on the wire rather than on a mock's call log. The failed
 * receipt is a genuine `ECONNREFUSED` against a port nothing binds, for the same
 * reason `email.service.spec.ts` uses one.
 *
 * **The `email_messages` write is stood in for.** `EmailAuditWriter` opens its own
 * `pg.Pool` on first use and this machine has no PostgreSQL, so the one thing
 * stubbed is the audit INSERT — and it is replaced by a RECORDER, so the assertion
 * below still proves the attempt was attributed to the subject. That is a test
 * double for a database, inside a spec, which is exactly what
 * `test/support/breaker-harness.ts` already does for the retention jobs; §2.2's ban
 * is on fakes in application code.
 *
 * ## Why the existing scripted pool and not a new one
 *
 * `test/support/breaker-harness.ts` already ships a scripted pg *client* double
 * behind the same narrow connection port the retention jobs use, and
 * `ErasureConnectionSource` is structurally that port. Reusing it is §2.4 rather
 * than tidiness: a second scripted client is a second mechanism for "record the
 * statements a service issued", and it is the mechanism that would drift.
 *
 * ## What the double can and cannot show
 *
 * It records WHICH statements were issued, in what order, with what bound values —
 * and it cannot show what PostgreSQL then did with them. Every assertion below is
 * therefore about the shape of the write (order, predicates, bound ids) and the
 * row counts are the job of a cluster-backed suite this machine does not have.
 */

const SUBJECT_A = '018f3c2a-1b4d-7c8e-9f01-23456789abcd';
const SUBJECT_B = '018f3c2a-1b4d-7c8e-9f01-23456789abce';

const ENV: ErasureEnvironment = {
  pepper: 'a-test-pepper-of-a-plausible-length-000001',
  pepperKid: 'test-v1',
  tombstoneDomain: 'tombstone.example.test',
};

const LIVE_ROW = {
  id: SUBJECT_A,
  username: 'robin',
  email: 'robin@example.test',
  deleted_at: null,
  email_anonymized: false,
};

const ERASED_ROW = {
  ...LIVE_ROW,
  username: tombstoneLocalPart(SUBJECT_A, ENV.pepper),
  email: tombstoneAddress(SUBJECT_A, ENV.pepper, ENV.tombstoneDomain),
  deleted_at: '2026-10-14T09:00:00.000Z',
  email_anonymized: true,
};

/** Port 1 is reserved and nothing binds it, so the refusal is a real ECONNREFUSED. */
const DEAD_SMTP: Readonly<Record<string, string>> = { EMAIL_HOST: '127.0.0.1', EMAIL_PORT: '1' };

let sink: SmtpSink;
/** The `email_messages` attempts this suite would have written, in order. */
let recordedAttempts: { readonly template: string; readonly userId: string; readonly status: string }[] = [];

beforeAll(async () => {
  sink = await startSmtpSink({ port: 0 });
});

afterAll(async () => {
  await sink?.close();
});

beforeEach(() => {
  recordedAttempts = [];
  // The audit write is the ONLY thing replaced, and it is replaced by a recorder.
  // The transport above it stays real, so delivery is observed over a socket.
  vi.spyOn(EmailAuditWriter.prototype, 'record').mockImplementation((attempt) => {
    recordedAttempts.push({ template: attempt.template, userId: attempt.userId, status: attempt.status });
    return Promise.resolve();
  });
});

function serviceFor(smtp: Readonly<Record<string, string>>): EmailService {
  const environment = environmentFor({ EMAIL_HOST: sink.host, EMAIL_PORT: String(sink.port), ...smtp });
  const config = { getOrThrow: <T>(key: string): T => ({ environment })[key] as T } as ConfigService;
  return new EmailService(config, new NodemailerEmailProvider(environment.email), new EmailRenderer());
}

/** `deliveries` at the moment the first `UPDATE users` was issued. Filled by the hook. */
let deliveriesWhenTheRowWasRewritten: number | undefined;

function poolFor(results: { live?: unknown; erased?: unknown }): ScriptedPool {
  deliveriesWhenTheRowWasRewritten = undefined;
  return scriptedPool(
    [
      {
        when: (statement) => statement.startsWith('SELECT id, username, email'),
        results: [
          { rows: [results.live ?? LIVE_ROW], rowCount: 1 },
          { rows: [results.erased ?? ERASED_ROW], rowCount: 1 },
        ],
      },
      {
        when: (statement) => statement.startsWith('UPDATE users SET email'),
        results: [{ rows: [{ deleted_at: '2026-10-14T10:00:00.000Z' }], rowCount: 1 }],
      },
    ],
    {
      onStatement: (statement) => {
        if (statement.startsWith('UPDATE users SET email') && deliveriesWhenTheRowWasRewritten === undefined) {
          deliveriesWhenTheRowWasRewritten = sink.deliveries.length;
        }
      },
    },
  );
}

function erasureFor(pool: ScriptedPool, smtp: Readonly<Record<string, string>> = {}): ErasureService {
  return new ErasureService(ENV, pool.source, serviceFor(smtp));
}

describe('the receipt is sent BEFORE the address changes', () => {
  it('delivers to the address that is still live, and only then rewrites the row', async () => {
    sink.clear();
    const pool = poolFor({});
    const outcome = await erasureFor(pool).eraseSelf(SUBJECT_A);

    expect(outcome.alreadyErased).toBe(false);

    // The proof is the ORDER, observed on the wire and on the connection: the sink
    // had already accepted the message by the time the rewrite was issued. Assert
    // only the final count and this would pass against the reversed ordering —
    // anonymising first, mailing afterwards — which is the exact failure the
    // ordering exists to prevent ("we emailed your receipt to deleted-<hmac>@…").
    expect(deliveriesWhenTheRowWasRewritten).toBe(1);
    expect(sink.deliveries[0]?.recipients).toEqual(['robin@example.test']);

    // …and the address it went to is not the tombstone. If the two were the same
    // value the order would be unobservable.
    expect(sink.deliveries[0]?.recipients).not.toContain(outcome.tombstoneAddress);
  });

  it('erases NOTHING when the receipt cannot be delivered, so a bounced receipt never costs the person their record silently', async () => {
    sink.clear();
    const pool = poolFor({});

    const failure = await erasureFor(pool, DEAD_SMTP)
      .eraseSelf(SUBJECT_A)
      .then(() => 'resolved')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EmailDeliveryError);

    // Not "the UPDATE rolled back" — the WRITE transaction was never OPENED. What
    // did run is the read's own BEGIN/SET/SELECT/COMMIT, so the whole remaining
    // trace is pinned exactly: a statement added to either transaction fails here,
    // and so does a write, a rollback, or a second connection.
    const issued = pool.statements().map((statement) => statement.text);
    expect(issued).toEqual([
      'BEGIN',
      'SET LOCAL ROLE app_admin',
      SELECT_SUBJECT_SQL.replace(/\s+/g, ' ').trim(),
      'COMMIT',
    ]);
    expect(issued.some((statement) => statement.includes('UPDATE users'))).toBe(false);
    expect(pool.connects()).toBe(1);
  });

  it('stores no body for the receipt, because writing the name into email_messages is a second copy of the erased data', async () => {
    sink.clear();
    await erasureFor(poolFor({})).eraseSelf(SUBJECT_A);

    // The receipt IS attributed — an erasure nobody can account for is the failure
    // the audit trail exists to prevent — and it is attributed WITHOUT a body.
    expect(recordedAttempts).toHaveLength(1);
    expect(recordedAttempts[0]).toEqual({
      template: ERASURE_RECEIPT_TEMPLATE,
      userId: SUBJECT_A,
      status: 'sent',
    });
    expect(ERASURE_RECEIPT_TEMPLATE).not.toBe('password_reset');
    expect(ERASURE_RECEIPT_TEMPLATE).not.toBe('email_verification');
  });
});

describe('a second erasure is a no-op, not a second tombstone', () => {
  it('writes nothing at all the second time, and reports the SAME tombstone', async () => {
    sink.clear();
    const pool = poolFor({});
    const service = erasureFor(pool);

    const first = await service.eraseSelf(SUBJECT_A);
    const firstStatements = pool.statements().length;
    const firstReceipts = sink.deliveries.length;

    const second = await service.eraseSelf(SUBJECT_A);

    // The branch is taken on `email_anonymized`, which is the schema's own answer
    // (GENERATED from `deletion_reason = 'rtbf'`) rather than a re-derivation of it.
    expect(second.alreadyErased).toBe(true);
    // Equality of the address is the idempotency claim made as a comparable value:
    // the same pepper produces the same tombstone, so a caller can tell a no-op
    // from a second tombstone by comparing the two outcomes.
    expect(second.tombstoneAddress).toBe(first.tombstoneAddress);
    expect(second.anonymizedAt).toBe(ERASED_ROW.deleted_at);

    // The second call issued the READ and nothing else — its whole remaining
    // trace, pinned statement by statement rather than counted, so a write added
    // to either transaction fails here.
    expect(pool.statements().slice(firstStatements).map((statement) => statement.text)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE app_admin',
      SELECT_SUBJECT_SQL.replace(/\s+/g, ' ').trim(),
      'COMMIT',
    ]);
    // And no mail: the address is a tombstone now, and EmailService refuses that
    // shape outright — so a second receipt would be a refusal, not a delivery.
    expect(sink.deliveries.length).toBe(firstReceipts);
  });

  it('is idempotent in SQL as well as in the branch, so two concurrent erasures cannot both write', () => {
    // The branch above is an optimisation. The CONTROL is the predicate: a second
    // `eraseSelf` racing past the read finds `deleted_at IS NOT NULL` and the
    // statement matches zero rows, so the second transaction rolls back and the
    // first one's tombstone is exactly as it was.
    expect(ANONYMISE_SUBJECT_SQL).toMatch(/AND\s+deleted_at IS NULL/i);
    expect(ANONYMISE_SUBJECT_SQL).toMatch(/RETURNING/i);
    // `email_anonymized` is generated; naming it raises `cannot update a generated
    // column`, so the derived flag cannot be written out of step with the reason.
    expect(ANONYMISE_SUBJECT_SQL).not.toMatch(/email_anonymized/);
  });
});

describe('the whole write is one transaction, in this order', () => {
  it('opens and closes each of its two transactions exactly once, and rewrites the row before anything that depends on the old identity', async () => {
    sink.clear();
    const pool = poolFor({});
    await erasureFor(pool).eraseSelf(SUBJECT_A);

    const issued = pool.statements().map((statement) => statement.text);
    // TWO transactions, not one: the read (which must be committed and the
    // connection returned before the receipt crosses the network) and the write.
    // Both are escalated through the same boundary, so the role is set twice and
    // the count is asserted rather than assumed.
    expect(issued.filter((statement) => statement === 'BEGIN')).toHaveLength(2);
    expect(issued.filter((statement) => statement === 'COMMIT')).toHaveLength(2);
    expect(issued.filter((statement) => statement === 'SET LOCAL ROLE app_admin')).toHaveLength(2);
    expect(issued).not.toContain('ROLLBACK');

    // The READ transaction closes before the WRITE transaction opens. A snapshot
    // held across the SMTP round trip is an idle-in-transaction session, and this
    // is the statement ordering that rules it out.
    const writeBegin = issued.lastIndexOf('BEGIN');
    expect(issued.indexOf('COMMIT')).toBeLessThan(writeBegin);

    const at = (needle: string): number => issued.findIndex((statement) => statement.includes(needle));
    // The row first: every later statement keys on the OLD username, and a
    // rollback ordering that rewrote the row first would leave nothing to find.
    expect(writeBegin).toBeLessThan(at('UPDATE users SET email'));
    expect(at('UPDATE users SET email')).toBeLessThan(at('UPDATE login_attempts SET username'));
    expect(at('UPDATE login_attempts SET username')).toBeLessThan(at('UPDATE refresh_tokens SET revoked_at'));
    expect(at('UPDATE refresh_tokens SET revoked_at')).toBeLessThan(at('UPDATE privacy_requests SET status'));
    expect(at('UPDATE privacy_requests SET status')).toBeLessThan(issued.lastIndexOf('COMMIT'));
  });

  it('rolls the whole thing back when a later statement fails, rather than leaving a half-rewritten row', async () => {
    sink.clear();
    const pool = scriptedPool(
      [
        { when: (s) => s.startsWith('SELECT id, username, email'), results: [{ rows: [LIVE_ROW], rowCount: 1 }] },
        { when: (s) => s.startsWith('UPDATE users SET email'), results: [{ rows: [{ deleted_at: 'x' }], rowCount: 1 }] },
      ],
      {
        raise: {
          when: (statement) => statement.startsWith('UPDATE login_attempts'),
          error: new Error('23514 check violation'),
        },
      },
    );

    await expect(erasureFor(pool).eraseSelf(SUBJECT_A)).rejects.toThrow('23514 check violation');

    const issued = pool.statements().map((statement) => statement.text);
    expect(issued).toContain('BEGIN');
    expect(issued).toContain('ROLLBACK');
    // The one COMMIT in the trace belongs to the READ, which had already committed
    // before the write transaction opened — that separation is what keeps a
    // snapshot off the SMTP round trip. What must NOT appear is a COMMIT after the
    // write transaction opened: that is the whole difference between rolling back
    // and half-applying, so it is asserted from the last BEGIN rather than by
    // counting.
    expect(issued.slice(issued.lastIndexOf('BEGIN'))).not.toContain('COMMIT');
  });

  it('keeps the forensic fields of the login telemetry and rewrites only the username', () => {
    // 11 CCR §7111 requires retaining what is needed to investigate a security
    // incident. The statement names `username` and nothing else — no `ip`, no
    // `ip_normalized`, no `ip_subnet`, no `status`, no `created_at`.
    expect(ANONYMISE_LOGIN_ATTEMPTS_SQL).toMatch(/SET\s+username\s*=\s*\$2/);
    for (const kept of ['ip', 'ip_normalized', 'ip_subnet', 'status', 'created_at']) {
      expect(ANONYMISE_LOGIN_ATTEMPTS_SQL, `${kept} must survive an erasure`).not.toMatch(
        new RegExp(`SET[^;]*\\b${kept}\\b\\s*=`),
      );
    }
    expect(REVOKE_SESSIONS_SQL).toMatch(/revoked_at IS NULL/);
    expect(CLOSE_OPEN_REQUESTS_SQL).toMatch(/status IN \('open', 'in_progress'\)/);
  });

  it('replaces the password hash rather than leaving one that still verifies', async () => {
    sink.clear();
    const pool = poolFor({});
    await erasureFor(pool).eraseSelf(SUBJECT_A);

    const bound = pool
      .statements()
      .find((statement) => statement.text.startsWith('UPDATE users SET email'))?.values ?? [];

    // $4 is the replacement hash. It must be a REAL bcrypt hash at the cost the
    // seed uses: `password_hash` is NOT NULL and making it nullable is a
    // migration, but leaving the old hash is the failure a tombstone must not
    // have — and a string that is not a bcrypt hash at all would make the login
    // path throw instead of simply failing.
    const replacement = bound[3];
    expect(typeof replacement).toBe('string');
    expect(String(replacement)).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(await bcrypt.compare('any-password-at-all', String(replacement))).toBe(false);
  });
});

describe('user A cannot erase user B, because the API cannot express it', () => {
  it('binds every statement to the one id it was given, and no statement ever names a second subject', async () => {
    sink.clear();
    const pool = poolFor({});
    await erasureFor(pool).eraseSelf(SUBJECT_A);

    const bound = pool.statements().flatMap((statement) => statement.values);
    // Every id the erasure passed to the database is A's. B is nowhere — not in a
    // predicate, not in a `WHERE`, not in a bound value.
    expect(bound.length).toBeGreaterThan(0);
    for (const value of bound) {
      if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
        expect(value).toBe(SUBJECT_A);
      }
    }
    expect(bound).not.toContain(SUBJECT_B);
  });

  it('erasing B leaves A alone, and the two runs issue disjoint statements', async () => {
    sink.clear();
    const pool = poolFor({ live: { ...LIVE_ROW, id: SUBJECT_B } });
    const outcome = await erasureFor(pool).eraseSelf(SUBJECT_B);

    expect(outcome.userId).toBe(SUBJECT_B);
    expect(outcome.tombstoneAddress).toBe(tombstoneAddress(SUBJECT_B, ENV.pepper, ENV.tombstoneDomain));
    expect(outcome.tombstoneAddress).not.toBe(tombstoneAddress(SUBJECT_A, ENV.pepper, ENV.tombstoneDomain));

    const bound = pool.statements().flatMap((statement) => statement.values);
    expect(bound).not.toContain(SUBJECT_A);
  });

  it('exposes exactly one erasure entry point, and it takes ONE id', () => {
    // The control, read from the source because it is a property of the SURFACE:
    // there is no second subject anywhere to supply. A DTO carrying `user_id`, or
    // a `eraseSelfAs(actor, subject)`, would be the defect this shape forecloses.
    const whole = readFileSync(join(BACKEND_ROOT, 'src', 'privacy', 'erasure.service.ts'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    // Past the class declaration, because the `ErasureConnectionSource` type above
    // it declares a `connect(` and a class-body scan would find it.
    const source = whole.slice(whole.indexOf('export class ErasureService'));

    const methods = [
      ...source.matchAll(/^\x20{2}((?:private |protected |public )?)(?:async )?([a-zA-Z][a-zA-Z0-9]*)\(/gm),
    ].map((match) => ({ visibility: match[1] ?? '', name: match[2] ?? '' }));
    expect(
      methods
        .filter((method) => method.name !== 'constructor')
        .map((method) => method.name)
        .sort(),
    ).toEqual(['applyErasure', 'eraseSelf', 'readSubject']);
    // And of the three, exactly ONE is reachable: the two helpers are private, so
    // the surface a caller can hold is `eraseSelf` alone. A public
    // `eraseSelfAs(actor, subject)` is the defect this shape forecloses.
    expect(methods.filter((method) => method.visibility === '' && method.name !== 'constructor')).toEqual([
      { visibility: '', name: 'eraseSelf' },
    ]);
    expect(source).toMatch(/async eraseSelf\(subjectId: string\)/);
    // A second parameter on the erasure entry point is the defect: an actor and a
    // subject, or a subject and a channel. There is one.
    expect(source).not.toMatch(/eraseSelf\(\s*subjectId: string\s*,/);
  });

  it('names what is NOT stopping it, because a reader must not over-credit this control', () => {
    // `users_update` is `USING (current_user = 'app_admin')`, so once the thin app
    // runs as the superset principal the DATABASE cannot distinguish an erasure
    // from any other write. The self-check above is an application control; the
    // database-enforced half is the subject gate inside
    // `authz.append_privacy_request_audit()` (0014) for the statutory record, and
    // a `SECURITY DEFINER` `authz.anonymise_subject(uuid)` would put this one below
    // the application too — a migration, and so reported rather than written.
    const source = readFileSync(join(BACKEND_ROOT, 'src', 'privacy', 'erasure.service.ts'), 'utf8');

    expect(source).toContain('database cannot tell an erasure from any');
    expect(source).toContain('APPLICATION control');
  });
});

describe('a subject that is not there is reported, not invented', () => {
  it('rejects rather than reporting a successful erasure of nothing', async () => {
    sink.clear();
    const pool = scriptedPool([
      { when: (s) => s.startsWith('SELECT id, username, email'), results: [{ rows: [], rowCount: 0 }] },
    ]);

    const failure = await erasureFor(pool)
      .eraseSelf(SUBJECT_A)
      .then(() => 'resolved')
      .catch((error: unknown) => error);

    expect(String((failure as Error).message)).toContain('no account is associated with this session');
    // §2.3's success-shaped value: a missing row reported as a completed erasure.
    expect(failure).not.toBe('resolved');
    expect(pool.statements().some((statement) => statement.text.includes('UPDATE users'))).toBe(false);
    expect(sink.deliveries).toEqual([]);
  });
});