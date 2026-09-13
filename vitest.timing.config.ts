import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// [TIMING-POOL] The wall-clock timing tests, run SEQUENTIALLY and ALONE.
//
// Both measure a duration and compare it to a fixed ceiling:
//   - password.test.ts [LOGIN-TIMING] runs ~100 real scrypt verifies and asserts the unknown-account
//     path costs about as much as a real verify (ratio-based: no timing oracle);
//   - share-referral.test.ts asserts the referral credit lands the trial end within 2000ms of the
//     expected instant.
// Run inside the main 229-file parallel suite, a saturated machine inflates those measurements and the
// tests trip on LOAD, not on code — and a timing test contending with 228 others is measuring noise,
// which is exactly what makes the no-oracle proof unable to prove anything. So they are EXCLUDED from
// vitest.config.ts and run here instead, in their own pass, with file parallelism OFF.
//
// This changes NO assertion and NO timeout — it only changes WHERE the tests run, so it cannot hide a
// regression: the login test still fails if the unknown-account path skips the KDF, and the share test
// still fails if the credit is wrong or the path drifts past its tolerance (both proven by mutation).
// `npm test` runs this pass immediately after the main suite, so these tests still gate every run.
export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      'apps/api/src/services/auth/password.test.ts',
      'apps/api/src/http/share-referral.test.ts',
    ],
    exclude: ['**/node_modules/**'],
    environment: 'node', // both are API tests; no jsdom needed
    setupFiles: ['apps/web/src/test-setup.ts'], // identical to the main config
    // Run the files one at a time, uncontended — the whole point of this pool.
    fileParallelism: false,
    // Same ceiling as the main config — NOT raised. Uncontended, these finish well under it
    // (the KDF test ~8s solo); the timeout is a backstop, not the fix.
    testTimeout: 20_000,
  },
});
