/**
 * The two HTTP origins this application talks to, written down once each.
 *
 * `AGENTS.md` §B4: never hand-write a URL. These are the two places a prefix is written
 * down at all, so every service composes its own path from one of them plus a table
 * name and a set of query parameters, rather than a URL somebody assembled by hand.
 *
 * `proxy.conf.json` forwards both in development — `/api` to the thin Nest app on
 * `:3000` and `/rest` to PostgREST on `:3001` — and in production the SSR server serves
 * them from the same origin, which is why neither is an absolute URL (`AGENTS.md` §F6:
 * `environment.production.ts` must not point at `localhost`).
 */

/** The thin NestJS app: auth, users, privacy and token routes. */
export const NEST_BASE_URL = '/api';

/**
 * PostgREST, which serves every base table directly.
 *
 * `AGENTS.md` §B1 makes PostgREST the API layer for CRUD over a table, so this is where
 * every table read and write goes — including the generic notification panel, which is
 * served by the same rule as every other table and needs no controller of its own.
 */
export const POSTGREST_BASE_URL = '/rest';