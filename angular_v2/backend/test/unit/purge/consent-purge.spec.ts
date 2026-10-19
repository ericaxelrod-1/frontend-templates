import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONSENT_PURGE, KNOWN_DISPATCH_TOKENS } from '../../../src/breaker/dispatch-token.js';
import { ConsentPurge } from '../../../src/purge/consent-purge.service.js';
import type { RetentionEnvironment } from '../../../src/purge/retention-environment.js';
import { TRIP_ENV, tripHarness } from '../../support/breaker-harness.js';
import type { TripHarness } from '../../support/breaker-harness.js';
import { loadTestEnvironment } from '../../support/database.js';
import {
  CONSENT_PURGE_PROOF_DATABASE,
  authenticatorClient,
  dropProofDatabase,
  rebuildProofDatabase,
} from '../notifications/proof-database.js';

/**
 * **The consent purge, against a real PostgreSQL, on its real schedule.**
 *
 * ## WHY THIS FILE EXISTS
 *
 * `authz.purge_expired_consent_records()` was shipped by `0028` with a grant, a
 * required window, a bound and a trigger that creates the rows it exists to delete
 * — and **nothing called it**. The consent record of every erased person
 * accumulated forever and the published retention policy did not happen.
 *
 * A function that exists, is granted, and is never called is the exact shape of
 * defect this repository keeps meeting: the code reads as finished. So this file
 * does not check that the function works — `test/unit/consent/consent-model.spec.ts`
 * already proves that — it checks the two things that were missing:
 *
 *   1. **the job is REGISTERED.** A job that exists but is not scheduled is the
 *      finding again, one level up, and nothing about the database would show it.
 *   2. **the job DELETES.** The rows are written, the job runs, and the expired
 *      ones are gone while the live ones are not.
 *
 * ## WHY A REAL DATABASE AND NOT A SCRIPTED POOL
 *
 * `AGENTS.md` §2.2: no stand-in for a real integration. The interesting half of
 * this job is in the database — the append-only guard, the `SECURITY DEFINER`
 * function, the `ON DELETE RESTRICT` foreign key and the RLS policy that admits
 * only `app_admin` — and a scripted pool would prove that the application issued
 * a string, which is not the property at stake.
 *
 * ## WHY THE RUNNER'S LOCK CONNECTION IS POINTED AT THE PROOF DATABASE
 *
 * `JobRunner` takes its advisory lock on a connection of its own, opened against
 * `environment.database.database`. Left alone, that is the developer's own
 * database: a connection this suite should not be opening, and a lock that is not
 * the one the proof is about. `tripHarness(env, database)` points it at the
 * throwaway database the rest of this file uses.
 *
 * ## THE WINDOW IS NOT ASSERTED, IT IS EXERCISED
 *
 * `tombstoneDays` is 1825 — the shipped floor — and the fixtures are backdated
 * either side of it. The point of the suite is that the job expires what is PAST
 * the window and keeps what is inside it, and a window of 1825 with a fixture
 * backdated 2000 days is that boundary being crossed for real.
 */

const DB = CONSENT_PURGE_PROOF_DATABASE;

/**
 * The windows are a decision and the interval is a scheduling fact; this suite
 * asserts scheduling and neither of their values — except the interval, which is
 * one SECOND so the real timer fires inside the test. Everything else is the
 * shipped shape.
 */
const ENV: RetentionEnvironment = {
  tombstoneDays: 1825,
  inactiveAccountDays: 1095,
  enqueueIntervalSeconds: 3600,
  consentPurgeIntervalSeconds: 1,
};

let owner: Client;
let pool: Pool;
let harness: TripHarness;

async function asRole<T>(role: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = await authenticatorClient(DB);
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** The same boundary, as a member whose `sub` is `sub`. */
async function asMember<T>(sub: string, work: (client: Client) => Promise<T>): Promise<T> {
  return asRole('app_member', async (client) => {
    await client.query('SELECT set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub, role: 'app_member' }),
    ]);
    return work(client);
  });
}

let subjects = 0;
let purposes = 0;

