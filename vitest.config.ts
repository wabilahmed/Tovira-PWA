import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Default unit/logic suite. Fast, no Docker required.
// Docker-dependent end-to-end checks live in vitest.integration.config.ts.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['apps/api/src/**/*.test.ts', 'apps/web/src/**/*.test.{ts,tsx}', 'apps/site/src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'test/integration/**'],
    // Node by default (API + web logic); web COMPONENT tests (.test.tsx) and the
    // marketing-site DOM tests (referral pass-through, RTL) run in jsdom.
    environment: 'node',
    environmentMatchGlobs: [
      ['apps/web/src/**/*.test.tsx', 'jsdom'],
      ['apps/site/src/**/*.test.ts', 'jsdom'],
    ],
    setupFiles: ['apps/web/src/test-setup.ts'],
    // scrypt password hashing across many parallel signup tests is CPU-heavy;
    // give a generous ceiling so a cold, contended run doesn't flake.
    testTimeout: 20_000,
  },
});
