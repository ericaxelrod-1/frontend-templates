import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOTIFICATIONS_MATERIALIZE } from '../../../src/breaker/dispatch-token.js';
import type { MaterializeSummary } from '../../../src/notifications/materializer.js';
import {
  REGISTERED_SOURCES,
  WATERMARK_SQL,
  materializerFor,
} from '../../../src/notifications/materializer.js';
import { NotificationMaterializer } from '../../../src/notifications/notification-materializer.service.js';
import { DEFAULT_EXPIRY_SECONDS } from '../../../src/notifications/notification-environment.js';
import type { NotificationEnvironment } from '../../../src/notifications/notification-environment.js';
import { loadNotificationEnvironment } from '../../../src/notifications/notification-environment.js';
import type { BreakerGate } from '../../../src/breaker/breaker-gate.js';
import type { DatabaseConnectionSource } from '../../../src/common/database-pool.js';
import type { JobRunner } from '../../../src/scheduler/job-runner.service.js';
import { PROOF_DATABASE, authenticatorClient, dropProofDatabase, rebuildProofDatabase } from './proof-database.js';
import { loadTestEnvironment } from '../../support/database.js';

/**
 * The materialiser against a REAL PostgreSQL, and the dismissal-resurrection proof.
 *
 * ## WHY A REAL DATABASE AND NOT A STAND-IN (§2.2)
 *
 * Every property this file asserts lives in the server and nowhere else:
 *
 *   * `ON CONFLICT DO NOTHING` against a `UNIQUE NULLS NOT DISTINCT` index is an
 *     index-inference behaviour, and the reason it must be `NULLS NOT DISTINCT` is
 *     that the DEFAULT unique index treats a NULL `user_id` as distinct from every
 *     other NULL — which a JavaScript `Set` reproduces faithfully and a JSON fixture
 *     cannot distinguish from the correct behaviour at all;
 *   * the RLS policy is a `CREATE POLICY` evaluation, so "a member cannot read an
 *     administrators-only notification" is a statement about a predicate the planner
 *     runs, not about a function this file called;
 *   * the watermark is `ORDER BY created_at DESC, id DESC LIMIT 1` over rows this
 *     suite inserted, so the second pass's window is a fact about the rows that exist.
 *
 * A stand-in here would not be a weaker version of the proof; it would be a different
 * claim, and the one the design's hardest requirement makes.
 *
 * ## WHY IT IS A THROWAWAY DATABASE AND NOT THE CONFIGURED ONE (§B8)
 *
 * The proof WRITES. `test/rls/support/fixture.ts` reaches the same conclusion for the
 * same reason with the same `DROP DATABASE` discipline, and `proof-database.ts` is
 * where that lives.
 */

/** The gate a harness supplies: always admitting, and recording what it was asked. */
type RecordingGate = {
  readonly gate: BreakerGate;
  readonly tokens: string[];
  readonly stoppable: boolean[];
};

/**
 * A gate stub that admits everything.
 *
 * **It is not a mock of a collaborator the materialiser's behaviour depends on** —
 * the breaker has its own suite, and the refusal branch here is asserted by reading
 * `tokens`/`stoppable` rather than by pretending the gate failed. What is under test is
 * the materialiser's SQL, and a gate that refused every dispatch would make every
 * assertion below vacuous.
 */
function admittingGate(): RecordingGate {
  const tokens: string[] = [];
  const stoppable: boolean[] = [];
  const lease = { token: undefined, probe: false, signal: undefined, release: (): void => undefined };
  const gate = {
    acquire: (token: string, isStoppable = false): unknown => {
      tokens.push(token);
      stoppable.push(isStoppable);
      return { admit: true, lease: { ...lease, token } };
    },
  };
  return { tokens, stoppable, gate: gate as unknown as BreakerGate };
}

/**
 * The pool the harness hands the job — a real `pg.Pool`, structurally the
 * `DatabaseConnectionSource` production injects.
 *
 * A raw `Client` would NOT do: it has no `release()`, and the one it needs is the
 * mechanism by which a connection returns to a budget. Handing the job a
 * hand-rolled object with a no-op `release` would be exactly the stand-in §2.2
 * forbids, one level below the database.
 */
