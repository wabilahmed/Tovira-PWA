import { defineConfig } from 'vitest/config';

// The live STAGING harness — black-box HTTP against a running staging server.
// DELIBERATELY separate from the unit suite (vitest.config.ts) and never included
// by `npm test`. Run with `npm run test:staging` and STAGING_API_URL/STAGING_APP_URL
// set. Sequential (one worker), generous timeouts — real network + server-side
// extraction, and we never want two identities racing the same rate limiter.
export default defineConfig({
  test: {
    include: ['tests/staging/**/*.test.ts', 'tests/extreme/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/staging/lib/global-setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    fileParallelism: false,
    retry: 0,
    reporters: ['default'],
  },
});
