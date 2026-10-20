import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/unit/**/*.spec.ts'],
    // The doc-claims and lint-baseline suites report their ledgers from inside a
    // passing test. Vitest captures console output by default, which would make
    // those reports invisible; a debt list nobody sees is a silent one.
    disableConsoleIntercept: true,
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
