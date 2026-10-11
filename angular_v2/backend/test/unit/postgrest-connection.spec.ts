import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPostgrestDbUri,
  PGRST_LOGIN_ROLE,
  postgrestChildEnv,
  PostgrestConnectionError,
  REQUIRED_COMPOSITION_KEYS,
  type EnvironmentSource,
} from '../../scripts/postgrest-connection.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * The shipped `.env.example` carried
 * `PGRST_DB_URI=postgresql://app:app@localhost:5432/app_dev`.
 *
 * `app` is the migration/owner role: it OWNS every table, so it is exempt from
 * every RLS policy on them and nothing errors when it is, and it is a member of
 * NONE of `app_anon` / `app_member` / `app_admin`, so the `SET ROLE` PostgREST
 * issues for the token's `role` claim is refused —
 * `42501 permission denied to set role "app_anon"`. Every data request failed
 * while `GET /` still answered **200**, so `dev.mjs`'s readiness probe went green
 * over a dead data layer and a forker following the documented setup never saw
 * it.
 *
 * The fix is that there is no `PGRST_DB_URI` to get wrong: it is composed, and
 * the role is a constant. These tests hold that line, including the failure the
 * fix could easily have introduced — a default password, which would put the
 * shipped defect back on any checkout whose `.env` is missing a key.
 */

const VALID: EnvironmentSource = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_NAME: 'app_dev',
  AUTHENTICATOR_PASSWORD: 'pgrst',
  PGRST_JWT_SECRET: 'a'.repeat(32),
};

function without(source: EnvironmentSource, key: string): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (name !== key && value !== undefined) {
      copy[name] = value;
    }
  }
  return copy;
}

