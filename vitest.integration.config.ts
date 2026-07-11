import { defineConfig } from 'vitest/config';

// Docker-dependent end-to-end checks. Requires `docker compose` to be available.
// Run with: npm run test:integration
export default defineConfig({
  test: {
    include: ['test/integration/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
