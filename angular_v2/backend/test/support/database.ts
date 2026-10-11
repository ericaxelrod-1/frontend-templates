import '../../src/config/load-env-file.js';
import { loadEnvironment, type DatabaseConfig, type Environment } from '../../src/config/environment.js';

let cached: Environment | undefined;

/**
 * The environment for tests: `backend/.env.test` through the same loader the
 * application uses (the test scripts set NODE_ENV=test). The development
 * `backend/.env` is never read from a test. A missing file is not swallowed —
 * `loadEnvironment` then throws and names every key that is absent.
 */
export function loadTestEnvironment(): Environment {
  cached ??= loadEnvironment(process.env);
  return cached;
}

export function databaseConfig(): DatabaseConfig {
  return loadTestEnvironment().database;
}
