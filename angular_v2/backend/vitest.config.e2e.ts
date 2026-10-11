import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/e2e/**/*.e2e-spec.ts'],
    // The DB-backed e2e files each seed a fresh throwaway database as the
    // cluster superuser, and the seed's ALTER ROLE fails with "tuple
    // concurrently updated" when two seeders overlap. Run files serially.
    fileParallelism: false,
    // Slice-3 brute-force tests assert real delays (1–4s) per request.
    testTimeout: 120_000,
  },
});
