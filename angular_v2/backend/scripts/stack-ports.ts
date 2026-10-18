/**
 * The three ports of the stack, resolved ONCE, from configuration.
 *
 * ## Why this module exists
 *
 * The stack is three programs configured by three different mechanisms, and each
 * port was therefore known in three or four places. `PORT=8443` moved the thin
 * app; the Angular SSR server read the same `PORT` and moved with it; and the
 * launcher — which had every one of the three values in hand — went on polling
 * `http://127.0.0.1:4000/` for 120 seconds and then took the whole stack down
 * with it. Nothing said what was wrong.
 *
 * The values cannot be collapsed into one file, and the constraints say why:
 *
 *   - `postgrest.conf` is hand-maintained, committed and secret-free. PostgREST
 *     reads it, and only PostgREST reads it, so **parsing it is the honest
 *     answer** for its port. The alternative — taking it from `postgrestEnv` —
 *     does not exist: `postgrestChildEnv` deliberately DELETES every inherited
 *     `PGRST_*` key so a stale `PGRST_SERVER_PORT` in a shell cannot outrank the
 *     committed file (PostgREST gives the environment precedence over the file),
 *     and re-introducing one to carry a port would put the same port in two
 *     places with the loser's precedence decided by a rule nobody remembers.
 *   - `PORT` is the thin app's key and belongs to `backend/.env`, which is where
 *     the app already reads it from.
 *   - The SSR server is a separate project, started by these launchers, which
 *     therefore hand it its port explicitly.
 *
 * So there are three configuration SURFACES and one resolver. Every refusal here
 * is a refusal at launch, before a child is spawned, and it names every problem
 * at once (§2.3): a wrong port used to become a 120-second timeout and a
 * shutdown with a line that pointed at the readiness probe rather than at the
 * value that was wrong.
 *
 * Bind addresses are NOT configuration and do not appear as configuration: every
 * origin below is loopback, because that is where all three listeners bind, and
 * nothing here can move one off-box (`645196f`).
 */

import type { EnvironmentSource } from './postgrest-connection.ts';

/**
 * The loopback address all three listeners bind, reused for the origins the
 * launchers probe and hand to the SSR child. A constant, not an option: the
 * reverse proxy in front of the stack is what is reachable from elsewhere.
 */
export const LOOPBACK_HOST = '127.0.0.1';

/**
 * Matches one PostgREST setting, capturing the WHOLE value rather than its first
 * token: a refusal that quotes `server-port = three thousand` as `three` names
 * a value nobody wrote. `^[ \t]*` rather than `\s*` so the multiline anchor
 * cannot start on a blank line, and no `#` anywhere in the pattern, so a
 * COMMENTED assignment (`# server-port = 9999`) never reads as a setting — the
 * same rule `erasure-environment.spec.ts` asserts for `.env*` files, where
 * `process.loadEnvFile` likewise skips a `#` line entirely.
 */
const SERVER_PORT_SETTING = /^[ \t]*server-port[ \t]*=[ \t]*(.+?)[ \t]*$/m;

const MINIMUM_PORT = 1;
const MAXIMUM_PORT = 65535;

/**
 * A source of environment values — the same type `postgrest-connection.ts`
 * passes and tests construct, rather than a second spelling of it (§2.4).
 */
export type StackPorts = {
  readonly apiPort: number;
  readonly ssrPort: number;
  readonly postgrestPort: number;
  readonly apiOrigin: string;
  readonly ssrOrigin: string;
  readonly postgrestOrigin: string;
};

/**
 * Raised for anything that stops the stack's ports from being known before it is
 * spawned. Carries the whole problem list, because an operator who has never
 * seen this error should be able to fix all of it in one edit (§2.3).
 */
export class StackPortsError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `The stack's ports are not usable (${String(problems.length)} problem(s)): ${problems.join('; ')}. ` +
        'All three are configuration: PORT and SSR_PORT live in the backend env file this command loaded ' +
        '(backend/.env, or backend/.env.production under npm run prod), and the PostgREST port is ' +
        '`server-port` in postgrest.conf, which PostgREST reads and this command does not write.',
    );
    this.name = 'StackPortsError';
    this.problems = [...problems];
  }
}

