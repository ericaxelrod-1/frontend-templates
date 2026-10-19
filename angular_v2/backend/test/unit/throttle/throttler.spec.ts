import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * The rate limiter, proven against the REAL application: the real
 * `AppModule`, the real `ThrottlerGuard` from `@nestjs/throttler`, the real
 * `@Throttle` metadata on the real handlers, and the real configuration read
 * from the environment. Nothing about the limiter is mocked, faked or
 * reimplemented here — the guard is the library's, the numbers are the
 * configured ones, and the answers are the ones a client would receive.
 *
 * ## WHY THE DATABASE IS DELIBERATELY ABSENT
 *
 * `DB_NAME` below names a database that does not exist. Two reasons, and both
 * matter:
 *
 *   1. **The unit suite touches no developer's data.** `AGENTS.md` §B8 forbids
 *      pointing a test at working data, and the login path WRITES a row to
 *      `login_attempts` on every attempt. There is no throwaway database here
 *      because creating one needs `db:seed`, and a seeded database is minutes
 *      of work for a test that must not depend on a cluster at all.
 *   2. **The absence is the OBSERVABLE.** A login request that REACHES the
 *      handler cannot open a connection, so the handler answers `500`. A login
 *      request the LIMITER refuses answers `429` instead. The difference
 *      between the two answers is how the test knows the handler ran — which
 *      is the whole of "a refused request is not recorded as a failed login",
 *      since the `login_attempts` row is written inside the handler.
 *
 * So the suite needs no PostgreSQL, and it is honest about what it proves.
 *
 * ## EVERY TEST OWNS ITS OWN ADDRESS
 *
 * The counters are keyed on (route, source address), so two cases that used one
 * address would share a bucket and the second would fail for the first one's
 * reason. Each case below takes an address out of `TEST-NET-1`
 * (`192.0.2.0/24`, RFC 5737) — the range reserved for documentation, and a
 * different range from the one the e2e suites use, so the two can never
 * collide either. The order the cases run in is therefore irrelevant.
 */

/**
 * The limits this suite runs with.
 *
 * Small numbers, so the assertions are about the CONFIGURED limit rather than
 * about a hundred and twenty requests: the point of every case below is that
 * the number the client is told about is the number the deployment configured.
 */
const THROTTLE_ENV = {
  THROTTLE_LIMIT: '5',
  THROTTLE_TTL_SECONDS: '60',
  THROTTLE_CREDENTIAL_LIMIT: '3',
  THROTTLE_LINK_LIMIT: '2',
} as const;

const GLOBAL_LIMIT = 5;
const CREDENTIAL_LIMIT = 3;
const LINK_LIMIT = 2;

/** A database that does not exist. See the file header. */
const ABSENT_DATABASE = 'throttle_spec_absent';

/** The message a refused request carries. The library's default is not used. */
const REFUSAL_MESSAGE = 'too many requests from this network — wait before trying again';

/**
 * Booting `AppModule` compiles and initialises the whole graph, which on a
 * cold module registry is seconds — past vitest's 5s default. The same cost
 * and the same number are paid by `test/unit/breaker/breaker-wiring.spec.ts`.
 */
const BOOT_TIMEOUT = 60_000;

let app: NestFastifyApplication;
let moduleRef: TestingModule;

/**
 * The environment this suite changed, and what it was before.
 *
 * **Restored in `afterAll`**, because a suite that leaves `DB_NAME` pointing at a
 * database that does not exist has left a trap for the next one: a suite that
 * boots the application would inherit it, and a suite that reads a database
 * would read the wrong one. The pristine values are captured before anything
 * is changed, and an absent value is DELETED rather than set to an empty
 * string — the same rule `erasure-environment.spec.ts` applies.
 */
const PRISTINE = ['DB_NAME', ...Object.keys(THROTTLE_ENV)].map(
  (key) => [key, process.env[key]] as const,
);