function problemsOf(source: EnvironmentSource, build: (input: EnvironmentSource) => string = buildPostgrestDbUri): string[] {
  try {
    build(source);
  } catch (error) {
    if (error instanceof PostgrestConnectionError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error('the composition did not throw');
}

/**
 * The same problem-list extraction, for the child-environment builder. Separate
 * rather than parameterised because the two take different argument types and a
 * cast at each call site is exactly the kind of thing that goes stale.
 */
function childEnvProblemsOf(source: Record<string, string>): string[] {
  try {
    postgrestChildEnv(source);
  } catch (error) {
    if (error instanceof PostgrestConnectionError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error('the child environment was built when it should not have been');
}

/**
 * Reports a connection string that names a role other than the one PostgREST may
 * log in as, and the configurations that would let one be composed at all.
 *
 * A scanner rather than a comparison because the assertion has to be about the
 * executable shape: the whole defect was a *committed value*, so a test that only
 * ever built a correct URI in memory would have passed while `.env.example` still
 * shipped the broken one.
 */
export function connectionShapeFindings(uri: string): string[] {
  const findings: string[] = [];
  const parsed = new URL(uri);
  if (parsed.username !== PGRST_LOGIN_ROLE) {
    findings.push(`the login role is '${parsed.username}', not '${PGRST_LOGIN_ROLE}'`);
  }
  if (parsed.username === 'app') {
    findings.push('the login role is the migration/owner role, which bypasses its own RLS');
  }
  if (parsed.password === '') {
    findings.push('the password section is empty');
  }
  return findings;
}

describe('PostgREST connection composition', () => {
  it("builds a URI that logs in as pgrst_authenticator, never as the owner role 'app'", () => {
    const uri = buildPostgrestDbUri(VALID);
    const parsed = new URL(uri);

    expect(parsed.protocol).toBe('postgresql:');
    expect(parsed.username).toBe('pgrst_authenticator');
    expect(parsed.password).toBe('pgrst');
    expect(parsed.hostname).toBe('localhost');
    expect(parsed.port).toBe('5432');
    expect(parsed.pathname).toBe('/app_dev');

    // Spelled out rather than implied by the assertions above, because the failure
    // this prevents is specifically "the owner role reached the URI", and a future
    // edit that kept every other assertion true while swapping the user would
    // otherwise pass.
    expect(connectionShapeFindings(uri)).toEqual([]);
  });

  it('does not take the login role from the environment, so DB_USER and DB_PASSWORD cannot move it to the owner', () => {
    // The owner credentials are deliberately not read. A composition that reused
    // them would be correct on a cluster where the two roles happened to share a
    // password and silently wrong everywhere else — which is how two independent
    // values drifted apart in the first place.
    const uri = buildPostgrestDbUri({ ...VALID, DB_USER: 'app', DB_PASSWORD: 'app' });

    expect(new URL(uri).username).toBe(PGRST_LOGIN_ROLE);
    expect(uri).not.toContain(':app@');
  });

  it('reads AUTHENTICATOR_PASSWORD rather than a default, so two different passwords produce two different URIs', () => {
    // The capability proof for the "no fallback" case: if the implementation
    // defaulted the password, these two URIs would be identical and this test
    // would fail. A missing-key throw alone would not catch it.
    const first = buildPostgrestDbUri({ ...VALID, AUTHENTICATOR_PASSWORD: 'first-password' });
    const second = buildPostgrestDbUri({ ...VALID, AUTHENTICATOR_PASSWORD: 'second-password' });

    expect(first).not.toBe(second);
    expect(new URL(first).password).toBe('first-password');
    expect(new URL(second).password).toBe('second-password');
  });

  it('refuses to compose without AUTHENTICATOR_PASSWORD rather than emitting a URI with an empty password', () => {
    const problems = problemsOf(without(VALID, 'AUTHENTICATOR_PASSWORD'));

    expect(problems).toEqual(['AUTHENTICATOR_PASSWORD is required but was not set']);
  });

  it('treats an empty AUTHENTICATOR_PASSWORD as absent, the way every other key is treated', () => {
    expect(problemsOf({ ...VALID, AUTHENTICATOR_PASSWORD: '' })).toEqual([
      'AUTHENTICATOR_PASSWORD is required but was not set',
    ]);
  });

  it('names every absent key at once, so one edit fixes the configuration', () => {
    const problems = problemsOf({});

    expect(problems).toEqual(
      REQUIRED_COMPOSITION_KEYS.map((key) => `${key} is required but was not set`),
    );
  });

  it('refuses a DB_PORT that is not a port number, and reports what it received', () => {
    // One message for both shapes — non-numeric and out-of-range — because from
    // here the only useful fact is that the value is not a port and what it was.
    // `environment.ts` splits them for the thin app; duplicating that split would
    // be a second wording of one rule.
    expect(problemsOf({ ...VALID, DB_PORT: 'five thousand' })).toEqual([
      "DB_PORT must be an integer between 1 and 65535, received 'five thousand'",
    ]);
    expect(problemsOf({ ...VALID, DB_PORT: '70000' })).toEqual([
      "DB_PORT must be an integer between 1 and 65535, received '70000'",
    ]);
    expect(problemsOf({ ...VALID, DB_PORT: '0' })).toEqual([
      "DB_PORT must be an integer between 1 and 65535, received '0'",
    ]);
  });

  it('percent-encodes a password containing URI delimiters, because those delimiters end the userinfo section', () => {
    const password = 'p@ss:word/with#delimiters';
    const uri = buildPostgrestDbUri({ ...VALID, AUTHENTICATOR_PASSWORD: password });

    expect(uri).not.toContain('@ss');
    // `URL.password` is not decoded, so decode before comparing — what matters is
    // that the value round-trips to exactly what was configured.
    expect(decodeURIComponent(new URL(uri).password)).toBe(password);
    expect(new URL(uri).hostname).toBe('localhost');
    expect(new URL(uri).pathname).toBe('/app_dev');
  });

  it('errors are attributable: the class names itself and says there is no PGRST_DB_URI to add', () => {
    try {
      buildPostgrestDbUri({});
      expect.unreachable('buildPostgrestDbUri should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PostgrestConnectionError);
      expect((error as PostgrestConnectionError).name).toBe('PostgrestConnectionError');
      expect((error as PostgrestConnectionError).message).toContain('4 problem(s)');
      // The operator has to be told what to do, and the action is NOT "add
      // PGRST_DB_URI" — that is the advice the old error gave, and following it
      // reintroduced the defect.
      expect((error as PostgrestConnectionError).message).toContain('There is no PGRST_DB_URI to add');
      expect((error as PostgrestConnectionError).message).toContain('AUTHENTICATOR_PASSWORD');
    }
  });
});

describe('the environment PostgREST is spawned with', () => {
  it('discards an inherited PGRST_DB_URI, so a stale shell export cannot reinstate the owner role', () => {
    const env = postgrestChildEnv({
      ...VALID,
      PGRST_DB_URI: 'postgresql://app:app@localhost:5432/app_dev',
    });

    expect(new URL(env['PGRST_DB_URI'] ?? '').username).toBe('pgrst_authenticator');
    expect(env['PGRST_DB_URI']).not.toBe('postgresql://app:app@localhost:5432/app_dev');
  });

  it('deletes every inherited PGRST_* key rather than setting it to undefined, which spawn would stringify', () => {
    const env = postgrestChildEnv({ ...VALID, PGRST_SERVER_PORT: '3001', PGRST_DB_ANON_ROLE: 'app_anon' });

    expect(env['PGRST_SERVER_PORT']).toBeUndefined();
    expect(env['PGRST_DB_ANON_ROLE']).toBeUndefined();
    // Only the two this module owns survive, and both carry real values.
    expect(Object.keys(env).filter((key) => key.startsWith('PGRST_')).sort()).toEqual([
      'PGRST_DB_URI',
      'PGRST_JWT_SECRET',
    ]);
    expect(env['PGRST_DB_URI']).toBeDefined();
    expect(env['PGRST_JWT_SECRET']).toBe(VALID['PGRST_JWT_SECRET']);
  });

  it('refuses to build the child environment without PGRST_JWT_SECRET, rather than leaving PostgREST to reject every token', () => {
    expect(childEnvProblemsOf(without(VALID, 'PGRST_JWT_SECRET'))).toEqual([
      'PGRST_JWT_SECRET is required but was not set',
    ]);
  });

  it('reports a missing password and a missing secret together, not one at a time', () => {
    const problems = childEnvProblemsOf(without(without(VALID, 'AUTHENTICATOR_PASSWORD'), 'PGRST_JWT_SECRET'));

    expect(problems).toContain('AUTHENTICATOR_PASSWORD is required but was not set');
    expect(problems).toContain('PGRST_JWT_SECRET is required but was not set');
  });

  it('does not mutate the environment it was given', () => {
    const source: NodeJS.ProcessEnv = { ...VALID, PGRST_DB_URI: 'postgresql://app:app@localhost:5432/app_dev' };
    const before = JSON.stringify(source);

    postgrestChildEnv(source);

    expect(JSON.stringify(source)).toBe(before);
  });
});

describe('no committed file ships a PGRST_DB_URI to be wrong', () => {
  it('no .env* example carries PGRST_DB_URI, because a committed credential and a hand-written login role are both the defect', () => {
    const examples = readdirSync(BACKEND_ROOT).filter((entry) => entry.startsWith('.env') && entry.endsWith('.example'));

    expect(examples.length).toBeGreaterThan(0);

    const offenders = examples
      .filter((example) => /^PGRST_DB_URI=/m.test(readFileSync(join(BACKEND_ROOT, example), 'utf8')))
      .map((example) => `${example} sets PGRST_DB_URI`);

    expect(offenders).toEqual([]);
  });

  it('neither orchestrator reads PGRST_DB_URI from the environment; both compose it', () => {
    for (const script of ['dev.mjs', 'prod.mjs']) {
      const source = readFileSync(join(BACKEND_ROOT, 'scripts', script), 'utf8');

      expect(source, `${script} must compose the connection, not read one`).toContain(
        "from './postgrest-connection.ts'",
      );
      expect(source, `${script} must call postgrestChildEnv`).toContain('postgrestChildEnv(process.env)');
      // Any read of the variable at all is the regression, including a guarded one:
      // the value is composed, so there is nothing legitimate for it to say.
      expect(source.replace(/postgrestChildEnv/g, '')).not.toMatch(/PGRST_DB_URI\s*(?:=|,|\)|;|\})/);
      // …apart from the module doc comment, which names it to explain the absence.
      expect(source.replace(/^\s*\*.*$/gm, '')).not.toContain('PGRST_DB_URI');
    }
  });

  it('the scanners above fail on the shape they reject, so the empty results are not vacuous', () => {
    expect(connectionShapeFindings('postgresql://app:app@localhost:5432/app_dev')).not.toEqual([]);
    expect(connectionShapeFindings('postgresql://app_admin:app@localhost:5432/app_dev')).not.toEqual([]);
    expect(connectionShapeFindings('postgresql://pgrst_authenticator:@localhost:5432/app_dev')).not.toEqual([]);
    expect(connectionShapeFindings('postgresql://pgrst_authenticator:pgrst@localhost:5432/app_dev')).toEqual([]);
  });
});
