/**
 * Same-origin base paths for the two backends, and the reason they are paths
 * and not hosts.
 *
 * The browser cannot call either server directly:
 *
 * - the thin Nest app (`backend/src/main.ts`) registers no CORS policy, so a
 *   cross-origin `POST /auth/login` from `http://localhost:4000` is refused by
 *   the browser before it leaves the page;
 * - `postgrest.conf` sets no `cors-allowed-origins`, so the same is true of the
 *   CRUD layer.
 *
 * Both are loopback services of the Node host, and the host is already in the
 * request path: `src/server.ts` serves the application. So the SSR server proxies
 * these two prefixes to them, and `proxy.conf.json` does the same for `ng serve`.
 * Every request the browser makes is then same-origin, which is also why no
 * token is ever exposed to a third-party origin (AGENTS.md §F6: a relative path,
 * never a hard-coded `localhost` in an environment file).
 */

/** The thin Nest app: authentication and the operations that are not plain CRUD. */
export const NEST_BASE_URL = '/api';

/** PostgREST: the CRUD API layer described by `src/app/api/schema.ts`. */
export const POSTGREST_BASE_URL = '/rest';