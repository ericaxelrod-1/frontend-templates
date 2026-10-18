import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  postgrestServerPort,
  resolveStackPorts,
  StackPortsError,
  ssrChildEnv,
  type StackPorts,
} from '../../scripts/stack-ports.js';
import type { EnvironmentSource } from '../../scripts/postgrest-connection.js';
import { BACKEND_ROOT, FRONTEND_ROOT, REPOSITORY_ROOT } from '../support/paths.js';

/**
 * The three ports of the stack are known in more than one place, and there is no
 * way to make that not so: three programs, three configuration mechanisms, and a
 * committed `postgrest.conf` that has to stay hand-maintained. What CAN be
 * arranged is that a disagreement is a red run rather than a 120-second timeout.
 *
 * Two halves, and they fail in different directions:
 *
 *   - **`resolveStackPorts` refuses** at launch, naming the keys. It is what turns
 *     a wrong port into one line of output instead of a child dying of
 *     `EADDRINUSE` and a shutdown message naming the readiness probe.
 *   - **the committed tree is checked against itself.** Three surfaces state a
 *     number — `backend/.env*.example`, `postgrest.conf`, and two literals in the
 *     frontend — and nothing at runtime compares the frontend's literals to the
 *     backend's configuration, because the frontend cannot read `postgrest.conf`
 *     and `postgrest.conf` is not a file the launchers write. A test is the only
 *     mechanism that spans them, and this repository already uses one for exactly
 *     this: `erasure-environment.spec.ts` and `retention-environment.spec.ts` scan
 *     the `.env*` files, and `postgrest-connection.spec.ts` reads the two
 *     orchestrators as text.
 *
 * **The live `.env` and `.env.test` are deliberately NOT part of the drift
 * check.** They are not committed, and a developer running the stack on other
 * ports is not drift — it is the feature. What a commit can break is the set of
 * committed examples, and the disagreement that matters in a real deployment is
 * caught at launch by `resolveStackPorts` itself, which reads the operator's file.
 */

const POSTGREST_CONF = readFileSync(join(REPOSITORY_ROOT, 'postgrest.conf'), 'utf8');

/** The env file examples, read rather than listed, so a new mode is covered. */
function exampleFiles(): readonly string[] {
  return readdirSync(BACKEND_ROOT)
    .filter((name) => name.startsWith('.env') && name.endsWith('.example'))
    .sort();
}

/** The one uncommented `KEY=value` line in a file, or `undefined`. */
function assigned(source: string, key: string): string | undefined {
  const line = source
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${key}=`));
  return line?.slice(key.length + 1);
}

function problemsOf(env: Record<string, string | undefined>, conf: string = POSTGREST_CONF): string[] {
  try {
    resolveStackPorts({ env, postgrestConf: conf });
  } catch (error) {
    if (error instanceof StackPortsError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error('resolveStackPorts did not throw');
}

/** A complete, correct source: one key varied at a time from here. */
function validEnv(overrides: Record<string, string | undefined> = {}): EnvironmentSource {
  return {
    PORT: '3000',
    SSR_PORT: '4000',
    POSTGREST_URL: 'http://127.0.0.1:3001',
    ...overrides,
  };
}

/** The ports a clean checkout with no configuration lands on. */
const DEFAULTS: StackPorts = resolveStackPorts({
  env: { POSTGREST_URL: `http://127.0.0.1:${String(postgrestServerPort(POSTGREST_CONF))}` },
  postgrestConf: POSTGREST_CONF,
});

describe('the ports a clean checkout with no configuration lands on', () => {
  it('is 3000 / 4000 / 3001, so `npm run dev` needs nothing set to run', () => {
    // The property the whole module is subordinate to: a fix that made the
    // deployer set three variables before anything runs would not be a fix.
    expect(DEFAULTS).toEqual({
      apiPort: 3000,
      ssrPort: 4000,
      postgrestPort: 3001,
      apiOrigin: 'http://127.0.0.1:3000',
      ssrOrigin: 'http://127.0.0.1:4000',
      postgrestOrigin: 'http://127.0.0.1:3001',
    });
  });

  it('reads the API port from PORT and the SSR port from SSR_PORT independently', () => {
    // The bug this exists for, stated as a passing case: one `PORT` used to move
    // both listeners, because both children inherited the backend's key.
    const ports = resolveStackPorts({
      env: validEnv({ PORT: '8443', SSR_PORT: '9443' }),
      postgrestConf: POSTGREST_CONF,
    });

    expect(ports.apiPort).toBe(8443);
    expect(ports.ssrPort).toBe(9443);
    expect(ports.apiOrigin).toBe('http://127.0.0.1:8443');
    expect(ports.ssrOrigin).toBe('http://127.0.0.1:9443');
    expect(ports.postgrestPort).toBe(3001);
  });

  it('treats an empty key as the documented default, the way the thin app does', () => {
    // Deliberately NOT a refusal. `readPort` in `src/config/environment.ts`
    // falls back to `DEFAULT_SERVER_PORT` for an empty `PORT`, and a launcher that
    // treated the same file differently would stop a checkout the app itself
    // starts. What it must not do is invent a THIRD answer.
    const ports = resolveStackPorts({
      env: { PORT: '', SSR_PORT: '', POSTGREST_URL: 'http://127.0.0.1:3001' },
      postgrestConf: POSTGREST_CONF,
    });

    expect(ports.apiPort).toBe(3000);
    expect(ports.ssrPort).toBe(4000);
  });
});

