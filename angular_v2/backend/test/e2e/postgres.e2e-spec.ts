import { randomUUID } from 'node:crypto';
import { Client, type QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseConfig } from '../support/database.js';

const TIMEOUT = 30_000;
const UNREACHABLE_CODES = /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN/;

const config = databaseConfig();
const schema = `verify_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
let client: Client;
let connected = false;

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : '';
}

beforeAll(async () => {
  client = new Client(config);
  await client.connect();
  connected = true;
}, TIMEOUT);

afterAll(async () => {
  if (!connected) {
    return;
  }
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.end();
});

describe('PostgreSQL integration', () => {
  it(
    'connects as a role that does not bypass row-level security',
    async () => {
      const result = await client.query<{ current_user: string; bypassrls: boolean }>(
        'SELECT current_user, rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = current_user',
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.current_user).toBe(config.user);
      expect(result.rows[0]?.bypassrls).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'creates, reads and drops its own throwaway schema',
    async () => {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`CREATE TABLE ${schema}.probe (id integer PRIMARY KEY, label text NOT NULL)`);
      await client.query(`INSERT INTO ${schema}.probe (id, label) VALUES (1, 'row')`);

      const rows: QueryResult<{ label: string }> = await client.query<{ label: string }>(
        `SELECT label FROM ${schema}.probe WHERE id = 1`,
      );
      expect(rows.rows).toEqual([{ label: 'row' }]);

      const visibleFromSearchPath = await client.query<{ located: string | null }>('SELECT to_regclass($1) AS located', [
        'probe',
      ]);
      expect(visibleFromSearchPath.rows[0]?.located ?? null).toBeNull();

      await client.query(`DROP SCHEMA ${schema} CASCADE`);

      const remaining = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name = $1',
        [schema],
      );
      expect(remaining.rows[0]?.count).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'surfaces a connection failure instead of resolving',
    async () => {
      const unreachable = new Client({ ...config, port: 1, connectionTimeoutMillis: 2000 });

      const failure: unknown = await unreachable.connect().then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(Error);
      expect(errorCode(failure)).toMatch(UNREACHABLE_CODES);
    },
    TIMEOUT,
  );
});