function poolAsConnectionSource(pool: Pool): DatabaseConnectionSource {
  return pool;
}

/** A `JobRunner` that records the schedule call instead of starting a timer. */
function recordingJobs(scheduled: Array<{ name: string; intervalSeconds: number }>): JobRunner {
  const runner = {
    schedule: (name: string, intervalSeconds: number): void => {
      scheduled.push({ name, intervalSeconds });
    },
    stop: (): void => undefined,
  };
  return runner as unknown as JobRunner;
}

type NotificationRow = {
  readonly id: string;
  readonly source: string;
  readonly kind: string;
  readonly audience: string;
  readonly user_id: string | null;
  readonly source_ref: string;
  readonly severity: string;
  readonly is_mock: boolean;
  readonly created_at: Date;
  readonly expires_at: Date;
  readonly acknowledged_at: Date | null;
  readonly resolved_at: Date | null;
  readonly dismissed_at: Date | null;
  readonly data: Record<string, unknown>;
};

/** The migrations this change shipped, read from the repository rather than transcribed. */
const SRC = join(import.meta.dirname, '..', '..', '..', 'src');
const MIGRATION_0027 = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'database', 'migrations', '0027_admin_notifications.sql'),
  'utf8',
);

const ADMIN = '0195f0e5-0002-7000-8000-00000000ad01';
const MEMBER = '0195f0e5-0002-7000-8000-00000000ad02';

let admin: Client;
let authenticator: Client;
let pool: Pool;

beforeAll(async () => {
  await rebuildProofDatabase();

  const env = loadTestEnvironment();
  pool = new Pool({
    host: env.database.host,
    port: env.database.port,
    user: env.authenticator.user,
    password: env.authenticator.password,
    database: PROOF_DATABASE,
  });

  admin = await authenticatorClient();
  await admin.query('BEGIN');
  await admin.query('SET LOCAL ROLE app_admin');
  await admin.query(
    `INSERT INTO public.users (id, username, email, password_hash)
     VALUES ($1, 'notification-admin', 'admin@example.test', 'x'), ($2, 'notification-member', 'member@example.test', 'x')`,
    [ADMIN, MEMBER],
  );
  await admin.query('COMMIT');

  authenticator = await authenticatorClient();
}, 300_000);

afterAll(async () => {
  await pool?.end().catch(() => undefined);
  await authenticator?.end().catch(() => undefined);
  await admin?.end().catch(() => undefined);
  dropProofDatabase();
}, 120_000);

/**
 * One statement, inside one transaction, as `app_admin`.
 *
 * Every read and write in this file crosses the same escalation boundary the
 * materialiser crosses (`pgrst_authenticator` → `SET LOCAL ROLE app_admin`), because
 * `admin_notifications`'s policy admits `app_admin` and nothing else, and its `OR`
 * branch calls `authz.actor()` — which `pgrst_authenticator` holds no `EXECUTE` on.
 * A read left outside the boundary therefore fails with `permission denied for
 * function actor`, which is that boundary working rather than a limitation here.
 */
async function asAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
  await admin.query('BEGIN');
  await admin.query('SET LOCAL ROLE app_admin');
  try {
    const value = await work(admin);
    await admin.query('COMMIT');
    return value;
  } catch (error) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/** An alert `hoursOld` in the past, so the window assertions have something to bite on. */
async function seedAlert(overrides: {
  readonly id: string;
  readonly hoursOld?: number;
  readonly userId?: string | null;
}): Promise<void> {
  await asAdmin(async (client) => {
    await client.query(
      `INSERT INTO public.security_alerts
         (id, alert_type, severity, title, message, source, user_id, ip, ip_normalized, ip_subnet,
          pattern_id, alert_data, is_mock, created_at)
       VALUES ($1, 'brute_force', 'critical', 'Credential stuffing from 198.51.100.44',
               'Rapid authentication failures across accounts.', 'system', $2,
               '::ffff:198.51.100.44', '198.51.100.44', '198.51.100.44',
               NULL, '{"failed_attempts":18,"window_minutes":15}', false,
               now() - make_interval(secs => $3::double precision))`,
      [overrides.id, overrides.userId ?? null, (overrides.hoursOld ?? 0) * 3600],
    );
  });
}

