# BLOCKERS

## Load-induced test-suite timing flakes (verify-on-stop full run under CPU contention)

**Status:** environmental — NOT a code defect, NOT caused by the deal-outcome batches. No test has been
weakened, skipped, or deleted. Recorded here per the verify-hook protocol ("if a test looks problematic,
STOP and write it to BLOCKERS.md — do not silently fix or weaken it").

**Symptom:** the stop-hook runs the WHOLE suite in parallel (`vitest run`, 229 files). On a saturated
machine (observed: 286–455s wall, 700–1200s aggregate setup) a single timing-sensitive test intermittently
fails. Two tests are affected, and which one trips depends on load, not code:

1. `apps/api/src/services/auth/password.test.ts` › `[LOGIN-TIMING] … unknown-account (DUMMY_VERIFY_HASH)
   timing matches a real hash` — **times out at 20000 ms**. It runs ~100 real scrypt `verify` calls
   (25 samples × 4 batches + warm-up) to prove the no-timing-oracle property. Solo it passes in **7.6 s**
   (full file 8.5 s / 7 tests). Under full-suite CPU contention the scrypt work exceeds the 20 s per-test
   timeout. The assertions are ratio-based (`fixedDummy > known*0.5`, `oldDummy < known*0.5`) and are
   sound — only the fixed timeout is fragile under load.
2. `apps/api/src/http/share-referral.test.ts` › `[P5-6] referral › a crediting failure does not fail
   signup` — a **2000 ms tolerance** assertion; measured 2176 ms in one contended run. Passes solo (42 s
   file). Already noted in agent memory (`solo-test-suite-discipline`).

**Evidence it is not a regression:**
- Un-contended full run (`vitest run --no-file-parallelism`): **1599 / 1599 passed, 0 failures** (198 s).
- Each flaky test passes in isolation; all deal-outcome areas pass in isolation (68/68).
- The two batches touched only the outcome domain (clients repo, outcome inference/endpoint/control,
  reports) — nothing in auth/password KDF or referral timing.

**Proposed robustness fix (NOT applied — outside batch scope, and must not be done merely to "go green"):**
give the two timing tests an explicit longer `testTimeout`/tolerance, OR run timing-sensitive tests in a
non-parallel pool (`test.sequential` / a separate project), so full-suite CPU contention cannot produce a
false timeout. This changes no assertion. Owner's call — raised for a separate maintenance task.

**Interim guidance:** treat a lone timeout/tolerance failure in these two tests during a contended
stop-hook run as a flake; confirm with a solo run or `--no-file-parallelism`. Do not weaken the tests.
