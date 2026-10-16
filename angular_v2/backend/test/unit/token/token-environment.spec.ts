import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAXIMUM_TOKEN_PEPPER_KID_LENGTH,
  MINIMUM_TOKEN_PEPPER_KID_LENGTH,
  MINIMUM_TOKEN_PEPPER_LENGTH,
  TokenEnvironmentError,
  loadTokenEnvironment,
} from '../../../src/token/token-environment.js';
import { BACKEND_ROOT } from '../../support/paths.js';

const REQUIRED_KEYS = ['AUTH_TOKEN_PEPPER', 'AUTH_TOKEN_PEPPER_KID'] as const;

function completeSource(): Record<string, string> {
  return {
    AUTH_TOKEN_PEPPER: 'a-test-token-pepper-of-plausible-length-0001',
    AUTH_TOKEN_PEPPER_KID: 'test-v1',
    JWT_SECRET: 'a-completely-different-jwt-secret-000000000001',
    PRIVACY_HMAC_PEPPER: 'a-completely-different-privacy-pepper-00000001',
  };
}

function problemsOf(source: Readonly<Record<string, unknown>>): string[] {
  try {
    loadTokenEnvironment(source);
  } catch (error) {
    if (error instanceof TokenEnvironmentError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error('loadTokenEnvironment did not throw');
}

function environmentFiles(): readonly string[] {
  return readdirSync(BACKEND_ROOT)
    .filter((name) => name === '.env' || name.startsWith('.env.'))
    .sort();
}

describe('TokenEnvironment loader', () => {
  it('returns validated configuration for a complete source', () => {
    const config = loadTokenEnvironment(completeSource());
    expect(config.pepper).toBe('a-test-token-pepper-of-plausible-length-0001');
    expect(config.pepperKid).toBe('test-v1');
  });

  it('refuses an absent or empty pepper', () => {
    const problems = problemsOf({ ...completeSource(), AUTH_TOKEN_PEPPER: '' });
    expect(problems.some((p) => p.includes('AUTH_TOKEN_PEPPER is required'))).toBe(true);
    expect(problems.some((p) => /default is a published key/i.test(p))).toBe(true);
  });

  it('refuses a pepper below 32 characters, naming the floor', () => {
    const problems = problemsOf({ ...completeSource(), AUTH_TOKEN_PEPPER: 'short-pepper' });
    expect(
      problems.some((p) => p.includes(`at least ${String(MINIMUM_TOKEN_PEPPER_LENGTH)} characters`)),
    ).toBe(true);
  });

  it('refuses key reuse with JWT_SECRET', () => {
    const shared = 'the-shared-secret-that-must-be-refused-000001';
    const problems = problemsOf({
      ...completeSource(),
      AUTH_TOKEN_PEPPER: shared,
      JWT_SECRET: shared,
    });
    expect(problems.some((p) => p.includes('must not equal JWT_SECRET'))).toBe(true);
  });

  it('refuses key reuse with PRIVACY_HMAC_PEPPER', () => {
    const shared = 'the-shared-pepper-that-must-be-refused-000001';
    const problems = problemsOf({
      ...completeSource(),
      AUTH_TOKEN_PEPPER: shared,
      PRIVACY_HMAC_PEPPER: shared,
    });
    expect(problems.some((p) => p.includes('must not equal PRIVACY_HMAC_PEPPER'))).toBe(true);
  });

  it('refuses an absent or empty pepper kid', () => {
    const problems = problemsOf({ ...completeSource(), AUTH_TOKEN_PEPPER_KID: '' });
    expect(problems.some((p) => p.includes('AUTH_TOKEN_PEPPER_KID is required'))).toBe(true);
  });

  it('refuses a pepper kid that is too short or too long', () => {
    const tooShort = problemsOf({ ...completeSource(), AUTH_TOKEN_PEPPER_KID: 'ab' });
    expect(
      tooShort.some((p) =>
        p.includes(`between ${String(MINIMUM_TOKEN_PEPPER_KID_LENGTH)} and ${String(MAXIMUM_TOKEN_PEPPER_KID_LENGTH)}`),
      ),
    ).toBe(true);

    const tooLong = problemsOf({
      ...completeSource(),
      AUTH_TOKEN_PEPPER_KID: 'a'.repeat(MAXIMUM_TOKEN_PEPPER_KID_LENGTH + 1),
    });
    expect(
      tooLong.some((p) =>
        p.includes(`between ${String(MINIMUM_TOKEN_PEPPER_KID_LENGTH)} and ${String(MAXIMUM_TOKEN_PEPPER_KID_LENGTH)}`),
      ),
    ).toBe(true);
  });

  it('refuses a pepper kid with invalid characters', () => {
    const problems = problemsOf({ ...completeSource(), AUTH_TOKEN_PEPPER_KID: 'bad kid with spaces' });
    expect(problems.some((p) => p.includes('must be an identifier'))).toBe(true);
  });

  it('asserts that every .env* file defines both token keys', () => {
    const files = environmentFiles();
    expect(files.length).toBeGreaterThanOrEqual(6);

    for (const file of files) {
      const content = readFileSync(join(BACKEND_ROOT, file), 'utf8');
      for (const key of REQUIRED_KEYS) {
        expect(
          content,
          `${file} is missing ${key}`,
        ).toMatch(new RegExp(`^${key}=`, 'm'));
      }
    }
  });

  it('module evaluation in token.module.ts asserts the environment at boot', () => {
    const content = readFileSync(join(BACKEND_ROOT, 'src', 'token', 'token.module.ts'), 'utf8');
    expect(content).toMatch(/export const APP_TOKEN_ENVIRONMENT = loadTokenEnvironment\(process\.env\);/);
    expect(content).toContain('{ provide: TOKEN_ENV, useValue: APP_TOKEN_ENVIRONMENT }');
  });
});