describe('a port that is not a port is refused before anything is spawned', () => {
  it('names the key and the value it received, for both keys', () => {
    expect(problemsOf(validEnv({ PORT: 'abc' }))).toEqual([
      "PORT must be an integer between 1 and 65535, received 'abc'",
    ]);
    expect(problemsOf(validEnv({ SSR_PORT: 'abc' }))).toEqual([
      "SSR_PORT must be an integer between 1 and 65535, received 'abc'",
    ]);
    expect(problemsOf(validEnv({ PORT: '0' }))[0]).toContain('PORT must be between 1 and 65535');
    expect(problemsOf(validEnv({ SSR_PORT: '70000' }))[0]).toContain('SSR_PORT must be between 1 and 65535');
    expect(() => resolveStackPorts({ env: validEnv({ PORT: 'abc' }), postgrestConf: POSTGREST_CONF })).toThrow(
      StackPortsError,
    );
  });

  it('refuses a port that is not a whole number rather than truncating it', () => {
    // `parseInt('8443abc')` is 8443. A value that parses to a port is not a port,
    // and this is the mistake that turns a configuration mistake into a listener
    // on a port nobody wrote down.
    expect(problemsOf(validEnv({ PORT: '8443abc' }))[0]).toContain('PORT must be an integer');
    expect(problemsOf(validEnv({ SSR_PORT: '40 00' }))[0]).toContain('SSR_PORT must be an integer');
  });

  it('reports every bad port at once, so one edit fixes the configuration', () => {
    expect(problemsOf(validEnv({ PORT: 'abc', SSR_PORT: 'def' }))).toHaveLength(2);
  });
});

describe('the PostgREST port comes from the file PostgREST reads', () => {
  it('parses `server-port` and refuses the three shapes that leave it unusable', () => {
    expect(postgrestServerPort(POSTGREST_CONF)).toBe(3001);

    // Absent: PostgREST would bind its own built-in default while the launcher
    // probed a port nobody configured — the 120-second timeout in its original form.
    expect(problemsOf(validEnv(), 'db-schemas = "public"').join('\n')).toContain('does not set `server-port`');
    // Malformed, and out of range.
    expect(problemsOf(validEnv(), 'server-port = three thousand').join('\n')).toContain(
      '`server-port = three thousand`',
    );
    expect(problemsOf(validEnv(), 'server-port = 70000').join('\n')).toContain('`server-port = 70000`');
  });

  it('is not fooled by a COMMENTED assignment, which is not a setting', () => {
    // `# server-port = 9999` reads as absent to PostgREST, so reading it as 9999
    // would aim the probe at a port the process will never bind. The committed
    // file is full of commented settings, so this is the shape it actually takes.
    const conf = '# server-port = 9999\nserver-port = 3001\n';

    expect(postgrestServerPort(conf)).toBe(3001);
  });
});

