import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseConfig } from '../support/database.js';

/**
 * The last step of `npm run verify`. It runs against the live database named by
 * `DB_*` and fails — loudly, with the driver's own error — when that database
 * is unreachable. There is no skip path and no in-memory substitute.
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
});
