# Deal outcomes — capture-only batch report

Goal: start accumulating win/loss outcome data per client so a **future** best-practices analysis has
something to correlate behavioural metrics against. This batch captures outcomes only — **no analysis,
no dashboard, no aggregation, no surfacing of patterns**, and **no extraction / no model call anywhere**
(confirmed: nothing here reads message content).

All commits carry `[skip ci]` (Anthropic credits exhausted → git-only, no gate, no deploy). Tips and
no-CI confirmation at the end.

---

## Task 1 — findings (delivered before any edit)

- **Client state** lives in the `clients` table (`0003_rls.sql` + 0005/0025/0032/0036), model
  `ClientRecord` in `ports/client-repository.ts`. RLS FORCE + tenant policy already on the table, plus
  the composite `UNIQUE (user_id, id)` (0036).
- **No existing status/stage/outcome on `clients`** (dormant or otherwise). Prior art elsewhere:
  `inventory_shares.outcome` + `outcome_set_by` (`0041`) — the exact enum+source shape mirrored here.
  `client_deal_values` exists (deal value — **out of scope**, untouched).
- **Going-cold clock** reads one field, `clients.last_touched_at`, vs `now − COLD_THRESHOLD_DAYS`
  (default 30). It is a **rep-capture-recency** clock (bumped on create + capture), **not** a true
  "last message either direction" timestamp — an imported old thread reads as fresh. True per-message
  direction lives in extraction (out of scope).
- **Monday statement** (`MondayDigestService`) composes rows from promises due, `listGoingCold(30d)`,
  key dates, unanswered questions, and unacted inventory suggestions.
- **"Rep confirms/dismisses" analogue:** the Ask pending-note flow is a *fact-capture lifecycle*
  (pending→commit/delete over notes), **not** reusable for a mutable tri-state outcome. The reusable
  pieces are `inventory_shares` (data shape) and `ConfirmChit`/`.tov-chit-action` (UI idiom) — both
  reused, so no second confirmation pattern was invented.
- **Nightly host:** `ScheduledBrain` (`.start()` at boot, `index.ts`), advisory-locked, recorded to
  `/health`. The new rule is a real job (lockKey 4711009), not an orphan emitter.

## Derived constants (recorded per the constraint)

- **`LOST_INFERRED_THRESHOLD_DAYS` = 90 (default).** Derivation: going-cold is 30d ("reach out"); a
  deal is not dead the moment it cools, so lost_inferred sits materially beyond it. 90d = 3× the
  cooling window and matches the existing promise-staleness horizon (`promiseStaleThresholdDays`), the
  product's existing "probably not live anymore" line. **Not settled** — a pilot may move it; change
  the env/config constant, no code. Recorded beside the field in `config.ts`.
- **"Still open" writes `outcome_source='rep'`** (Task 4's rule) — which **pins the client against
  future inference**. A rep who taps "still open" won't be auto-re-inferred lost (they still get the
  separate 30-day cooling nudge). If you prefer "still open" to only snooze (re-inferable later), flip
  it to clear the source instead — a one-line change. Flagged, not silently chosen.

---

## Task 5 — the dataset floor (silence rule alone, rep never taps)

For a pilot rep who **never taps the outcome control**, the nightly rule alone produces this — stated,
not assumed:

1. **Two states only: `open` and `lost_inferred`.** No `won`, no `lost_confirmed` — both are rep-only.
   Every non-open datum has `outcome_source = 'inferred'`; **zero rep-confirmed outcomes accumulate.**
2. **The book self-partitions by capture-silence.** A client with ≥90 days since the last *capture
   activity about it* (and not won/rep-set) is `lost_inferred`; anything touched inside 90 days is
   `open`. Because the clock is `last_touched_at`, a rep who still captures notes/imports (just never
   taps outcomes) keeps active clients `open` automatically — only genuinely abandoned clients fall in.
3. **Import skews the early floor.** An import stamps `last_touched_at = import time`, so a freshly
   imported dormant client reads `open` for 90 days after import, then flips. The floor is therefore a
   function of **capture behaviour**, not true conversation recency — the analysis must treat
   `lost_inferred` as "the rep went quiet on this client for 90 days," which correlates with, but is
   not identical to, "the deal died."
4. **It is a live snapshot, not a log.** `outcome`, `outcome_source`, `outcome_changed_at` hold the
   *current* value; the rule is idempotent and reversible (a new capture reverts an inferred loss to
   the untouched default on the next run, clearing `outcome_changed_at`). This batch stores **no
   transition history** — a later analysis reading the table gets the current partition plus, for
   each currently-inferred loss, the date it crossed 90 days. Wins/confirmed losses only accumulate
   once reps actually tap.

**Net floor:** a nightly-recomputed, capture-silence partition of each rep's book into open vs
inferred-lost — useful as a coarse negative signal, but with no confirmed outcomes and no wins until
reps engage the control. That is the value of `outcome_source`: it marks the floor as entirely
inferred, so the future analysis can weight it accordingly rather than mistaking it for ground truth.

---

## Task 6 — suite, typecheck, lint

- **Full suite: 1591 passed / 228 files / 0 failures.** Delta from 1566 = **+25**, all new tests:
  client-outcome (5), outcome-inference (6), outcome endpoint (7), OutcomeControl (4), Alerts (+2),
  MondayDigest (+1). File count +3 = the three new test files. Nothing else moved.
- **Typecheck clean · lint clean.**

## Unshipped on main

This batch adds, on top of the existing credit-blocked backlog (TRIAL-14, homepage audit, security /
referral / spend work): migration `0061_client_outcome.sql`, the outcome field + `setOutcome` /
`clearOutcome`, the nightly `outcomes-inference` job, `POST /clients/:id/outcome`, and the
`OutcomeControl` on the alerts + Monday surfaces. All sit on `main` behind `[skip ci]` — no gate, no
deploy. `0061` has been validated only in-memory (per the migrations-live-only rule); it applies live
on the next `docker compose up` / real deploy.
