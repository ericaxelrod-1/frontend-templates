import { defineConfig } from 'vitest/config';

/**
 * The W07 row-level-security proof. A gating step of `npm run verify`, run with
 * its own config because it is the only suite that mutates a database, starts a
 * PostgREST process and reaches the network on localhost.
 *
 * `fileParallelism` is off: every test in the suite shares one database, and
 * several of them deliberately grant and revoke inside transactions. Parallel
 * files would interleave those and produce failures that say nothing about RLS.
 *
 * `disableConsoleIntercept` matches the unit config so the suite's own failure
 * output — a Postgres error, a PostgREST log — reaches the terminal instead of
 * being captured and discarded.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['test/rls/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    disableConsoleIntercept: true,
  },
});
