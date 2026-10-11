/**
 * PostgREST's database connection: COMPOSED, never configured.
 *
 * ## Why this module exists
 *
 * PostgREST performs exactly one `LOGIN`, and the role it logs in as decides
 * whether the whole API layer works at all. It must be `pgrst_authenticator`:
 *
 *   - The other login role in this design, `app`, is the migration/owner role.
 *     It OWNS every table, so it is exempt from every RLS policy on them and
 *     nothing errors when it is — and it is a member of NONE of
 *     `app_anon` / `app_member` / `app_admin`, so the `SET ROLE` PostgREST
 *     issues from the token's `role` claim is refused outright:
 *     `42501 permission denied to set role "app_anon"`.
 *   - `pgrst_authenticator` owns nothing and is a member of exactly the three
 *     serving roles — that grant in `database/bootstrap/001_roles.sql` is the
 *     escalation boundary (§B5), and a login role that is not its member gets a
 *     403 on every request.
 *
 * The shipped `.env.example` used to carry
 * `PGRST_DB_URI=postgresql://app:app@localhost:5432/app_dev`, which is the first
 * role. Every data request therefore failed while `GET /` still answered **200**,
 * so the whole data layer was dead and the readiness probe in `dev.mjs` was
 * green — the failure was invisible to a forker following the documented setup.
 *
 * ## Why it is composed rather than configured
 *
 * A committed file must not carry a credential, so the URI cannot be written
 * out. And an *unset* `PGRST_DB_URI` is worse than a wrong one, because a
 * developer fills it in with a password that then drifts away from
 * `AUTHENTICATOR_PASSWORD` — the same secret, held twice, with nothing to say
 * they disagree. Two consequences the previous tree paid for:
 *
 *   - `database/seed.ts` sets `pgrst_authenticator`'s LOGIN password from
 *     `AUTHENTICATOR_PASSWORD`, so a URI naming any other password authenticates
 *     against a role whose password the operator no longer knows.
 *   - The RLS proof sets its OWN password on the SAME cluster-scoped role, so a
 *     hand-written `PGRST_DB_URI` password is stale the moment `npm run verify`
 *     finishes.
 *
 * So the role is a constant here and the password is read from the single key
 * every other component already reads. `DB_USER` / `DB_PASSWORD` are
 * deliberately NOT used: those belong to the owner, and reading them is the
 * defect, not a configuration option.
 */

/**
 * The one role PostgREST may log in as. Not configurable, and not an option:
 * the escalation boundary is `GRANT app_anon, app_member, app_admin TO
 * pgrst_authenticator`, so this name and the grant are the same fact.
 */
export const PGRST_LOGIN_ROLE = 'pgrst_authenticator';

/**
 * Raised for anything that stops the connection from being composed: an absent
 * key, a malformed port, an absent JWT secret.
 *
 * Carries the whole problem list rather than the first failure, because an
 * operator who has never seen this error should be able to fix all of it in one
 * edit instead of rerunning after each discovery (§2.3).
 */
export class PostgrestConnectionError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `PostgREST's database connection cannot be composed (${problems.length} problem(s)): ${problems.join('; ')}. ` +
        'There is no PGRST_DB_URI to add: scripts/dev.mjs and scripts/prod.mjs build it, so the login role is ' +
        `${PGRST_LOGIN_ROLE} and the password is AUTHENTICATOR_PASSWORD. Fill in the keys named above ` +
        '(see backend/.env.example) and retry.',
    );
    this.name = 'PostgrestConnectionError';
    this.problems = [...problems];
  }
}

/** The keys this module reads, and the reason each one is load-bearing. */
const REQUIRED_KEYS = ['DB_HOST', 'DB_NAME', 'AUTHENTICATOR_PASSWORD'] as const;

/**
 * A source of environment values. `NodeJS.ProcessEnv` is what the orchestrators
 * pass and a plain record is what the tests pass, so neither has to mutate the
 * real `process.env` to exercise a failure.
 */
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

function readRequired(source: EnvironmentSource, key: string, problems: string[]): string | undefined {
  const value = source[key];
  if (value === undefined || value === '') {
    problems.push(`${key} is required but was not set`);
    return undefined;
  }
  return value;
}