/**
 * One port, from a key that may be absent.
 *
 * The bound is checked here rather than borrowed from `environment.ts` for two
 * reasons, and the first is the load-bearing one: this runs in the LAUNCHER, and
 * a configuration failure found before a child is spawned costs one line of
 * output, while the same failure found after `spawn` costs a half-started stack
 * whose log points at the program that rejected it. The second is that
 * `postgrest-connection.ts` already validates `DB_PORT` for exactly this reason,
 * in its own wording — a shared validator across three processes would be a
 * second thing to keep in step for no behavioural gain.
 */
function readPort(
  source: EnvironmentSource,
  key: string,
  fallback: number,
  problems: string[],
): number | undefined {
  const raw = source[key];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    problems.push(`${key} must be an integer between ${String(MINIMUM_PORT)} and ${String(MAXIMUM_PORT)}, received '${raw}'`);
    return undefined;
  }
  const port = Number.parseInt(raw, 10);
  if (port < MINIMUM_PORT || port > MAXIMUM_PORT) {
    problems.push(`${key} must be between ${String(MINIMUM_PORT)} and ${String(MAXIMUM_PORT)}, received '${raw}'`);
    return undefined;
  }
  return port;
}

/**
 * The port `postgrest.conf` binds, read from the file PostgREST is about to be
 * given.
 *
 * Throws rather than defaulting. `server-port` absent is not "use 3001": it is a
 * PostgREST that starts on its own built-in default while the launcher probes a
 * port nobody configured, which is the 120-second timeout this module exists to
 * remove.
 */
export function postgrestServerPort(postgrestConf: string): number {
  const matched = SERVER_PORT_SETTING.exec(postgrestConf);
  if (matched === null) {
    throw new StackPortsError([
      'postgrest.conf does not set `server-port`, so the port the launcher would probe is not configured ' +
        'anywhere: PostgREST would bind its own built-in default and the readiness probe would poll a ' +
        'port nobody chose',
    ]);
  }
  const raw = matched[1] ?? '';
  if (!/^\d+$/.test(raw) || Number.parseInt(raw, 10) < MINIMUM_PORT || Number.parseInt(raw, 10) > MAXIMUM_PORT) {
    throw new StackPortsError([
      `postgrest.conf sets \`server-port = ${raw}\`, which is not an integer between ${String(MINIMUM_PORT)} and ${String(MAXIMUM_PORT)}`,
    ]);
  }
  return Number.parseInt(raw, 10);
}

/**
 * The port a URL names, resolving an absent `:`-section to the scheme's default
 * rather than to `undefined` — `http://127.0.0.1` is port 80, and comparing it
 * against anything else is the whole disagreement being looked for.
 */
function portOf(raw: string): number | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.port !== '') {
    return Number.parseInt(parsed.port, 10);
  }
  return parsed.protocol === 'https:' ? 443 : 80;
}

/**
 * Resolves all three ports, or throws naming every way they are unusable.
 *
 * The checks are the three failures that used to be silent, in the order an
 * operator meets them:
 *
 *   1. a value that is not a port (the app would refuse it too, but only after a
 *      child was spawned and a build had run);
 *   2. `POSTGREST_URL` naming a port `postgrest.conf` does not bind — the thin app
 *      calls PostgREST on that URL and nothing in the launcher rewrites it, so the
 *      disagreement surfaces on the first account-scoped request instead of at
 *      launch;
 *   3. two of the three on one port — which cannot work, and used to surface as a
 *      child dying of `EADDRINUSE` and a shutdown message naming the wrong cause.
 */
