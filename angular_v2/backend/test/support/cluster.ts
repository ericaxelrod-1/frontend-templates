import { spawnSync } from 'node:child_process';
import { loadTestEnvironment } from './database.js';

/**
 * Cluster-scoped test helpers — the state that is NOT owned by any one database.
 *
 * `ALTER ROLE … PASSWORD`, `CREATE ROLE` and `GRANT role TO role` are cluster
 * objects: one statement rewrites them for every database on the cluster,
 * including `app_dev`, which no suite is allowed to touch. Two places in this
 * repository issue them:
 *
 *   - `test/rls/support/fixture.ts` → `rebuildDatabase`, which sets the RLS
 *     proof's own password because its PostgREST process logs in as
 *     `pgrst_authenticator` with it for the whole run;
 *   - `database/seed.ts`, which sets it from configuration so the seed can
 *     connect through the escalation boundary.
 *
 * Both therefore have to put the role back, and this module is where "put it
 * back" lives, so there is exactly one implementation of the undo and every
 * suite — RLS proof or e2e — reaches for the same one (§2.4).
 */

/** Escapes a value for a single-quoted SQL literal. These values are hostile by design. */
function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Runs `sql` as the cluster superuser against `database` and returns its
 * unaligned output, throwing on failure.
 *
 * `psql` continues past an error and still exits 0 by default, so
 * `ON_ERROR_STOP=1` is not optional: without it a failed statement in the
 * middle is indistinguishable from success.
 */
export function psqlAsSuperuser(sql: string, database: string): string {
  const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', database, '-c', sql], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`superuser psql failed against ${database}:\n${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Puts `pgrst_authenticator`'s LOGIN password back to the configured
 * `AUTHENTICATOR_PASSWORD`.
 *
 * ## Why this exists
 *
 * `ALTER ROLE pgrst_authenticator LOGIN PASSWORD …` is CLUSTER-scoped, so a
 * suite that sets it rewrites the password the development and test databases
 * use too. Anything that leaves it behind makes the next `npm run dev` unable
 * to mint a token — `POST /auth/login` → HTTP 500, `password authentication
 * failed for user "pgrst_authenticator"` in the NestJS log, and PostgREST fails
 * the same way because it connects as this role. That is the hazard
 * `AGENTS.md` §B8 warns about — *"a tampered run can leave the cluster worse
 * than it found it … check the cluster, not the diff"* — except it happened on
 * the ordinary green path, with no tampering.
 *
 * ## Why it restores rather than reads back
 *
 * A SCRAM verifier cannot be read back — that is the point of SCRAM — so there
 * is no "save the old value and put it back". The only restorable value is the
 * one the operator configured: `AUTHENTICATOR_PASSWORD`, which is also what the
 * thin app authenticates with and what `scripts/postgrest-connection.ts` puts in
 * `PGRST_DB_URI`. If that key is wrong the restore writes a wrong password,
 * which is why the restore is asserted from the outside: `test/smoke` connects
 * with it after everything else has finished.
 *
 * Connects to `postgres` rather than to a proof database, because a role is
 * cluster-scoped and this must work whether or not those databases still exist
 * — that is what lets a suite drop its database first and restore the cluster
 * afterwards without an ordering trap.
 */
export function restoreAuthenticatorPassword(): void {
  const configured = loadTestEnvironment().authenticator.password;
  psqlAsSuperuser(
    `ALTER ROLE pgrst_authenticator LOGIN PASSWORD ${quoteSqlLiteral(configured)}`,
    'postgres',
  );
}