/**
 * Builds `PGRST_DB_URI` for the PostgREST child process.
 *
 * Throws `PostgrestConnectionError` when any of `DB_HOST`, `DB_PORT`, `DB_NAME`
 * or `AUTHENTICATOR_PASSWORD` is absent or malformed. There is no default for
 * the password and there must never be one: a fallback here would silently
 * re-open the shipped defect on any checkout whose `.env` is missing a key,
 * because PostgREST would then authenticate as the wrong password and fail with
 * `password authentication failed for user "pgrst_authenticator"` — the exact
 * symptom this module exists to remove.
 *
 * Only the password is percent-encoded. It is the one value that may contain
 * `@`, `:`, `/` or `#`, all of which terminate the userinfo section of a
 * connection URI; `DB_HOST` / `DB_NAME` are operator-chosen identifiers, not
 * secrets, and encoding them would produce a URI that reads differently from
 * the configuration it came from.
 */
export function buildPostgrestDbUri(source: EnvironmentSource): string {
  const problems: string[] = [];

  const host = readRequired(source, 'DB_HOST', problems);
  const database = readRequired(source, 'DB_NAME', problems);
  const password = readRequired(source, 'AUTHENTICATOR_PASSWORD', problems);

  const rawPort = readRequired(source, 'DB_PORT', problems);
  let port: number | undefined;
  if (rawPort !== undefined) {
    port = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      problems.push(`DB_PORT must be an integer between 1 and 65535, received '${rawPort}'`);
      port = undefined;
    }
  }

  if (problems.length > 0) {
    throw new PostgrestConnectionError(problems);
  }

  // `host`, `database`, `port` and `password` are all defined here: every branch
  // that can leave one undefined pushes a problem and throws above. Written as an
  // explicit guard rather than `!`, because a non-null assertion is banned
  // (§2.6) and because a silent `undefined` would compose a URI that names
  // "undefined" — the same class of silent misconfiguration as the inherited
  // `PGRST_*` keys this module strips.
  if (host === undefined || database === undefined || port === undefined || password === undefined) {
    throw new PostgrestConnectionError(['the composed connection is incomplete; this is a defect in buildPostgrestDbUri']);
  }

  return `postgresql://${PGRST_LOGIN_ROLE}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

/**
 * The environment PostgREST is spawned with.
 *
 * Inherited `PGRST_*` keys are DELETED rather than set to `undefined`: PostgREST
 * gives environment variables precedence over its config file, so an inherited
 * `PGRST_DB_URI` — from a developer's shell, or from a stale `backend/.env` that
 * still carries one — would win over the composed value and reintroduce the
 * shipped defect without any error in this process. `spawn` stringifies env
 * values, so `undefined` would arrive as the literal text `"undefined"`.
 *
 * The URI is therefore composed from the surviving keys whatever the caller had
 * in its environment, and the JWT secret is the one key that stays explicit: it
 * is a shared secret rather than a derivable coordinate, so it is still read from
 * the environment — and refused loudly when absent, because a PostgREST with the
 * wrong secret answers every authenticated request with `PGRST301` while the
 * config file still looks correct (§B5).
 */
export function postgrestChildEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const problems: string[] = [];

  const secret = source['PGRST_JWT_SECRET'];
  if (secret === undefined || secret === '') {
    problems.push('PGRST_JWT_SECRET is required but was not set');
  }

  let uri: string | undefined;
  try {
    uri = buildPostgrestDbUri(source);
  } catch (error) {
    if (error instanceof PostgrestConnectionError) {
      problems.unshift(...error.problems);
    } else {
      throw error;
    }
  }

  if (uri === undefined || secret === undefined || problems.length > 0) {
    throw new PostgrestConnectionError(problems);
  }

  const env: NodeJS.ProcessEnv = { ...source };
  for (const key of Object.keys(env)) {
    if (key.startsWith('PGRST_')) {
      delete env[key];
    }
  }
  env['PGRST_DB_URI'] = uri;
  env['PGRST_JWT_SECRET'] = secret;
  return env;
}

/**
 * The keys this module refuses to start without, in the order they are reported.
 * Exported so a test can assert the refusal set is exactly these four rather
 * than "whatever the implementation happens to read".
 */
export const REQUIRED_COMPOSITION_KEYS = [...REQUIRED_KEYS, 'DB_PORT'] as const;
