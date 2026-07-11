import { defineConfig } from 'vitest/config';

// Default unit/logic suite. Fast, no Docker required.
// Docker-dependent end-to-end checks live in vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ['apps/api/src/**/*.test.ts', 'apps/web/src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'test/integration/**'],
    environment: 'node',
  },
});
