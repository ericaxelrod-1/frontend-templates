import {
  SentinelConfigService,
  SENTINEL_GUARD_ENV_VAR,
} from './sentinel.config';

const SENTINEL_ENV_VARS = [
  'SENTINEL_WARNING_PERCENT',
  'SENTINEL_CRITICAL_PERCENT',
  'SENTINEL_PANIC_PERCENT',
  SENTINEL_GUARD_ENV_VAR,
];

describe('SentinelConfigService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const name of SENTINEL_ENV_VARS) {
      delete process.env[name];
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('thresholds', () => {
    it('falls back to the documented 90/95/98 defaults when nothing is configured', () => {
      const config = new SentinelConfigService();

      expect(config.thresholds).toEqual({
        warningPercent: 90,
        criticalPercent: 95,
        panicPercent: 98,
      });
    });

    it('reads each tier from the environment instead of a hardcoded literal', () => {
      process.env.SENTINEL_WARNING_PERCENT = '70';
      process.env.SENTINEL_CRITICAL_PERCENT = '80';
      process.env.SENTINEL_PANIC_PERCENT = '99';

      const config = new SentinelConfigService();

      expect(config.thresholds).toEqual({
        warningPercent: 70,
        criticalPercent: 80,
        panicPercent: 99,
      });
    });

    it('refuses to boot on a non-numeric threshold rather than defaulting past it', () => {
      process.env.SENTINEL_CRITICAL_PERCENT = 'nearly-full';

      expect(() => new SentinelConfigService()).toThrow(
        /SENTINEL_CRITICAL_PERCENT must be a finite number/,
      );
    });

    it('refuses to boot on a threshold outside (0, 100]', () => {
      process.env.SENTINEL_PANIC_PERCENT = '120';

      expect(() => new SentinelConfigService()).toThrow(
        /SENTINEL_PANIC_PERCENT must be a percentage within \(0, 100\]/,
      );
    });

    it('refuses to boot when the tiers are not strictly increasing', () => {
      process.env.SENTINEL_WARNING_PERCENT = '96';
      process.env.SENTINEL_CRITICAL_PERCENT = '95';
      process.env.SENTINEL_PANIC_PERCENT = '98';

      expect(() => new SentinelConfigService()).toThrow(
        /Sentinel thresholds must be strictly increasing/,
      );
    });
  });

  describe(`${SENTINEL_GUARD_ENV_VAR}`, () => {
    it('defaults to armed', () => {
      expect(new SentinelConfigService().guardDisabled).toBe(false);
    });

    it.each(['true', 'TRUE', '1', 'yes', 'on'])(
      'disarms the guard for %p',
      (value) => {
        process.env[SENTINEL_GUARD_ENV_VAR] = value;
        expect(new SentinelConfigService().guardDisabled).toBe(true);
      },
    );

    it.each(['false', 'FALSE', '0', 'no', 'off'])(
      'keeps the guard armed for %p',
      (value) => {
        process.env[SENTINEL_GUARD_ENV_VAR] = value;
        expect(new SentinelConfigService().guardDisabled).toBe(false);
      },
    );

    it('treats an empty value as unset rather than as "on"', () => {
      process.env[SENTINEL_GUARD_ENV_VAR] = '   ';
      expect(new SentinelConfigService().guardDisabled).toBe(false);
    });

    it('refuses to boot on a misspelled value instead of guessing', () => {
      process.env[SENTINEL_GUARD_ENV_VAR] = 'ture';

      expect(() => new SentinelConfigService()).toThrow(
        new RegExp(`${SENTINEL_GUARD_ENV_VAR} must be one of`),
      );
    });
  });

  describe('onModuleInit', () => {
    it('warns, naming the flag, when the guard is disarmed', () => {
      process.env[SENTINEL_GUARD_ENV_VAR] = 'true';
      const config = new SentinelConfigService();
      const warn = jest.spyOn(config['logger'], 'warn').mockImplementation();

      config.onModuleInit();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(SENTINEL_GUARD_ENV_VAR);
      expect(warn.mock.calls[0][0]).toContain('DISABLED');
      warn.mockRestore();
    });

    it('logs the armed tiers when the guard is in place', () => {
      const config = new SentinelConfigService();
      const log = jest.spyOn(config['logger'], 'log').mockImplementation();

      config.onModuleInit();

      expect(log.mock.calls[0][0]).toContain('Sentinel armed');
      expect(log.mock.calls[0][0]).toContain('95%');
      expect(log.mock.calls[0][0]).toContain('98%');
      log.mockRestore();
    });
  });
});
