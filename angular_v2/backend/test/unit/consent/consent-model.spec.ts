import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { consentConfigMaterializer } from '../../../src/notifications/consent-config-materializer.js';
import {
  CONSENT_PROOF_DATABASE,
  authenticatorClient,
  dropProofDatabase,
  rebuildProofDatabase,
} from '../notifications/proof-database.js';
import { loadTestEnvironment } from '../../support/database.js';

/**
 * The consent model against a REAL PostgreSQL, and the append-only proof.
 *
 * ## WHY A REAL DATABASE (§2.2)
 *
 * Every property this file asserts lives in the server and nowhere else:
 *
 *   * append-only is a `GRANT` **and** a `BEFORE UPDATE OR DELETE` trigger. A JSON
 *     fixture cannot tell "the grant was revoked" from "the trigger refused it" from
 *     "there was nothing there", and the two halves are the whole point.
 *   * pseudonymisation is an `AFTER UPDATE … ON users` trigger whose body is
 *     `SECURITY DEFINER`, so whether it runs at all is a question about the owner's
 *     privileges meeting the guard trigger above it.
 *   * the referential action on a hard purge of a user is a system trigger that runs
 *     with the privileges of the owner of the referencing table, and whether it
 *     survives the guard is exactly the question `0028` says must be verified rather
 *     than assumed.
 *   * `authz.effective_consent()` is `DISTINCT ON` over an event log, so the derived
 *     state is wrong the moment the ordering is.
 *
 * ## WHY THERE IS NO `reset()`
 *
 * `consent_records` refuses `DELETE` to every serving role and `TRUNCATE` to every
 * role, including the one this suite authenticates as. That is the control under
 * test, so a suite that cleaned up by deleting rows would be asserting the control
 * and depending on its absence at the same time.
 *
 * So nothing is cleaned up. Every case owns its own subject and its own purpose key
 * and asserts only about rows it created, which also makes the cases independent of
 * one another's ORDER — the alternative is a suite where one test's appends change
 * another's row count.
 *
 * ## THE OWNER IS REACHED FROM HERE, ON PURPOSE, TWICE
 *
 * `owner` is the migration role `app`, which is not a member of any serving role and
 * which this suite uses for exactly two things: widening a grant so the trigger half
 * of append-only can be proved separately from the grant half, and backdating a row
 * to place it on one side of a retention window. Both are operations no serving role
 * may perform, which is the point of asserting them through it.
 */

const DB = CONSENT_PROOF_DATABASE;

let owner: Client;
let pool: Pool;

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

/**
 * A running refusal, returned rather than thrown.
 *
 * "this is refused" is not expressible by a helper that reports refusal as an
 * exception and says nothing about WHICH refusal it was — and here the two are
 * different controls: `permission denied for table consent_records` is the GRANT,
 * and `is append-only` is the TRIGGER. An assertion on one message would pass with
 * the other control absent.
 */
async function refusal(work: () => Promise<unknown>): Promise<{ readonly code: string; readonly message: string }> {
  try {
    await work();
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    if (failure.code !== undefined) {
      return { code: failure.code, message: failure.message ?? '' };
    }
    throw error;
  }
  throw new Error('the statement was accepted, so there is no refusal to report');
}

let subjects = 0;

/** A fresh user, created through the boundary — the owner is bound by its own policies. */
async function newUser(): Promise<string> {
  subjects += 1;
  return asRole('app_admin', async (client) => {
    const row = await client.query<{ readonly id: string }>(
      `INSERT INTO public.users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
      [`consent-${String(subjects)}`, `consent-${String(subjects)}@example.test`],
    );
    return row.rows[0]?.id;
  });
}

let purposes = 0;

/** A fresh catalogue entry. `policyVersion` is the knob decision 2 exists for. */
async function newPurpose(policyVersion = 1): Promise<string> {
  purposes += 1;
  const key = `p${String(purposes)}_suite`;
  await asRole('app_admin', async (client) => {
    await client.query(
      `INSERT INTO public.consent_purposes (key, label, description, legal_basis, requires_consent, policy_version)
       VALUES ($1, $2, 'a purpose this suite created', 'consent', true, $3)`,
      [key, `Purpose ${String(purposes)}`, policyVersion],
    );
  });
  return key;
}

/** Records one decision through the ONLY writer, as `sub`. */
async function record(sub: string, purposeKey: string, granted: boolean, mechanism = 'consent_control'): Promise<string> {
  return asMember(sub, async (client) => {
    const row = await client.query<{ readonly id: string }>('SELECT authz.record_consent_decision($1, $2, $3) AS id', [
      purposeKey,
      granted,
      mechanism,
    ]);
    return row.rows[0]?.id;
  });
}

type RecordRow = {
  readonly id: string;
  readonly user_id: string | null;
  readonly purpose_key: string;
  readonly granted: boolean;
  readonly policy_version: number;
  readonly mechanism: string;
  readonly source: string;
  readonly recorded_at: Date;
};

async function seriesFor(sub: string): Promise<readonly RecordRow[]> {
  return asRole('app_admin', async (client) =>
    (
      await client.query<RecordRow>(
        `SELECT id, user_id, purpose_key, granted, policy_version, mechanism, source, recorded_at
           FROM public.consent_records WHERE user_id = $1 ORDER BY recorded_at, id`,
        [sub],
      )
    ).rows,
  );
}

async function rowsById(ids: readonly string[]): Promise<readonly RecordRow[]> {
  return asRole('app_admin', async (client) =>
    (
      await client.query<RecordRow>(
        `SELECT id, user_id, purpose_key, granted, policy_version, mechanism, source, recorded_at
           FROM public.consent_records WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [ids],
      )
    ).rows,
  );
}

