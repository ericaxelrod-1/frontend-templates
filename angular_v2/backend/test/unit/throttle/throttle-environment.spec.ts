import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THROTTLE_CREDENTIAL_LIMIT,
  DEFAULT_THROTTLE_LIMIT,
  DEFAULT_THROTTLE_LINK_LIMIT,
  DEFAULT_THROTTLE_TTL_SECONDS,
  MAXIMUM_LIMIT,
  MAXIMUM_SECONDS,
  ThrottleEnvironmentError,
  loadThrottleEnvironment,
} from '../../../src/common/throttle-environment.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * The `THROTTLE_*` namespace: the numbers behind the address-keyed limiter, and
 * the two halves of the permission this namespace has.
 *
 * `notification-environment.ts` is the precedent and the two assertions below
 * are its pair, because the permission is narrow rather than general and the
 * two halves fail in opposite directions:
 *
 *   - **an absent key must take the documented default**, because that is the
 *     permission `retention-environment.ts` withholds from its own keys. A rate
 *     limit is an operating point, not a published key: a default nobody chose
 *     applies silently, and a default limit that silently applies is a limit
 *     nobody has to agree with;
 *   - **a MALFORMED key must abort the boot, naming the key, the value and the
 *     range**, because `THROTTLE_LIMIT=0` is a limiter that limits nothing and
 *     `THROTTLE_TTL_SECONDS=1h` is a window that does not exist. A limit that
 *     silently becomes something else is a limit nobody chose, and the file
 *     still looks configured (§2.3).
 */

const KEYS = [
  'THROTTLE_LIMIT',
  'THROTTLE_TTL_SECONDS',
  'THROTTLE_CREDENTIAL_LIMIT',
  'THROTTLE_LINK_LIMIT',
] as const;

/** A complete, valid source — the values the boot cases below start from. */
const VALID: Readonly<Record<string, string>> = {
  THROTTLE_LIMIT: '120',
  THROTTLE_TTL_SECONDS: '60',
  THROTTLE_CREDENTIAL_LIMIT: '20',
  THROTTLE_LINK_LIMIT: '10',
};

