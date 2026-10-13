import {
  ExecutionContext,
  CallHandler,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, firstValueFrom } from 'rxjs';
import { SystemResourceInterceptor } from './system-resource.interceptor';
import {
  SystemHealthService,
  HealthStatus,
} from '../services/system-health.service';
import {
  SentinelConfigService,
  SENTINEL_GUARD_ENV_VAR,
} from '../config/sentinel.config';

/**
 * Stands in for the measurement side only. Enforcement is what is under test,
 * so the tier is set directly rather than by filling a real filesystem.
 */
class StubbedHealthService {
  constructor(private readonly status: HealthStatus) {}

  isPanic(): boolean {
    return this.status === HealthStatus.PANIC;
  }

  isResourceCritical(): boolean {
    return this.status === HealthStatus.CRITICAL;
  }
}

const HANDLED = 'handler-ran';
const nextHandler: CallHandler = { handle: () => of(HANDLED) };

function contextFor(
  method: string,
  url: string,
  isHeavyRoute: boolean,
): ExecutionContext {
  const handler = (): void => undefined;
  Reflect.defineMetadata('isHeavyRoute', isHeavyRoute, handler);

  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({ method, url }),
    }),
  } as unknown as ExecutionContext;
}

describe('SystemResourceInterceptor', () => {
  const reflector = new Reflector();

  function build(status: HealthStatus, env: Record<string, string> = {}) {
    const previous = { ...process.env };
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
    }
    const interceptor = new SystemResourceInterceptor(
      reflector,
      new StubbedHealthService(status) as unknown as SystemHealthService,
      new SentinelConfigService(),
    );
    process.env = previous;

    // Silences the bypass warning so a test can assert on its absence.
    jest.spyOn(interceptor['logger'], 'warn').mockImplementation();
    return interceptor;
  }

  /** Asserts the request reached the handler. */
  async function expectAllowed(
    interceptor: SystemResourceInterceptor,
    context: ExecutionContext,
  ): Promise<void> {
    await expect(
      firstValueFrom(interceptor.intercept(context, nextHandler)),
    ).resolves.toBe(HANDLED);
  }

  /** Asserts the request was refused before the handler ran. */
  function expectRefused(
    interceptor: SystemResourceInterceptor,
    context: ExecutionContext,
  ): void {
    expect(() => interceptor.intercept(context, nextHandler)).toThrow(
      ServiceUnavailableException,
    );
  }

  describe('the documented ladder', () => {
    it('lets a heavy route through while the disk is healthy', async () => {
      await expectAllowed(
        build(HealthStatus.NORMAL),
        contextFor('POST', '/privacy/export', true),
      );
    });

    it('refuses a heavy route at CRITICAL (>= 95%)', () => {
      expectRefused(
        build(HealthStatus.CRITICAL),
        contextFor('POST', '/privacy/export', true),
      );
    });

    it('refuses a heavy route at PANIC (>= 98%) too', () => {
      expectRefused(
        build(HealthStatus.PANIC),
        contextFor('POST', '/privacy/export', true),
      );
    });

    it('does not refuse an ordinary route merely for being a POST', async () => {
      await expectAllowed(
        build(HealthStatus.CRITICAL),
        contextFor('POST', '/privacy/restrictions', false),
      );
    });

    it('refuses EVERY write at PANIC, not just @HeavyRoute() handlers', () => {
      const interceptor = build(HealthStatus.PANIC);

      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expectRefused(
          interceptor,
          contextFor(method, '/privacy/restrictions', false),
        );
      }
    });

    it('still serves reads at PANIC', async () => {
      await expectAllowed(
        build(HealthStatus.PANIC),
        contextFor('GET', '/privacy/preferences', false),
      );
    });

    it('refuses a heavy route at PANIC even when the method is a read', () => {
      expectRefused(
        build(HealthStatus.PANIC),
        contextFor('GET', '/privacy/export', true),
      );
    });

    it('names the tier and the threshold in the refusal', () => {
      try {
        build(HealthStatus.PANIC).intercept(
          contextFor('POST', '/privacy/restrictions', false),
          nextHandler,
        );
        fail('expected a ServiceUnavailableException');
      } catch (error) {
        const message = (error as ServiceUnavailableException).message;
        expect(message).toContain('PANIC');
        expect(message).toContain('98%');
      }
    });

    it('uses the configured thresholds in the refusal message, not literals', () => {
      try {
        build(HealthStatus.PANIC, { SENTINEL_PANIC_PERCENT: '97' }).intercept(
          contextFor('POST', '/privacy/restrictions', false),
          nextHandler,
        );
        fail('expected a ServiceUnavailableException');
      } catch (error) {
        expect((error as ServiceUnavailableException).message).toContain('97%');
      }
    });
  });

  describe(`FR-015: ${SENTINEL_GUARD_ENV_VAR}`, () => {
    it('is armed by default — the override is not implicit', () => {
      expectRefused(
        build(HealthStatus.CRITICAL),
        contextFor('POST', '/privacy/export', true),
      );
    });

    it('lets a heavy route through at CRITICAL when set', async () => {
      await expectAllowed(
        build(HealthStatus.CRITICAL, { [SENTINEL_GUARD_ENV_VAR]: 'true' }),
        contextFor('POST', '/privacy/export', true),
      );
    });

    it('lets writes through at PANIC when set', async () => {
      await expectAllowed(
        build(HealthStatus.PANIC, { [SENTINEL_GUARD_ENV_VAR]: 'true' }),
        contextFor('DELETE', '/privacy/account', false),
      );
    });

    it('logs a warning naming the flag for every bypassed request', () => {
      const interceptor = build(HealthStatus.PANIC, {
        [SENTINEL_GUARD_ENV_VAR]: 'true',
      });
      interceptor.intercept(
        contextFor('POST', '/privacy/export', true),
        nextHandler,
      );

      const warn = interceptor['logger'].warn as jest.Mock;
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0][0] as string;
      expect(message).toContain(SENTINEL_GUARD_ENV_VAR);
      expect(message).toContain('PANIC');
      expect(message).toContain('POST /privacy/export');
    });

    it('stays silent when it is not actually blocking anything', () => {
      const interceptor = build(HealthStatus.CRITICAL, {
        [SENTINEL_GUARD_ENV_VAR]: 'true',
      });
      interceptor.intercept(
        contextFor('GET', '/privacy/preferences', false),
        nextHandler,
      );

      expect(interceptor['logger'].warn as jest.Mock).not.toHaveBeenCalled();
    });

    it('does NOT stop the service measuring: a full disk still reports PANIC', async () => {
      const previous = { ...process.env };
      process.env[SENTINEL_GUARD_ENV_VAR] = 'true';
      const service = new SystemHealthService(new SentinelConfigService());

      jest.spyOn(require('fs/promises'), 'statfs').mockResolvedValue({
        bsize: 1024 * 1024 * 1024,
        blocks: 1000,
        bfree: 5,
        bavail: 5,
      } as never);
      await service.checkDiskSpace();
      jest.restoreAllMocks();
      process.env = previous;

      expect(service.getHealthStatus()).toBe(HealthStatus.PANIC);
      expect(service.isPanic()).toBe(true);
      expect(service.getSnapshot().guardDisabled).toBe(true);
    });

    it('refuses to boot on a misconfigured value rather than guessing', () => {
      expect(() =>
        build(HealthStatus.CRITICAL, { [SENTINEL_GUARD_ENV_VAR]: 'ture' }),
      ).toThrow(new RegExp(SENTINEL_GUARD_ENV_VAR));
    });
  });
});
