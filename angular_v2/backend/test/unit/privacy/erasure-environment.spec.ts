import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ErasureEnvironmentError,
  MAXIMUM_PEPPER_KID_LENGTH,
  MINIMUM_PEPPER_LENGTH,
  loadErasureEnvironment,
} from '../../../src/privacy/erasure-environment.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * `PRIVACY_HMAC_PEPPER` is a KEY, and a key with a default is a published key.
 *
 * Every assertion here is one way that becomes true, and they fail in different
 * directions:
 *
 *   - **a missing key must abort the boot**, because the alternative is a
 *     tombstone table anybody who has read this repository can recompute;
 *   - **a short key must be refused**, because 256 bits is where an offline sweep
 *     stops being infeasible and a floor nobody can find is a floor nobody knows
 *     they are standing on;
 *   - **key reuse with `JWT_SECRET` must be refused**, because one leak signing
 *     both the sessions and the tombstones is two compromises wearing one secret;
 *   - **an unnameable `pepper_kid` must be refused**, because a pepper nobody can
 *     identify is a pepper that cannot be rotated — which is the property the
 *     whole `pepper_kid` column exists to provide.
 *
 * Mirrors `test/unit/purge/retention-environment.spec.ts`, which is the precedent
 * for "a decision, validated at boot, with a floor" in this repository.
 */

const KEYS = ['PRIVACY_HMAC_PEPPER', 'PRIVACY_HMAC_PEPPER_KID', 'PRIVACY_TOMBSTONE_DOMAIN'] as const;

function completeSource(): Record<string, string> {
  return {
    PRIVACY_HMAC_PEPPER: 'a-test-pepper-of-a-plausible-length-000001',
    PRIVACY_HMAC_PEPPER_KID: 'test-v1',
    PRIVACY_TOMBSTONE_DOMAIN: 'tombstone.example.test',
  };
}

