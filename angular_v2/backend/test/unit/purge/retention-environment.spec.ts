import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAXIMUM_TOMBSTONE_DAYS,
  MINIMUM_TOMBSTONE_DAYS,
  RetentionEnvironmentError,
  loadRetentionEnvironment,
} from '../../../src/purge/retention-environment.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * The retention window is a DECISION and is validated as one.
 *
 * The two halves of this file are the two ways that decision goes wrong, and they
 * fail in opposite directions:
 *
 *   * **a missing or malformed key** must abort the boot, because a default nobody
 *     chose silently applies and the harm is not disk — it is that the retention
 *     policy this template PUBLISHES is one it does not ENFORCE, which is what an
 *     auditor reads (GDPR Art. 5(1)(e), CPRA §1798.100(a)(3)); and
 *   * **a window of zero** must be refused, because it makes every tombstone that
 *     has ever existed due on the next sweep. A loader that accepted `0` and the
 *     database that accepted `0` would be two halves of the same deletion with
 *     nothing stopping either.
 *
 * The bound is asserted here AND inside `authz.retention_due_tombstones()`. Two
 * copies of one number is deliberate rather than duplicated (§2.4): the loader
 * refuses a misconfiguration at boot, and the function refuses a malformed call
 * from any other caller, which is a different caller with a different reason to lie.
 */

/** The six environment files, read rather than listed, so a new mode is covered. */
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

describe('the retention window is required in every mode', () => {
  it('is present, uncommented and assigned in every .env* file', () => {
    // Every mode, because "required in every mode with no default" is the property
    // and a key present in four files and absent from the fifth is a key that is
    // absent from production. `environment.ts` refuses a missing key rather than
    // defaulting it, so a mode whose file lacks it simply cannot boot.
    const files = environmentFiles();
    expect(files.length, 'the .env* files were not found; this assertion would be vacuous').toBeGreaterThanOrEqual(6);

    for (const file of files) {
      const source = readFileSync(join(BACKEND_ROOT, file), 'utf8');
      const assigned = source
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('RETENTION_TOMBSTONE_DAYS='));

      expect(assigned, `${file} does not assign RETENTION_TOMBSTONE_DAYS`).toHaveLength(1);
      expect(assigned[0], `${file} assigns a commented-out window`).not.toMatch(/^#/);

      const value = (assigned[0] ?? '').split('=')[1] ?? '';
      expect(Number.isInteger(Number(value)) && Number(value) > 0, `${file} sets a nonsensical window`).toBe(true);
    }
  });

  it('names the key, and says why there is no default, in the file a reader configures', () => {
    // A key nobody can find is a key nobody sets, and the boot error that follows
    // reads as a broken checkout rather than as a missing decision.
    for (const file of ['.env.example', '.env.production.example']) {
      const source = readFileSync(join(BACKEND_ROOT, file), 'utf8');
      expect(source, `${file} does not mention the window in prose`).toContain('RETENTION_TOMBSTONE_DAYS');
      expect(source, `${file} does not say the key has no default`).toMatch(/NO default|no default/i);
    }
  });
});

describe('loadRetentionEnvironment', () => {
  it('returns the window for a complete source', () => {
    expect(loadRetentionEnvironment({ RETENTION_TOMBSTONE_DAYS: '30' })).toEqual({ tombstoneDays: 30 });
    expect(loadRetentionEnvironment({ RETENTION_TOMBSTONE_DAYS: 365 })).toEqual({ tombstoneDays: 365 });
  });

  it('refuses a source with no window at all, rather than substituting one', () => {
    // The whole reason this loader exists. A default here is a retention policy
    // nobody chose, and it destroys personal data.
    for (const source of [{}, { RETENTION_TOMBSTONE_DAYS: '' }, { RETENTION_TOMBSTONE_DAYS: undefined }]) {
      expect(problemsOf(source)).toContainEqual(expect.stringContaining('RETENTION_TOMBSTONE_DAYS is required'));
    }
  });

  it('refuses zero, a negative window, and a value that is not a whole number of days', () => {
    // Zero is the dangerous one: every tombstone that has ever existed becomes due on
    // the next sweep. A negative window is the same deletion wearing a sign.
    expect(problemsOf({ RETENTION_TOMBSTONE_DAYS: '0' })).toContainEqual(
      expect.stringContaining('Zero would make every tombstone that has ever existed due'),
    );
    expect(problemsOf({ RETENTION_TOMBSTONE_DAYS: '-1' })).toContainEqual(expect.stringContaining('whole number of days'));
    // A units mistake is the likeliest way an absurd value arrives.
    expect(problemsOf({ RETENTION_TOMBSTONE_DAYS: '2592000' })).toContainEqual(expect.stringContaining('must be between'));
    expect(problemsOf({ RETENTION_TOMBSTONE_DAYS: '30.5' })).toContainEqual(expect.stringContaining('whole number of days'));
    expect(problemsOf({ RETENTION_TOMBSTONE_DAYS: 'thirty' })).toContainEqual(expect.stringContaining('whole number of days'));
  });

  it('refuses a window past the ceiling, which is a units mistake rather than a policy', () => {
    expect(problemsOf({ RETENTION_TOMBSTONE_DAYS: String(MAXIMUM_TOMBSTONE_DAYS + 1) })).toContainEqual(
      expect.stringContaining(`between ${String(MINIMUM_TOMBSTONE_DAYS)} and ${String(MAXIMUM_TOMBSTONE_DAYS)}`),
    );
    expect(loadRetentionEnvironment({ RETENTION_TOMBSTONE_DAYS: String(MAXIMUM_TOMBSTONE_DAYS) })).toEqual({
      tombstoneDays: MAXIMUM_TOMBSTONE_DAYS,
    });
  });

  it('names every problem in one error rather than the first, so a boot failure is actionable', () => {
    // The shape `loadEnvironment` and `loadBreakerEnvironment` both use: a rejection
    // from inside module initialisation that explains nothing is the failure mode
    // these loaders were written to avoid.
    let thrown: unknown;
    try {
      loadRetentionEnvironment({ RETENTION_TOMBSTONE_DAYS: '0' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RetentionEnvironmentError);
    expect((thrown as RetentionEnvironmentError).message).toContain('The retention configuration is not usable');
    expect((thrown as RetentionEnvironmentError).problems).toHaveLength(1);
  });

  it('refuses a value that is not a number at all, rather than coercing it', () => {
    expect(problemsOf({ RETENTION_TOMBSTONE_DAYS: { days: 30 } })).toContainEqual(
      expect.stringContaining('must be an integer number of days'),
    );
  });
});

describe('the window is read at module-evaluation time, before any job can act on it', () => {
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

    expect(source, 'purge.module.ts does not read the window at module scope').toMatch(atModuleScope);
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
