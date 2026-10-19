import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPIRY_SECONDS,
  DEFAULT_LOOKBACK_SECONDS,
  DEFAULT_MATERIALIZE_INTERVAL_SECONDS,
  MAXIMUM_SECONDS,
  NOTIFICATIONS_ENV,
  NotificationEnvironmentError,
  loadNotificationEnvironment,
} from '../../../src/notifications/notification-environment.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * The `NOTIFICATIONS_*` keys are the ONE namespace in this repository where every key
 * is allowed to default, and the whole point of this file is that the permission is
 * narrow rather than general.
 *
 * The three assertions below are the two halves of that, and they fail in opposite
 * directions, which is what makes the pair worth having:
 *
 *   - **an absent key must take the documented default**, because that is the
 *     permission `retention-environment.ts` withholds from its own keys and the reason
 *     this namespace is on the other side of the line. If a default were also refused
 *     here, the namespace would be pointless;
 *   - **a MALFORMED key must abort the boot, naming the key, the value and the range**,
 *     because `NOTIFICATIONS_LOOKBACK_SECONDS=1h` is a materialiser whose overlap is
 *     `NaN` — which is not "no overlap", it is a comparison that is never true, and the
 *     consequence is that every backdated source record is dropped silently and
 *     permanently while the file still looks configured (§2.3).
 */

const KEYS = [
  'NOTIFICATIONS_MATERIALIZE_INTERVAL_SECONDS',
  'NOTIFICATIONS_LOOKBACK_SECONDS',
  'NOTIFICATIONS_EXPIRY_SECONDS',
] as const;

/** A source that supplies nothing, so every key falls to its default. */
function emptySource(): Record<string, string> {
  return {};
}

function problemsOf(source: Readonly<Record<string, unknown>>): string[] {
  try {
    loadNotificationEnvironment(source);
  } catch (error) {
    if (error instanceof NotificationEnvironmentError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error('loadNotificationEnvironment did not throw');
}

/** Every `*.module.ts` in `src/`, recursively — the only files that can bind a token. */
function moduleFiles(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (entry.endsWith('.module.ts')) {
        found.push(path);
      }
    }
  };
  walk(join(BACKEND_ROOT, 'src'));
  return found.sort();
}

describe('every NOTIFICATIONS_* key takes its documented default when it is absent', () => {
  it('returns the three defaults for an empty source', () => {
    expect(loadNotificationEnvironment(emptySource())).toEqual({
      materializeIntervalSeconds: DEFAULT_MATERIALIZE_INTERVAL_SECONDS,
      lookbackSeconds: DEFAULT_LOOKBACK_SECONDS,
      expirySeconds: DEFAULT_EXPIRY_SECONDS,
    });
  });

  it('treats an EMPTY value as absent rather than as zero', () => {
    // `.env.example` ships these blank, and a blank that meant "zero" would be a
    // configuration that silently switches the mechanism off on every fresh checkout.
    expect(loadNotificationEnvironment({ ...emptySource(), ...Object.fromEntries(KEYS.map((k) => [k, ''])) })).toEqual(
      loadNotificationEnvironment(emptySource()),
    );
  });

  it('prefers a configured value over the default', () => {
    expect(
      loadNotificationEnvironment({
        NOTIFICATIONS_MATERIALIZE_INTERVAL_SECONDS: '60',
        NOTIFICATIONS_LOOKBACK_SECONDS: '120',
        NOTIFICATIONS_EXPIRY_SECONDS: '600',
      }),
    ).toEqual({ materializeIntervalSeconds: 60, lookbackSeconds: 120, expirySeconds: 600 });
  });
});

