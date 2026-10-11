import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';

/**
 * The last step of `npm run verify`. It runs against the live database named by
 * `DB_*` and fails — loudly, with the driver's own error — when that database
 * is unreachable. There is no skip path and no in-memory substitute.
 *
 * It runs LAST on purpose. The row-level security proof that ran immediately
 * before it rewrites `pgrst_authenticator`'s LOGIN password — a CLUSTER-scoped
 * role, not a database-scoped one — so whatever it leaves behind is what this
 * check reads. That is the whole point of putting the assertion here: a step
 * that only ever ran in isolation could not see the damage a preceding step did
 * to the shared cluster, and a green `verify` reported success while leaving the
 * development machine unable to mint a token.
 */
const config = databaseConfig();
let client: Client;
let connected = false;

beforeAll(async () => {
  client = new Client(config);
  await client.connect();
  connected = true;
});

afterAll(async () => {
  if (connected) {
    await client.end();
  }
});

describe('database smoke check', () => {
  it('answers a live query as a non-superuser role', async () => {
    const result = await client.query<{
      version: string;
      current_user: string;
      current_database: string;
      superuser: boolean;
    }>(
      "SELECT version(), current_user, current_database(), (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser",
    );

    const row = result.rows[0];

    expect(row?.current_user).toBe(config.user);
    expect(row?.current_database).toBe(config.database);
    expect(row?.superuser).toBe(false);
    expect(row?.version).toMatch(/PostgreSQL \d+/);
  });

  it('reports the schemas PostgREST is expected to be able to expose', async () => {
    const result = await client.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg\\_%' AND schema_name <> 'information_schema' ORDER BY schema_name",
    );

    expect(result.rows.map((row) => row.schema_name)).toContain('public');
  });

  it('the login role authenticates with the configured AUTHENTICATOR_PASSWORD, so the RLS proof did not leave the cluster worse than it found it', async () => {
    // A real connection, because a SCRAM verifier cannot be read back: the only
    // honest statement about "is this the configured password" is whether a login
    // with it succeeds. Asserting against `pg_authid.rolpassword` would compare
    // opaque hashes and pass either way.
    //
    // The failure this catches was observed, not theorised: the RLS fixture ran
    // `ALTER ROLE pgrst_authenticator LOGIN PASSWORD <proof password>` as
    // superuser and never undid it, so every green verify left the role on the
    // fixture's password and the next `npm run dev` answered
    // `POST /auth/login` → HTTP 500, `password authentication failed for user
    // "pgrst_authenticator"`. PostgREST failed the same way, because both
    // connect as this role.
    const authenticator = loadTestEnvironment().authenticator;
    const probe = new Client({
      host: config.host,
      port: config.port,
      user: authenticator.user,
      password: authenticator.password,
      database: config.database,
    });

    try {
      await probe.connect();
    } catch (error) {
      throw new Error(
        `pgrst_authenticator cannot authenticate with the configured AUTHENTICATOR_PASSWORD on ${config.database}: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          'The row-level security proof changes that password on the CLUSTER and is supposed to restore it; ' +
          'either its afterAll did not run, or the password in backend/.env.test is not the one it restores. ' +
          'Re-run `npm run db:seed` (which sets it from AUTHENTICATOR_PASSWORD) rather than editing it by hand.',
        { cause: error },
      );
    }

    try {
      const result = await probe.query<{ ok: number }>('SELECT 1 AS ok');
      expect(result.rows[0]?.ok).toBe(1);
    } finally {
      await probe.end().catch(() => undefined);
    }
  });
});
