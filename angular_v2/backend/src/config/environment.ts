/**
 * Typed, validated process environment.
 *
 * Every key this application depends on is read here, once. A missing or
 * malformed value is a hard error: there is no default fallback for a database
 * coordinate and no default for the JWT signing secret. `loadEnvironment`
 * throws with the complete list of problems rather than the first one, so a
 * misconfigured checkout is fixed in one pass.
 */

export const MINIMUM_JWT_SECRET_LENGTH = 32;

export type DatabaseConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
};

export type JwtConfig = {
  readonly secret: string;
};

export type ServerConfig = {
  readonly port: number;
};

export type Environment = {
  readonly database: DatabaseConfig;
  readonly jwt: JwtConfig;
  readonly server: ServerConfig;
};

export const DEFAULT_SERVER_PORT = 3000;

const DATABASE_KEYS = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'] as const;

const MINIMUM_PORT = 1;
const MAXIMUM_PORT = 65535;

export class EnvironmentError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `The environment is not usable. ${problems.length} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
    this.name = 'EnvironmentError';
    this.problems = problems;
  }
}

function readString(
  source: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null || value === '') {
    problems.push(`${key} is required but was not set`);
    return undefined;
  }
  if (typeof value !== 'string') {
    problems.push(`${key} must be a string, received ${typeof value}`);
    return undefined;
  }
  return value;
}

function readPort(
  source: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
  fallback: number | undefined,
): number | undefined {
  const raw = source[key];
  if (raw === undefined || raw === null || raw === '') {
    if (fallback === undefined) {
      problems.push(`${key} is required but was not set`);
      return undefined;
    }
    return fallback;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    problems.push(`${key} must be an integer, received ${typeof raw}`);
    return undefined;
  }
  const text = String(raw);
  if (!/^\d+$/.test(text)) {
    problems.push(`${key} must be an integer between ${MINIMUM_PORT} and ${MAXIMUM_PORT}, received '${text}'`);
    return undefined;
  }
  const port = Number.parseInt(text, 10);
  if (port < MINIMUM_PORT || port > MAXIMUM_PORT) {
    problems.push(`${key} must be between ${MINIMUM_PORT} and ${MAXIMUM_PORT}, received '${text}'`);
    return undefined;
  }
  return port;
}

function readDatabase(
  source: Readonly<Record<string, unknown>>,
  problems: string[],
): DatabaseConfig | undefined {
  const values: Partial<Record<(typeof DATABASE_KEYS)[number], string | undefined>> = {};
  for (const key of DATABASE_KEYS) {
    if (key === 'DB_PORT') {
      continue;
    }
    values[key] = readString(source, key, problems);
  }
  const port = readPort(source, 'DB_PORT', problems, undefined);

  const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = values;
  if (
    DB_HOST === undefined ||
    DB_USER === undefined ||
    DB_PASSWORD === undefined ||
    DB_NAME === undefined ||
    port === undefined
  ) {
    return undefined;
  }
  return { host: DB_HOST, port, user: DB_USER, password: DB_PASSWORD, database: DB_NAME };
}

function readJwt(
  source: Readonly<Record<string, unknown>>,
  problems: string[],
): JwtConfig | undefined {
  const secret = readString(source, 'JWT_SECRET', problems);
  if (secret === undefined) {
    return undefined;
  }
  if (secret.length < MINIMUM_JWT_SECRET_LENGTH) {
    problems.push(
      `JWT_SECRET must be at least ${MINIMUM_JWT_SECRET_LENGTH} characters, received ${secret.length}`,
    );
    return undefined;
  }
  const postgrestSecret = source['PGRST_JWT_SECRET'];
  if (postgrestSecret !== undefined && postgrestSecret !== null && postgrestSecret !== '') {
    if (postgrestSecret !== secret) {
      problems.push(
        'PGRST_JWT_SECRET must equal JWT_SECRET: PostgREST and the thin app verify the same secret, and divergent values issue tokens that the API layer refuses',
      );
    }
  }
  return { secret };
}

export function loadEnvironment(source: Readonly<Record<string, unknown>>): Environment {
  const problems: string[] = [];
  const database = readDatabase(source, problems);
  const jwt = readJwt(source, problems);
  const server = readPort(source, 'PORT', problems, DEFAULT_SERVER_PORT);
  const serverConfig = server === undefined ? undefined : { port: server };

  if (database !== undefined && jwt !== undefined && serverConfig !== undefined) {
    return { database, jwt, server: serverConfig };
  }
  throw new EnvironmentError(problems);
}
