import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAXIMUM_INACTIVE_ACCOUNT_DAYS,
  MAXIMUM_TOMBSTONE_DAYS,
  MINIMUM_INACTIVE_ACCOUNT_DAYS,
  MINIMUM_TOMBSTONE_DAYS,
  RetentionEnvironmentError,
  loadRetentionEnvironment,
} from '../../../src/purge/retention-environment.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * The retention windows are DECISIONS and are validated as one — and since `0017`
 * there are **two**, with **floors**, which is the whole of what this file is for.
 *
 * The three halves of this file are the three ways the decision goes wrong, and
 * they fail in different directions:
 *
 *   * **a missing or malformed key** must abort the boot, because a default nobody
 *     chose silently applies and the harm is not disk — it is that the retention
 *     policy this template PUBLISHES is one it does not ENFORCE, which is what an
 *     auditor reads (GDPR Art. 5(1)(e), CPRA §1798.100(a)(3));
 *   * **a window below the floor** must be refused, because the floor IS the
 *     policy. Until `0017` the tombstone key was bounded `1..36500`, so
 *     `RETENTION_TOMBSTONE_DAYS=1` was valid configuration and hard-destroyed
 *     every tombstone in the repository on the next sweep. A lower bound of 1 is a
 *     bound on syntax, not on harm; and
 *   * **a window past the ceiling** must be refused, because a hundred-thousand-day
 *     window is far more likely to be a units mistake (milliseconds, seconds) than
 *     a decision.
 *
 * Each bound is asserted here AND inside its `authz.retention_due_*()` function.
 * Two copies of one number is deliberate rather than duplicated (§2.4): the loader
 * refuses a misconfiguration at boot, and the function refuses a malformed call
 * from any other caller, which is a different caller with a different reason to
 * lie. Boot validation is ONE PROCESS; `EXECUTE` is not.
 */

/** The environment files, read rather than listed, so a new mode is covered. */
function environmentFiles(): readonly string[] {
  return readdirSync(BACKEND_ROOT)
    .filter((name) => name === '.env' || name.startsWith('.env.'))
    .sort();
}

