import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

/**
 * The wiring, proved without a database and without a running server.
 *
 * This is the test that catches a provider nobody injected, an `APP_INTERCEPTOR`
 * that resolves to nothing, and a module that never gets imported — all of which
 * leave a tree that typechecks, lints, and unit-tests green while the breaker is
 * not actually in the request path.
 *
 * **It touches no database.** `pg.Pool` connects lazily, so building the graph
 * opens no socket. `init()` IS required — Nest applies an `APP_*` provider during
 * the module scan, not at compile time — so both jobs do register their intervals
 * here; they are `unref()`ed and cleared by the `close()` below, and the first
 * meter tick is a minute away. The integration suite owns the database.
 *
 * The assertion reads `ApplicationConfig.getGlobalInterceptors()`, which is the
 * list Nest itself built and the one the request pipeline actually walks. It is
 * not the provider map: a provider Nest never applied is exactly the failure this
 * file exists to catch, and the container would still show it.
 *
 * The `BREAKER_*` keys are set here, in the process, before the import — and they
 * win, because `process.loadEnvFile` does not overwrite a variable that is already
 * set, which is the same precedence `npm start` gets from `--env-file`.
 */

const BREAKER_ENV: Record<string, string> = {
  BREAKER_MEMORY_GREEN: '60',
  BREAKER_MEMORY_YELLOW: '80',
  BREAKER_MEMORY_RED: '90',
  BREAKER_POLL_SECONDS: '30',
  BREAKER_COOLDOWN_SECONDS: '120',
  BREAKER_PROBE_TIMEOUT_SECONDS: '60',
  BREAKER_PROTECTED: 'auth.login,auth.refresh,auth.logout,auth.me,breaker.meter,breaker.gate',
};

describe('the application wires the breaker into the request path', () => {
  it('resolves the whole graph, with the gate applied as a global interceptor', async () => {
    for (const [key, value] of Object.entries(BREAKER_ENV)) {
      process.env[key] = value;
    }

    const { AppModule } = await import('../../../src/app.module.js');
    const { ApplicationConfig } = await import('@nestjs/core');
    const { BreakerGateInterceptor } = await import('../../../src/breaker/breaker.interceptor.js');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      await moduleRef.init();

      const applicationConfig = moduleRef.get(ApplicationConfig, { strict: false });
      const interceptors = applicationConfig.getGlobalInterceptors();
      expect(interceptors).toHaveLength(1);
      expect(interceptors[0]).toBeInstanceOf(BreakerGateInterceptor);

      // The other half of the ordering argument: the guard is global too, and it
      // runs FIRST (middleware → guards → interceptors → pipes → handler), so an
      // unauthenticated prober gets a 401 and never a capacity verdict.
      const { JwtAuthGuard } = await import('../../../src/auth/jwt-auth.guard.js');
      // Instances, not classes — Nest applies the resolved objects.
      expect(applicationConfig.getGlobalGuards().some((guard) => guard instanceof JwtAuthGuard)).toBe(true);
    } finally {
      await moduleRef.close();
    }
  });

  it('reads and validates the BREAKER_* keys before any Nest call, so a bad threshold fails the boot', async () => {
    // A separate import graph from the test above, because `breaker.module.ts`
    // evaluates its configuration once at module-evaluation time — which is the
    // whole point: `@Cron` binds during OnModuleInit, and a meter that took its
    // first reading before the configuration was asserted would be acting on
    // thresholds nobody chose.
    const { BreakerEnvironmentError, loadBreakerEnvironment } = await import(
      '../../../src/breaker/breaker-environment.js'
    );

    expect(() =>
      loadBreakerEnvironment({ ...BREAKER_ENV, BREAKER_MEMORY_GREEN: '90', BREAKER_MEMORY_YELLOW: '60', BREAKER_MEMORY_RED: '60' }),
    ).toThrow(BreakerEnvironmentError);
  });
});