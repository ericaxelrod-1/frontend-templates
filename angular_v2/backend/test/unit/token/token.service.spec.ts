import { describe, expect, it } from 'vitest';
import { TokenService } from '../../../src/token/token.service.js';
import type { TokenEnvironment } from '../../../src/token/token-environment.js';
import { scriptedPool } from '../../support/breaker-harness.js';
import type { EmailService } from '../../../src/email/email.service.js';
import type { TokenPurpose } from '../../../src/token/token.types.js';

const TEST_ENV: TokenEnvironment = {
  pepper: 'test-pepper-token-secret-must-be-32-chars-long',
  pepperKid: 'test-kid-v1',
};

const DUMMY_EMAIL_SERVICE = {} as unknown as EmailService;

describe('TokenService primitive', () => {
  describe('mint', () => {
    it('refuses invalid purpose', async () => {
      const pool = scriptedPool([]);
      const service = new TokenService(pool.source, TEST_ENV, DUMMY_EMAIL_SERVICE);

      await expect(
        service.mint({
          purpose: 'invalid_purpose' as unknown as TokenPurpose,
          subjectIdentifier: 'user@example.test',
        }),
      ).rejects.toThrow(/Invalid token purpose/);
    });

    it('refuses empty subjectIdentifier', async () => {
      const pool = scriptedPool([]);
      const service = new TokenService(pool.source, TEST_ENV, DUMMY_EMAIL_SERVICE);

      await expect(
        service.mint({
          purpose: 'password_reset',
          subjectIdentifier: '   ',
        }),
      ).rejects.toThrow(/subjectIdentifier must be a non-empty string/);
    });

    it('refuses non-positive ttlSeconds', async () => {
      const pool = scriptedPool([]);
      const service = new TokenService(pool.source, TEST_ENV, DUMMY_EMAIL_SERVICE);

      await expect(
        service.mint({
          purpose: 'password_reset',
          subjectIdentifier: 'user@example.test',
          ttlSeconds: -10,
        }),
      ).rejects.toThrow(/ttlSeconds must be a positive/);
    });

    it('successfully mints a token, saves via authz.mint_auth_token, and returns rawToken', async () => {
      const tokenId = '018f3c2a-1b4d-7c8e-9f01-23456789abcd';
      const pool = scriptedPool([
        {
          when: (s) => s.includes('authz.mint_auth_token'),
          results: [{ rows: [{ id: tokenId }], rowCount: 1 }],
        },
      ]);
      const service = new TokenService(pool.source, TEST_ENV, DUMMY_EMAIL_SERVICE);

      const minted = await service.mint({
        purpose: 'password_reset',
        subjectIdentifier: 'user@example.test',
        userId: '018f3c2a-1b4d-7c8e-9f01-000000000001',
      });

      expect(minted.id).toBe(tokenId);
      expect(minted.purpose).toBe('password_reset');
      expect(typeof minted.rawToken).toBe('string');
      expect(minted.rawToken.length).toBeGreaterThanOrEqual(40);
      expect(minted.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const statements = pool.statements();
      expect(statements.some((s) => s.text === 'SET LOCAL ROLE app_admin')).toBe(true);

      const mintCall = statements.find((s) => s.text.includes('authz.mint_auth_token'));
      expect(mintCall).toBeDefined();
      expect(mintCall?.values[0]).toBe('018f3c2a-1b4d-7c8e-9f01-000000000001'); // userId
      expect(Buffer.isBuffer(mintCall?.values[1])).toBe(true); // subjectHmac
      expect(mintCall?.values[2]).toBe('test-kid-v1'); // pepperKid
      expect(Buffer.isBuffer(mintCall?.values[3])).toBe(true); // tokenHash
      expect(mintCall?.values[4]).toBe('password_reset'); // purpose
      expect(mintCall?.values[5]).toBe(3600); // default ttl
    });
  });

  describe('redeem', () => {
    it('successfully redeems a valid token with expected purpose', async () => {
      const tokenId = '018f3c2a-1b4d-7c8e-9f01-23456789abcd';
      const subjectHmac = Buffer.from('abcd1234abcd1234abcd1234abcd1234', 'hex');
      const now = new Date();
      const expiresAt = new Date(Date.now() + 3600_000);

      const pool = scriptedPool([
        {
          when: (s) => s.includes('authz.redeem_auth_token'),
          results: [
            {
              rows: [
                {
                  id: tokenId,
                  user_id: '018f3c2a-1b4d-7c8e-9f01-000000000001',
                  subject_hmac: subjectHmac,
                  pepper_kid: 'test-kid-v1',
                  purpose: 'password_reset',
                  created_at: now,
                  expires_at: expiresAt,
                },
              ],
              rowCount: 1,
            },
          ],
        },
      ]);
      const service = new TokenService(pool.source, TEST_ENV, DUMMY_EMAIL_SERVICE);

      const res = await service.redeem({
        rawToken: 'valid-test-raw-token-that-is-long-enough-001',
        expectedPurpose: 'password_reset',
      });

      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.token.id).toBe(tokenId);
        expect(res.token.userId).toBe('018f3c2a-1b4d-7c8e-9f01-000000000001');
        expect(res.token.purpose).toBe('password_reset');
        expect(res.token.pepperKid).toBe('test-kid-v1');
      }
    });

    it('refuses malformed or truncated token without querying database', async () => {
      const pool = scriptedPool([]);
      const service = new TokenService(pool.source, TEST_ENV, DUMMY_EMAIL_SERVICE);

      const res = await service.redeem({
        rawToken: 'short',
        expectedPurpose: 'password_reset',
      });

      expect(res.status).toBe('invalid_or_expired');
      expect(pool.statements()).toHaveLength(0);
    });

    it('refuses invalid purpose without querying database', async () => {
      const pool = scriptedPool([]);
      const service = new TokenService(pool.source, TEST_ENV, DUMMY_EMAIL_SERVICE);

      const res = await service.redeem({
        rawToken: 'valid-looking-token-of-sufficient-length-0001',
        expectedPurpose: 'non_existent_purpose' as unknown as TokenPurpose,
      });

      expect(res.status).toBe('invalid_or_expired');
      expect(pool.statements()).toHaveLength(0);
    });

    it('returns invalid_or_expired when token is not found or already consumed in database', async () => {
      const pool = scriptedPool([
        {
          when: (s) => s.includes('authz.redeem_auth_token'),
          results: [{ rows: [], rowCount: 0 }],
        },
      ]);
      const service = new TokenService(pool.source, TEST_ENV, DUMMY_EMAIL_SERVICE);

      const res = await service.redeem({
        rawToken: 'valid-looking-token-of-sufficient-length-0001',
        expectedPurpose: 'password_reset',
      });

      expect(res.status).toBe('invalid_or_expired');
    });
  });

  describe('invalidateSubjectTokens and purgeExpiredTokens', () => {
    it('calls authz.invalidate_auth_tokens with subject HMAC', async () => {
      const pool = scriptedPool([
        {
          when: (s) => s.includes('authz.invalidate_auth_tokens'),
          results: [{ rows: [{ count: 3 }], rowCount: 1 }],
        },
      ]);
      const service = new TokenService(pool.source, TEST_ENV, DUMMY_EMAIL_SERVICE);

      const count = await service.invalidateSubjectTokens('test@example.test', 'password_reset');
      expect(count).toBe(3);

      const call = pool.statements().find((s) => s.text.includes('authz.invalidate_auth_tokens'));
      expect(call).toBeDefined();
      expect(Buffer.isBuffer(call?.values[0])).toBe(true);
      expect(call?.values[1]).toBe('password_reset');
    });

    it('calls authz.purge_expired_auth_tokens with cutoff timestamp', async () => {
      const pool = scriptedPool([
        {
          when: (s) => s.includes('authz.purge_expired_auth_tokens'),
          results: [{ rows: [{ count: 5 }], rowCount: 1 }],
        },
      ]);
      const service = new TokenService(pool.source, TEST_ENV, DUMMY_EMAIL_SERVICE);

      const cutoff = new Date('2026-01-01T00:00:00Z');
      const count = await service.purgeExpiredTokens(cutoff);
      expect(count).toBe(5);

      const call = pool.statements().find((s) => s.text.includes('authz.purge_expired_auth_tokens'));
      expect(call).toBeDefined();
      expect(call?.values[0]).toBe(cutoff);
    });
  });
});
