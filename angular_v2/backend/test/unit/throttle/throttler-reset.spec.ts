import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The counters EXPIRE.
 *
 * A limiter that never forgets is a limiter that wedges an account: the
 * failure this whole unit exists to avoid is a person locked out of their own
 * account by a counter that a single burst filled and nothing ever drained.
 * The per-account gate has the same property and states it — "the block lifts
 * when the failures age out of the window, so it cannot lock an account
 * forever" (`src/auth/throttle.ts`) — and the address-keyed limiter has to
 * have it too, or the two together are a permanent lock.
 *
 * **The window is one second here**, which is the only way to prove the
 * property in a test that finishes: the configured window is read at import
 * time, so the suite sets it before the application module is imported, and
 * the same suite waits for it to pass. A test that waited the production
 * window would be a test that takes a minute to say something that can be
 * said in one.
 *
 * The suite is otherwise the same shape as `throttler.spec.ts`: the real
 * application, the real guard, the real configuration, and a database that
 * does not exist so no request reaches a handler that could touch a row.
 */

const THROTTLE_ENV = {
  THROTTLE_LIMIT: '2',
  THROTTLE_TTL_SECONDS: '1',
  THROTTLE_CREDENTIAL_LIMIT: '2',
  THROTTLE_LINK_LIMIT: '2',
} as const;

const LIMIT = 2;

/** The window, in milliseconds, plus the slack a loaded machine needs. */
const WINDOW_MS = 1000;
const WAIT_AFTER_WINDOW_MS = 1500;

const BOOT_TIMEOUT = 60_000;

let app: NestFastifyApplication;
let moduleRef: TestingModule;

/**
 * The environment this suite changed, and what it was before.
 *
 * **Restored in `afterAll`**, because a suite that leaves `DB_NAME` pointing at
 * a database that does not exist has left a trap for the next one. The pristine
 * values are captured before anything is changed, and an absent value is
 * DELETED rather than set to an empty string.
 */
const PRISTINE = ['DB_NAME', ...Object.keys(THROTTLE_ENV)].map(
  (key) => [key, process.env[key]] as const,
);

beforeAll(async () => {
  for (const [key, value] of Object.entries(THROTTLE_ENV)) {
    process.env[key] = value;
  }
  process.env['DB_NAME'] = 'throttle_reset_spec_absent';

  const { AppModule } = await import('../../../src/app.module.js');
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useLogger(false);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, BOOT_TIMEOUT);

afterAll(async () => {
  try {
    await app?.close();
    await moduleRef?.close();
  } catch {
    // A teardown failure is not the assertion this suite makes.
  } finally {
    for (const [key, value] of PRISTINE) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

describe('the counter expires with its window', () => {
  it('refuses over the limit, then admits again once the window has passed', async () => {
    const address = '192.0.2.80';
    const statuses: number[] = [];
    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      statuses.push((await app.inject({ method: 'GET', url: '/users/me', remoteAddress: address })).statusCode);
    }
    expect(statuses).toEqual([401, 401]);

    const refused = await app.inject({ method: 'GET', url: '/users/me', remoteAddress: address });
    expect(refused.statusCode).toBe(429);

    // The window passes. The counter is empty again, and the route serves.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, WAIT_AFTER_WINDOW_MS);
    });

    const admitted = await app.inject({ method: 'GET', url: '/users/me', remoteAddress: address });
    expect(admitted.statusCode).toBe(401);
    expect(admitted.statusCode).not.toBe(429);
    // The counter starts from zero again rather than from where it stopped:
    // the allowance is whole, not the remainder of the previous window.
    for (let attempt = 0; attempt < LIMIT - 1; attempt += 1) {
      const next = await app.inject({ method: 'GET', url: '/users/me', remoteAddress: address });
      expect(next.statusCode).toBe(401);
    }
  }, WINDOW_MS + 30_000);
});