beforeAll(async () => {
  // The environment is set BEFORE the application module is imported, because
  // the limiter's numbers are read at import time: `@Throttle(...)` is a
  // decorator, and a decorator is evaluated when the controller module is
  // imported. `process.loadEnvFile` does not overwrite a variable that is
  // already set, so these win over `.env.test` — the same precedence
  // `npm start` gets from `--env-file`.
  for (const [key, value] of Object.entries(THROTTLE_ENV)) {
    process.env[key] = value;
  }
  process.env['DB_NAME'] = ABSENT_DATABASE;

  const { AppModule } = await import('../../../src/app.module.js');
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // The login route answers `500` in this suite, on purpose (see the header).
  // The application's logger would print a stack trace for each of those, which
  // is noise in a suite whose failures are asserted, not read.
  app.useLogger(false);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, BOOT_TIMEOUT);

afterAll(async () => {
  try {
    await app?.close();
    await moduleRef?.close();
  } catch {
    // A teardown failure is not the assertion this suite makes.
  } finally {
    for (const [key, value] of PRISTINE) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

/** One request, from a named source address. */
function send(
  method: 'GET' | 'POST',
  url: string,
  address: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
    remoteAddress: address,
  });
}

/** A login body the validation pipe accepts, so the request reaches the handler. */
const LOGIN_BODY = { username: 'throttle-probe', password: 'a-password-of-no-consequence' };

describe('the limiter is registered globally, and the global limit applies', () => {
  it('is a global guard, ahead of the authentication guard', async () => {
    // A per-controller `@UseGuards` is not a limit: a new controller that
    // forgets the decorator is unthrottled, and the forgetting is invisible.
    // The assertion is on the list Nest itself built — the one the request
    // pipeline actually walks — and not on the provider map, because a
    // provider Nest never applied is exactly the failure this case catches.
    const { ApplicationConfig } = await import('@nestjs/core');
    const { ThrottlerGuard } = await import('@nestjs/throttler');
    const { JwtAuthGuard } = await import('../../../src/auth/jwt-auth.guard.js');

    const guards = moduleRef.get(ApplicationConfig, { strict: false }).getGlobalGuards();
    expect(guards.some((guard) => guard instanceof ThrottlerGuard)).toBe(true);
    expect(guards.some((guard) => guard instanceof JwtAuthGuard)).toBe(true);
    // The order is a decision: the limiter runs FIRST, so it sees the traffic
    // an unauthenticated caller sends. See `app.module.ts`.
    expect(guards[0]?.constructor.name).toBe('ThrottlerGuard');
  });

  it('answers 429 once the configured number of requests is exceeded', async () => {
    const address = '192.0.2.10';
    const statuses: number[] = [];
    let allowed: Awaited<ReturnType<typeof send>> | undefined;
    for (let attempt = 0; attempt < GLOBAL_LIMIT; attempt += 1) {
      const response = await send('GET', '/users/me', address);
      statuses.push(response.statusCode);
      allowed ??= response;
    }
    // Every request under the limit is answered by the authentication guard,
    // because the route is not public and no token is presented.
    expect(statuses).toEqual([401, 401, 401, 401, 401]);
    // The number the client is told about is the number that was configured.
    // The library sets the rate-limit headers on every request it HANDLETS,
    // and a refused request is thrown before they are set — so the number is
    // read from an admitted request, which is where a client reads it too.
    expect(allowed?.headers['x-ratelimit-limit']).toBe(String(GLOBAL_LIMIT));

    const refused = await send('GET', '/users/me', address);
    expect(refused.statusCode).toBe(429);
    // The shape is the one this application already answers a rate-limit
    // refusal with: `{ statusCode, message }`. The named Nest exceptions add
    // an `error` field, the plain `HttpException` does not, and the
    // per-address gate in `auth.service.ts` raises the same shape this does.
    expect(refused.json()).toEqual({ statusCode: 429, message: REFUSAL_MESSAGE });
    // `Retry-After` is the one header a refusal carries, and it is the one a
    // client needs: how long to wait.
    expect(refused.headers['retry-after']).toBeDefined();
  });

  it('answers a 429 that a client can tell from a 401', async () => {
    // The distinction the client needs: "slow down" and "that was the wrong
    // password" are different sentences, and a client that cannot tell them
    // apart retries a wrong password at full speed.
    const address = '192.0.2.11';
    const unauthorised = await send('GET', '/users/me', address);
    expect(unauthorised.statusCode).toBe(401);
    const unauthorisedBody = unauthorised.json<{ statusCode: number; message: string; error?: string }>();
    // The named Nest exceptions carry the `error` field; a plain
    // `HttpException` — which is what a rate-limit refusal is, in this
    // application and in the library — carries `{ statusCode, message }`. The
    // shape is the framework's, and the application already answers its other
    // rate-limit refusal (`auth.service.ts`, the per-address gate) this way.
    expect(unauthorisedBody).toEqual({
      statusCode: 401,
      message: 'unauthorized',
      error: 'Unauthorized',
    });

    for (let attempt = 0; attempt < GLOBAL_LIMIT; attempt += 1) {
      await send('GET', '/users/me', address);
    }
    const refused = await send('GET', '/users/me', address);
    const refusedBody = refused.json<{ statusCode: number; message: string }>();
    expect(refusedBody.statusCode).toBe(429);
    // Different in BOTH fields a client can read: the status and the sentence.
    expect(refusedBody.message).not.toBe(unauthorisedBody.message);
    expect(refusedBody.message).toBe(REFUSAL_MESSAGE);
  });
});

describe('the tightened routes are tighter than the global allowance', () => {
  it('limits the login route to the credential number', async () => {
    const address = '192.0.2.20';
    const statuses: number[] = [];
    let allowed: Awaited<ReturnType<typeof send>> | undefined;
    for (let attempt = 0; attempt < CREDENTIAL_LIMIT; attempt += 1) {
      const response = await send('POST', '/auth/login', address, LOGIN_BODY);
      statuses.push(response.statusCode);
      allowed ??= response;
    }
    // The requests under the limit reached the handler, which cannot open a
    // connection to the database that does not exist.
    expect(statuses).toEqual([500, 500, 500]);
    expect(allowed?.headers['x-ratelimit-limit']).toBe(String(CREDENTIAL_LIMIT));

    const refused = await send('POST', '/auth/login', address, LOGIN_BODY);
    expect(refused.statusCode).toBe(429);
  });

  it('limits the link route to the link number', async () => {
    const address = '192.0.2.21';
    let allowed: Awaited<ReturnType<typeof send>> | undefined;
    for (let attempt = 0; attempt < LINK_LIMIT; attempt += 1) {
      const response = await send('POST', '/auth/password-reset/request', address, {
        email: 'throttle-probe@example.test',
      });
      allowed ??= response;
    }
    expect(allowed?.headers['x-ratelimit-limit']).toBe(String(LINK_LIMIT));

    const refused = await send('POST', '/auth/password-reset/request', address, {
      email: 'throttle-probe@example.test',
    });
    expect(refused.statusCode).toBe(429);
  });

  it('states the numbers, rather than the presence of a decorator', async () => {
    // The assertion is on the numbers a client is told, and the comparison
    // between them. A test that asserted only that a decorator is present
    // would pass against a decorator carrying the global limit — which is the
    // same as no tightening at all.
    const global = await send('GET', '/users/me', '192.0.2.22');
    const credential = await send('POST', '/auth/login', '192.0.2.22', LOGIN_BODY);
    const link = await send('POST', '/auth/password-reset/request', '192.0.2.22', {
      email: 'throttle-probe@example.test',
    });

    const globalLimit = Number(global.headers['x-ratelimit-limit']);
    const credentialLimit = Number(credential.headers['x-ratelimit-limit']);
    const linkLimit = Number(link.headers['x-ratelimit-limit']);

    expect(globalLimit).toBe(GLOBAL_LIMIT);
    expect(credentialLimit).toBe(CREDENTIAL_LIMIT);
    expect(linkLimit).toBe(LINK_LIMIT);
    expect(credentialLimit).toBeLessThan(globalLimit);
    expect(linkLimit).toBeLessThan(globalLimit);
  });
});

describe('ThrottleSkip exempts the route it names', () => {
  it('does not limit GET /auth/me at all', async () => {
    const address = '192.0.2.30';
    const statuses: number[] = [];
    // Far more requests than the global allowance: a client that asks "is my
    // session still good?" on every navigation must not be refused.
    for (let attempt = 0; attempt < GLOBAL_LIMIT * 4; attempt += 1) {
      statuses.push((await send('GET', '/auth/me', address)).statusCode);
    }
    expect(statuses.every((status) => status === 401)).toBe(true);
    expect(statuses).not.toContain(429);
  });

  it('leaves no limiter headers on the exempt route, because the guard never touched it', async () => {
    // The stronger statement: the exempt route is not "counted and allowed" —
    // it is not counted at all. The library sets the rate-limit headers for
    // every throttler it HANDLES, so their absence is the proof.
    const exempt = await send('GET', '/auth/me', '192.0.2.31');
    expect(exempt.headers['x-ratelimit-limit']).toBeUndefined();

    const limited = await send('GET', '/users/me', '192.0.2.31');
    expect(limited.headers['x-ratelimit-limit']).toBe(String(GLOBAL_LIMIT));
  });
});

describe('a refused request is never recorded as a failed login', () => {
  it('does not reach the handler, and the handler is the only writer of the attempt', async () => {
    const address = '192.0.2.40';
    const statuses: number[] = [];
    for (let attempt = 0; attempt < CREDENTIAL_LIMIT; attempt += 1) {
      statuses.push((await send('POST', '/auth/login', address, LOGIN_BODY)).statusCode);
    }
    // Every request under the limit reached the handler: the handler cannot
    // open a connection to the database that does not exist, so it answers
    // `500`. The refused one is answered by the guard, and the answer CHANGED.
    expect(statuses).toEqual([500, 500, 500]);

    const refused = await send('POST', '/auth/login', address, LOGIN_BODY);
    expect(refused.statusCode).toBe(429);
    expect(refused.json<{ message: string }>().message).toBe(REFUSAL_MESSAGE);

    // The second half of the claim: the row is written by the handler and by
    // nothing else. `AuthService.gate()` is the only writer of a login attempt
    // in the application, and only the handler calls it — so a request the
    // guard refused cannot have written one, and the two limits cannot
    // compound (a caller who trips the address limit does not also spend a
    // unit of the account's failure budget).
    const writers = sourceFiles()
      .filter((file) => /INSERT\s+INTO\s+login_attempts/i.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(BACKEND_ROOT, file).replaceAll('\\', '/'));
    expect(writers).toEqual(['src/auth/auth.service.ts']);
  });
});

describe('the limits are per route and per key, so no two of them collide', () => {
  it('does not spend one route\'s budget on another', async () => {
    const address = '192.0.2.50';
    // Spend the login route's whole allowance…
    for (let attempt = 0; attempt < CREDENTIAL_LIMIT; attempt += 1) {
      await send('POST', '/auth/login', address, LOGIN_BODY);
    }
    // …and the link route is untouched by it.
    const link = await send('POST', '/auth/password-reset/request', address, {
      email: 'throttle-probe@example.test',
    });
    expect(link.statusCode).not.toBe(429);
    expect(link.headers['x-ratelimit-limit']).toBe(String(LINK_LIMIT));
  });

  it('does not spend one address\'s budget on another', async () => {
    const first = '192.0.2.60';
    const second = '192.0.2.61';
    for (let attempt = 0; attempt < GLOBAL_LIMIT; attempt += 1) {
      await send('GET', '/users/me', first);
    }
    expect((await send('GET', '/users/me', first)).statusCode).toBe(429);

    // A different source address is a different key, so it starts at zero.
    const other = await send('GET', '/users/me', second);
    expect(other.statusCode).toBe(401);
    expect(other.headers['x-ratelimit-limit']).toBe(String(GLOBAL_LIMIT));
  });

  it('counts the canonical address, so one host cannot be spelled two ways', async () => {
    // The two layers must agree on what "the same host" means, or a rotation
    // of the SPELLING of one address would spend the account budget while
    // splitting the address budget. `src/auth/ip-address.ts` is the canonical
    // form and the limiter keys on it.
    const address = '192.0.2.70';
    for (let attempt = 0; attempt < GLOBAL_LIMIT; attempt += 1) {
      await send('GET', '/users/me', address);
    }
    const spelledAnotherWay = await send('GET', '/users/me', `::ffff:${address}`);
    expect(spelledAnotherWay.statusCode).toBe(429);
  });
});

/** Every application source file, for the scans above. */
function sourceFiles(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.ts')) {
        found.push(path);
      }
    }
  };
  walk(join(BACKEND_ROOT, 'src'));
  return found.sort();
}

/**
 * Comments are stripped before a scan, for the reason
 * `test/unit/claims-write-surface.spec.ts` gives: the prose that explains why
 * a table is written where it is quotes the table, and a scanner that cannot
 * tell prose from a statement returns those lines and reads as a failure.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('//');
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join('\n');
}