function problemsOf(source: Readonly<Record<string, unknown>>): string[] {
  try {
    loadErasureEnvironment(source);
  } catch (error) {
    if (error instanceof ErasureEnvironmentError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error('loadErasureEnvironment did not throw');
}

/** The environment files, read rather than listed, so a new mode is covered. */
function environmentFiles(): readonly string[] {
  return readdirSync(BACKEND_ROOT)
    .filter((name) => name === '.env' || name.startsWith('.env.'))
    .sort();
}

describe('the erasure keys are required in every mode', () => {
  it('are present, uncommented and assigned in every .env* file', () => {
    // "Required in every mode with no default" is the property, and a key present
    // in five files and absent from the sixth is a key that is absent from
    // production. A COMMENTED assignment does not count: `.env` is loaded by
    // `process.loadEnvFile`, which skips a `#` line entirely, so a commented key
    // reads as a missing key and the boot stops naming it.
    const files = environmentFiles();
    expect(files.length, 'the .env* files were not found; this assertion would be vacuous').toBeGreaterThanOrEqual(6);

    for (const file of files) {
      const source = readFileSync(join(BACKEND_ROOT, file), 'utf8');
      for (const key of KEYS) {
        const assigned = source
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith(`${key}=`));

        expect(assigned, `${file} does not assign ${key}`).toHaveLength(1);
        expect(assigned[0], `${file} assigns a commented-out ${key}`).not.toMatch(/^#/);
      }
    }
  });

  it('assigns a REAL value in the two files a process actually reads', () => {
    // The examples ship blanks for the same reason `JWT_SECRET=` does — a committed
    // file must not carry a secret. The two files the application and the test
    // suite load are not examples, and a blank there is a process that cannot
    // start.
    for (const file of ['.env', '.env.test']) {
      const source = readFileSync(join(BACKEND_ROOT, file), 'utf8');
      for (const key of KEYS) {
        const value = new RegExp(`^${key}=(.*)$`, 'm').exec(source)?.[1] ?? '';
        expect(value.length, `${file} leaves ${key} empty, so a process reading it cannot boot`).toBeGreaterThan(0);
      }
      const pepper = new RegExp('^PRIVACY_HMAC_PEPPER=(.*)$', 'm').exec(source)?.[1] ?? '';
      expect(pepper.length, `${file} ships a pepper below the floor`).toBeGreaterThanOrEqual(MINIMUM_PEPPER_LENGTH);
    }
  });

  it('names every key, and says why there is no default, in the file a reader configures', () => {
    // A key nobody can find is a key nobody sets, and the boot error that follows
    // reads as a broken checkout rather than as a missing decision.
    for (const file of ['.env.example', '.env.production.example']) {
      const source = readFileSync(join(BACKEND_ROOT, file), 'utf8');
      for (const key of KEYS) {
        expect(source, `${file} does not mention ${key}`).toContain(key);
      }
      expect(source, `${file} does not say the keys have no default`).toMatch(/NO default|no default/i);
      expect(source, `${file} does not explain what rotation costs`).toMatch(/rotat/i);
      expect(source, `${file} does not state the key-reuse refusal`).toMatch(/JWT_SECRET/);
    }
  });
});

describe('loadErasureEnvironment', () => {
  it('returns the namespace for a complete source', () => {
    expect(loadErasureEnvironment(completeSource())).toEqual({
      pepper: completeSource()['PRIVACY_HMAC_PEPPER'],
      pepperKid: completeSource()['PRIVACY_HMAC_PEPPER_KID'],
      tombstoneDomain: completeSource()['PRIVACY_TOMBSTONE_DOMAIN'],
    });
  });

  it('refuses a source missing any key, rather than substituting a default', () => {
    for (const key of KEYS) {
      const source: Record<string, string | undefined> = { ...completeSource(), [key]: undefined };
      const problems = problemsOf(source).join('\n');
      expect(problems, `${key} was defaulted`).toContain(`${key} is required`);
    }
    // An empty string is a MISSING key, not an empty key: the whole failure this
    // loader exists for is a process starting with a key nobody chose.
    expect(problemsOf({ ...completeSource(), PRIVACY_HMAC_PEPPER: '' }).join('\n')).toContain(
      'PRIVACY_HMAC_PEPPER is required',
    );
  });

  it('refuses a pepper below the floor, naming the key, the length and the floor', () => {
    for (const pepper of ['short', 'x'.repeat(MINIMUM_PEPPER_LENGTH - 1)]) {
      const problems = problemsOf({ ...completeSource(), PRIVACY_HMAC_PEPPER: pepper }).join('\n');
      expect(problems, `a ${pepper.length}-character pepper was accepted`).toContain(
        `PRIVACY_HMAC_PEPPER must be at least ${String(MINIMUM_PEPPER_LENGTH)} characters`,
      );
      expect(problems).toContain(`received ${String(pepper.length)}`);
    }
    // The floor itself is accepted, so this is a bound and not an off-by-one.
    expect(
      loadErasureEnvironment({ ...completeSource(), PRIVACY_HMAC_PEPPER: 'x'.repeat(MINIMUM_PEPPER_LENGTH) }).pepper,
    ).toBe('x'.repeat(MINIMUM_PEPPER_LENGTH));
  });

  it('refuses a pepper that is also the JWT signing secret', () => {
    // Key reuse, refused rather than documented. One secret that signs both the
    // session tokens and the tombstone digests is one leak and two compromises.
    const shared = 'the-one-secret-this-deployment-shared-by-accident-0001';
    expect(
      problemsOf({ ...completeSource(), PRIVACY_HMAC_PEPPER: shared, JWT_SECRET: shared }).join('\n'),
    ).toContain('must not equal JWT_SECRET');

    // …and the same pepper beside a DIFFERENT secret is fine, which is the positive
    // control that proves the assertion above is about reuse and not about the
    // presence of a second key.
    expect(
      loadErasureEnvironment({
        ...completeSource(),
        PRIVACY_HMAC_PEPPER: shared,
        JWT_SECRET: 'a-completely-different-signing-secret-000001',
      }).pepperKid,
    ).toBe(completeSource()['PRIVACY_HMAC_PEPPER_KID']);
  });

  it('refuses a pepper kid that could not identify a key, because a kid nobody can read is no kid', () => {
    for (const kid of ['ab', 'has space', 'quote"injection', 'line\nbreak', 'x'.repeat(MAXIMUM_PEPPER_KID_LENGTH + 1)]) {
      const problems = problemsOf({ ...completeSource(), PRIVACY_HMAC_PEPPER_KID: kid }).join('\n');
      expect(problems, `pepper_kid '${kid}' was accepted`).toContain('PRIVACY_HMAC_PEPPER_KID');
    }
    expect(loadErasureEnvironment({ ...completeSource(), PRIVACY_HMAC_PEPPER_KID: 'prod-2026-10' }).pepperKid).toBe(
      'prod-2026-10',
    );
  });

  it('refuses a tombstone domain that could name somebody else\'s mailbox', () => {
    // The value is concatenated after '@'. A domain carrying its own '@' produces
    // `deleted-<digest>@victim@example.com`, which routes to VICTIM — so this is an
    // injection, not a formatting complaint.
    for (const domain of ['victim@example.com', 'localhost', 'has space', 'scheme://host', '@']) {
      const problems = problemsOf({ ...completeSource(), PRIVACY_TOMBSTONE_DOMAIN: domain }).join('\n');
      expect(problems, `tombstone domain '${domain}' was accepted`).toContain('PRIVACY_TOMBSTONE_DOMAIN must be a bare host');
    }
    expect(
      loadErasureEnvironment({ ...completeSource(), PRIVACY_TOMBSTONE_DOMAIN: 'tombstone.example.test' })
        .tombstoneDomain,
    ).toBe('tombstone.example.test');
  });

  it('names every problem in one error rather than the first', () => {
    // The shape `loadEnvironment`, `loadBreakerEnvironment` and
    // `loadRetentionEnvironment` all use: a boot failure that names one of three
    // bad keys sends the operator round the loop twice more.
    let thrown: unknown;
    try {
      loadErasureEnvironment({});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ErasureEnvironmentError);
    expect((thrown as ErasureEnvironmentError).message).toContain('The erasure configuration is not usable');
    expect((thrown as ErasureEnvironmentError).problems).toHaveLength(3);
  });

  it('refuses a value that is not a string, rather than coercing it', () => {
    // `String({days: 30})` would reach the length check as `[object Object]` and
    // fail there with a message about the wrong thing; the type check comes first.
    expect(
      problemsOf({ ...completeSource(), PRIVACY_HMAC_PEPPER: { bytes: 32 } }).join('\n'),
    ).toContain('PRIVACY_HMAC_PEPPER must be a string');
  });
});

const PRISTINE_VALUES = KEYS.map((key) => [key, process.env[key]] as const);

afterEach(() => {
  for (const [key, value] of PRISTINE_VALUES) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('the BOOT refuses an unnamed pepper, which is the control the key is for', () => {
  /**
   * Imports `erasure.module.ts` for real, with `process.env` doctored, and returns
   * whatever it threw — or `undefined` if it evaluated cleanly.
   *
   * **The module is imported rather than the loader called**, because the claim
   * under test is about the MOMENT: `loadErasureEnvironment` runs as a
   * module-evaluation statement, so a misconfigured process dies before Nest is
   * even constructed and long before a route exists. Testing the loader alone
   * would pass against a wiring that called it inside a provider factory, which is
   * precisely the regression this guards.
   *
   * **Matched by name and message, never by `instanceof`**: the loader runs inside
   * a fresh module registry, so the class it throws is a different object from the
   * one this file imported statically.
   */
  async function bootWith(overrides: Readonly<Record<string, string>>): Promise<Error | undefined> {
    vi.resetModules();
    // `.env.test` supplies every OTHER required key, so the only thing this
    // doctored source is missing is the one under test and the refusal cannot be a
    // different module's error wearing the right shape.
    await import('../../../src/config/load-env-file.js');
    Object.assign(process.env, overrides);

    try {
      await import('../../../src/privacy/erasure.module.js');
      return undefined;
    } catch (error) {
      if (error instanceof Error) {
        return error;
      }
      throw error;
    }
  }

  it('aborts when the pepper is absent — which is what commenting it out of .env.test does', async () => {
    const thrown = await bootWith({
      ...completeSource(),
      PRIVACY_HMAC_PEPPER: '',
    });

    expect(thrown?.name, 'the boot did not abort').toBe('ErasureEnvironmentError');
    expect(thrown?.message).toContain('PRIVACY_HMAC_PEPPER is required');
    expect(thrown?.message).toContain('a default is a published key');
  });

  it('aborts when the pepper is too short, naming the floor', async () => {
    const thrown = await bootWith({ ...completeSource(), PRIVACY_HMAC_PEPPER: 'too-short' });

    expect(thrown?.name, 'the boot did not abort').toBe('ErasureEnvironmentError');
    expect(thrown?.message).toContain(`at least ${String(MINIMUM_PEPPER_LENGTH)} characters`);
    expect(thrown?.message).toContain('received 9');
  });

  it('aborts when the pepper is the JWT secret', async () => {
    const shared = 'the-one-secret-this-deployment-shared-by-accident-0001';
    const thrown = await bootWith({
      ...completeSource(),
      PRIVACY_HMAC_PEPPER: shared,
      JWT_SECRET: shared,
    });

    expect(thrown?.name, 'the boot did not abort').toBe('ErasureEnvironmentError');
    expect(thrown?.message).toContain('must not equal JWT_SECRET');
  });

  it('aborts when the kid is missing, because a pepper nobody can name cannot be rotated', async () => {
    const thrown = await bootWith({ ...completeSource(), PRIVACY_HMAC_PEPPER_KID: '' });

    expect(thrown?.name, 'the boot did not abort').toBe('ErasureEnvironmentError');
    expect(thrown?.message).toContain('PRIVACY_HMAC_PEPPER_KID is required');
  });

  it('the same source complete boots, so the refusals above are the RULES and not a broken import', async () => {
    // The positive control, and it is load-bearing: without it, an
    // `erasure.module.ts` that failed to import for any reason at all — a renamed
    // file, a broken dependency — would make all four refusals above green.
    const thrown = await bootWith(completeSource());
    expect(thrown, `a complete source was refused:\n${thrown?.message ?? ''}`).toBeUndefined();
  });

  it('reads the keys at module scope and binds the validated value, never a re-read of process.env', () => {
    // The moment AND the binding. A loader called inside a provider factory would
    // let the application start against a namespace nobody asserted, and the value
    // a factory re-read would be whatever `process.env` held at DI time.
    const source = readFileSync(join(BACKEND_ROOT, 'src', 'privacy', 'erasure.module.ts'), 'utf8');

    expect(source).toMatch(/^export const APP_ERASURE_ENVIRONMENT = loadErasureEnvironment\(process\.env\);$/m);
    expect(source).toContain('{ provide: ERASURE_ENV, useValue: APP_ERASURE_ENVIRONMENT }');
    expect(source).not.toMatch(/useFactory[\s\S]{0,400}process\.env/);

    // The loader itself takes a source, which is what keeps a second implicit
    // reader from appearing beside it (§2.3).
    expect(readFileSync(join(BACKEND_ROOT, 'src', 'privacy', 'erasure-environment.ts'), 'utf8')).not.toContain(
      'process.env',
    );
  });
});