describe('a malformed NOTIFICATIONS_* key is refused, not silently absorbed', () => {
  it('names the key and the value received for anything that is not a whole number', () => {
    for (const bad of ['1h', '60s', '-1', '1.5', 'NaN', ' ']) {
      const problems = problemsOf({ NOTIFICATIONS_LOOKBACK_SECONDS: bad }).join('\n');
      expect(problems, `'${bad}' was accepted`).toContain('NOTIFICATIONS_LOOKBACK_SECONDS must be a whole number of seconds');
      expect(problems).toContain(`received '${bad}'`);
    }
  });

  it('refuses zero, because zero removes the mechanism rather than tuning it', () => {
    // `NOTIFICATIONS_LOOKBACK_SECONDS=0` reads as "no overlap wanted" and means "every
    // backdated source record is dropped forever"; `NOTIFICATIONS_EXPIRY_SECONDS=0`
    // means every notification is invisible the instant it is written. Neither is a
    // value a deployment wants, and both are one keystroke away.
    for (const key of KEYS) {
      const problems = problemsOf({ [key]: '0' }).join('\n');
      expect(problems, `${key}=0 was accepted`).toContain(`${key} must be between 1 and ${String(MAXIMUM_SECONDS)} seconds`);
      expect(problems).toContain('the mechanism is');
    }
  });

  it('refuses a value past a year, which is far more likely to be a units mistake', () => {
    const tooLong = String(MAXIMUM_SECONDS + 1);
    const problems = problemsOf({ NOTIFICATIONS_EXPIRY_SECONDS: tooLong }).join('\n');
    expect(problems).toContain(`must be between 1 and ${String(MAXIMUM_SECONDS)} seconds`);
    expect(problems).toContain('units mistake');
  });

  it('accepts the two bounds, so they are bounds and not off-by-ones', () => {
    expect(loadNotificationEnvironment({ NOTIFICATIONS_LOOKBACK_SECONDS: '1' }).lookbackSeconds).toBe(1);
    expect(loadNotificationEnvironment({ NOTIFICATIONS_LOOKBACK_SECONDS: String(MAXIMUM_SECONDS) }).lookbackSeconds).toBe(
      MAXIMUM_SECONDS,
    );
  });

  it('names every bad key in ONE error rather than the first', () => {
    // The shape `loadEnvironment`, `loadRetentionEnvironment` and
    // `loadErasureEnvironment` all use: a boot failure naming one of three bad keys
    // sends the operator round the loop twice more.
    const problems = problemsOf({ ...Object.fromEntries(KEYS.map((k) => [k, '1h'])) });
    expect(problems).toHaveLength(3);
    for (const key of KEYS) {
      expect(problems.join('\n')).toContain(key);
    }
  });

  it('refuses a value that is not a string or a number, rather than coercing it', () => {
    expect(problemsOf({ NOTIFICATIONS_LOOKBACK_SECONDS: { seconds: 60 } }).join('\n')).toContain(
      'NOTIFICATIONS_LOOKBACK_SECONDS must be an integer number of seconds, received object',
    );
  });
});

describe('the namespace is discoverable and bound at boot', () => {
  it('names every key in the two example files an operator configures from', () => {
    // A key nobody can find is a key nobody sets. These keys have defaults, so a
    // missing one is not a boot failure — it is a silent departure from what the
    // deployment intended, which is the harder failure to notice.
    for (const file of ['.env.example', '.env.production.example']) {
      const source = readFileSync(join(BACKEND_ROOT, file), 'utf8');
      for (const key of KEYS) {
        expect(source, `${file} does not mention ${key}`).toContain(key);
      }
      expect(source, `${file} does not say these keys HAVE defaults`).toMatch(/HAS a default|have a default/i);
      expect(source, `${file} does not say a malformed one is refused`).toMatch(/MALFORMED|malformed/);
    }
  });

  it('is read at module scope and bound as the validated value, never re-read from process.env', () => {
    // The moment AND the binding. A loader called inside a provider factory would let
    // the application start against a namespace nobody asserted — the same property
    // `test/unit/privacy/erasure-environment.spec.ts` asserts, for a namespace whose
    // failure mode is a quiet wrong window rather than a published key.
    const source = readFileSync(join(BACKEND_ROOT, 'src', 'notifications', 'notifications.module.ts'), 'utf8');
    expect(source).toMatch(/^export const APP_NOTIFICATION_ENVIRONMENT = loadNotificationEnvironment\(process\.env\);$/m);
    expect(source).toContain('{ provide: NOTIFICATIONS_ENV, useValue: APP_NOTIFICATION_ENVIRONMENT }');
    expect(source).not.toMatch(/useFactory[\s\S]{0,400}process\.env/);

    // The loader itself takes a source, which is what keeps a second implicit reader
    // from appearing beside it (§2.3).
    expect(readFileSync(join(BACKEND_ROOT, 'src', 'notifications', 'notification-environment.ts'), 'utf8')).not.toContain(
      'process.env',
    );
  });

  it('has a DI token that no other module binds', () => {
    // Two providers bound to the same token would be two sources of truth for one
    // window, and DI would pick one without saying which (§2.4).
    expect(NOTIFICATIONS_ENV).toBe('NOTIFICATIONS_ENVIRONMENT');
    const binders = moduleFiles()
      .filter((file) => readFileSync(file, 'utf8').includes('NOTIFICATIONS_ENV'))
      .map((file) => relative(BACKEND_ROOT, file).replaceAll('\\', '/'));
    expect(binders).toEqual(['src/notifications/notifications.module.ts']);
  });
});