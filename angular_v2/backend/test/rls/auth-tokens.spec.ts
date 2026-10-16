import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';
import { createHmac, randomBytes } from 'node:crypto';

const TIMEOUT = 120_000;
const UP_MIGRATION = join(BACKEND_ROOT, 'database', 'migrations', '0018_auth_tokens.sql');
const DOWN_MIGRATION = join(BACKEND_ROOT, 'database', 'migrations', '0018_auth_tokens.down.sql');

describe('auth_tokens RLS and primitive security proof (migration 0018)', () => {
  let client: Client;
  let ownerClient: Client;
  const env = loadTestEnvironment();

  beforeAll(async () => {
    // Owner client for DDL and direct table inspection
    ownerClient = new Client({
      host: env.database.host,
      port: env.database.port,
      user: env.database.user,
      password: env.database.password,
      database: env.database.database,
    });
    await ownerClient.connect();

    // Authenticator client for serving role escalation boundary (SET LOCAL ROLE app_admin)
    client = new Client({
      host: env.database.host,
      port: env.database.port,
      user: env.authenticator.user,
      password: env.authenticator.password,
      database: env.database.database,
    });
    await client.connect();

    // Ensure migration 0018 is applied as the schema owner role
    const upSql = readFileSync(UP_MIGRATION, 'utf8');
    await ownerClient.query(upSql);
  }, TIMEOUT);

  afterAll(async () => {
    try {
      await client?.end();
      await ownerClient?.end();
    } finally {
      restoreAuthenticatorPassword();
    }
  });

  describe('catalog and structural security posture', () => {
    it('ENABLEs RLS and deliberately does NOT FORCE it (relrowsecurity=true, relforcerowsecurity=false)', async () => {
      const res = await ownerClient.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relrowsecurity, relforcerowsecurity
           FROM pg_class
          WHERE oid = 'public.auth_tokens'::regclass`,
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].relrowsecurity, 'RLS must be enabled').toBe(true);
      expect(res.rows[0].relforcerowsecurity, 'RLS must not be forced').toBe(false);
    });

    it('defaults primary key to uuidv7()', async () => {
      const res = await ownerClient.query<{ default_expr: string }>(
        `SELECT pg_get_expr(d.adbin, d.adrelid) AS default_expr
           FROM pg_attrdef d
           JOIN pg_class c ON c.oid = d.adrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
          WHERE n.nspname = 'public' AND c.relname = 'auth_tokens' AND a.attname = 'id'`,
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].default_expr).toContain('uuidv7');
    });

    it('cascades on delete when user_id references users(id)', async () => {
      const res = await ownerClient.query<{ confdeltype: string }>(
        `SELECT con.confdeltype
           FROM pg_constraint con
           JOIN pg_class c ON c.oid = con.conrelid
          WHERE c.relname = 'auth_tokens' AND con.contype = 'f'`,
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].confdeltype, 'FK must be ON DELETE CASCADE (c)').toBe('c');
    });

    it('revokes all table privileges from PUBLIC, app_anon, app_member, and app_admin', async () => {
      const res = await ownerClient.query<{ grantee: string; privilege_type: string }>(
        `SELECT grantee, privilege_type
           FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name = 'auth_tokens'`,
      );

      const servingGrants = res.rows.filter((row) =>
        ['PUBLIC', 'app_anon', 'app_member', 'app_admin'].includes(row.grantee),
      );
      expect(servingGrants, 'serving roles must hold no direct table grants').toEqual([]);
    });

    it('grants EXECUTE on authz token functions to app_admin and revokes from PUBLIC', async () => {
      const functions = [
        'mint_auth_token',
        'redeem_auth_token',
        'invalidate_auth_tokens',
        'purge_expired_auth_tokens',
      ];

      for (const fn of functions) {
        const res = await ownerClient.query<{ grantee: string }>(
          `SELECT r.rolname AS grantee
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
             LEFT JOIN pg_roles r ON r.oid = acl.grantee
            WHERE n.nspname = 'authz' AND p.proname = $1`,
          [fn],
        );

        const grantees = res.rows.map((row) => row.grantee ?? 'PUBLIC');
        expect(grantees, `${fn} must be granted to app_admin`).toContain('app_admin');
        expect(grantees, `${fn} must be revoked from PUBLIC`).not.toContain('PUBLIC');
      }
    });
  });

  describe('atomic redemption, single-use, and concurrency', () => {
    function makeHash(token: string): Buffer {
      return createHmac('sha256', 'test-salt').update(token).digest();
    }

    it('mints and redeems a token exactly once; second redemption fails', async () => {
      const tokenHash = makeHash(randomBytes(16).toString('hex'));
      const subjectHmac = makeHash('user-1');

      // Mint through escalation boundary (pgrst_authenticator + SET LOCAL ROLE app_admin)
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      const mintRes = await client.query<{ id: string }>(
        'SELECT authz.mint_auth_token($1, $2, $3, $4, $5, $6) AS id',
        [null, subjectHmac, 'kid-1', tokenHash, 'password_reset', 3600],
      );
      await client.query('COMMIT');
      expect(mintRes.rows[0].id).toBeDefined();

      // First redemption: succeeds
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      const redeemRes1 = await client.query<{ id: string; consumed_at: Date }>(
        'SELECT * FROM authz.redeem_auth_token($1, $2)',
        [tokenHash, 'password_reset'],
      );
      await client.query('COMMIT');
      expect(redeemRes1.rows).toHaveLength(1);
      expect(redeemRes1.rows[0].id).toBe(mintRes.rows[0].id);

      // Second redemption: fails (0 rows)
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      const redeemRes2 = await client.query(
        'SELECT * FROM authz.redeem_auth_token($1, $2)',
        [tokenHash, 'password_reset'],
      );
      await client.query('COMMIT');
      expect(redeemRes2.rows).toHaveLength(0);
    });

    it('proves concurrent redemption race: exactly one transaction succeeds', async () => {
      const tokenHash = makeHash(randomBytes(16).toString('hex'));
      const subjectHmac = makeHash('user-concurrent');

      // Mint
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      await client.query(
        'SELECT authz.mint_auth_token($1, $2, $3, $4, $5, $6) AS id',
        [null, subjectHmac, 'kid-1', tokenHash, 'password_reset', 3600],
      );
      await client.query('COMMIT');

      // Open two separate clients connected through the authenticator boundary
      const clientA = new Client({
        host: env.database.host,
        port: env.database.port,
        user: env.authenticator.user,
        password: env.authenticator.password,
        database: env.database.database,
      });
      const clientB = new Client({
        host: env.database.host,
        port: env.database.port,
        user: env.authenticator.user,
        password: env.authenticator.password,
        database: env.database.database,
      });

      await clientA.connect();
      await clientB.connect();

      try {
        const attempt = async (c: Client) => {
          await c.query('BEGIN');
          await c.query('SET LOCAL ROLE app_admin');
          const res = await c.query('SELECT * FROM authz.redeem_auth_token($1, $2)', [
            tokenHash,
            'password_reset',
          ]);
          await c.query('COMMIT');
          return res.rowCount ?? 0;
        };

        const [rowsA, rowsB] = await Promise.all([attempt(clientA), attempt(clientB)]);

        // Exactly one client must receive 1 row; the other 0
        expect(rowsA + rowsB, 'Sum of successful concurrent redemptions must be exactly 1').toBe(1);
      } finally {
        await clientA.end();
        await clientB.end();
      }
    });

    it('refuses cross-purpose redemption', async () => {
      const tokenHash = makeHash(randomBytes(16).toString('hex'));
      const subjectHmac = makeHash('user-cross-purpose');

      // Mint for password_reset
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      await client.query(
        'SELECT authz.mint_auth_token($1, $2, $3, $4, $5, $6) AS id',
        [null, subjectHmac, 'kid-1', tokenHash, 'password_reset', 3600],
      );
      await client.query('COMMIT');

      // Attempt redemption for email_verification: must fail (0 rows)
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      const redeemWrong = await client.query(
        'SELECT * FROM authz.redeem_auth_token($1, $2)',
        [tokenHash, 'email_verification'],
      );
      await client.query('COMMIT');
      expect(redeemWrong.rows).toHaveLength(0);

      // Now redeem with correct purpose: succeeds (1 row)
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      const redeemRight = await client.query(
        'SELECT * FROM authz.redeem_auth_token($1, $2)',
        [tokenHash, 'password_reset'],
      );
      await client.query('COMMIT');
      expect(redeemRight.rows).toHaveLength(1);
    });

    it('refuses expired token redemption', async () => {
      const tokenHash = makeHash(randomBytes(16).toString('hex'));
      const subjectHmac = makeHash('user-expired');

      // Mint with 1 second TTL
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      await client.query(
        'SELECT authz.mint_auth_token($1, $2, $3, $4, $5, $6) AS id',
        [null, subjectHmac, 'kid-1', tokenHash, 'password_reset', 1],
      );
      await client.query('COMMIT');

      // Wait 1.2s so token expires
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Attempt redemption: must fail
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      const res = await client.query(
        'SELECT * FROM authz.redeem_auth_token($1, $2)',
        [tokenHash, 'password_reset'],
      );
      await client.query('COMMIT');
      expect(res.rows).toHaveLength(0);
    });

    it('cascades deletion when user is deleted', async () => {
      // Create user as app_admin
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      const userRes = await client.query<{ id: string }>(
        `INSERT INTO public.users (username, email, password_hash)
         VALUES ('token_cascade_user', 'token_cascade@example.test', 'hash')
         RETURNING id`,
      );
      await client.query('COMMIT');
      const userId = userRes.rows[0].id;

      const tokenHash = makeHash(randomBytes(16).toString('hex'));
      const subjectHmac = makeHash('token_cascade@example.test');

      // Mint token for this user
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      await client.query(
        'SELECT authz.mint_auth_token($1, $2, $3, $4, $5, $6) AS id',
        [userId, subjectHmac, 'kid-1', tokenHash, 'account_deletion', 3600],
      );
      await client.query('COMMIT');

      // Assert row exists (ownerClient can read auth_tokens table directly)
      const countBefore = await ownerClient.query<{ count: string }>(
        'SELECT count(*) AS count FROM public.auth_tokens WHERE user_id = $1',
        [userId],
      );
      expect(Number(countBefore.rows[0].count)).toBe(1);

      // Delete user
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      await client.query('DELETE FROM public.users WHERE id = $1', [userId]);
      await client.query('COMMIT');

      // Assert token row was cascaded
      const countAfter = await ownerClient.query<{ count: string }>(
        'SELECT count(*) AS count FROM public.auth_tokens WHERE user_id = $1',
        [userId],
      );
      expect(Number(countAfter.rows[0].count)).toBe(0);
    });
  });

  describe('down and up migration cycle', () => {
    it('executes down script cleanly and up script cleanly', async () => {
      const downSql = readFileSync(DOWN_MIGRATION, 'utf8');
      const upSql = readFileSync(UP_MIGRATION, 'utf8');

      // Execute DOWN as owner
      await ownerClient.query(downSql);

      // Assert table dropped
      const checkTableDropped = await ownerClient.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'auth_tokens'
         ) AS exists`,
      );
      expect(checkTableDropped.rows[0].exists).toBe(false);

      // Assert functions dropped
      const checkFnDropped = await ownerClient.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'authz' AND p.proname = 'redeem_auth_token'
         ) AS exists`,
      );
      expect(checkFnDropped.rows[0].exists).toBe(false);

      // Re-apply UP as owner
      await ownerClient.query(upSql);

      // Assert table restored
      const checkTableRestored = await ownerClient.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'auth_tokens'
         ) AS exists`,
      );
      expect(checkTableRestored.rows[0].exists).toBe(true);
    });
  });
});