/** A fresh user, created through the boundary. */
async function newUser(): Promise<string> {
  subjects += 1;
  return asRole('app_admin', async (client) => {
    const row = await client.query<{ readonly id: string }>(
      `INSERT INTO public.users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
      [`purge-${String(subjects)}`, `purge-${String(subjects)}@example.test`],
    );
    return row.rows[0]?.id;
  });
}

/** A fresh catalogue entry. */
async function newPurpose(): Promise<string> {
  purposes += 1;
  const key = `p${String(purposes)}_purge_suite`;
  await asRole('app_admin', async (client) => {
    await client.query(
      `INSERT INTO public.consent_purposes (key, label, description, legal_basis, requires_consent, policy_version)
       VALUES ($1, $2, 'a purpose this suite created', 'consent', true, 1)`,
      [key, `Purpose ${String(purposes)}`],
    );
  });
  return key;
}

/** Records one decision through the ONLY writer, as `sub`. */
async function record(sub: string, purposeKey: string): Promise<string> {
  return asMember(sub, async (client) => {
    const row = await client.query<{ readonly id: string }>(
      'SELECT authz.record_consent_decision($1, $2, $3) AS id',
      [purposeKey, true, 'consent_control'],
    );
    return row.rows[0]?.id;
  });
}

/** Anonymises an account the way the erasure path does — the trigger that orphans the series. */
async function erase(sub: string): Promise<void> {
  await asRole('app_admin', async (client) => {
    await client.query(
      `UPDATE public.users SET deleted_at = now(), deletion_reason = 'rtbf' WHERE id = $1`,
      [sub],
    );
  });
}

/**
 * Backdates a row. `recorded_at` is what the retention window is measured on, and
 * no serving role may write it — only the owner, which is the point.
 */
async function backdate(id: string, days: number): Promise<void> {
  await owner.query(
    'UPDATE public.consent_records SET recorded_at = now() - make_interval(days => $2) WHERE id = $1',
    [id, days],
  );
}

type RecordRow = {
  readonly id: string;
  readonly user_id: string | null;
  readonly purpose_key: string;
};

async function rowsById(ids: readonly string[]): Promise<readonly RecordRow[]> {
  return asRole('app_admin', async (client) =>
    (
      await client.query<RecordRow>(
        `SELECT id, user_id, purpose_key FROM public.consent_records WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [ids],
      )
    ).rows,
  );
}

/** The three shapes a record can be in when the sweep reaches it. */
type Fixtures = {
  /** An erased person's record, past the window: the sweep's work. */
  readonly expiredOrphan: string;
  /** An erased person's record, inside the window: too young to expire. */
  readonly freshOrphan: string;
  /** A live person's record, backdated past the window: not the sweep's to destroy. */
  readonly liveRecord: string;
};

async function seedFixtures(): Promise<Fixtures> {
  const purpose = await newPurpose();

  const erasedOld = await newUser();
  const expiredOrphan = await record(erasedOld, purpose);
  await backdate(expiredOrphan, ENV.tombstoneDays + 200);
  await erase(erasedOld);

  const erasedFresh = await newUser();
  const freshOrphan = await record(erasedFresh, purpose);
  await erase(erasedFresh);

  const live = await newUser();
  const liveRecord = await record(live, purpose);
  await backdate(liveRecord, ENV.tombstoneDays + 200);

  return { expiredOrphan, freshOrphan, liveRecord };
}

