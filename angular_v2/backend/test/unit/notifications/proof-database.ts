import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import { CLUSTER_SUPERUSER, psqlAsSuperuser } from '../../support/cluster.js';
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

/**
 * A second throwaway database, for the consent proof.
 *
 * `NOT` a second implementation: `rebuildProofDatabase` and friends take the
 * database name as a parameter for exactly this reason. Vitest runs spec files in
 * parallel, so two files sharing one database would have each file's `beforeAll`
 * drop the other's schema mid-run — a failure that reads as a schema bug and is
 * a harness bug.
 */
export const CONSENT_PROOF_DATABASE = 'consent_proof';

/**
 * A third throwaway database, for the consent PURGE proof.
 *
 * The same reason as the second one: Vitest runs spec files in parallel, and a
 * database shared by two files has each file's `beforeAll` drop the other's schema
 * mid-run — a failure that reads as a schema bug and is a harness bug.
 */
export const CONSENT_PURGE_PROOF_DATABASE = 'consent_purge_proof';

/**
 * A fourth, for the administration proof over the two authorization axes.
 *
 * The same reason as the others, and one more: this suite WRITES to `groups` and to
 * `user_groups`, and it must be able to force a cycle attempt and see the database
 * refuse it. A refused statement is still a statement against real rows, so the
 * database it runs against has to be one this suite owns.
 */
export const AUTHORIZATION_PROOF_DATABASE = 'authorization_proof';

/**
 * A fifth, for the CAPTCHA proof.
 *
 * The same reason as the others: Vitest runs spec files in parallel, and this
 * suite WRITES to `public.captcha` — it mints challenges, spends them and reads
 * the rows back to prove the digest is all that is stored.
 */
export const CAPTCHA_PROOF_DATABASE = 'captcha_proof';

/**
 * A sixth, for the login gate's challenge decision.
 *
 * The same reason as the others: this suite writes `login_attempts` rows to put
 * an account over the threshold, and it must not share a database with the
 * challenge proof — Vitest runs spec files in parallel, and one file's
 * `beforeAll` would drop the other's schema mid-run.
 */
export const LOGIN_CAPTCHA_PROOF_DATABASE = 'login_captcha_proof';

/**
 * A seventh, for the security-telemetry proof.
 *
 * The same reason as the others, and one more: this suite WRITES to all four
 * security-telemetry tables and reads them back, and it boots the real
 * application to do it — so it must not share a database with another suite.
 */
export const SECURITY_TELEMETRY_PROOF_DATABASE = 'security_telemetry_proof';

/** The migration/owner role, which owns every table and never receives a request. */
const OWNING_ROLE = 'app';

const MIGRATIONS_DIR = join(BACKEND_ROOT, 'database', 'migrations');

/**
 * Recreate a proof database and apply every shipped migration to it.
 *
 * Applied TWICE on purpose, for the reason `test/rls/support/fixture.ts` applies
 * `0001` twice: "applies cleanly" and "is idempotent" are different claims, and a file
 * that has only ever run once has been shown to do neither. `0027` is the migration
 * that added the notifications substrate and `0028` the one that added the consent
 * model, and a second application that failed on either would mean the RLS proof and
 * this one disagree about what the schema tolerates.
 */
export async function rebuildProofDatabase(database: string = PROOF_DATABASE): Promise<void> {
  psqlAsSuperuser(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
    'postgres',
  );
  psqlAsSuperuser(`DROP DATABASE IF EXISTS ${database}`, 'postgres');
  psqlAsSuperuser(`CREATE DATABASE ${database} OWNER ${OWNING_ROLE}`, 'postgres');

  for (const [pass, files] of [
    ['first', await migrationFiles()],
    ['second', await migrationFiles()],
  ] as const) {
    const client = await connectAs(
      loadTestEnvironment().database.user,
      loadTestEnvironment().database.password,
      database,
    );
    try {
      for (const file of files) {
        await client.query(await readFile(file, 'utf8'));
      }
    } catch (error) {
      throw new Error(
        `applying migrations to ${database} failed on the ${pass} pass: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      await client.end();
    }
  }
}

/**
 * Drop a proof database.
 *
 * `rebuildProofDatabase` creates it from nothing on every run, so without this each run
 * leaves a stale copy of a schema behind — and a leftover database is indistinguishable
 * from a correct one to whoever inspects the cluster next. Backends are terminated
 * first: a leaked client makes the `DROP` fail naming a connection the operator cannot
 * see (§B8).
 */
export function dropProofDatabase(database: string = PROOF_DATABASE): void {
  psqlAsSuperuser(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
    'postgres',
  );
  psqlAsSuperuser(`DROP DATABASE IF EXISTS ${database}`, 'postgres');
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
export function authenticatorClient(database: string = PROOF_DATABASE): Promise<Client> {
  const env = loadTestEnvironment();
  return connectAs(env.authenticator.user, env.authenticator.password, database);
}

/**
 * A client for the migration/owner role — the role that owns every table.
 *
 * Offered for exactly one reason: **a fixture must not depend on the control under
 * test.** A fixture that creates its rows through the boundary as `app_admin` needs
 * the very grant the suite is asserting, so removing that grant makes the fixture
 * fail in `beforeAll` and every assertion in the file is SKIPPED rather than failed
 * — a red exit code wearing eleven green tests, which is the shape this repository
 * calls a false green (`AGENTS.md` §B8). A fixture row created by the OWNER depends
 * on nothing the suite is testing, so the assertions that do depend on it go red on
 * their own.
 *
 * The owner is never used to assert anything: it bypasses every policy, so a
 * refusal it met would be no refusal at all. It creates the rows; the serving roles
 * are the ones that answer.
 */
export function ownerClient(database: string = PROOF_DATABASE): Promise<Client> {
  const config = loadTestEnvironment().database;
  return connectAs(config.user, config.password, database);
}

/**
 * A client for the cluster superuser.
 *
 * **Offered for one reason: an UNAMBIGUOUS read.** The four security-telemetry
 * tables are `FORCE ROW LEVEL SECURITY` with a policy that admits `app_admin` and
 * nothing else, so a read through the boundary that returned nothing would be
 * indistinguishable from "the rows are not there" — the §B8 rule about asserting
 * on row counts rather than on status codes, applied to a read. A superuser
 * session bypasses the policies, so a count it reports is the count that exists.
 *
 * It is never used to ASSERT a refusal: a refusal witnessed through a session
 * that bypasses the policies is not a refusal.
 */
export function superuserClient(database: string = PROOF_DATABASE): Promise<Client> {
  return connectAs(CLUSTER_SUPERUSER, '', database);
}

async function connectAs(user: string, password: string, database: string): Promise<Client> {
  const config = loadTestEnvironment().database;
  const client = new Client({
    host: config.host,
    port: config.port,
    user,
    password,
    database,
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