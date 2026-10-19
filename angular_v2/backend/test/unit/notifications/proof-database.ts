import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import { psqlAsSuperuser } from '../../support/cluster.js';
import { loadTestEnvironment } from '../../support/database.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * A throwaway database for the notification materialiser proof.
 *
 * ## WHY A DATABASE AND NOT THE CONFIGURED ONE
 *
 * `AGENTS.md` §B8: "Use a dedicated test database or a throwaway schema per suite;
 * never point tests at a developer's working data." The materialiser proof WRITES —
 * it inserts alerts, renders notifications and dismisses one — and `test/rls/support/fixture.ts`
 * reaches the same conclusion for the same reason, with the same `DROP DATABASE` and
 * the same "terminate the backends first" rule that §B8 also insists on.
 *
 * ## WHY THE SUITE CARRIES ITS OWN MIGRATIONS INSTEAD OF A `migrations` LEDGER
 *
 * `npm run migration:run` is **not run here, and must not be**: migrations in this
 * repository are applied centrally, and the proof database is not the central one. So
 * this fixture reads `database/migrations/*.sql` from disk and executes each file as
 * the owner role, which is exactly what `scripts/migrate.ts` does minus the ledger —
 * and that ledger is the only part a throwaway database does not need. It is also what
 * makes the proof honest: the SQL under test is the file that ships, read from the
 * repository, not a transcription of it.
 *
 * Roles are cluster-scoped and already exist, so `database/bootstrap/001_roles.sql`
 * is deliberately NOT applied: it would be `CREATE ROLE` against roles that are there.
 */

/** Distinct from `rls_proof`, which `test:rls` owns and which may be mid-drop. */
export const PROOF_DATABASE = 'notifications_proof';

/** The migration/owner role, which owns every table and never receives a request. */
const OWNING_ROLE = 'app';

const MIGRATIONS_DIR = join(BACKEND_ROOT, 'database', 'migrations');

/**
 * Recreate the proof database and apply every shipped migration to it.
 *
 * Applied TWICE on purpose, for the reason `test/rls/support/fixture.ts` applies
 * `0001` twice: "applies cleanly" and "is idempotent" are different claims, and a file
 * that has only ever run once has been shown to do neither. `0027` is the migration
 * this unit added, and a second application that fails on `CREATE TABLE` would mean the
 * RLS proof and this one disagree about what the schema tolerates.
 */
export async function rebuildProofDatabase(): Promise<void> {
  psqlAsSuperuser(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PROOF_DATABASE}' AND pid <> pg_backend_pid()`,
    'postgres',
  );
  psqlAsSuperuser(`DROP DATABASE IF EXISTS ${PROOF_DATABASE}`, 'postgres');
  psqlAsSuperuser(`CREATE DATABASE ${PROOF_DATABASE} OWNER ${OWNING_ROLE}`, 'postgres');

  for (const [pass, files] of [
    ['first', await migrationFiles()],
    ['second', await migrationFiles()],
  ] as const) {
    const client = await connectAs(loadTestEnvironment().database.user, loadTestEnvironment().database.password);
    try {
      for (const file of files) {
        await client.query(await readFile(file, 'utf8'));
      }
    } catch (error) {
      throw new Error(
        `applying migrations to ${PROOF_DATABASE} failed on the ${pass} pass: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      await client.end();
    }
  }
}

/**
 * Drop the proof database.
 *
 * `rebuildProofDatabase` creates it from nothing on every run, so without this each run
 * leaves a stale copy of a schema behind — and a leftover database is indistinguishable
 * from a correct one to whoever inspects the cluster next. Backends are terminated
 * first: a leaked client makes the `DROP` fail naming a connection the operator cannot
 * see (§B8).
 */
export function dropProofDatabase(): void {
  psqlAsSuperuser(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PROOF_DATABASE}' AND pid <> pg_backend_pid()`,
    'postgres',
  );
  psqlAsSuperuser(`DROP DATABASE IF EXISTS ${PROOF_DATABASE}`, 'postgres');
}

/**
 * A client for the single LOGIN role PostgREST and every writer in this application
 * connect as — the escalation boundary. Every write in the proof runs through it and
 * does `SET LOCAL ROLE app_admin`, which is the only way a write reaches
 * `admin_notifications`: that table's policy admits `app_admin` and admits nothing
 * else, and the branch keys on `current_user` rather than on any token field (§B2).
 *
 * **The migration/owner role is deliberately NOT offered.** It is a member of none of
 * the serving roles, so `SET LOCAL ROLE app_admin` from it fails with `42501` — which
 * is the escalation boundary doing its job, and is why seeding goes THROUGH the
 * boundary rather than around it (`0022`'s grants, `AGENTS.md` §B2: "Never disable
 * `row_security` to seed").
 */
export function authenticatorClient(): Promise<Client> {
  const env = loadTestEnvironment();
  return connectAs(env.authenticator.user, env.authenticator.password);
}

async function connectAs(user: string, password: string): Promise<Client> {
  const config = loadTestEnvironment().database;
  const client = new Client({
    host: config.host,
    port: config.port,
    user,
    password,
    database: PROOF_DATABASE,
  });
  await client.connect();
  return client;
}

/** Every UP migration, in the order `scripts/migrate.ts` would apply them. */
async function migrationFiles(): Promise<readonly string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries
    .filter((name) => /^\d{4,}_.*\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort()
    .map((name) => join(MIGRATIONS_DIR, name));
}