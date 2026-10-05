# BLOCKERS

## Resolved

- **[TASK 2] Erasure window had no reject/withdraw state** — the lifecycle was only
  `pending | retention_asserted | completed`, so a restriction could end only by completion (erasure).
  **Decision (owner):** build `rejected` + `withdrawn` now (statuses + service methods + ops routes +
  a migration extending the `erasure_requests.status` CHECK constraint); restriction lifts on either.
- **[TASK 3] No in-app cancellation control vs Terms 6.5** — app had no cancel button / portal link /
  cancel route; Terms 6.5 says "cancel at any time from your account… access continues until the end of
  the period you have paid for." VAT is inclusive (decomposed, never added on top) and off by default.
  **Decision (owner):** build a **"Manage subscription"** button opening a **Stripe Customer Portal**
  session (cancel at period end, update payment method, invoice history); reuse the portal for the
  dunning "update your payment" link only if it can pay the open invoice with 3DS, else keep the hosted
  invoice page. Disclosure: prices include VAT, renews same date & time, cancel anytime from Billing,
  access continues to end of the paid period. Dashboard Customer Portal settings to be listed in the report.

## Resolved

- **Load-induced test-suite timing flakes** — `password.test.ts` `[LOGIN-TIMING]`,
  `share-referral.test.ts`, and `inventory-share.test.ts` intermittently failed the verify-on-stop full
  run under CPU contention (inflated wall-clock measurements; a starved scrypt signup returning a
  non-JSON body). **Fixed** by a sequential timing pool: those three files are excluded from the
  parallel `vitest.config.ts` and run alone, `fileParallelism: false`, in `vitest.timing.config.ts`,
  which `npm test` runs immediately after the main suite (so they still gate — locally and in CI, which
  invokes `npm test`). No assertion or timeout was changed; the timing tests' teeth were re-proven by
  mutation. See the `TIMING-POOL` commit.