/** Wipe everything this suite rendered, so each case starts from nothing. */
async function reset(): Promise<void> {
  await asAdmin(async (client) => {
    await client.query('DELETE FROM public.admin_notifications');
    await client.query('DELETE FROM public.security_alerts');
  });
}

/**
 * Run one pass of the REAL job body, through the REAL materialiser, on the real
 * pool, and return ONE source's summary.
 *
 * A pass runs every registered source, so a bare `run.summaries` carries an entry
 * per source and every assertion in a suite about `security_alerts` would have to
 * restate the other sources' numbers — which is the shape that makes a real change
 * to the registry a dozen edits nobody reads. Narrowing here is not hiding it:
 * "a pass covers every registered source" asserts the whole array, and the
 * narrowing is the source named rather than the index chosen.
 */
async function passFor(source: string, nowMs: number = Date.now()): Promise<readonly MaterializeSummary[]> {
  const summaries = await passWith(loadNotificationEnvironment({}), nowMs);
  return summaries.filter((summary) => summary.source === source);
}

/** Run one pass and return the summary of EVERY registered source, in registry order. */
async function pass(nowMs: number = Date.now()): Promise<readonly MaterializeSummary[]> {
  return passWith(loadNotificationEnvironment({}), nowMs);
}

/** The same pass, under a different validated namespace — so an expiry is observable. */
async function passWith(
  env: NotificationEnvironment,
  nowMs: number = Date.now(),
): Promise<readonly MaterializeSummary[]> {
  const recording = admittingGate();
  const job = new NotificationMaterializer(env, recording.gate, poolAsConnectionSource(pool), recordingJobs([]));
  const run = await job.tick(nowMs);
  if (!run.ran) {
    throw new Error(`the pass did not run: ${JSON.stringify(run)}`);
  }
  return run.summaries;
}

/** The watermark query, read as the role the job reads it as. */
async function watermarkOf(source: string): Promise<readonly { watermark_at: Date }[]> {
  return asAdmin(async (client) => (await client.query<{ watermark_at: Date }>(WATERMARK_SQL, [source])).rows);
}

async function notifications(): Promise<readonly NotificationRow[]> {
  return asAdmin(
    async (client) =>
      (
        await client.query<NotificationRow>(
          `SELECT id, source, kind, audience, user_id, source_ref, severity, is_mock,
                  created_at, expires_at, acknowledged_at, resolved_at, dismissed_at, data
           FROM public.admin_notifications
           ORDER BY source_ref`,
        )
      ).rows,
  );
}