export function resolveStackPorts(input: {
  readonly env: EnvironmentSource;
  readonly postgrestConf: string;
}): StackPorts {
  const problems: string[] = [];

  let postgrestPort: number | undefined;
  try {
    postgrestPort = postgrestServerPort(input.postgrestConf);
  } catch (error) {
    if (error instanceof StackPortsError) {
      problems.push(...error.problems);
    } else {
      throw error;
    }
  }

  // `3000` is `DEFAULT_SERVER_PORT` in `src/config/environment.ts`, which is what
  // the thin app itself falls back to; `4000` is what `frontend/src/server.ts`
  // falls back to. Both are duplicated on purpose — a clean checkout with no
  // configuration has to land on 3000/3001/4000 — and both are held together by
  // `test/unit/stack-ports.spec.ts` rather than by a mechanism that would have to
  // be configured before anything could run.
  const apiPort = readPort(input.env, 'PORT', 3000, problems);
  const ssrPort = readPort(input.env, 'SSR_PORT', 4000, problems);

  const postgrestUrl = input.env['POSTGREST_URL'];
  if (postgrestUrl === undefined || postgrestUrl === '') {
    problems.push(
      'POSTGREST_URL is required but was not set: the thin app calls PostgREST on it, so the launcher ' +
        'cannot check it against postgrest.conf',
    );
  } else if (postgrestPort !== undefined) {
    const configured = portOf(postgrestUrl);
    if (configured === undefined) {
      problems.push(`POSTGREST_URL must be an absolute http(s) URL, received '${postgrestUrl}'`);
    } else if (configured !== postgrestPort) {
      problems.push(
        `POSTGREST_URL names port ${String(configured)} but postgrest.conf binds PostgREST to ` +
          `${String(postgrestPort)}: the thin app calls PostgREST on POSTGREST_URL and nothing rewrites it, ` +
          'so every account-scoped request would fail after the stack reported itself ready',
      );
    }
  }

  // Only compare what resolved, so a malformed value is reported once rather than
  // as a typo's worth of disagreements on top of it.
  const resolved: ReadonlyArray<readonly [string, number | undefined]> = [
    ['PORT (the thin app)', apiPort],
    ['SSR_PORT (the Angular SSR server)', ssrPort],
    ['server-port in postgrest.conf (PostgREST)', postgrestPort],
  ];
  const claimed = new Map<number, string>();
  for (const [name, port] of resolved) {
    if (port === undefined) {
      continue;
    }
    const holder = claimed.get(port);
    if (holder !== undefined) {
      problems.push(
        `${holder} and ${name} are both configured for port ${String(port)}: one of them cannot bind, ` +
          'and the process that loses the race exits with a cause that names neither key',
      );
    } else {
      claimed.set(port, name);
    }
  }

  if (problems.length > 0 || apiPort === undefined || ssrPort === undefined || postgrestPort === undefined) {
    throw new StackPortsError(problems);
  }

  const origin = (port: number): string => `http://${LOOPBACK_HOST}:${String(port)}`;
  return {
    apiPort,
    ssrPort,
    postgrestPort,
    apiOrigin: origin(apiPort),
    ssrOrigin: origin(ssrPort),
    postgrestOrigin: origin(postgrestPort),
  };
}

/**
 * The environment the Angular SSR child is spawned with.
 *
 * Three things happen here and nowhere else, because they are the seam between
 * the stack's configuration and a process that has none of it:
 *
 *   - `PORT` is DELETED. It is the thin app's key, read from the backend env
 *     file the launcher just loaded, and the SSR server used to read the same
 *     key — so the two children inherited one `PORT` and competed for one port.
 *     The deployer can no longer move one and accidentally move the other, and
 *     the failure that produced (a child dying of `EADDRINUSE` while the launcher's
 *     probe sat on a third port) is no longer expressible.
 *   - `SSR_PORT` is set to the resolved port. This is the key
 *     `frontend/src/server.ts` reads, and it is the only way the SSR server's
 *     port is ever configured.
 *   - `API_ORIGIN` and `POSTGREST_ORIGIN` are set from the resolved ports, which
 *     is what retires the last two copies: the SSR server's proxy targets are
 *     answered by the stack that started it, so pointing the stack at other
 *     ports needs no rebuild. The defaults in `api-proxy.ts` remain as the
 *     standalone-run fallback and are held to these values by
 *     `test/unit/stack-ports.spec.ts`.
 *
 * The source is not mutated; `postgrestChildEnv` makes the same promise.
 */
export function ssrChildEnv(env: NodeJS.ProcessEnv, ports: StackPorts): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = { ...env };
  delete child['PORT'];
  child['SSR_PORT'] = String(ports.ssrPort);
  child['API_ORIGIN'] = ports.apiOrigin;
  child['POSTGREST_ORIGIN'] = ports.postgrestOrigin;
  return child;
}