/** Polls until the condition holds, so the assertion is about the effect and not about a sleep. */
async function waitUntil(predicate: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${what} did not happen within 20s`);
}

beforeAll(async () => {
  await rebuildProofDatabase(DB);
  const env = loadTestEnvironment();
  owner = new Client({ ...env.database, database: DB });
  await owner.connect();
  pool = new Pool({
    host: env.database.host,
    port: env.database.port,
    user: env.authenticator.user,
    password: env.authenticator.password,
    database: DB,
  });
  harness = tripHarness(TRIP_ENV, DB);
}, 300_000);

afterAll(async () => {
  await pool?.end().catch(() => undefined);
  await owner?.end().catch(() => undefined);
  dropProofDatabase(DB);
}, 120_000);

// =============================================================================
// 1. THE JOB IS A NAMED DISPATCH SITE
// =============================================================================

describe('the consent purge is a named dispatch site', () => {
  it('has a token in the shared vocabulary, so the gate and the lock key can name it', () => {
    // `undefined` was the old answer for an unnamed job: fail-closed, and
    // undocumented infrastructure behaving by accident. A token makes the job
    // nameable by the gate, the scheduler and the lock-key derivation alike.
    expect(CONSENT_PURGE).toBe('consent.purge');
    expect(KNOWN_DISPATCH_TOKENS).toContain(CONSENT_PURGE);
  });
});

// =============================================================================
// 2. IT IS REGISTERED — THE FINDING, ONE LEVEL UP
// =============================================================================

describe('the job is registered with the runner', () => {
  it('registers exactly one interval, under the dispatch token, and clears it on shutdown', () => {
    // A job that exists but is not scheduled is the original finding again: the
    // function is granted, the window is asserted, and nothing ever runs. The
    // registry is where a schedule either exists or does not, so this is asserted
    // there rather than inferred from a log line.
    const purge = new ConsentPurge(ENV, harness.gate, { connect: () => pool.connect() }, harness.jobs);

    purge.onApplicationBootstrap();
    expect(harness.scheduler.getIntervals()).toEqual([CONSENT_PURGE]);

    purge.onModuleDestroy();
    expect(harness.scheduler.getIntervals()).toEqual([]);
  });
});

// =============================================================================
// 3. IT DELETES — AND IT DELETES THE RIGHT THINGS
// =============================================================================

describe('the sweep expires the consent records of erased people, and nothing else', () => {
  it('removes the orphaned records past the window and keeps the ones inside it', async () => {
    // The series is keyed to a PERSON, so after an erasure the rows are orphaned
    // and nothing else ties them to a clock. A sweep that also expired a LIVE
    // person's consent history would destroy the record while the person is still
    // using the product — the opposite of what append-only is protecting.
    const fixtures = await seedFixtures();
    const purge = new ConsentPurge(ENV, harness.gate, { connect: () => pool.connect() }, harness.jobs);

    const run = await purge.tick();

    // A count, not `void`: a purge that reports nothing is indistinguishable from a
    // purge that found nothing.
    expect(run).toEqual({ ran: true, removed: 1 });

    const survivors = await rowsById([fixtures.expiredOrphan, fixtures.freshOrphan, fixtures.liveRecord]);
    expect(survivors.map((row) => row.id).sort()).toEqual(
      [fixtures.freshOrphan, fixtures.liveRecord].sort(),
    );
    expect(
      survivors.find((row) => row.id === fixtures.liveRecord)?.user_id,
      "a live person's record was expired",
    ).not.toBeNull();
  });

  it('runs on its interval, not only when somebody calls it', async () => {
    // The registration above and the deletion above are two halves of one claim,
    // and this is the half that joins them: the REAL `setInterval` the runner
    // registered fires, takes the advisory lock on a dedicated connection, and the
    // body deletes. A job that only deletes when called by hand is a job nothing
    // calls.
    const fixtures = await seedFixtures();
    const purge = new ConsentPurge(ENV, harness.gate, { connect: () => pool.connect() }, harness.jobs);

    purge.onApplicationBootstrap();
    try {
      await waitUntil(async () => {
        const survivors = await rowsById([fixtures.expiredOrphan]);
        return survivors.length === 0;
      }, 'the registered interval did not expire the orphaned record');
    } finally {
      purge.onModuleDestroy();
    }

    // …and the other two are still there, so the interval deleted the right row and
    // not the next one.
    const survivors = await rowsById([fixtures.freshOrphan, fixtures.liveRecord]);
    expect(survivors.map((row) => row.id).sort()).toEqual(
      [fixtures.freshOrphan, fixtures.liveRecord].sort(),
    );
  });

  it('is idempotent: a second sweep finds nothing and changes nothing', async () => {
    // The runner records no "this ran" marker, so a job killed mid-body is re-run
    // from the beginning by the next process that gets the lock. The body has to be
    // safe to run twice, and "a window comparison and a delete" is.
    const fixtures = await seedFixtures();
    const purge = new ConsentPurge(ENV, harness.gate, { connect: () => pool.connect() }, harness.jobs);

    expect(await purge.tick()).toEqual({ ran: true, removed: 1 });
    expect(await purge.tick()).toEqual({ ran: true, removed: 0 });

    const survivors = await rowsById([fixtures.freshOrphan, fixtures.liveRecord]);
    expect(survivors).toHaveLength(2);
  });
});
