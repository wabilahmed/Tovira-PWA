import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// [TIMING-POOL] The timing- and load-sensitive tests, run SEQUENTIALLY and ALONE.
//
//   - password.test.ts [LOGIN-TIMING] runs ~100 real scrypt verifies and asserts the unknown-account
//     path costs about as much as a real verify (ratio-based: no timing oracle);
//   - share-referral.test.ts asserts the referral credit lands the trial end within 2000ms of the
//     expected instant;
//   - inventory-share.test.ts boots a fresh server with a real scrypt signup per test — under a
//     saturated parallel run that CPU-heavy request can fail and return a non-JSON error body
//     ("Unexpected token '<'"), a load flake, not a code fault.
// Run inside the main parallel suite, a saturated machine inflates the wall-clock measurements and
// starves the signup requests — false reds from load, and a timing test contending with the whole
// suite is measuring noise, exactly what makes the no-oracle proof unable to prove anything. So these
// files are EXCLUDED from vitest.config.ts and run here instead, in their own pass, parallelism OFF.
//
// This changes NO assertion and NO timeout — only WHERE the tests run, so it cannot hide a regression:
// the login test still fails if the unknown-account path skips the KDF, the share test still fails if
// the credit is wrong or the path drifts past its tolerance (both proven by mutation), and the
// inventory tests still assert the full share→decrement→sold_out lifecycle. `npm test` runs this pass
// immediately after the main suite, so these tests still gate every run.
export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      'apps/api/src/services/auth/password.test.ts',
      'apps/api/src/http/share-referral.test.ts',
      'apps/api/src/http/inventory-share.test.ts',
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