describe('the materialiser contract, against a real PostgreSQL', () => {
  beforeAll(async () => {
    await reset();
  });

  it('has exactly one registration point, and a source that is not registered cannot run', () => {
    expect(REGISTERED_SOURCES).toEqual(['security_alerts', 'consent_config']);
    expect(materializerFor('security_alerts').source).toBe('security_alerts');
    // The refusal, not a skip. A materialiser that quietly stopped running is the
    // failure §2.3 is about, and it is indistinguishable from a source with no rows.
    expect(() => materializerFor('a_source_that_does_not_exist')).toThrow(/no materializer is registered/);
  });

  it('a pass covers every registered source, so the registry is not a list of intentions', async () => {
    // The whole array, which is what `passFor` narrows. Every source registered in
    // `MATERIALIZERS` reports a summary from one pass: a source in the registry that
    // the runner never reached would be invisible in every other assertion here.
    await reset();
    expect((await pass()).map((summary) => summary.source)).toEqual([...REGISTERED_SOURCES]);
  });

  it('reads its own source and writes one notification per source row it finds', async () => {
    await reset();
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000b1' });
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000b2' });

    const summaries = await passFor('security_alerts');
    expect(summaries).toEqual([{ source: 'security_alerts', scanned: 2, created: 2 }]);

    const rows = await notifications();
    expect(rows).toHaveLength(2);
    // The discriminator pair: the source is this materialiser's, and the kind is the
    // source row's own `alert_type`, which is what keeps the panel's "Alert type"
    // filter working after it stops reading `security_alerts`.
    expect(rows.every((row) => row.source === 'security_alerts' && row.kind === 'brute_force')).toBe(true);
    expect(rows.map((row) => row.source_ref).sort()).toEqual([
      '0195f0e5-0002-7000-8000-0000000000b1',
      '0195f0e5-0002-7000-8000-0000000000b2',
    ]);
  });

  it('carries the source payload in `data` rather than inventing columns for it', async () => {
    await reset();
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000b3' });
    await pass();

    const [row] = await notifications();
    expect(row?.data).toMatchObject({
      ip_normalized: '198.51.100.44',
      ip_subnet: '198.51.100.44',
      alert_data: { failed_attempts: 18, window_minutes: 15 },
    });
    // `jsonb_strip_nulls`, so an alert with no pattern does not carry a `pattern_id: null`
    // the panel would render as a row of "none".
    expect(row?.data).not.toHaveProperty('pattern_id');
  });

  it('sets the expiry from configuration', async () => {
    await reset();
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000b4' });
    await pass();

    const [fresh] = await notifications();
    expect(fresh?.expires_at.getTime() - fresh?.created_at.getTime()).toBe(DEFAULT_EXPIRY_SECONDS * 1000);
    expect(fresh?.expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('renders a row ALREADY EXPIRED when the configured expiry is shorter than the row is old', async () => {
    // THE time-bound property. A notification five years old must not surface, and the
    // only thing that can guarantee it is an expiry the materialiser is forced to
    // compute — `expires_at` is NOT NULL, so a source cannot publish a permanent row by
    // omitting it. Configured to a minute here so the arithmetic is observable inside
    // the one-hour window rather than needing a source row 30 days old.
    await reset();
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000b5', hoursOld: 0.5 });
    await passWith({ materializeIntervalSeconds: 300, lookbackSeconds: 3600, expirySeconds: 60 });

    const [ancient] = await notifications();
    expect(ancient?.expires_at.getTime(), 'a half-hour-old alert was given a fresh expiry').toBeLessThan(Date.now());
  });

  it('never materialises a source row outside the window at all', async () => {
    // The other half of "never surface", and the stronger one: an alert a month old is
    // not rendered expired, it is not rendered at all — so the panel never has to filter
    // it and the table does not accumulate a year of history nobody will ever read.
    // The ceiling this does have is recorded by the next test.
    await reset();
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000b6', hoursOld: 24 * 30 });
    expect(await passFor('security_alerts')).toEqual([{ source: 'security_alerts', scanned: 0, created: 0 }]);
    expect(await notifications()).toHaveLength(0);
  });

  it('is idempotent: a second pass over an unchanged source writes nothing', async () => {
    // The property `JobRunner` requires of every job body, because it records nothing
    // about a run and a killed pass is re-run from the beginning by the next process.
    await reset();
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000b5' });

    expect(await passFor('security_alerts')).toEqual([{ source: 'security_alerts', scanned: 1, created: 1 }]);
    expect(await passFor('security_alerts')).toEqual([{ source: 'security_alerts', scanned: 1, created: 0 }]);
    expect(await notifications()).toHaveLength(1);
  });

  it('DOES NOT RESURRECT A DISMISSAL — one row, still dismissed, after a second pass', async () => {
    // THE assertion this whole unit exists to be able to make. A `dismissed_at` is a
    // soft delete, so the row SURVIVES; a materialiser that treated "the row exists" as
    // "nothing to do" is fine, and one that treated it as "not yet done" would insert a
    // second, undismissed notification beside it. Getting that wrong produces an alert a
    // user dismisses and sees again tomorrow, and it looks exactly like a working
    // materialiser that simply found a new source row.
    await reset();
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000b6' });
    await pass();

    const before = await notifications();
    expect(before).toHaveLength(1);
    expect(before[0]?.dismissed_at).toBeNull();

    // The dismissal, written the way a member writes it: one column, one statement.
    const dismissed = await asAdmin(async (client) =>
      client.query(
        `UPDATE public.admin_notifications SET dismissed_at = now() WHERE source_ref = $1 RETURNING dismissed_at`,
        ['0195f0e5-0002-7000-8000-0000000000b6'],
      ),
    );
    expect(dismissed.rowCount).toBe(1);

    // Re-run. This is the same call the scheduler makes every interval.
    expect(await passFor('security_alerts')).toEqual([{ source: 'security_alerts', scanned: 1, created: 0 }]);

    const after = await notifications();
    expect(after, 'the dismissal produced a second notification').toHaveLength(1);
    expect(after[0]?.dismissed_at, 'the re-run cleared the dismissal').not.toBeNull();
    expect(after[0]?.id).toBe(before[0]?.id);
  });

  it('resurrects nothing for a SYSTEM-WIDE row either, where user_id is NULL', async () => {
    // The half a JavaScript stand-in would get wrong. Under a DEFAULT `UNIQUE` index a
    // NULL `user_id` is distinct from every other NULL, so the `ON CONFLICT` clause
    // would match nothing and this row would be re-inserted on every pass, forever.
    // `UNIQUE NULLS NOT DISTINCT` is the whole reason this is not the case, and only a
    // real index can say so.
    await reset();
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000b7' });
    await pass();
    await asAdmin(async (client) => client.query('UPDATE public.admin_notifications SET dismissed_at = now()'));

    await pass();
    await pass();

    const rows = await notifications();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBeNull();
    expect(rows[0]?.dismissed_at).not.toBeNull();
  });

  it('picks up a BACKDATED source row the watermark would otherwise sort behind', async () => {
    // The overlap is not decoration. A pure watermark silently drops every record that
    // arrives late: it sorts behind the mark, nothing errors, and the notification
    // simply does not exist — a missing row that reads exactly like a correct one.
    await reset();
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000b8' });
    await pass();

    // Backdated half an hour, so it sorts BEHIND the watermark the first pass left.
    // The floor is `watermark - 3600s`, so it is inside the window; with no overlap the
    // floor would be the watermark itself and this row would be lost for good.
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000b9', hoursOld: 0.5 });
    expect(await passFor('security_alerts')).toEqual([{ source: 'security_alerts', scanned: 2, created: 1 }]);
    expect(await notifications()).toHaveLength(2);
  });

  it('records the reason a backdated record can still be missed, rather than pretending it cannot', async () => {
    // The ceiling, asserted so it stays a decision rather than becoming a surprise. A
    // source row backdated by MORE than the overlap is outside the window, permanently
    // and silently. The fix, when a deployment grows a source that does this, is a
    // longer `NOTIFICATIONS_LOOKBACK_SECONDS` — which is why it is a configuration key
    // with a default and not a constant written into the SQL.
    await reset();
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000c0' });
    await pass();

    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000c1', hoursOld: 26 });
    expect(await passFor('security_alerts')).toEqual([{ source: 'security_alerts', scanned: 1, created: 0 }]);
    expect(await notifications()).toHaveLength(1);
  });

  it('starts a source with no watermark one window back, not at the beginning of time', async () => {
    // The seed IS the overlap applied to a watermark of "now". Without it the first
    // pass of a newly-registered source would scan the whole table — which is why a
    // five-year-old `security_alerts` table does not produce five years of
    // notifications the first time somebody registers a materialiser for it.
    await reset();
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000c2', hoursOld: 72 });
    expect(await passFor('security_alerts')).toEqual([{ source: 'security_alerts', scanned: 0, created: 0 }]);
    expect(await notifications()).toHaveLength(0);
  });

  it('reports an all-zero pass in the shape of a working pass, not of a dead one', async () => {
    await reset();
    expect(await passFor('security_alerts')).toEqual([{ source: 'security_alerts', scanned: 0, created: 0 }]);
  });
});

describe('the addressing policy, as the roles actually see it', () => {
  beforeAll(async () => {
    await reset();
    // One addressed to a person, one not.
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000d1', userId: MEMBER });
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000d2' });
    await pass();
  });

  it('sends an unaddressed alert to the ADMINISTRATORS case, not to everyone', async () => {
    const rows = await notifications();
    expect(rows.find((row) => row.source_ref.endsWith('d2'))?.audience).toBe('administrators');
    expect(rows.find((row) => row.source_ref.endsWith('d1'))).toMatchObject({ audience: 'all', user_id: MEMBER });
  });

  it('refuses a member the administrators-only row and allows them their own', async () => {
    // Named after the attack: the shape that matters is "a member reads somebody
    // else's unaddressed security alert", and `security_alerts` itself is admin-only
    // today — so publishing it to `user_id IS NULL` would be a widening of the very
    // table this materialiser renders.
    const rows = await readAsMember(MEMBER);
    expect(rows.map((row) => row.source_ref)).toEqual(['0195f0e5-0002-7000-8000-0000000000d1']);
  });

  it('refuses a member another member’s notification', async () => {
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000d3', userId: ADMIN });
    await pass();
    const rows = await readAsMember(MEMBER);
    expect(rows.map((row) => row.source_ref)).not.toContain('0195f0e5-0002-7000-8000-0000000000d3');
    expect(rows).toHaveLength(1);
  });

  it('lets a member dismiss what they can see, and lets them change nothing else', async () => {
    const client = await authenticatorClient();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_member');
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claimsFor(MEMBER)]);
      const dismissed = await client.query(
        `UPDATE public.admin_notifications SET dismissed_at = now() WHERE source_ref = $1 RETURNING dismissed_at`,
        ['0195f0e5-0002-7000-8000-0000000000d1'],
      );
      expect(dismissed.rowCount, 'the member could not dismiss their own notification').toBe(1);

      // The same column grant must not be a licence to close somebody else's.
      const other = await client.query(
        `UPDATE public.admin_notifications SET dismissed_at = now() WHERE source_ref = $1 RETURNING dismissed_at`,
        ['0195f0e5-0002-7000-8000-0000000000d3'],
      );
      expect(other.rowCount, 'a member dismissed a notification addressed to somebody else').toBe(0);

      // …and to run the operator's half of the lifecycle. That one is refused at the
      // GRANT layer, not by the policy, because `app_member` holds no privilege on
      // `resolved_at` at any granularity: a column privilege can only narrow a grant
      // that exists, and there is none to narrow. Asserting on the error rather than
      // on a zero row count, because the two are different controls.
      await expect(
        client.query(`UPDATE public.admin_notifications SET resolved_at = now() WHERE source_ref = $1`, [
          '0195f0e5-0002-7000-8000-0000000000d3',
        ]),
      ).rejects.toThrow(/permission denied for table admin_notifications/);
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  });

  it('refuses an anonymous caller outright, so the denial is a 42501 rather than a zero-row read', async () => {
    const client = await authenticatorClient();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_anon');
      await expect(client.query('SELECT id FROM public.admin_notifications')).rejects.toThrow(/permission denied/);
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  });

  it('survives a malformed `sub` as a denial, rather than taking the whole query down', async () => {
    const client = await authenticatorClient();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_member');
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: 'not-a-uuid' })]);
      const rows = await client.query<{ id: string }>('SELECT id FROM public.admin_notifications');
      // Zero rows, and no error: `authz.actor()` catches its own cast (§B2), and a
      // policy that RAISES on caller input is a denial-of-service surface.
      expect(rows.rows).toEqual([]);
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  });
});

