# Close trial farming — Task 4 report (suite / typecheck / lint · deltas · mutations · unshipped)

## Suite / typecheck / lint

- **Full unit suite:** `npx vitest run` → **255 files, 1697 tests, all pass.** Timing config
  (`vitest.timing.config.ts`) → **21 pass.** (`npm test` runs both.)
- **Typecheck:** `npm run typecheck` → clean (api + web + test projects).
- **Lint:** `npm run lint` → clean (0 problems).

### Suite delta + the regression Task 4 caught
Running the full suite after Task 2/3 surfaced **10 failures across 7 files** (recall, book-scan,
notes, onboarding, import, import-ceiling, and the Batch-B concurrent-leak test). Cause: those tests
sign up and extract **without verifying**, so the new verification gate (correctly) deferred their
extractions and the downstream assertions saw no facts. This is the gate working — not a defect — but
it means the default test fixture had to move to the new precondition.

**Fix (Task 4):** the in-memory test harness now defaults a signed-up account to **verified**
(`buildInMemoryDeps` — verification is a precondition of the core loop, and the gate itself is proven
end-to-end by the dedicated `verification-gates-extraction.test.ts`, which opts into the real
`emailVerified`-backed gate via `enforceVerification: true`). Prod (`index.ts`) always wires the real
gate. After the fix: full suite green, no assertions weakened — only fixture setup moved to the new
precondition.

Net-new tests this batch: `verification-gates-extraction` (3), `extraction-ceiling` (1),
`trial-email-key` (5), `trial-grant-key-reuse` (2), `limiter` rewritten (5), plus new cases in
`note-sweep-service` (+2) and `extraction-service` (+2).

## Every mutation (proven able to fail, then reverted)

| Task | Guard | Mutation | Result | Reverted |
|---|---|---|---|---|
| 2 | verification gates extraction | `if (false && verifiedGate…)` — allow extraction while unverified | 3 tests RED (unverified extracted; queued note didn't wait) | ✅ |
| 3a | ceiling checked BEFORE the spend | `if (false && limiter.allow…)` — check moved after the spend | 3 tests RED (model called at the ceiling) | ✅ |
| 3b | trial key normalised (no per-alias farming) | `grantOrGet(email.trim().toLowerCase())` — skip normalisation | grant-reuse RED (`w.abil@` got a fresh trial) | ✅ |

Adapters/services all confirmed reverted (`git diff` clean on the mutated lines; suite green after each).

## Derived numbers — reported as NOT settled (your ruling)

**Trial ceiling: `TRIAL_EXTRACTION_CEILING` 200 → 100.** Derivation: one real rep's genuine first
import (one WhatsApp chat = one note = one extraction; an active field book ≈ 20–35 live chats,
central ~30) **plus** ~two weeks of daily capture (~5/day × 14 ≈ 70) ≈ **~100**, with no meaningful
headroom beyond it. Cross-check: the hero "you have enough to see value" bar is 20 notes, so 100
clears it with room — a real rep never notices; a farmer's trial is near-worthless.

**Paid ceiling: `PAID_EXTRACTION_CEILING` 2000/period.** Per billing period (resets — never locks out
a long-term customer). It is a runaway-loop backstop, not a cost gate.

**The honest caveat (please weigh this):** the **AED 45 trial spend cap already bounds a trial account
to ~65–150 extractions** (at ~AED 0.3–0.7 each) and fires *before* the count ceiling for normal-cost
extractions. So the real per-verified-account exposure is **~AED 45**, and the count ceiling's value is
(a) **durability** — it is not derived from prunable log rows, so archival/erasure can't lower it — and
(b) it becomes the binding limit if per-extraction cost falls (cheaper model). **The count ceiling does
not reduce the exposure below AED 45.** If AED 45 of free spend per *verified, dot/plus-normalised*
inbox is still too much, the lever is the **trial-specific spend cap**, not the count — and signup
rate-limiting (explicitly out of scope this batch) is the remaining farming lever. Numbers NOT settled.

## What is unshipped on `main` (nothing pushed, nothing deployed)

`main` is **4 commits ahead of `origin/main`**, all `[skip ci]`, none pushed:

| commit | task |
|---|---|
| `04949ed` | Batch B — concurrent two-account leak test + local detector |
| `3033184` | Trial-farm Task 1 — findings only |
| `5e1dc8d` | Trial-farm Task 2 — verification gates extraction |
| `f8458af` | Trial-farm Task 3 — durable ceiling, post-trial scope, normalised key |
| (this) | Trial-farm Task 4 — suite/lint fixes + this report |

## Not applied / needs your action

- **`docs/tovira-spec.md`** — the SOFT-verification decision (§5g, locked) is reversed for extraction
  only. Proposed edit is **listed** in `TRIAL-FARMING-DOCS-CHANGES.md`, NOT applied (docs/ is
  guard-protected).
- **Migration `0067_extraction_counters.sql`** — additive; validated only live (`docker compose up`),
  per the in-memory-suite convention. It applies on the next deploy's ECS boot.
- **Config env** — `PAID_EXTRACTION_CEILING` is new (default 2000); `TRIAL_EXTRACTION_CEILING` default
  changed 200 → 100. Both overridable via env.

## Out of scope (as agreed): signup rate-limiting, CAPTCHA, async extraction work, erasure follow-ups.