describe('the values that have to agree are checked against each other', () => {
  it('refuses a POSTGREST_URL that does not name the port postgrest.conf binds', () => {
    // The failure this closes: POSTGREST_URL moved to a new PostgREST port,
    // postgrest.conf did not, the stack started and reported itself ready, and
    // every account-scoped request failed — because the thin app calls PostgREST
    // on that URL and nothing in the launcher rewrites it.
    const problems = problemsOf(validEnv({ POSTGREST_URL: 'http://127.0.0.1:3002' }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('POSTGREST_URL names port 3002');
    expect(problems[0]).toContain('postgrest.conf binds PostgREST to 3001');
  });

  it('resolves an absent port section to the scheme default rather than to nothing', () => {
    // `http://127.0.0.1` IS port 80. Comparing `''` against 3001 would report a
    // disagreement the operator cannot act on without knowing why — or, worse,
    // would pass and let a URL that names no port through.
    expect(problemsOf(validEnv({ POSTGREST_URL: 'http://127.0.0.1:80' })).join('\n')).toContain(
      'POSTGREST_URL names port 80',
    );
    expect(problemsOf(validEnv({ POSTGREST_URL: 'http://127.0.0.1' })).join('\n')).toContain(
      'POSTGREST_URL names port 80',
    );
    expect(problemsOf(validEnv({ POSTGREST_URL: 'https://127.0.0.1' })).join('\n')).toContain(
      'POSTGREST_URL names port 443',
    );
    expect(problemsOf(validEnv({ POSTGREST_URL: 'not a url' })).join('\n')).toContain(
      'must be an absolute http(s) URL',
    );
  });

  it('refuses a missing POSTGREST_URL rather than skipping the check', () => {
    expect(problemsOf(validEnv({ POSTGREST_URL: '' }))[0]).toContain('POSTGREST_URL is required');
  });

  it('refuses two listeners configured for one port, naming both keys', () => {
    // The collision that used to surface as a child dying of `EADDRINUSE` and a
    // shutdown message naming neither key.
    const problems = problemsOf(validEnv({ PORT: '4000' }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('PORT (the thin app) and SSR_PORT (the Angular SSR server)');
    expect(problems[0]).toContain('port 4000');
  });

  it('names PostgREST in a collision too, because its key lives in another file', () => {
    const problems = problemsOf(validEnv({ PORT: '3001' }));

    expect(problems[0]).toContain('PORT (the thin app)');
    expect(problems[0]).toContain('server-port in postgrest.conf (PostgREST)');
  });

  it('the errors are attributable and say where the values are configured', () => {
    let thrown: unknown;
    try {
      resolveStackPorts({ env: validEnv({ PORT: 'abc' }), postgrestConf: POSTGREST_CONF });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StackPortsError);
    expect((thrown as StackPortsError).name).toBe('StackPortsError');
    expect((thrown as StackPortsError).message).toContain('PORT and SSR_PORT');
    expect((thrown as StackPortsError).message).toContain('postgrest.conf');
  });
});

describe('the environment the SSR child is spawned with', () => {
  const env: NodeJS.ProcessEnv = {
    PORT: '8443',
    SSR_PORT: '9443',
    API_ORIGIN: 'http://stale:1',
    POSTGREST_ORIGIN: 'http://stale:2',
    JWT_SECRET: 'kept',
  };

  it('deletes PORT, which is the thin app\'s key and reached this process by accident', () => {
    // The mechanism. `PORT` used to be inherited from backend/.env by both
    // children, so one key named two listeners; the second to arrive died of
    // EADDRINUSE and the shutdown message named neither.
    const child = ssrChildEnv(env, DEFAULTS);

    expect(child['PORT']).toBeUndefined();
    expect(child['SSR_PORT']).toBe('4000');
  });

  it('answers both proxy targets from the resolved stack, overriding a stale value', () => {
    const moved = resolveStackPorts({
      env: validEnv({ PORT: '8443', SSR_PORT: '9443' }),
      postgrestConf: POSTGREST_CONF,
    });
    const child = ssrChildEnv(env, moved);

    expect(child['API_ORIGIN']).toBe('http://127.0.0.1:8443');
    expect(child['POSTGREST_ORIGIN']).toBe('http://127.0.0.1:3001');
    expect(child['SSR_PORT']).toBe('9443');
  });

  it('carries the rest of the environment through, and does not mutate its source', () => {
    const before = JSON.stringify(env);

    const child = ssrChildEnv(env, DEFAULTS);

    expect(child['JWT_SECRET']).toBe('kept');
    expect(JSON.stringify(env)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The drift gate: the committed copies of each number, held against each other.
// ---------------------------------------------------------------------------

describe('no committed file states a port that another committed file contradicts', () => {
  it('every .env* example assigns PORT, SSR_PORT and POSTGREST_URL to the resolved ports', () => {
    const files = exampleFiles();
    expect(files.length, 'the .env* example files were not found; this would be vacuous').toBeGreaterThanOrEqual(4);

    for (const file of files) {
      const source = readFileSync(join(BACKEND_ROOT, file), 'utf8');

      for (const key of ['PORT', 'SSR_PORT', 'POSTGREST_URL']) {
        expect(assigned(source, key), `${file} does not assign ${key}`).toBeDefined();
      }
      expect(assigned(source, 'PORT'), `${file} disagrees with the resolved API port`).toBe(
        String(DEFAULTS.apiPort),
      );
      expect(assigned(source, 'SSR_PORT'), `${file} disagrees with the resolved SSR port`).toBe(
        String(DEFAULTS.ssrPort),
      );
      expect(
        new URL(assigned(source, 'POSTGREST_URL') ?? '').port,
        `${file} disagrees with \`server-port\` in postgrest.conf`,
      ).toBe(String(DEFAULTS.postgrestPort));
    }
  });

  // `frontend/proxy.conf.json` is a FOURTH file naming these ports, and it is
  // deliberately not asserted here. It is not drift, and the distinction is
  // worth stating rather than leaving to the next reader who greps for `3000`
  // and finds one they were not told about:
  //
  //   It belongs to `ng serve` (`npm start`), which reads NEITHER
  //   `backend/.env` NOR `postgrest.conf`. It has no shared configuration
  //   surface to agree with, so asserting it against `postgrest.conf` would
  //   compare two unrelated configurations and fail for a deployer who moved
  //   the ports and does not use that path. Every file gated above is gated
  //   because it participates in the SAME stack as the launchers; this one
  //   starts a different stack.
  //
  // The cost of that choice, stated plainly: a developer who moves all three
  // ports and then runs `npm start` gets a proxy aimed at 3000/3001 and a
  // confusing failure, rather than a clear one. That is acceptable because
  // `npm run dev` is the documented path and it now refuses at launch with both
  // numbers named. If a future change makes `proxy.conf.json` env-driven, gate
  // it here and delete this comment.

  it('the frontend\'s proxy defaults name the ports the stack resolves', () => {
    // `api-proxy.ts` is the last two copies. It cannot read `postgrest.conf` —
    // it is a different project, and the file is a PostgreSQL server's
    // configuration — and the launchers now override both values, so the literals
    // are only what a standalone `npm run serve:ssr:frontend` gets. That is
    // exactly why they still have to be right.
    const source = readFileSync(join(FRONTEND_ROOT, 'src', 'server', 'api-proxy.ts'), 'utf8');

    expect(source).toContain(`'http://127.0.0.1:${String(DEFAULTS.apiPort)}'`);
    expect(source).toContain(`'http://127.0.0.1:${String(DEFAULTS.postgrestPort)}'`);
  });

  it('the SSR server reads SSR_PORT, and its default is the resolved default', () => {
    const source = readFileSync(join(FRONTEND_ROOT, 'src', 'server.ts'), 'utf8');
    const configured = /process\.env\['SSR_PORT'\] \?\? '(\d+)'/.exec(source);

    expect(configured, 'server.ts does not read SSR_PORT with a literal default').not.toBeNull();
    expect(configured?.[1], 'server.ts\'s SSR_PORT default has drifted from stack-ports.ts').toBe(
      String(DEFAULTS.ssrPort),
    );
    // The regression this guards is a key, not a number: with `PORT` in that
    // expression the SSR server again follows the thin app's port.
    expect(source).not.toMatch(/process\.env\['PORT'\]/);
  });
});

describe('neither orchestrator names a port', () => {
  const ORCHESTRATORS = ['dev.mjs', 'prod.mjs'] as const;

  /** The file with its comments removed, so prose about ports is not a literal. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  }

  function codeOf(script: string): string {
    return stripComments(readFileSync(join(BACKEND_ROOT, 'scripts', script), 'utf8'));
  }

  it.each(ORCHESTRATORS)('%s resolves its ports instead of writing one down', (script) => {
    const code = codeOf(script);

    // `127.0.0.1:3001` in a probe is the 120-second timeout this removed; the
    // general shape catches `localhost:4000` in a banner and every port that has
    // not been invented yet.
    expect(code, `${script} still carries a port literal`).not.toMatch(/:\d{4,}\b/);
    expect(code).toContain("from './stack-ports.ts'");
    expect(code).toContain('resolveStackPorts(');
    expect(code).toContain('ssrChildEnv(process.env, stackPorts)');
  });

  it('the scanner above is not vacuous: it finds a port when there is one', () => {
    // A scanner that matches nothing is indistinguishable from a clean tree, and
    // this file's entire value is that it goes red.
    const probe = `
  await waitFor('http://127.0.0.1:3001/', 'postgrest', c);
`;

    expect(stripComments(probe)).toMatch(/:\d{4,}\b/);
    expect(stripComments("console.log('http://localhost:4000');")).toMatch(/:\d{4,}\b/);
    expect(codeOf('dev.mjs')).not.toMatch(/:\d{4,}\b/);
  });

  it('both orchestrators hand PostgREST the very file they resolved the port from', () => {
    // Two different files would resolve the port from one and probe the other,
    // and the disagreement would be a 120-second timeout rather than an error.
    for (const script of ORCHESTRATORS) {
      const code = codeOf(script);

      expect(code, `${script} must spawn PostgREST with the file it parsed`).toContain(
        "start('postgrest', 'postgrest', [postgrestConfPath]",
      );
      expect(code, `${script} must read the port from the same path`).toContain(
        'readFileSync(postgrestConfPath,',
      );
    }
  });
});