import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SERVER_PORT,
  EnvironmentError,
  MINIMUM_JWT_SECRET_LENGTH,
  loadEnvironment,
} from '../../src/config/environment.js';

const SECRET = 'a'.repeat(MINIMUM_JWT_SECRET_LENGTH);

function validSource(overrides: Record<string, string | number> = {}): Record<string, string | number> {
  return {
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USER: 'app',
    DB_PASSWORD: 'app',
    DB_NAME: 'app_dev',
    JWT_SECRET: SECRET,
    ...overrides,
  };
}

function problemsOf(source: Record<string, string | number>): string[] {
  try {
    loadEnvironment(source);
  } catch (error) {
    if (error instanceof EnvironmentError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error('loadEnvironment did not throw');
}

describe('loadEnvironment', () => {
  it('returns the validated environment for a complete source', () => {
    expect(loadEnvironment(validSource({ PORT: '4000' }))).toEqual({
      database: { host: 'localhost', port: 5432, user: 'app', password: 'app', database: 'app_dev' },
      jwt: { secret: SECRET },
      server: { port: 4000 },
    });
  });

  it('defaults PORT to the documented server port', () => {
    expect(loadEnvironment(validSource()).server.port).toBe(DEFAULT_SERVER_PORT);
  });

  it('never defaults a database coordinate', () => {
    for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET']) {
      const source = validSource();
      delete source[key];

      expect(problemsOf(source)).toContain(`${key} is required but was not set`);
    }
  });

  it('rejects a JWT secret shorter than the minimum, and says how short it is', () => {
    const problems = problemsOf(validSource({ JWT_SECRET: 'a'.repeat(MINIMUM_JWT_SECRET_LENGTH - 1) }));

    expect(problems).toEqual([
      `JWT_SECRET must be at least ${MINIMUM_JWT_SECRET_LENGTH} characters, received ${MINIMUM_JWT_SECRET_LENGTH - 1}`,
    ]);
  });

  it('accepts a JWT secret at exactly the minimum length', () => {
    expect(loadEnvironment(validSource()).jwt.secret).toHaveLength(MINIMUM_JWT_SECRET_LENGTH);
  });

  it('treats an empty value as absent rather than as an empty string', () => {
    expect(problemsOf(validSource({ DB_USER: '' }))).toContain('DB_USER is required but was not set');
    expect(problemsOf(validSource({ JWT_SECRET: '' }))).toContain('JWT_SECRET is required but was not set');
  });

  it('rejects a non-numeric port and reports the received value', () => {
    expect(problemsOf(validSource({ DB_PORT: 'five thousand' }))).toEqual([
      'DB_PORT must be an integer between 1 and 65535, received \'five thousand\'',
    ]);
  });

  it('rejects a port outside the valid range', () => {
    expect(problemsOf(validSource({ DB_PORT: '70000' }))).toEqual([
      "DB_PORT must be between 1 and 65535, received '70000'",
    ]);
    expect(problemsOf(validSource({ DB_PORT: '0' }))).toEqual(["DB_PORT must be between 1 and 65535, received '0'"]);
  });

  it('reports every problem at once rather than only the first', () => {
    const problems = problemsOf({});

    expect(problems).toEqual([
      'DB_HOST is required but was not set',
      'DB_USER is required but was not set',
      'DB_PASSWORD is required but was not set',
      'DB_NAME is required but was not set',
      'DB_PORT is required but was not set',
      'JWT_SECRET is required but was not set',
    ]);
  });

  it('rejects a non-string value where a string is required', () => {
    const problems = problemsOf({ ...validSource(), DB_HOST: 127 });

    expect(problems).toEqual(['DB_HOST must be a string, received number']);
  });

  it('names itself in the error so the failure is attributable', () => {
    try {
      loadEnvironment({});
      expect.unreachable('loadEnvironment should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentError);
      expect((error as EnvironmentError).name).toBe('EnvironmentError');
      expect((error as EnvironmentError).message).toContain('6 problem(s)');
    }
  });
});
