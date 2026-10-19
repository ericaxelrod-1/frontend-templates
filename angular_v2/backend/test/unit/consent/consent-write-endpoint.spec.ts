import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { psqlAsSuperuser, restoreAuthenticatorPassword } from '../../support/cluster.js';
import { loadTestEnvironment } from '../../support/database.js';
import { startPostgrestProcess, type PostgrestProcess } from '../../support/postgrest-process.js';
import { mintToken, request, sqlStateOf } from '../../rls/support/jwt.js';
import {
  authenticatorClient,
  dropProofDatabase,
  rebuildProofDatabase,
} from '../notifications/proof-database.js';

/**
 * THE CONSENT WRITE, OVER THE REAL API LAYER.
 *
 * ## WHY THIS FILE EXISTS, AND WHAT IT WOULD HAVE CAUGHT
 *
 * The frontend POSTs to `/rest/rpc/record_consent_decision`. For thirteen
 * migrations that URL did not exist: `0028` created the write seam as
 * `authz.record_consent_decision`, `postgrest.conf` serves `public` alone, and a
 * person who clicked "accept" got a 404 — which the frontend caught with
 * `catchError(() => of(null))`, so the failure looked exactly like a successful
 * write that returned nothing. The feature was present, looked right, and did
 * nothing.
 *
 * **A MOCKED HTTP TEST CANNOT SEE THAT.** `consent-api.service.spec.ts` asserts
 * on the URL string, which proves the request was SHAPED right. It cannot prove
 * the endpoint EXISTS, because a mock answers whatever it is told to answer.
 * This file therefore runs against a real PostgREST and a real PostgreSQL, and
 * asserts on the catalogue, on the row that was written, and on the refusal.
 *
 * ## WHAT IS ASSERTED
 *
 *  1. **the RPC is in the served catalogue** — the document PostgREST serves,
 *     fetched from the running server, not a file in the repository. This is the
 *     assertion the mocked test could not make, and it is the one that would
 *     have gone red on the defect.
 *  2. **a signed-in member's decision lands** — over HTTP, through the wrapper,
 *     with the row read back from the DATABASE (as `app_admin`, through the
 *     escalation boundary) and every field checked: subject, purpose, grant,
 *     mechanism, source and the catalogue's policy version.
 *  3. **an anonymous call is refused with `42501`** — the SQLSTATE, not the HTTP
 *     status. PostgREST answers a privilege error to the anonymous role with a
 *     `401`, and a status-only assertion would be asserting the wrong thing.
 *  4. **`app_anon` holds no `EXECUTE` on the wrapper** — read from the live
 *     catalogue, because "the anonymous call was refused" and "the anonymous
 *     role has no privilege" are two different controls and only one of them is
 *     visible from outside.
 *
 * ## THE DATABASE
 *
 * A throwaway one, built by the REAL pipeline: every shipped migration, in
 * directory order, read from disk — so the SQL under test is the file that
 * ships. `AGENTS.md` §B8: never point a test at a developer's working data.
 *
 * ## THE AUTHENTICATOR PASSWORD
 *
 * `pgrst_authenticator` is CLUSTER-scoped, and PostgREST logs in as it, so the
 * suite sets its password to the CONFIGURED value before the run and puts it
 * back afterwards — the same thing `database/seed.ts` does, and the same
 * contract `test/support/cluster.ts` exists to honour. The restore is in a
 * `finally`, because leaving a cluster-scoped mutation behind is the failure
 * mode §B8 warns about.
 */

const TIMEOUT = 180_000;

/** Distinct from every other proof database, because vitest runs files in parallel. */
const PROOF_DB = 'consent_write_proof';

/** Distinct from 3016–3019, which the RLS suites own. */
const PROOF_PORT = 3021;

/** This suite's own signing secret. Never the application's. */
const PROOF_JWT_SECRET = 'unit-s-consent-write-signing-0123456789ab';

/** The catalogue version the purpose carries, so a copied value is distinguishable from a default. */
const POLICY_VERSION = 7;

const env = loadTestEnvironment();
const AUTHENTICATOR_PASSWORD = env.authenticator.password;

const PURPOSE_KEY = 'unit_s_analytics';
const MECHANISM = 'profile_settings';
const SOURCE = 'app';

let postgrest: PostgrestProcess;
let memberId = '';

/** A token for the proof server: the proof's own secret, never the application's. */
function token(sub: string, role: 'app_member' | 'app_admin'): string {
  return mintToken(PROOF_JWT_SECRET, { sub, role });
}

/** Runs a statement as `app_admin` through the escalation boundary, in one transaction. */
async function asAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = await authenticatorClient(PROOF_DB);
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_admin');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** One row of `consent_records`, as the assertions read it. */
type ConsentRecordRow = {
  readonly id: string;
  readonly user_id: string | null;
  readonly purpose_key: string;
  readonly granted: boolean;
  readonly policy_version: number;
  readonly mechanism: string;
  readonly source: string;
};

/** The rows in `consent_records`, read as an administrator so the count cannot be a visibility artefact. */
async function records(): Promise<readonly ConsentRecordRow[]> {
  return asAdmin(async (client) =>
    (
      await client.query<ConsentRecordRow>(
        `SELECT id, user_id, purpose_key, granted, policy_version, mechanism, source
           FROM public.consent_records ORDER BY recorded_at, id`,
      )
    ).rows,
  );
}