function problemsOf(source: Readonly<Record<string, unknown>>): string[] {
  try {
    loadRetentionEnvironment(source);
  } catch (error) {
    if (error instanceof RetentionEnvironmentError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error('loadRetentionEnvironment did not throw');
}

/** A complete source with both windows at their floors, so one key can be varied. */
function withTombstoneDays(value: string): Record<string, string> {
  return {
    RETENTION_TOMBSTONE_DAYS: value,
    RETENTION_INACTIVE_ACCOUNT_DAYS: String(MINIMUM_INACTIVE_ACCOUNT_DAYS),
  };
}

function withInactiveAccountDays(value: string): Record<string, string> {
  return {
    RETENTION_TOMBSTONE_DAYS: String(MINIMUM_TOMBSTONE_DAYS),
    RETENTION_INACTIVE_ACCOUNT_DAYS: value,
  };
}

describe('both retention windows are required in every mode', () => {
  it('are present, uncommented, assigned, and at or above their floors in every .env* file', () => {
    // Every mode, because "required in every mode with no default" is the property
    // and a key present in four files and absent from the fifth is a key that is
    // absent from production. `environment.ts` refuses a missing key rather than
    // defaulting it, so a mode whose file lacks it simply cannot boot.
    //
    // The FLOOR is checked here too, and that half is new. `.env*` used to ship
    // `RETENTION_TOMBSTONE_DAYS=30`, which was legal configuration under the old
    // `1..36500` bound and would now be refused at boot — so a template that ships
    // a value its own validator rejects is a template nobody can start, and the
    // check that catches it has to read the value rather than the key's presence.
    const files = environmentFiles();
    expect(files.length, 'the .env* files were not found; this assertion would be vacuous').toBeGreaterThanOrEqual(6);

    const floors: ReadonlyArray<readonly [string, number]> = [
      ['RETENTION_TOMBSTONE_DAYS', MINIMUM_TOMBSTONE_DAYS],
      ['RETENTION_INACTIVE_ACCOUNT_DAYS', MINIMUM_INACTIVE_ACCOUNT_DAYS],
    ];

    for (const file of files) {
      const source = readFileSync(join(BACKEND_ROOT, file), 'utf8');

      for (const [key, floor] of floors) {
        const assigned = source
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith(`${key}=`));

        expect(assigned, `${file} does not assign ${key}`).toHaveLength(1);
        expect(assigned[0], `${file} assigns a commented-out ${key}`).not.toMatch(/^#/);

        const value = Number((assigned[0] ?? '').split('=')[1]);
        expect(Number.isInteger(value) && value > 0, `${file} sets a nonsensical ${key}`).toBe(true);
        expect(
          value >= floor,
          `${file} ships ${key}=${String(value)}, below its ${String(floor)}-day floor — the boot would refuse it`,
        ).toBe(true);
      }
    }
  });

  it('names both keys, and says why there is no default, in the file a reader configures', () => {
    // A key nobody can find is a key nobody sets, and the boot error that follows
    // reads as a broken checkout rather than as a missing decision.
    for (const file of ['.env.example', '.env.production.example']) {
      const source = readFileSync(join(BACKEND_ROOT, file), 'utf8');
      for (const key of ['RETENTION_TOMBSTONE_DAYS', 'RETENTION_INACTIVE_ACCOUNT_DAYS']) {
        expect(source, `${file} does not mention ${key} in prose`).toContain(key);
      }
      expect(source, `${file} does not say the keys have no default`).toMatch(/NO default|no default/i);
      // …and the floor is written down where the operator will read it, because a
      // floor nobody can find is a floor nobody knows they are standing on.
      expect(source, `${file} does not state the five-year floor`).toContain('1825');
      expect(source, `${file} does not state the three-year floor`).toContain('1095');
    }
  });
});

describe('loadRetentionEnvironment', () => {
  it('returns both windows for a complete source', () => {
    expect(
      loadRetentionEnvironment({
        RETENTION_TOMBSTONE_DAYS: String(MINIMUM_TOMBSTONE_DAYS),
        RETENTION_INACTIVE_ACCOUNT_DAYS: String(MINIMUM_INACTIVE_ACCOUNT_DAYS),
      }),
    ).toEqual({ tombstoneDays: MINIMUM_TOMBSTONE_DAYS, inactiveAccountDays: MINIMUM_INACTIVE_ACCOUNT_DAYS });
    expect(loadRetentionEnvironment({ RETENTION_TOMBSTONE_DAYS: 3650, RETENTION_INACTIVE_ACCOUNT_DAYS: 2000 })).toEqual({
      tombstoneDays: 3650,
      inactiveAccountDays: 2000,
    });
  });

  it('refuses a source missing either window, rather than substituting one', () => {
    // The whole reason this loader exists. A default here is a retention policy
    // nobody chose, and it destroys personal data. Each key is checked ON ITS OWN,
    // so a source carrying only one of them is refused — which is the shape a
    // forker gets by adding 0017 to a deployment and forgetting half the change.
    for (const source of [
      {},
      { RETENTION_TOMBSTONE_DAYS: '' },
      { RETENTION_TOMBSTONE_DAYS: undefined },
      { RETENTION_TOMBSTONE_DAYS: '1825' },
      { RETENTION_INACTIVE_ACCOUNT_DAYS: '1095' },
      { RETENTION_INACTIVE_ACCOUNT_DAYS: undefined },
    ]) {
      const problems = problemsOf(source).join('\n');
      const namesTombstone = source['RETENTION_TOMBSTONE_DAYS'] === undefined;
      const namesAccount = source['RETENTION_INACTIVE_ACCOUNT_DAYS'] === undefined;
      if (namesTombstone) {
        expect(problems, `a source with no tombstone window did not name it:\n${problems}`).toContain(
          'RETENTION_TOMBSTONE_DAYS is required',
        );
      }
      if (namesAccount) {
        expect(problems, `a source with no account window did not name it:\n${problems}`).toContain(
          'RETENTION_INACTIVE_ACCOUNT_DAYS is required',
        );
      }
    }
  });

  it('refuses a tombstone window below the five-year floor, naming the key, the value and the floor', () => {
    // THE ASSERTION THIS FILE EXISTS FOR. `RETENTION_TOMBSTONE_DAYS=1` was valid
    // configuration under `0016`'s `1..36500` bound, and it is the shortest possible
    // route to destroying every tombstone in the repository on the next sweep —
    // which is `0011:222-228`'s failure exactly: the policy the template publishes
    // is five years, and the configuration was allowed to say one day.
    //
    // The floor itself is accepted, so this is a bound and not an off-by-one.
    for (const value of ['1', '30', '1095', String(MINIMUM_TOMBSTONE_DAYS - 1)]) {
      const problems = problemsOf(withTombstoneDays(value)).join('\n');
      expect(problems, `RETENTION_TOMBSTONE_DAYS=${value} was accepted`).toContain('RETENTION_TOMBSTONE_DAYS must be between');
      expect(problems, `RETENTION_TOMBSTONE_DAYS=${value} did not name the floor`).toContain(
        String(MINIMUM_TOMBSTONE_DAYS),
      );
      expect(problems, `RETENTION_TOMBSTONE_DAYS=${value} did not name the value received`).toContain(
        `received ${value}`,
      );
      // …and it says WHY, because a floor an operator cannot reason about is one
      // they route around rather than one they respect.
      expect(problems).toContain('hard-destroys every tombstone in the repository');
    }
    expect(loadRetentionEnvironment(withTombstoneDays(String(MINIMUM_TOMBSTONE_DAYS))).tombstoneDays).toBe(
      MINIMUM_TOMBSTONE_DAYS,
    );
  });

  it('refuses an inactive-account window below the three-year floor, naming the key, the value and the floor', () => {
    for (const value of ['1', '30', '365', String(MINIMUM_INACTIVE_ACCOUNT_DAYS - 1)]) {
      const problems = problemsOf(withInactiveAccountDays(value)).join('\n');
      expect(problems, `RETENTION_INACTIVE_ACCOUNT_DAYS=${value} was accepted`).toContain(
        'RETENTION_INACTIVE_ACCOUNT_DAYS must be between',
      );
      expect(problems, `RETENTION_INACTIVE_ACCOUNT_DAYS=${value} did not name the floor`).toContain(
        String(MINIMUM_INACTIVE_ACCOUNT_DAYS),
      );
      expect(problems, `RETENTION_INACTIVE_ACCOUNT_DAYS=${value} did not name the value received`).toContain(
        `received ${value}`,
      );
    }
    expect(loadRetentionEnvironment(withInactiveAccountDays(String(MINIMUM_INACTIVE_ACCOUNT_DAYS))).inactiveAccountDays).toBe(
      MINIMUM_INACTIVE_ACCOUNT_DAYS,
    );
  });

  it('refuses zero, a negative window, and a value that is not a whole number of days', () => {
    // Zero used to have its own sentence ("every tombstone that has ever existed is
    // due on the next sweep"). It no longer needs one: `0` is a whole number of days
    // and it is below the floor, so the range message already refuses it — and it
    // refuses it for the *stated* reason, which is the floor, rather than for the
    // accident that a zero cannot be expressed. Asserted on what the operator reads.
    expect(problemsOf(withTombstoneDays('0')).join('\n')).toContain('must be between');
    expect(problemsOf(withTombstoneDays('0')).join('\n')).toContain('received 0');
    // A negative window never reaches the range check at all: `^\d+$` rejects it, and
    // that is the same deletion wearing a sign.
    expect(problemsOf(withTombstoneDays('-1')).join('\n')).toContain('whole number of days');
    expect(problemsOf(withInactiveAccountDays('30.5')).join('\n')).toContain('whole number of days');
    expect(problemsOf(withInactiveAccountDays('thirty')).join('\n')).toContain('whole number of days');
  });

  it('refuses a window past the ceiling, which is a units mistake rather than a policy', () => {
    expect(problemsOf(withTombstoneDays(String(MAXIMUM_TOMBSTONE_DAYS + 1))).join('\n')).toContain(
      `between ${String(MINIMUM_TOMBSTONE_DAYS)} and ${String(MAXIMUM_TOMBSTONE_DAYS)}`,
    );
    expect(problemsOf(withInactiveAccountDays(String(MAXIMUM_INACTIVE_ACCOUNT_DAYS + 1))).join('\n')).toContain(
      `between ${String(MINIMUM_INACTIVE_ACCOUNT_DAYS)} and ${String(MAXIMUM_INACTIVE_ACCOUNT_DAYS)}`,
    );
    // The old case: 2592000 is 30 days expressed in SECONDS, which is the likeliest
    // way an absurd value arrives.
    expect(problemsOf(withTombstoneDays('2592000')).join('\n')).toContain('must be between');
    expect(loadRetentionEnvironment(withTombstoneDays(String(MAXIMUM_TOMBSTONE_DAYS))).tombstoneDays).toBe(
      MAXIMUM_TOMBSTONE_DAYS,
    );
  });

  it('names every problem in one error rather than the first, so a boot failure is actionable', () => {
    // The shape `loadEnvironment` and `loadBreakerEnvironment` both use: a rejection
    // from inside module initialisation that explains nothing is the failure mode
    // these loaders were written to avoid. Two bad keys must arrive as TWO problems —
    // a boot that names only the first sends the operator round the loop again.
    let thrown: unknown;
    try {
      loadRetentionEnvironment({ RETENTION_TOMBSTONE_DAYS: '1', RETENTION_INACTIVE_ACCOUNT_DAYS: '1' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RetentionEnvironmentError);
    expect((thrown as RetentionEnvironmentError).message).toContain('The retention configuration is not usable');
    expect((thrown as RetentionEnvironmentError).problems).toHaveLength(2);
    expect((thrown as RetentionEnvironmentError).message).toContain('RETENTION_TOMBSTONE_DAYS must be between');
    expect((thrown as RetentionEnvironmentError).message).toContain('RETENTION_INACTIVE_ACCOUNT_DAYS must be between');
  });

  it('refuses a value that is not a number at all, rather than coercing it', () => {
    // A parsed-looking object is the shape a careless `JSON.parse` of a config blob
    // produces, and `String({days: 30})` would reach the range check as `30` — a
    // number the caller never wrote. The type check has to come first.
    expect(
      problemsOf({
        RETENTION_TOMBSTONE_DAYS: { days: 30 },
        RETENTION_INACTIVE_ACCOUNT_DAYS: String(MINIMUM_INACTIVE_ACCOUNT_DAYS),
      }).join('\n'),
    ).toContain('must be an integer number of days');
  });
});

describe('the windows are read at module-evaluation time, before any job can act on them', () => {
  it('purge.module calls the loader on process.env at module scope, not inside a factory', () => {
    // The moment is the whole of it. `loadEnvironment` and `loadBreakerEnvironment`
    // are both module-evaluation statements for the same reason: a control whose
    // value proposition is refusing bad configuration must refuse it BEFORE it has
    // acted on it, and both jobs register their first interval in
    // `onApplicationBootstrap`, which is strictly later. Reading the key inside a
    // provider factory would let a retention job register its interval against a
    // window nobody asserted.
    const source = readFileSync(join(BACKEND_ROOT, 'src', 'purge', 'purge.module.ts'), 'utf8');
    const atModuleScope = /^export const APP_RETENTION_ENVIRONMENT = loadRetentionEnvironment\(process\.env\);$/m;

    expect(source, 'purge.module.ts does not read the windows at module scope').toMatch(atModuleScope);
    // …and the validated value, not a re-read of `process.env`, is what is bound.
    expect(source).toContain('{ provide: RETENTION_ENV, useValue: APP_RETENTION_ENVIRONMENT }');
    expect(source).not.toMatch(/useFactory[\s\S]{0,400}process\.env/);

    // The loader itself must not reach for `process.env` — it takes a source, which
    // is what makes it testable and what keeps a second implicit reader from
    // appearing next to it (§2.3: no config key read with a default that masks a
    // missing namespace).
    const loader = readFileSync(join(BACKEND_ROOT, 'src', 'purge', 'retention-environment.ts'), 'utf8');
    expect(loader).not.toContain('process.env');
  });
});

// The two keys this file doctors are restored after every case.
//
// **Individually, and never by reassigning `process.env`.** `process.env` is
// replaced wholesale by a plain object when it is assigned to, and `loadEnvFile`
// then writes into the environment store behind it — so the file this suite depends
// on to supply the *other* required keys would silently stop working after the first
// test, and every case after it would fail on `BREAKER_*` rather than on the
// retention floor it is about. That failure mode is invisible from the assertion it
// produces: the message would name a module this file never mentions.
const DOCTORED_KEYS = ['RETENTION_TOMBSTONE_DAYS', 'RETENTION_INACTIVE_ACCOUNT_DAYS'] as const;
const PRISTINE_VALUES = DOCTORED_KEYS.map((key) => [key, process.env[key]] as const);

afterEach(() => {
  for (const [key, value] of PRISTINE_VALUES) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('the BOOT refuses a window below the floor, which is the control the numbers are for', () => {
  /**
   * Imports `purge.module.ts` for real, with `process.env` doctored, and returns
   * whatever it threw — or `undefined` if it evaluated cleanly.
   *
   * **The module is imported rather than the loader called**, because the claim
   * under test is about the MOMENT: `loadRetentionEnvironment` runs as a
   * module-evaluation statement, so a misconfigured process dies before Nest is
   * even constructed and long before either retention job registers an interval.
   * Testing the loader alone would pass against a wiring in which the loader was
   * called inside a provider factory, which is precisely the regression this guards.
   *
   * The refusal is matched by **name and message, never by `instanceof`**: the
   * loader runs inside a fresh module registry, so the class it throws is a
   * different object from the one this file imported statically, and `instanceof`
   * would be false for a refusal that is exactly right.
   */
  async function bootWith(overrides: Readonly<Record<string, string>>): Promise<Error | undefined> {
    vi.resetModules();
    // `.env.test` supplies every OTHER required key — the breaker thresholds
    // included — so the only thing this doctored source is missing is the one key
    // under test, and the refusal cannot be a different module's error wearing the
    // right shape.
    await import('../../../src/config/load-env-file.js');
    Object.assign(process.env, overrides);

    try {
      await import('../../../src/purge/purge.module.js');
      return undefined;
    } catch (error) {
      if (error instanceof Error) {
        return error;
      }
      throw error;
    }
  }

  it('a tombstone window of 1 — the value that used to be legal — aborts the boot', async () => {
    const thrown = await bootWith({
      RETENTION_TOMBSTONE_DAYS: '1',
      RETENTION_INACTIVE_ACCOUNT_DAYS: String(MINIMUM_INACTIVE_ACCOUNT_DAYS),
    });

    expect(thrown?.name, 'the boot did not abort').toBe('RetentionEnvironmentError');
    expect(thrown?.message).toContain('RETENTION_TOMBSTONE_DAYS must be between');
    expect(thrown?.message).toContain(String(MINIMUM_TOMBSTONE_DAYS));
    expect(thrown?.message).toContain('received 1');
  });

  it('an inactive-account window of 30 aborts the boot, naming the three-year floor', async () => {
    const thrown = await bootWith({
      RETENTION_TOMBSTONE_DAYS: String(MINIMUM_TOMBSTONE_DAYS),
      RETENTION_INACTIVE_ACCOUNT_DAYS: '30',
    });

    expect(thrown?.name, 'the boot did not abort').toBe('RetentionEnvironmentError');
    expect(thrown?.message).toContain('RETENTION_INACTIVE_ACCOUNT_DAYS must be between');
    expect(thrown?.message).toContain(String(MINIMUM_INACTIVE_ACCOUNT_DAYS));
    expect(thrown?.message).toContain('received 30');
  });

  it('an absent key aborts the boot rather than starting with a window nobody chose', async () => {
    const thrown = await bootWith({
      RETENTION_TOMBSTONE_DAYS: String(MINIMUM_TOMBSTONE_DAYS),
      RETENTION_INACTIVE_ACCOUNT_DAYS: '',
    });

    expect(thrown?.name, 'the boot did not abort').toBe('RetentionEnvironmentError');
    expect(thrown?.message).toContain('RETENTION_INACTIVE_ACCOUNT_DAYS is required');
  });

  it('the same source at its floors boots, so the refusals above are the FLOOR and not a broken import', async () => {
    // The positive control, and it is load-bearing: without it, a `purge.module.ts`
    // that failed to import for any reason at all — a renamed file, a broken
    // dependency, a missing breaker key — would make all three refusals above green.
    const thrown = await bootWith({
      RETENTION_TOMBSTONE_DAYS: String(MINIMUM_TOMBSTONE_DAYS),
      RETENTION_INACTIVE_ACCOUNT_DAYS: String(MINIMUM_INACTIVE_ACCOUNT_DAYS),
    });
    expect(thrown, `a source at both floors was refused:\n${thrown?.message ?? ''}`).toBeUndefined();
  });
});
