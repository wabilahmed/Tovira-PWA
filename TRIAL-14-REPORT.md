# Trial 7 → 14 days — batch report `feat(TRIAL-14)`

Product decision (locked): the free trial is a **flat 14 days**, stated up front — no usage-gated
extension, no conditional second week. This batch consolidates the length to one source, removes the
extension path, updates the math/tests, sweeps the copy, and reports the two things it must not do
itself (drop a DB column; edit guard-protected `docs/`).

All commits carry **`[skip ci]`** (Anthropic credits exhausted → the CI extraction gate fails on
spend, not on this change). Git-only, no gate, no deploy. Tips + no-CI confirmation in the final
section.

## Task 5 — seeding bound under 14 days (finding, no change)

**Worst-case Claude spend per trial user under the 14-day window: ~AED 45 (~$12.25) — unchanged from
7 days. No breach of the per-account cap; nothing adjusted.**

Measurement / basis (recorded beside the number):
- The **spend cap is AED 45 per billing *period*** (`config.spendCapAed`), and **the entire trial is
  ONE period** — `periodKeyFrom` returns a single `t:${trialEndsAt}` key for the whole trial window
  (`services/spend/period.ts:28`). So one AED 45 cap covers the full trial, 7 days or 14.
- The **trial extraction ceiling is a COUNT (200), not time-scaled** — `TrialExtractionLimiter.allow`
  gates on `countExtractions(userId) < 200` (`services/extraction/limiter.ts`), a per-trial total.
- Therefore extending the calendar window 7 → 14 raises **neither** bound; it only gives the rep more
  days to reach the same ceilings. The heaviest real call measured this session (the BLIND-2 import,
  5,615 messages) was **~AED 2.29 warm** — the AED 45 cap absorbs ~20 such imports before extraction
  *defers* (degrade-not-block), and 200 daily-note extractions cost well under the cap. The binding
  worst case stays the cap: **~AED 45**.

Since the cap is the bound and the window doesn't scale it, there is **no breach** — no stop-and-report
condition triggered, and (per the constraint) the cap was **not** adjusted.

## Orphaned DB column (reported, NOT dropped)

Removing the usage-gated extension (task 3) leaves **`subscriptions.trial_extended`** (added by
`migrations/0022_trial_extended.sql`) with no reader or writer — the app model, pg `SUB_COLS`/mapping/
patch, and the in-memory record no longer reference it. Per the batch constraint, it is **left in
place**, not dropped.

**Proposed follow-up (a separate data decision, not made here):** a migration
`00NN_drop_trial_extended.sql` running `ALTER TABLE subscriptions DROP COLUMN IF EXISTS trial_extended;`
once you're satisfied nothing external reads it. It holds only a boolean and is harmless where it sits;
dropping it is tidiness, not correctness.

## docs/ — proposed copy changes (guard-protected: listed, NOT applied)

`docs/` is guard-protected, so these are proposed, not edited:

**Flip "7-day"/"7 days" → 14 (current-state copy):**
- `docs/tovira-landing-copy.md`: lines **26, 30, 179, 183, 219, 220** ("Start a 7-day trial", "first 7 days", "7 days free").
- `docs/tovira-user-stories.md`: line **181** ("a 7-day free trial").
- `docs/tovira-dev-plan.md`: line **145** ("7-day trial" in the Stripe line).
- `docs/tovira-spec.md`: lines **136, 164, 210** ("7-day-trial weakness", "inside a 7-day trial", "7-day free trial").

**Rewrite to drop the removed extension (these describe the deleted feature):**
- `docs/tovira-dev-plan.md`: line **147** — "Activity-gated trial extension: +7 days…" → remove.
- `docs/tovira-user-stories.md`: line **184** — "Activity-gated extension: … unlocks +7 days…" → remove.
- `docs/tovira-spec.md`: line **237** — "7-day trial stays; capturing notes on 3+ clients unlocks 7 more days…" → replace with "Flat 14-day trial; no usage-gated extension."

**Do NOT change (not trial length — flagged so they aren't swept by mistake):**
- `docs/tovira-spec.md:253` — "7-day confirmation link" is the **email-verification token TTL**, not the trial.
- `docs/tovira-spec.md:304` — "~7 days idle" is iOS local-storage wipe behaviour.
- `docs/tovira-spec.md:319, 323` — dated **decision-log** entries ("Locked 7-day free trial", "activity-gated trial extension"). These are historical record; rather than rewrite history, add a **new dated entry**: "2026-09-12 — Trial changed to a flat 14 days; usage-gated extension removed." Your call.

(Non-doc historical report files — `TZ-*.md`, `USER-FLOWS.md`, `SECURITY-AUDIT-REPORT.md` — also mention
7; they are point-in-time records and are intentionally left as-is.)

## Out of scope (noted, by hand)
Stripe Dashboard `trial_period_days` → set to **14** manually in the Dashboard, outside this batch.
The app never reads a Stripe trial length (the trial is app-owned via `config.trialDays`); this only
keeps the Stripe-side trial banner/checkout consistent with the product.