describe('the scheduling and gating facts a source that is not registered must not be able to get wrong', () => {
  it('registers one interval, from configuration, under its own dispatch token', () => {
    const scheduled: Array<{ name: string; intervalSeconds: number }> = [];
    const job = new NotificationMaterializer(
      { materializeIntervalSeconds: 300, lookbackSeconds: 3600, expirySeconds: DEFAULT_EXPIRY_SECONDS },
      admittingGate().gate,
      poolAsConnectionSource(pool),
      recordingJobs(scheduled),
    );
    job.onApplicationBootstrap();
    expect(scheduled).toEqual([{ name: NOTIFICATIONS_MATERIALIZE, intervalSeconds: 300 }]);
  });

  it('asks the breaker as `notifications.materialize` and takes a NON-stoppable lease', async () => {
    // Non-stoppable because every pass is ONE transaction over every source: an abort
    // would make a partial pass representable, and the transaction already gives
    // all-or-nothing without a second mechanism for it.
    const recording = admittingGate();
    const job = new NotificationMaterializer(
      { materializeIntervalSeconds: 300, lookbackSeconds: 3600, expirySeconds: DEFAULT_EXPIRY_SECONDS },
      recording.gate,
      poolAsConnectionSource(pool),
      recordingJobs([]),
    );
    await job.tick();
    expect(recording.tokens).toEqual([NOTIFICATIONS_MATERIALIZE]);
    expect(recording.stoppable).toEqual([false]);
  });
});

