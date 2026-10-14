import { describe, expect, it } from 'vitest';
import {
  BreakerEnvironmentError,
  GATE_INTERVAL_OFFSET_MS,
  breakerRuntimeOf,
  loadBreakerEnvironment,
} from '../../../src/breaker/breaker-environment.js';

/**
 * The `BREAKER_*` namespace, asserted at boot — rebase.md §9B.1.
 *
 * The test this file exists for is `90/60/60`. It is not a syntax error. It
 * boots, it yields a breaker whose red zone is never above its yellow zone, and
 * the result is a trip condition reached at the same value as the healthy zone: a
 * breaker that never trips, on a machine reporting itself healthy, with no warning
 * anywhere. That is §2.3's failure mode wearing a passing boot.
 */

function validSource(overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    BREAKER_MEMORY_GREEN: '60',
    BREAKER_MEMORY_YELLOW: '80',
    BREAKER_MEMORY_RED: '90',
    BREAKER_POLL_SECONDS: '30',
    BREAKER_COOLDOWN_SECONDS: '120',
    BREAKER_PROBE_TIMEOUT_SECONDS: '60',
    BREAKER_PROTECTED: 'auth.login,auth.refresh,auth.logout,auth.me,breaker.meter,breaker.gate',
    ...overrides,
  };
}

function problemsOf(source: Readonly<Record<string, string>>): string[] {
  try {
    loadBreakerEnvironment(source);
  } catch (error) {
    if (error instanceof BreakerEnvironmentError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error('loadBreakerEnvironment did not throw');
}

describe('the BREAKER_* namespace', () => {
  it('accepts the shipped ordering and returns the parsed values', () => {
    const env = loadBreakerEnvironment(validSource());

    expect(env.thresholds).toEqual({ green: 60, yellow: 80, red: 90 });
    expect(env.pollSeconds).toBe(30);
    expect(env.cooldownSeconds).toBe(120);
    expect(env.probeTimeoutSeconds).toBe(60);
    expect(env.protectedTokens).toEqual([
      'auth.login',
      'auth.refresh',
      'auth.logout',
      'auth.me',
      'breaker.meter',
      'breaker.gate',
    ]);
    // The sweeper's own keys carry documented defaults: they are scheduling facts,
    // not decisions, and none of them decides whether the process stops working.
    expect(env.purgePollSeconds).toBe(60);
    expect(env.purgeDrainBudget).toBe(100);
    expect(env.purgeMaxAttempts).toBe(3);
  });

  it('refuses GREEN=90 YELLOW=60 RED=60, naming all three', () => {
    const problems = problemsOf(
      validSource({ BREAKER_MEMORY_GREEN: '90', BREAKER_MEMORY_YELLOW: '60', BREAKER_MEMORY_RED: '60' }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('BREAKER_MEMORY_GREEN < BREAKER_MEMORY_YELLOW < BREAKER_MEMORY_RED');
    expect(problems[0]).toContain('90/60/60');
  });

  it('refuses any pair of thresholds that is not strictly increasing', () => {
    for (const source of [
      { BREAKER_MEMORY_GREEN: '80', BREAKER_MEMORY_YELLOW: '80', BREAKER_MEMORY_RED: '90' },
      { BREAKER_MEMORY_GREEN: '60', BREAKER_MEMORY_YELLOW: '90', BREAKER_MEMORY_RED: '90' },
      { BREAKER_MEMORY_GREEN: '95', BREAKER_MEMORY_YELLOW: '80', BREAKER_MEMORY_RED: '90' },
    ]) {
      expect(problemsOf(validSource(source))).not.toEqual([]);
    }
  });

  it('refuses a threshold outside 1..100, so a percentage can never be unreachable or meaningless', () => {
    expect(problemsOf(validSource({ BREAKER_MEMORY_RED: '101' }))[0]).toContain('between 1 and 100');
    expect(problemsOf(validSource({ BREAKER_MEMORY_GREEN: '0' }))[0]).toContain('greater than zero');
    expect(problemsOf(validSource({ BREAKER_MEMORY_YELLOW: '200' }))[0]).toContain('between 1 and 100');
  });

  it('refuses an absent key rather than defaulting it, because a default nobody chose silently applies', () => {
    const source = validSource();
    delete source['BREAKER_MEMORY_RED'];
    expect(problemsOf(source)).toEqual(['BREAKER_MEMORY_RED is required but was not set']);
  });

  it('refuses an unknown BREAKER_PROTECTED token, because a typo leaves that site sheddable and invisibly so', () => {
    const problems = problemsOf(validSource({ BREAKER_PROTECTED: 'auth.login,auth.logon' }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'auth.logon'");
    expect(problems[0]).toContain('names no dispatch site in this build');
  });

  it('refuses a token that is not service.method at all', () => {
    expect(problemsOf(validSource({ BREAKER_PROTECTED: 'AuthController.login' }))[0]).toContain(
      'is not a service.method token',
    );
    expect(problemsOf(validSource({ BREAKER_PROTECTED: 'authlogin' }))[0]).toContain(
      'is not a service.method token',
    );
  });

  it('refuses an empty or duplicated protected list', () => {
    expect(problemsOf(validSource({ BREAKER_PROTECTED: ' , ' }))).toContain(
      'BREAKER_PROTECTED must name at least one dispatch site',
    );
    expect(problemsOf(validSource({ BREAKER_PROTECTED: 'auth.login,auth.login' }))[0]).toContain(
      "names 'auth.login' more than once",
    );
  });

  it('names every problem at once, so a misconfigured checkout is fixed in one pass', () => {
    const problems = problemsOf({
      BREAKER_MEMORY_GREEN: '90',
      BREAKER_MEMORY_YELLOW: '60',
      BREAKER_MEMORY_RED: 'ninety',
      BREAKER_PROTECTED: 'auth.nope',
    });

    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems.join('\n')).toContain('BREAKER_MEMORY_RED');
    expect(problems.join('\n')).toContain('auth.nope');
  });

  it('gives the gate a schedule of its own, phase-shifted from the meter\'s', () => {
    // A separate schedule is load-bearing twice over. The jobs must not be able to
    // stop each other, and a gate that ticks in the meter's phase reads a reading
    // that is up to a full poll interval old on every single tick.
    const env = loadBreakerEnvironment(validSource({ BREAKER_POLL_SECONDS: '30' }));
    const meterPeriodMs = env.pollSeconds * 1000;
    const gatePeriodMs = meterPeriodMs + GATE_INTERVAL_OFFSET_MS;

    expect(gatePeriodMs).not.toBe(meterPeriodMs);
    // The phase shift is not a whole meter period, so the two do not stay aligned.
    expect(GATE_INTERVAL_OFFSET_MS % meterPeriodMs).not.toBe(0);
    expect(GATE_INTERVAL_OFFSET_MS).toBeGreaterThan(0);
  });

  it('hands the state machine exactly the configuration it needs, read once', () => {
    const runtime = breakerRuntimeOf(loadBreakerEnvironment(validSource()));

    expect(runtime.thresholds).toEqual({ green: 60, yellow: 80, red: 90 });
    expect(runtime.pollSeconds).toBe(30);
    expect(runtime.cooldownSeconds).toBe(120);
    expect(runtime.probeTimeoutSeconds).toBe(60);
    expect(runtime.protectedTokens).toContain('breaker.meter');
  });
});