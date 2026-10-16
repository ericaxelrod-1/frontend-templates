import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { TokenService } from '../../../src/token/token.service.js';
import type { TokenEnvironment } from '../../../src/token/token-environment.js';
import type { EmailService } from '../../../src/email/email.service.js';

const TEST_ENV: TokenEnvironment = {
  pepper: 'test-pepper-token-secret-must-be-32-chars-long',
  pepperKid: 'test-kid-v1',
};

describe('Token enumeration resistance', () => {
  it('requesting a token for an address that exists vs one that does not produces identical response structure, status, and no observable leak', async () => {
    const existingEmail = 'alice@example.test';
    const nonExistentEmail = 'ghost@example.test';

    const sendPasswordResetEmail = vi.fn().mockResolvedValue({ messageId: '<test-msg-id>' });
    const mockEmailService = {
      sendPasswordResetEmail,
      sendVerificationEmail: vi.fn(),
      sendErasureReceipt: vi.fn(),
    } as unknown as EmailService;

    const userMap = new Map<string, { id: string; username: string; email: string }>([
      [existingEmail, { id: '018f3c2a-1b4d-7c8e-9f01-000000000001', username: 'alice', email: existingEmail }],
    ]);

    const pool = {
      connect: () =>
        Promise.resolve({
          query: (text: string, values: readonly unknown[] = []) => {
            if (text.includes('SELECT id, username, email FROM public.users')) {
              const email = typeof values[0] === 'string' ? values[0] : '';
              const user = userMap.get(email);
              return Promise.resolve({ rows: user ? [user] : [], rowCount: user ? 1 : 0 });
            }
            if (text.includes('authz.mint_auth_token')) {
              return Promise.resolve({ rows: [{ id: '018f3c2a-1b4d-7c8e-9f01-000000000002' }], rowCount: 1 });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
          },
          release: () => {},
        } as unknown as PoolClient),
    };

    const service = new TokenService(pool, TEST_ENV, mockEmailService);

    // Warm-up / calibration
    await service.deliver({ purpose: 'password_reset', email: existingEmail });
    await service.deliver({ purpose: 'password_reset', email: nonExistentEmail });
    sendPasswordResetEmail.mockClear();

    // Measure existing account
    const startExisting = performance.now();
    const resultExisting = await service.deliver({
      purpose: 'password_reset',
      email: existingEmail,
    });
    const durationExisting = performance.now() - startExisting;

    // Measure non-existent account
    const startNonExistent = performance.now();
    const resultNonExistent = await service.deliver({
      purpose: 'password_reset',
      email: nonExistentEmail,
    });
    const durationNonExistent = performance.now() - startNonExistent;

    // 1. Response body must be strictly identical
    expect(resultExisting).toEqual(resultNonExistent);
    expect(resultExisting).toEqual({ status: 'accepted' });

    // 2. Status code / status property must be strictly identical
    expect(resultExisting.status).toBe('accepted');
    expect(resultNonExistent.status).toBe('accepted');
    expect(resultExisting.status).toBe(resultNonExistent.status);

    // 3. Email delivery verification: only the existing account was sent an email
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      existingEmail,
      'alice',
      expect.any(String),
      '018f3c2a-1b4d-7c8e-9f01-000000000001',
    );

    // 4. Observable timing verification: both finish quickly without macro-discrepancy
    const timeDelta = Math.abs(durationExisting - durationNonExistent);
    expect(timeDelta).toBeLessThan(50); // delta well under 50ms in-process
  });
});