describe('the migration itself', () => {
  it('is a `UNIQUE NULLS NOT DISTINCT` identity and not a default UNIQUE', () => {
    // If this ever changes to a plain `UNIQUE`, the system-wide rows start
    // duplicating on every pass and only a real database would notice — which is why
    // the assertion reads the shipped file and the proof above reads the live index.
    expect(MIGRATION_0027).toMatch(/UNIQUE NULLS NOT DISTINCT \(source, source_ref, user_id\)/);
    expect(MIGRATION_0027).not.toMatch(/UNIQUE \(source, source_ref, user_id\)/);
  });

  it('never sets `request.jwt.claims` — the write path that would make F1 reachable', () => {
    // Comments are stripped first, for the reason
    // `test/unit/claims-write-surface.spec.ts` strips them: the prohibition is about
    // EXECUTABLE text, and this change's own files discuss the setting at length in
    // prose. The global scanner is the real gate; this is the local one.
    const files = [
      MIGRATION_0027,
      readFileSync(join(SRC, 'notifications', 'notification-materializer.service.ts'), 'utf8'),
      readFileSync(join(SRC, 'notifications', 'security-alert-materializer.ts'), 'utf8'),
      readFileSync(join(SRC, 'notifications', 'materializer.ts'), 'utf8'),
    ];
    for (const file of files) {
      expect(stripComments(file)).not.toContain('request.jwt.claims');
      expect(stripComments(file)).not.toContain('set_config');
    }
  });
});

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const sql = line.indexOf('--');
      const ts = line.indexOf('//');
      const at = [sql, ts].filter((index) => index !== -1).sort((a, b) => a - b)[0];
      return at === undefined ? line : line.slice(0, at);
    })
    .join('\n');
}