function problemsOf(source: Readonly<Record<string, unknown>>): string[] {
  try {
    loadThrottleEnvironment(source);
  } catch (error) {
    if (error instanceof ThrottleEnvironmentError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error('loadThrottleEnvironment did not throw');
}

describe('every THROTTLE_* key takes its documented default when it is absent', () => {
  it('returns the four defaults for an empty source', () => {
    expect(loadThrottleEnvironment({})).toEqual({
      limit: DEFAULT_THROTTLE_LIMIT,
      ttlSeconds: DEFAULT_THROTTLE_TTL_SECONDS,
      credentialLimit: DEFAULT_THROTTLE_CREDENTIAL_LIMIT,
      linkLimit: DEFAULT_THROTTLE_LINK_LIMIT,
    });
  });

  it('treats an EMPTY value as absent rather than as zero', () => {
    // The example files ship these blank, and a blank that meant "zero" would
    // be a configuration that silently switches the limiter off on every fresh
    // checkout.
    expect(loadThrottleEnvironment(Object.fromEntries(KEYS.map((key) => [key, ''])))).toEqual(
      loadThrottleEnvironment({}),
    );
  });

  it('prefers a configured value over the default', () => {
    expect(
      loadThrottleEnvironment({
        THROTTLE_LIMIT: '30',
        THROTTLE_TTL_SECONDS: '15',
        THROTTLE_CREDENTIAL_LIMIT: '5',
        THROTTLE_LINK_LIMIT: '3',
      }),
    ).toEqual({ limit: 30, ttlSeconds: 15, credentialLimit: 5, linkLimit: 3 });
  });

  it('keeps the tightened allowances BELOW the global one, because a limit that is not tighter is not a tightening', () => {
    // The defaults, read as a set: §B6 asks for the routes that create or move
    // credentials to be tightened, and a "tightened" limit that is above the
    // global allowance would be a loosening.
    const environment = loadThrottleEnvironment({});
    expect(environment.credentialLimit).toBeLessThan(environment.limit);
    expect(environment.linkLimit).toBeLessThan(environment.limit);
  });
});

describe('a malformed THROTTLE_* key is refused, not silently absorbed', () => {
  it('names the key and the value received for anything that is not a whole number', () => {
    for (const bad of ['1h', '60s', '-1', '1.5', 'NaN', ' ']) {
      const problems = problemsOf({ THROTTLE_LIMIT: bad }).join('\n');
      expect(problems, `'${bad}' was accepted`).toContain('THROTTLE_LIMIT must be a whole number');
      expect(problems).toContain(`received '${bad}'`);
    }
  });

  it('refuses zero, because zero removes the mechanism rather than tuning it', () => {
    // `THROTTLE_LIMIT=0` does not mean "unlimited"; it means every request is
    // refused the moment the first one is counted, which reads in the log like
    // a broken deployment and in the product like a dead one.
    for (const key of KEYS) {
      const problems = problemsOf({ [key]: '0' }).join('\n');
      expect(problems, `${key}=0 was accepted`).toContain(`${key} must be between 1 and`);
      expect(problems).toContain('the mechanism is');
    }
  });

  it('refuses a value past the range, which is far more likely to be a units mistake', () => {
    const tooLong = String(MAXIMUM_SECONDS + 1);
    expect(problemsOf({ THROTTLE_TTL_SECONDS: tooLong }).join('\n')).toContain(
      `must be between 1 and ${String(MAXIMUM_SECONDS)}`,
    );
    const tooMany = String(MAXIMUM_LIMIT + 1);
    expect(problemsOf({ THROTTLE_LIMIT: tooMany }).join('\n')).toContain(
      `must be between 1 and ${String(MAXIMUM_LIMIT)}`,
    );
  });

  it('accepts the two bounds, so they are bounds and not off-by-ones', () => {
    expect(loadThrottleEnvironment({ THROTTLE_TTL_SECONDS: '1' }).ttlSeconds).toBe(1);
    expect(loadThrottleEnvironment({ THROTTLE_TTL_SECONDS: String(MAXIMUM_SECONDS) }).ttlSeconds).toBe(
      MAXIMUM_SECONDS,
    );
    expect(loadThrottleEnvironment({ THROTTLE_LIMIT: '1' }).limit).toBe(1);
    expect(loadThrottleEnvironment({ THROTTLE_LIMIT: String(MAXIMUM_LIMIT) }).limit).toBe(MAXIMUM_LIMIT);
  });

  it('names every bad key in ONE error rather than the first', () => {
    // The shape `loadEnvironment`, `loadNotificationEnvironment` and
    // `loadErasureEnvironment` all use: a boot that names one of three bad
    // keys sends the operator round the loop twice more.
    const problems = problemsOf(Object.fromEntries(KEYS.map((key) => [key, '1h'])));
    expect(problems).toHaveLength(KEYS.length);
    for (const key of KEYS) {
      expect(problems.join('\n')).toContain(key);
    }
  });

  it('refuses a value that is not a string or a number, rather than coercing it', () => {
    expect(problemsOf({ THROTTLE_LIMIT: { limit: 60 } }).join('\n')).toContain(
      'THROTTLE_LIMIT must be an integer, received object',
    );
  });
});

describe('the namespace is discoverable, and read at module scope', () => {
  it('names every key in the example files an operator configures from', () => {
    // A key nobody can find is a key nobody sets. These keys have defaults, so
    // a missing one is not a boot failure — it is a silent departure from what
    // the deployment intended, which is the harder failure to notice.
    for (const file of ['.env.example', '.env.development.example', '.env.production.example', '.env.test.example']) {
      const source = readFileSync(join(BACKEND_ROOT, file), 'utf8');
      for (const key of KEYS) {
        expect(source, `${file} does not mention ${key}`).toContain(key);
        // Assigned, and BLANK: the default applies until an operator chooses a
        // number, which is the whole point of a namespace whose keys may
        // default.
        expect(source, `${file} does not assign ${key}`).toMatch(new RegExp(`^${key}=$`, 'm'));
      }
      expect(source, `${file} does not say these keys HAVE a default`).toMatch(/HAS a default|have a default/i);
      expect(source, `${file} does not say a malformed one is refused`).toMatch(/MALFORMED|malformed/);
    }
  });

  it('is read at module scope and bound as the validated value, never re-read from process.env', () => {
    // The moment AND the binding. A loader called inside a provider factory
    // would let the application start against a namespace nobody asserted —
    // and a `@Throttle(...)` decorator, which is evaluated when the controller
    // module is imported, could not read a DI value at all.
    const source = readFileSync(join(BACKEND_ROOT, 'src', 'common', 'throttle.ts'), 'utf8');
    expect(source).toMatch(/^export const THROTTLE_ENVIRONMENT = loadThrottleEnvironment\(process\.env\);$/m);
    expect(source).not.toMatch(/useFactory[\s\S]{0,400}process\.env/);

    // The loader itself takes a source, which is what keeps a second implicit
    // reader from appearing beside it (§2.3).
    expect(
      readFileSync(join(BACKEND_ROOT, 'src', 'common', 'throttle-environment.ts'), 'utf8'),
    ).not.toContain('process.env');
  });
});

const PRISTINE_VALUES = KEYS.map((key) => [key, process.env[key]] as const);

/**
 * Booting `AppModule` compiles and initialises the whole graph, which on a
 * cold module registry is seconds — past vitest's 5s default, and the positive
 * control below is the case that pays it. `test/unit/breaker/breaker-wiring.spec.ts`
 * states the same cost and the same number, and for the same reason: the suite
 * runs beside `email-assets.spec.ts`, which spawns a real `nest build`, so the
 * machine this boots on is not an idle one.
 */
const BOOT_TIMEOUT = 60_000;

afterEach(() => {
  for (const [key, value] of PRISTINE_VALUES) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('the BOOT refuses a malformed limit, which is the control the key is for', () => {
  /**
   * Imports the application module for real, with `process.env` doctored, and
   * returns whatever it threw — or `undefined` if it evaluated cleanly.
   *
   * **The module is imported rather than the loader called**, because the claim
   * under test is about the MOMENT: the numbers are read as the module
   * evaluation runs, so a misconfigured process dies before Nest is even
   * constructed and long before a route exists. Testing the loader alone would
   * pass against a wiring that called it inside a provider factory, which is
   * precisely the regression this guards.
   *
   * **Matched by name and message, never by `instanceof`**: the loader runs
   * inside a fresh module registry, so the class it throws is a different
   * object from the one this file imported statically.
   */
  async function bootWith(overrides: Readonly<Record<string, string>>): Promise<Error | undefined> {
    vi.resetModules();
    // `.env.test` supplies every OTHER required key, so the only thing this
    // doctored source is missing is the one under test and the refusal cannot
    // be a different module's error wearing the right shape.
    await import('../../../src/config/load-env-file.js');
    for (const [key, value] of Object.entries({ ...VALID, ...overrides })) {
      process.env[key] = value;
    }

    try {
      await import('../../../src/app.module.js');
      return undefined;
    } catch (error) {
      if (error instanceof Error) {
        return error;
      }
      throw error;
    }
  }

  it('aborts when a limit is not a number, naming the key and the value', async () => {
    const thrown = await bootWith({ THROTTLE_LIMIT: '1h' });

    expect(thrown?.name, 'the boot did not abort').toBe('ThrottleEnvironmentError');
    expect(thrown?.message).toContain('THROTTLE_LIMIT must be a whole number');
    expect(thrown?.message).toContain("received '1h'");
  }, BOOT_TIMEOUT);

  it('aborts when a limit is zero, because a limiter that limits nothing is not a limiter', async () => {
    const thrown = await bootWith({ THROTTLE_CREDENTIAL_LIMIT: '0' });

    expect(thrown?.name, 'the boot did not abort').toBe('ThrottleEnvironmentError');
    expect(thrown?.message).toContain('THROTTLE_CREDENTIAL_LIMIT must be between 1 and');
  }, BOOT_TIMEOUT);

  it('aborts when the window is not a number of seconds', async () => {
    const thrown = await bootWith({ THROTTLE_TTL_SECONDS: '60s' });

    expect(thrown?.name, 'the boot did not abort').toBe('ThrottleEnvironmentError');
    expect(thrown?.message).toContain('THROTTLE_TTL_SECONDS must be a whole number');
  }, BOOT_TIMEOUT);

  it('the same source complete boots, so the refusals above are the RULES and not a broken import', async () => {
    // The positive control, and it is load-bearing: without it, an
    // `app.module.ts` that failed to import for any reason at all — a renamed
    // file, a broken dependency — would make all three refusals above green.
    const thrown = await bootWith({});
    expect(thrown, `a complete source was refused:\n${thrown?.message ?? ''}`).toBeUndefined();
  }, BOOT_TIMEOUT);
});