beforeAll(async () => {
  // The database, built from the shipped migrations. Two passes happen inside
  // `rebuildProofDatabase`, because "applies cleanly" and "is idempotent" are
  // different claims.
  await rebuildProofDatabase(PROOF_DB);

  // The authenticator's password, set to the configured value so PostgREST can
  // log in. Cluster-scoped, and restored in `afterAll`.
  psqlAsSuperuser(
    `ALTER ROLE pgrst_authenticator LOGIN PASSWORD '${AUTHENTICATOR_PASSWORD.replaceAll("'", "''")}'`,
    'postgres',
  );

  // The fixture: one member, one catalogue entry. The member is created through
  // the boundary, because `users` is FORCE ROW LEVEL SECURITY and the owner
  // role is bound by its own policies like anybody else's.
  await asAdmin(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO public.users (username, email, password_hash)
       VALUES ('unit-s-member', 'unit-s-member@example.test', 'not-a-real-hash')
       RETURNING id`,
    );
    memberId = inserted.rows[0]?.id ?? '';
    if (memberId === '') {
      throw new Error('the fixture member was not created');
    }

    await client.query(
      `INSERT INTO public.consent_purposes (key, label, description, legal_basis, requires_consent, policy_version)
       VALUES ($1, 'Analytics', 'a purpose this suite created', 'consent', true, $2)`,
      [PURPOSE_KEY, POLICY_VERSION],
    );
  });

  postgrest = await startPostgrestProcess({
    port: PROOF_PORT,
    database: PROOF_DB,
    authenticatorPassword: AUTHENTICATOR_PASSWORD,
    jwtSecret: PROOF_JWT_SECRET,
  });
}, TIMEOUT);

afterAll(() => {
  // Stopping PostgREST first lets the DROP terminate cleanly rather than fail
  // naming a connection the operator cannot see.
  try {
    postgrest?.stop();
  } finally {
    try {
      dropProofDatabase(PROOF_DB);
    } finally {
      restoreAuthenticatorPassword();
    }
  }
}, TIMEOUT);

describe('the consent write is an endpoint the API layer actually serves', () => {
  it('is in the catalogue PostgREST serves, not only in the database', async () => {
    // THE ASSERTION THE MOCKED TEST CANNOT MAKE. The document is fetched from
    // the running server, so it is the server's own answer to "do you serve
    // this?" — a committed file could be stale, and a mock always agrees.
    const response = await request(`${postgrest.baseUrl}/`);
    expect(response.status, `the served catalogue did not answer: ${response.body.slice(0, 200)}`).toBe(200);

    const document: unknown = JSON.parse(response.body);
    if (typeof document !== 'object' || document === null) {
      throw new TypeError('the served catalogue is not an object');
    }
    const paths = (document as Record<string, unknown>)['paths'];
    if (typeof paths !== 'object' || paths === null) {
      throw new TypeError('the served catalogue has no paths object');
    }

    expect(
      Object.keys(paths),
      'the served catalogue does not offer the consent write, so a member who accepts is talking to a 404',
    ).toContain('/rpc/record_consent_decision');
  });

  it('records a signed-in member\'s decision, and the row is in the table', async () => {
    const response = await request(
      `${postgrest.baseUrl}/rpc/record_consent_decision`,
      token(memberId, 'app_member'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_purpose_key: PURPOSE_KEY,
          p_granted: true,
          p_mechanism: MECHANISM,
          p_source: SOURCE,
        }),
      },
    );

    expect(response.status, `the member's decision was not accepted: ${response.body}`).toBe(200);

    // The response IS the new row's id, and it is the id of a row that exists.
    const id: unknown = JSON.parse(response.body);
    expect(typeof id, `the endpoint answered with something that is not a record id: ${response.body}`).toBe('string');

    const rows = await records();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      // The subject is the CLAIM, not a parameter: the wrapper takes no user
      // id, and the seam derives it from the token.
      user_id: memberId,
      purpose_key: PURPOSE_KEY,
      granted: true,
      // Copied from the catalogue AT THE MOMENT OF THE DECISION, not joined at
      // read time — a later bump to `consent_purposes.policy_version` must not
      // re-label a decision that was taken under the old one.
      policy_version: POLICY_VERSION,
      mechanism: MECHANISM,
      source: SOURCE,
    });
  });

  it('refuses an anonymous decision with 42501, and writes nothing', async () => {
    const before = await records();

    const response = await request(`${postgrest.baseUrl}/rpc/record_consent_decision`, undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_purpose_key: PURPOSE_KEY,
        p_granted: false,
        p_mechanism: 'anonymous',
        p_source: SOURCE,
      }),
    });

    // The SQLSTATE, not the HTTP status: PostgREST answers a privilege error
    // to the anonymous role with a 401, and a status-only assertion would be
    // asserting the wrong control.
    expect(sqlStateOf(response.body), `the anonymous call was not refused: ${response.status} ${response.body}`).toBe(
      '42501',
    );

    // And nothing was written, which is the half a status code cannot show.
    expect(await records(), 'the refused call still wrote a row').toEqual(before);
  });

  it('holds no EXECUTE on the wrapper for app_anon, and holds it for the two signed-in roles', async () => {
    // The grant, read from the live catalogue. "The anonymous call was refused"
    // and "the anonymous role has no privilege" are two different controls, and
    // only this one says which of them fired.
    const held = await asAdmin(async (client) =>
      (
        await client.query<{ anon: boolean; member: boolean; admin: boolean }>(
          `SELECT has_function_privilege('app_anon', 'public.record_consent_decision(text,boolean,text,text)', 'EXECUTE')  AS anon,
                  has_function_privilege('app_member', 'public.record_consent_decision(text,boolean,text,text)', 'EXECUTE') AS member,
                  has_function_privilege('app_admin', 'public.record_consent_decision(text,boolean,text,text)', 'EXECUTE')  AS admin`,
        )
      ).rows[0],
    );

    expect(held).toEqual({ anon: false, member: true, admin: true });
  });
});
