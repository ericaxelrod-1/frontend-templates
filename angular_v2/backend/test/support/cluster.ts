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

/** The cluster superuser every cluster-scoped statement here runs as. */
export const CLUSTER_SUPERUSER = 'postgres';

/**
 * Where the superuser credential comes from on this platform — and therefore
 * what a failure below actually means.
 *
 * **Linux needs no password at all**: the session is a Unix socket one and the
 * superuser authenticates by PEER, so a failure means the socket is not where
 * `psql` expects it, or `sudo -u postgres` is not passwordless.
 *
 * **Windows needs one, and it is not in this repository**: the session is a TCP
 * one, so the `postgres` password has to come from `PGPASSFILE` — the file that
 * variable names — or `PGPASSWORD`. `-w` is set, so `psql` never prompts and the
 * failure is immediate; the hint says which of the two is missing rather than
 * leaving the operator with a bare `password authentication failed`.
 */
const SUPERUSER_CREDENTIAL_HINT =
  process.platform === 'win32'
    ? 'The Windows branch authenticates over TCP, so the `postgres` password has to come from ' +
      'PGPASSFILE (the file that variable names) or PGPASSWORD. `-w` is set, so psql never prompts: ' +
      'check that PGPASSFILE names a readable file with a `postgres` entry for this host and port.'
    : 'The Linux branch authenticates over the Unix socket, so the superuser needs no password — ' +
      'peer authentication is the whole of it. A failure here means the socket is not where psql ' +
      'expects it, or `sudo -u postgres` is not passwordless.';

/**
 * Runs `sql` as the cluster superuser against `database` and returns its
 * unaligned output, throwing on failure.
 *
 * `psql` continues past an error and still exits 0 by default, so
 * `ON_ERROR_STOP=1` is not optional: without it a failed statement in the
 * middle is indistinguishable from success.
 *
 * ## Why the invocation is platform-dependent and the SQL is not
 *
 * `sudo -u postgres psql` is the Linux answer and works there because the
 * superuser authenticates by PEER over the Unix socket. **No `-h` on that
 * branch: `-h` forces a TCP session, and a TCP session is not peer
 * authentication.** It asks the cluster for a password the `postgres` role may
 * not have, so the failure names a password rather than the socket that would
 * have worked. The socket is what `database/seed.ts` already uses and what
 * `docs/deployment-guide.md` §Prerequisites already tells an operator to type.
 *
 * Windows has neither `sudo` nor a `postgres` OS account and no socket to fall
 * back on, so the session is a TCP one against the configured host and the
 * password comes from `PGPASSFILE` (or `PGPASSWORD`). `-w` is on the Windows
 * spelling because without it `psql` PROMPTS on stdin for the password and
 * hangs forever, which turns a provisioning step into an overnight stall — the
 * hazard `database/seed.ts` records.
 *
 * It is one function with a branch rather than two functions, on purpose (§2.4):
 * "run one statement as the cluster superuser" has exactly one implementation
 * here, and a second one beside it is a second place for the quoting, the
 * `ON_ERROR_STOP` and the failure handling to diverge.
 */
export function psqlAsSuperuser(sql: string, database: string): string {
  const config = loadTestEnvironment().database;
  const common = [
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
    '-p',
    String(config.port),
    '-U',
    CLUSTER_SUPERUSER,
    '-d',
    database,
    '-c',
    sql,
  ];
  const [command, args] =
    process.platform === 'win32'
      ? ['psql', ['-w', '-h', config.host, ...common]]
      : ['sudo', ['-u', CLUSTER_SUPERUSER, 'psql', ...common]];
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    const spawnFailure = result.error === undefined ? '' : `\n${result.error.message}`;
    throw new Error(
      `superuser psql failed against ${database}:\n${result.stderr}${spawnFailure}\n${SUPERUSER_CREDENTIAL_HINT}`,
    );
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