/** Anonymises an account the way the erasure path does: `users` is the trigger's table. */
async function erase(sub: string): Promise<void> {
  await asRole('app_admin', async (client) => {
    await client.query(`UPDATE public.users SET deleted_at = now(), deletion_reason = 'rtbf' WHERE id = $1`, [sub]);
  });
}

beforeAll(async () => {
  await rebuildProofDatabase(DB);
  owner = new Client({ ...loadTestEnvironment().database, database: DB });
  await owner.connect();
  const env = loadTestEnvironment();
  pool = new Pool({
    host: env.database.host,
    port: env.database.port,
    user: env.authenticator.user,
    password: env.authenticator.password,
    database: DB,
  });
}, 300_000);

afterAll(async () => {
  await pool?.end().catch(() => undefined);
  await owner?.end().catch(() => undefined);
  dropProofDatabase(DB);
}, 120_000);

// =============================================================================
// 1. THE CATALOGUE IS PUBLIC — BECAUSE THE GATE RUNS BEFORE ANYONE SIGNS IN
// =============================================================================

describe('the catalogue is readable by a caller who has not signed in', () => {
  it('lets app_anon read the purposes, the page groups, the tags and the join', async () => {
    // The reason this is a grant rather than a leak: the gate runs in the BROWSER,
    // before anybody is signed in, so a visitor cannot be asked about a processing
    // whose description they are refused. What is here is what the application says
    // it does — and for any tracker a fork adds, the same identifier that is already
    // in the page source.
    const key = await newPurpose();
    await asRole('app_admin', async (client) => {
      await client.query(
        `INSERT INTO public.consent_page_groups (key, path_globs, authenticated_only)
         VALUES ('anon_readable', '["/pricing"]', false)`,
      );
      await client.query(
        `INSERT INTO public.consent_tags (key, snippet, purposes) VALUES ('anon_readable_tag', '<script></script>', $1::jsonb)`,
        [JSON.stringify([key])],
      );
    });

    const purposes_ = await asRole('app_anon', async (client) =>
      (await client.query<{ readonly key: string }>('SELECT key FROM public.consent_purposes ORDER BY key')).rows,
    );
    expect(purposes_.map((row) => row.key)).toContain(key);

    for (const relation of ['consent_page_groups', 'consent_tags', 'consent_tag_groups']) {
      const rows = await asRole('app_anon', async (client) =>
        (await client.query<{ readonly n: number }>(`SELECT count(*)::int AS n FROM public.${relation}`)).rows,
      );
      expect(rows[0]?.n, `app_anon read nothing from ${relation}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('refuses app_anon the consent records outright, so the refusal is a 42501 and not a zero-row read', async () => {
    // No grant at all on this table for `app_anon`, which is the cheapest certainty
    // that an anonymous reader is refused. A policy alone would answer `200 []`.
    const sub = await newUser();
    await record(sub, await newPurpose(), true);

    const refused = await refusal(() =>
      asRole('app_anon', async (client) => client.query('SELECT id FROM public.consent_records')),
    );
    expect(refused.code).toBe('42501');
    expect(refused.message).toMatch(/permission denied for table consent_records/);
  });
});

// =============================================================================
// 2. APPEND-ONLY, HALF ONE — THE GRANTS
// =============================================================================

describe('no serving role holds a verb that could rewrite the record', () => {
  it('holds no INSERT, UPDATE, DELETE or TRUNCATE on consent_records — app_admin included', async () => {
    // Read from `pg_class`, for every serving role and every verb. `app_admin` is the
    // SUPERSET PRINCIPAL and not a bypass (§B2); on this table the superset set is
    // `SELECT`, and that is the answer to "what may an administrator do to a person's
    // consent history".
    const held = await asRole('app_admin', async (client) =>
      (
        await client.query<{ readonly role: string; readonly verb: string }>(
          `SELECT r.role, p.verb
             FROM unnest(ARRAY['app_anon', 'app_member', 'app_admin']) AS r(role)
             CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(verb)
            WHERE has_table_privilege(r.role, 'public.consent_records', p.verb)
            ORDER BY r.role, p.verb`,
        )
      ).rows,
    );

    expect(held).toEqual([]);
    // …and the one verb that IS granted, so the assertion above is not the shape a
    // table nobody can read at all would also produce.
    const reads = await asRole('app_admin', async (client) =>
      (
        await client.query<{ readonly member: boolean; readonly admin: boolean; readonly anon: boolean }>(
          `SELECT has_table_privilege('app_member', 'public.consent_records', 'SELECT')    AS member,
                  has_table_privilege('app_admin', 'public.consent_records', 'SELECT')    AS admin,
                  has_table_privilege('app_anon',  'public.consent_records', 'SELECT')    AS anon`,
        )
      ).rows[0],
    );
    expect(reads).toEqual({ member: true, admin: true, anon: false });
  });

  it('refuses app_admin an UPDATE and a DELETE by name, as 42501', async () => {
    const sub = await newUser();
    const key = await newPurpose();
    await record(sub, key, true);

    const updated = await refusal(() =>
      asRole('app_admin', async (client) => client.query('UPDATE public.consent_records SET granted = false')),
    );
    expect(updated.code).toBe('42501');
    expect(updated.message).toMatch(/permission denied for table consent_records/);

    const deleted = await refusal(() =>
      asRole('app_admin', async (client) => client.query('DELETE FROM public.consent_records')),
    );
    expect(deleted.code).toBe('42501');
    expect(deleted.message).toMatch(/permission denied for table consent_records/);

    // …and the row is still exactly what it was. Asserted on the ROW, because
    // "nothing raised" is also what a delete that removed nothing looks like from
    // outside.
    expect(await seriesFor(sub)).toHaveLength(1);
    expect((await seriesFor(sub))[0]).toMatchObject({
      purpose_key: key,
      granted: true,
      mechanism: 'consent_control',
    });
  });

  it('refuses app_admin an INSERT, because the write seam is the only writer', async () => {
    const refused = await refusal(() =>
      asRole('app_admin', async (client) =>
        client.query(
          `INSERT INTO public.consent_records (user_id, purpose_key, granted, policy_version, mechanism)
           VALUES (NULL, $1, true, 1, 'by_hand')`,
          [await newPurpose()],
        ),
      ),
    );
    expect(refused.code).toBe('42501');
  });
});

// =============================================================================
// 3. APPEND-ONLY, HALF TWO — THE TRIGGER, PROVED BY BREAKING THE GRANT
// =============================================================================

describe('the guard refuses a rewrite even when a grant has been widened', () => {
  it('is the second half of the control, and only a widened grant can show it', async () => {
    // `0016` states the two halves for `privacy_purge_queue`: "A policy with no grant
    // behind it is not dead code, it is the reason a widened grant is still refused at
    // the row layer." A future migration that grants UPDATE to `app_admin` would be
    // caught HERE rather than quietly opening a rewrite of the statutory record — and
    // a suite that only ever saw the refusal by grant could not tell the two apart.
    const sub = await newUser();
    await record(sub, await newPurpose(), true);
    const before = await seriesFor(sub);
    expect(before).toHaveLength(1);

    await owner.query('GRANT UPDATE, DELETE ON public.consent_records TO app_admin');
    try {
      const updated = await refusal(() =>
        asRole('app_admin', async (client) =>
          client.query('UPDATE public.consent_records SET granted = false WHERE user_id = $1', [sub]),
        ),
      );
      expect(updated.code).toBe('42501');
      // The TRIGGER's message, not the GRANT's. This is the assertion that says which
      // of the two controls fired.
      expect(updated.message).toMatch(/is append-only/);
      expect(updated.message).toMatch(/may not UPDATE it/);

      const deleted = await refusal(() =>
        asRole('app_admin', async (client) =>
          client.query('DELETE FROM public.consent_records WHERE user_id = $1', [sub]),
        ),
      );
      expect(deleted.code).toBe('42501');
      expect(deleted.message).toMatch(/is append-only/);
      expect(deleted.message).toMatch(/may not DELETE it/);

      expect(await seriesFor(sub), 'the trigger half did not hold either').toEqual(before);
    } finally {
      await owner.query('REVOKE UPDATE, DELETE ON public.consent_records FROM app_admin');
    }
  });
});

// =============================================================================
// 4. THE WRITE SEAM, AND ONLY IT
// =============================================================================

describe('a decision is appended only through the seam, and only for the caller', () => {
  it('records the caller as the subject, and the signature has no user parameter to contradict that', async () => {
    const sub = await newUser();
    const key = await newPurpose(3);
    await record(sub, key, true);

    const [row] = await seriesFor(sub);
    expect(row).toMatchObject({
      user_id: sub,
      purpose_key: key,
      granted: true,
      // Copied from the catalogue AT THE MOMENT OF THE DECISION rather than joined at
      // read time: a later bump to `consent_purposes.policy_version` must not silently
      // re-label a decision that was taken under the old one.
      policy_version: 3,
      source: 'app',
    });

    const signature = await asRole('app_admin', async (client) =>
      (
        await client.query<{ readonly args: string | null }>(
          `SELECT pg_get_function_arguments(p.oid) AS args
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'authz' AND p.proname = 'record_consent_decision'`,
        )
      ).rows[0]?.args,
    );
    expect(signature).not.toMatch(/user/i);
  });

  it('refuses an anonymous caller at the grant, and by name once a grant is widened', async () => {
    // Two different controls and the test says which is which. `EXECUTE` is granted to
    // `app_member` and `app_admin` only, so an anonymous caller is refused by the
    // GRANT — the cheaper of the two, and `0021` closes it the same way.
    const refused = await refusal(() =>
      asRole('app_anon', async (client) => client.query(`SELECT authz.record_consent_decision('x', true, 'ui')`)),
    );
    expect(refused.code).toBe('42501');
    expect(refused.message).toMatch(/permission denied for function record_consent_decision/);

    // The function's OWN gate is the second half, and a second half that can never
    // fire is not a control — so it is made reachable here, exactly as the
    // append-only guard is made reachable by widening the grant above. `0021` carries
    // the same pair; this is the case that proves the pair is not one control written
    // twice.
    await owner.query('GRANT EXECUTE ON FUNCTION authz.record_consent_decision(text, boolean, text, text) TO app_anon');
    try {
      const widened = await refusal(() =>
        asRole('app_anon', async (client) => client.query(`SELECT authz.record_consent_decision('x', true, 'ui')`)),
      );
      expect(widened.code).toBe('42501');
      expect(widened.message).toMatch(/only a signed-in caller/);
    } finally {
      await owner.query(
        'REVOKE EXECUTE ON FUNCTION authz.record_consent_decision(text, boolean, text, text) FROM app_anon',
      );
    }
  });

  it('refuses a member whose sub is unusable, rather than appending a row with no subject', async () => {
    // A malformed `sub` is a clean denial everywhere else in this schema — `actor()`
    // catches its own cast — and it is one here rather than an append with a NULL
    // subject, which decision 3 forbids.
    const malformed = await asRole('app_member', async (client) => {
      await client.query('SELECT set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify({ sub: 'not-a-uuid' })]);
      return refusal(() => client.query(`SELECT authz.record_consent_decision('x', true, 'ui')`));
    });
    expect(malformed.code).toBe('42501');
    expect(malformed.message).toMatch(/no usable `sub`/);
  });

  it('refuses a blank mechanism, because pseudonymisation keeps it', async () => {
    const sub = await newUser();
    const key = await newPurpose();
    const refused = await asMember(sub, async (client) =>
      refusal(() => client.query('SELECT authz.record_consent_decision($1, $2, $3)', [key, true, '   '])),
    );
    expect(refused.code).toBe('22023');
    expect(refused.message).toMatch(/the mechanism is required/);
  });

  it('refuses a purpose key that is not in the catalogue, by name', async () => {
    const sub = await newUser();
    const refused = await asMember(sub, async (client) =>
      refusal(() => client.query('SELECT authz.record_consent_decision($1, $2, $3)', ['no_such_purpose', true, 'ui'])),
    );
    expect(refused.code).toBe('22023');
    expect(refused.message).toMatch(/no consent_purposes row has key no_such_purpose/);
  });
});

// =============================================================================
// 5. CURRENT STATE IS DERIVED, AND A READ APPENDS NOTHING
// =============================================================================

describe('the current state is the latest event, and reading it appends nothing', () => {
  it('answers with one row per purpose — the latest — after a grant and a later revocation', async () => {
    // The decision the model exists for: a person who agreed in March and revoked in
    // June has TWO facts, and storing only the latest destroys the one that proves the
    // revocation.
    const sub = await newUser();
    const key = await newPurpose();
    await record(sub, key, true, 'consent_control');
    await record(sub, key, false, 'settings_page');

    expect(
      (await seriesFor(sub)).map((row) => row.granted),
      'both facts are still rows',
    ).toEqual([true, false]);

    const effective = await asMember(sub, async (client) =>
      (await client.query<{ readonly purpose_key: string; readonly granted: boolean; readonly mechanism: string }>('SELECT * FROM authz.effective_consent($1)', [sub])).rows,
    );
    expect(effective).toHaveLength(1);
    expect(effective[0]).toMatchObject({ purpose_key: key, granted: false, mechanism: 'settings_page' });
  });

  it('appends nothing when the gate reads: a render is not a decision', async () => {
    // Requirement 7, proven by COUNT rather than by "nothing raised" — a read that
    // wrote a row and a read that did not both return successfully.
    const sub = await newUser();
    await record(sub, await newPurpose(), true);
    const before = await seriesFor(sub);

    await asMember(sub, async (client) => {
      await client.query<{ readonly purpose_key: string; readonly granted: boolean; readonly mechanism: string }>('SELECT * FROM authz.effective_consent($1)', [sub]);
      await client.query('SELECT key FROM public.consent_purposes');
      await client.query('SELECT count(*) FROM public.consent_records');
    });
    await asRole('app_admin', async (client) => client.query<{ readonly purpose_key: string; readonly granted: boolean; readonly mechanism: string }>('SELECT * FROM authz.effective_consent($1)', [sub]));

    expect(await seriesFor(sub)).toEqual(before);
  });

  it('refuses a member another subject\'s series, through the policy rather than a second check', async () => {
    // `SECURITY INVOKER`, so RLS applies with the CALLER's privileges: a member asking
    // about somebody else gets zero rows because the policy admits only their own. A
    // `p_user_id`-shaped check inside the function would be a second mechanism for a
    // question the policy already answers, and it would answer it differently.
    const mine = await newUser();
    const theirs = await newUser();
    const myKey = await newPurpose();
    await record(mine, myKey, true);
    await record(theirs, await newPurpose(), true);

    expect(
      await asMember(mine, async (client) => client.query<{ readonly purpose_key: string; readonly granted: boolean; readonly mechanism: string }>('SELECT * FROM authz.effective_consent($1)', [theirs])),
    ).toMatchObject({ rows: [] });

    // …and the raw table says the same thing, so the guarantee is the POLICY's and not
    // the function's.
    expect(
      await asMember(mine, async (client) => client.query('SELECT purpose_key FROM public.consent_records')),
    ).toMatchObject({ rows: [{ purpose_key: myKey }] });
  });

  it('gives app_admin the whole series, which is the second of the two readers the model admits', async () => {
    const a = await newUser();
    const b = await newUser();
    const keyA = await newPurpose();
    const keyB = await newPurpose();
    await record(a, keyA, true);
    await record(b, keyB, true);

    const seen = await asRole('app_admin', async (client) =>
      (
        await client.query<{ readonly purpose_key: string }>(
          'SELECT purpose_key FROM public.consent_records WHERE user_id = ANY($1::uuid[]) ORDER BY purpose_key',
          [[a, b]],
        )
      ).rows,
    );
    expect(seen.map((row) => row.purpose_key)).toEqual([keyA, keyB].sort());
  });
});

// =============================================================================
// 6. ERASURE PSEUDONYMISES THE SERIES
// =============================================================================

describe('an erasure drops the identifier and keeps the fact', () => {
  it('nulls user_id on every row and keeps timestamp, purpose, version, mechanism and source', async () => {
    // The trigger is on `users` rather than on the erasure route, so a path that
    // anonymised an account without knowing about this table would leave a series
    // identifying a person who no longer exists. It is `SECURITY DEFINER` because the
    // append-only guard refuses an `UPDATE` whose caller is not the owner, and `0009`
    // already showed that a half-privilege here leaves a tombstone in a state nothing
    // else can reach.
    const sub = await newUser();
    const first = await newPurpose();
    const second = await newPurpose();
    await record(sub, first, true, 'consent_control');
    await record(sub, second, false, 'settings_page');
    const before = await seriesFor(sub);
    expect(before).toHaveLength(2);

    await erase(sub);

    const orphaned = await rowsById(before.map((row) => row.id));
    expect(orphaned).toHaveLength(2);
    for (const [index, row] of orphaned.entries()) {
      expect(row.user_id, 'the identifier is exactly what an erasure has to remove').toBeNull();
      expect(row).toMatchObject({
        purpose_key: before[index]?.purpose_key,
        granted: before[index]?.granted,
        policy_version: before[index]?.policy_version,
        mechanism: before[index]?.mechanism,
        source: before[index]?.source,
      });
      expect(new Date(row.recorded_at).toISOString()).toBe(new Date(before[index]?.recorded_at).toISOString());
    }
  });

  it('is idempotent: anonymising again rewrites nothing', async () => {
    // The predicate `OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL` is the
    // whole of the idempotency, for the reason `ANONYMISE_SUBJECT_SQL` is: there is
    // no "have I already done this" branch that could be got wrong.
    const sub = await newUser();
    await record(sub, await newPurpose(), true);
    const id = (await seriesFor(sub))[0]?.id;

    for (const attempt of [1, 2, 3]) {
      await asRole('app_admin', async (client) => {
        await client.query(
          `UPDATE public.users SET deleted_at = coalesce(deleted_at, now()), deletion_reason = 'rtbf' WHERE id = $1`,
          [sub],
        );
      });
      const [row] = await rowsById([id]);
      expect(row, `attempt ${String(attempt)}`).toMatchObject({ user_id: null });
    }
  });
});

// =============================================================================
// 7. THE FOREIGN KEY, ON A HARD PURGE
// =============================================================================

describe('a hard purge of the account destroys the person, not the proof', () => {
  it('survives the delete, survives the append-only guard, and loses only the identifier', async () => {
    // `0028` says this had to be VERIFIED rather than assumed, and it is: the
    // referential action is a system trigger running with the privileges of the owner
    // of the referencing table, which is the one role the append-only guard admits. If
    // that were not so, every purge of an erased account would raise `42501` — which is
    // what a purge is.
    const sub = await newUser();
    const key = await newPurpose();
    await record(sub, key, true, 'consent_control');
    const [before] = await seriesFor(sub);
    expect(before).toBeDefined();

    await asRole('app_admin', async (client) => client.query('DELETE FROM public.users WHERE id = $1', [sub]));

    const [survivor] = await rowsById([before?.id]);
    expect(survivor).toMatchObject({
      user_id: null,
      purpose_key: key,
      granted: true,
      mechanism: 'consent_control',
    });
    const gone = await asRole('app_admin', async (client) =>
      (await client.query<{ readonly n: number }>('SELECT count(*)::int AS n FROM public.users WHERE id = $1', [sub])).rows,
    );
    expect(gone[0]?.n).toBe(0);
  });

  it('clears an actor pointer the same way, so a tag survives the erasure of whoever configured it', async () => {
    // `0024`'s distinction: the tag is not a record about its author, so their erasure
    // must not destroy it. SET NULL and never CASCADE — the `disabled_by` case is why.
    const author = await newUser();
    const tagId = await asRole('app_admin', async (client) => {
      const row = await client.query<{ readonly id: string }>(
        `INSERT INTO public.consent_tags (key, snippet, purposes, created_by)
         VALUES ('authored', '<script></script>', '[]'::jsonb, $1) RETURNING id`,
        [author],
      );
      return row.rows[0]?.id;
    });

    await erase(author);
    await asRole('app_admin', async (client) => client.query('DELETE FROM public.users WHERE id = $1', [author]));

    const survivor = await asRole('app_admin', async (client) =>
      (await client.query<{ readonly created_by: string | null; readonly snippet: string }>('SELECT created_by, snippet FROM public.consent_tags WHERE id = $1', [tagId])).rows,
    );
    expect(survivor).toHaveLength(1);
    expect(survivor[0]?.created_by).toBeNull();
    expect(survivor[0]?.snippet).toBe('<script></script>');
  });
});

// =============================================================================
// 8. RETENTION — THE ONE LEGITIMATE DELETER
// =============================================================================

describe('the retention sweep deletes orphaned records and nothing else', () => {
  /** Backdates a row. `recorded_at` is trigger-managed and no serving role may write it. */
  async function backdate(id: string, days: number): Promise<void> {
    await owner.query('UPDATE public.consent_records SET recorded_at = now() - make_interval(days => $2) WHERE id = $1', [
      id,
      days,
    ]);
  }

  it('sweeps an orphaned row past the window, keeps a fresh orphan, and keeps a live person\'s record', async () => {
    // The series is keyed to a PERSON, so after an erasure these rows are orphaned and
    // nothing else ties them to a clock. A sweep that also expired a LIVE person's
    // consent history would destroy the record while the person is still using the
    // product — the opposite of what append-only is protecting.
    const erasedOld = await newUser();
    await record(erasedOld, await newPurpose(), true);
    const [erasedOldRow] = await seriesFor(erasedOld);
    await backdate(erasedOldRow?.id, 4000);
    await erase(erasedOld);

    const erasedFresh = await newUser();
    await record(erasedFresh, await newPurpose(), true);
    const [erasedFreshRow] = await seriesFor(erasedFresh);
    await erase(erasedFresh);

    const live = await newUser();
    const liveKey = await newPurpose();
    await record(live, liveKey, true);
    const [liveRow] = await seriesFor(live);
    await backdate(liveRow?.id, 4000);

    const removed = await asRole('app_admin', async (client) =>
      (await client.query<{ readonly removed: number }>('SELECT authz.purge_expired_consent_records($1::integer) AS removed', [3650])).rows[0]
        ?.removed,
    );
    // A count, not `void`: a purge that reports nothing is indistinguishable from a
    // purge that found nothing.
    expect(removed, 'the sweep returns a count').toBeGreaterThanOrEqual(1);

    const survivors = await rowsById([
      erasedOldRow?.id,
      erasedFreshRow?.id,
      liveRow?.id,
    ]);
    expect(survivors.map((row) => row.id).sort()).toEqual([erasedFreshRow?.id, liveRow?.id].sort());
    expect(survivors.find((row) => row.id === liveRow?.id)?.user_id, 'a live person keeps their record').toBe(live);
  });

  it('refuses a missing or out-of-range window rather than inventing one', async () => {
    // `RETENTION_TOMBSTONE_DAYS` is a PARAMETER here and not a second clock. A missing
    // window that defaulted to something would be exactly the second clock the brief
    // forbids.
    const missing = await asRole('app_admin', async (client) =>
      refusal(() => client.query('SELECT authz.purge_expired_consent_records(NULL::integer)')),
    );
    expect(missing.code).toBe('22023');
    expect(missing.message).toMatch(/does not read a second clock/);

    const absurd = await asRole('app_admin', async (client) =>
      refusal(() => client.query('SELECT authz.purge_expired_consent_records($1::integer)', [0])),
    );
    expect(absurd.code).toBe('22023');
    expect(absurd.message).toMatch(/between 1 and 36500/);
  });

  it('is unreachable by a member, so the sweep is not a second writer', async () => {
    const refused = await asMember(await newUser(), async (client) =>
      refusal(() => client.query('SELECT authz.purge_expired_consent_records($1::integer)', [3650])),
    );
    expect(refused.code).toBe('42501');
  });
});

// =============================================================================
// 9. THE MISCONFIGURATION REPORT
// =============================================================================

type NotificationRow = {
  readonly source: string;
  readonly kind: string;
  readonly severity: string;
  readonly title: string;
  readonly message: string;
  readonly audience: string;
  readonly user_id: string | null;
  readonly source_ref: string;
  readonly data: Record<string, unknown>;
};

async function reportedBy(source: string): Promise<readonly NotificationRow[]> {
  return asRole('app_admin', async (client) =>
    (
      await client.query<NotificationRow>(
        `SELECT source, kind, severity, title, message, audience, user_id, source_ref, data
           FROM public.admin_notifications WHERE source = $1 ORDER BY source_ref`,
        [source],
      )
    ).rows,
  );
}

/** Seeds a tag and returns its id. Nothing here is caught: a tag that cannot be stored
 *  fails loudly, and a tag that stores but is WRONG is this report's job. */
// `purposeKeys` is `unknown[]` rather than `string[]` on purpose: one case below stores a
// NUMBER in `consent_tags.purposes` on purpose, so the report has something to reject that
// a type error would have made unwriteable.
async function tag(key: string, snippet: string, purposeKeys: readonly unknown[], groups: readonly string[] = []): Promise<string> {
  return asRole('app_admin', async (client) => {
    const row = await client.query<{ readonly id: string }>(
      'INSERT INTO public.consent_tags (key, snippet, purposes) VALUES ($1, $2, $3::jsonb) RETURNING id',
      [key, snippet, JSON.stringify(purposeKeys)],
    );
    const id = row.rows[0]?.id;
    for (const groupKey of groups) {
      await client.query(
        `INSERT INTO public.consent_tag_groups (tag_id, group_id)
         SELECT $1, id FROM public.consent_page_groups WHERE key = $2`,
        [id, groupKey],
      );
    }
    return id;
  });
}

/** The window a first pass is given: no watermark, so the runner seeds it one overlap back. */
const FIRST_PASS_FLOOR = (): Date => new Date(Date.now() - 3_600_000);

/**
 * Runs the registered `consent_config` source against a real database.
 *
 * A `Pool` and not the single-connection boundary the rest of this file uses,
 * because `Materializer.materialize` takes a `PoolClient` — the same shape
 * `NotificationMaterializer` hands it in production, so the assertions below are
 * about the path the job really takes rather than about a connection made to
 * measure.
 */
async function reportPass(): Promise<{ readonly scanned: number; readonly created: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_admin');
    const summary = await consentConfigMaterializer.materialize(client, { floorAt: FIRST_PASS_FLOOR() }, 2_592_000);
    await client.query('COMMIT');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

describe('a misconfigured tag is reported to stdout and to the panel, and blocks nothing', () => {
  it('publishes one notification per malformed tag, names every defect, and leaves a sound tag alone', async () => {
    await asRole('app_admin', async (client) => {
      await client.query(
        `INSERT INTO public.consent_page_groups (key, path_globs) VALUES ('report_group', '["/**"]')
         ON CONFLICT (key) DO NOTHING`,
      );
    });

    const soundPurpose = await newPurpose();
    const soundTag = await tag('sound_tag', '<script data-x></script>', [soundPurpose], ['report_group']);
    const unknownTag = await tag('unknown_purpose_tag', '<script></script>', ['not_a_purpose'], ['report_group']);
    const emptySnippetTag = await tag('empty_snippet_tag', '   ', [soundPurpose], ['report_group']);
    const orphanTag = await tag('orphan_tag', '<script></script>', [soundPurpose]);
    const noPurposeTag = await tag('no_purpose_tag', '<script></script>', [], ['report_group']);
    const notAStringTag = await tag('not_a_string_tag', '<script></script>', [42], ['report_group']);

    const summary = await reportPass();

    // Both halves of "the sound tag is not reported": `scanned` proves the window
    // covered the rows, and its absence from the output proves the filter is not
    // "report everything".
    expect(summary.scanned).toBeGreaterThanOrEqual(6);
    expect(summary.created).toBeGreaterThanOrEqual(5);

    const byRef = new Map((await reportedBy('consent_config')).map((row) => [row.source_ref, row]));
    expect(byRef.has(soundTag), 'a sound tag must not be reported').toBe(false);

    const unknown = byRef.get(unknownTag);
    expect(unknown).toMatchObject({
      source: 'consent_config',
      kind: 'consent_tag_misconfigured',
      // HIGH and not the table default: a tag that is live and wrong is a compliance
      // defect, and a misconfiguration nobody triages is what this report exists to
      // prevent.
      severity: 'high',
      // Administrators only. NOT 'all' with a NULL user, which would publish a
      // misconfigured third-party snippet to every authenticated member.
      audience: 'administrators',
      user_id: null,
    });
    expect(unknown?.title).toContain('unknown_purpose_tag');
    expect(unknown?.message).toMatch(/no consent_purposes row has key not_a_purpose/);
    expect(unknown?.data).toMatchObject({ tag_key: 'unknown_purpose_tag', enabled: true });

    expect(byRef.get(emptySnippetTag)?.message).toMatch(/the snippet is empty/);
    expect(byRef.get(orphanTag)?.message).toMatch(/attached to no page group/);
    expect(byRef.get(noPurposeTag)?.message).toMatch(/names no purpose/);
    expect(byRef.get(notAStringTag)?.message).toMatch(/purpose entry is not a string/);
  });

  it('writes the same problem to the process output, so an operator without the panel still sees it', async () => {
    await asRole('app_admin', async (client) => {
      await client.query(
        `INSERT INTO public.consent_page_groups (key, path_globs) VALUES ('stdout_group', '["/**"]')
         ON CONFLICT (key) DO NOTHING`,
      );
    });
    const id = await tag('stdout_tag', '', [await newPurpose()], ['stdout_group']);

    // Nest's `ConsoleLogger` chooses a standard stream per level and that choice is
    // not this file's to make, so both are watched and the union is asserted. This is
    // the requirement's "reported to stdout", asserted on the CONTENT — a logger wired
    // to nothing could not produce a line naming the tag and the defect.
    const written: string[] = [];
    const spyOn = (stream: NodeJS.WriteStream): (() => void) => {
      const spy = vi.spyOn(stream, 'write').mockImplementation((chunk: unknown): boolean => {
        written.push(String(chunk));
        return true;
      });
      return (): void => {
        spy.mockRestore();
      };
    };
    const restoreOut = spyOn(process.stdout);
    const restoreErr = spyOn(process.stderr);
    try {
      await reportPass();
    } finally {
      restoreOut();
      restoreErr();
    }

    const output = written.join('');
    expect(output, 'nothing reached the process output at all').not.toBe('');
    expect(output).toContain('stdout_tag');
    expect(output).toMatch(/the snippet is empty/);
    expect((await reportedBy('consent_config')).map((row) => row.source_ref)).toContain(id);
  });

  it('is idempotent: a second pass republishes nothing and does not resurrect a dismissal', async () => {
    await asRole('app_admin', async (client) => {
      await client.query(
        `INSERT INTO public.consent_page_groups (key, path_globs) VALUES ('idempotent_group', '["/**"]')
         ON CONFLICT (key) DO NOTHING`,
      );
    });
    const id = await tag('idempotent_tag', '', ['missing_purpose'], ['idempotent_group']);

    expect((await reportPass()).created).toBeGreaterThanOrEqual(1);
    const dismissed = await asRole('app_admin', async (client) =>
      client.query(
        `UPDATE public.admin_notifications SET dismissed_at = now()
          WHERE source = 'consent_config' AND source_ref = $1 RETURNING dismissed_at`,
        [id],
      ),
    );
    expect(dismissed.rowCount).toBe(1);

    expect((await reportPass()).created, 'the overlap window re-reads the tag and writes nothing').toBe(0);
    const still = (await reportedBy('consent_config')).filter((row) => row.source_ref === id);
    expect(still, 'the dismissal must survive the next pass').toHaveLength(1);
  });

  it('is not readable by a member, so a misconfiguration is not published to every member', async () => {
    const member = await newUser();
    const seen = await asMember(member, async (client) =>
      (await client.query<{ readonly id: string }>('SELECT id FROM public.admin_notifications WHERE source = $1', ['consent_config'])).rows,
    );
    expect(seen).toEqual([]);
  });
});