/** The claims document a real member token carries, and nothing else. */
function claimsFor(sub: string): string {
  return JSON.stringify({ sub, role: 'app_member' });
}

async function readAsMember(sub: string): Promise<readonly NotificationRow[]> {
  const client = await authenticatorClient();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_member');
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claimsFor(sub)]);
    const result = await client.query<NotificationRow>(
      `SELECT id, source, kind, audience, user_id, source_ref, severity, is_mock,
              created_at, expires_at, acknowledged_at, resolved_at, dismissed_at, data
       FROM public.admin_notifications ORDER BY source_ref`,
    );
    await client.query('COMMIT');
    return result.rows;
  } finally {
    await client.end();
  }
}

/** The watermark query the runner reads, asserted live rather than by comment. */
describe('the watermark', () => {
  it('reads the newest rendered source row, and nothing at all for a source with none', async () => {
    await reset();
    expect(await watermarkOf('security_alerts')).toEqual([]);

    // Two rows an HOUR apart, seeded oldest-first, so the newest source row and the
    // newest-minted notification are different rows.
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000e1', hoursOld: 1 });
    await seedAlert({ id: '0195f0e5-0002-7000-8000-0000000000e2', hoursOld: 0 });
    await pass();

    const marked = await watermarkOf('security_alerts');
    expect(marked).toHaveLength(1);
    // The NEWEST source row (`e2`, seeded last and one hour newer), not the
    // oldest-minted notification — which is the difference `materializer.ts` argues at
    // length, and the only way to see it is to seed two rows out of order and read
    // which one the mark lands on.
    expect(marked[0]?.watermark_at).toEqual(
      (await notifications()).find((row) => row.source_ref.endsWith('e2'))?.created_at,
    );
  });
});