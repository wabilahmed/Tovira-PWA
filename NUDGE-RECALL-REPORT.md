# Meeting nudges + recall — batch report

Covers `docs(NUDGE-RECALL-REPORT)` (Task C) and `docs(ASK-CONVO-REPORT)` (ASK-CONVO Task 6) — one
document, since the recall-cost and Ask-conversation work are the same story. Fourteen commits;
suite **1207 green**, typecheck + lint clean throughout. No extraction-prompt change, no gate run.

---

## PART A — pre-meeting nudges

### The as-was chain (Task A1, full detail in `NUDGE-AUDIT.md`)
A 2-hour-ahead nudge was **not achievable**, for two independent structural reasons plus three
quality gaps:
- **Trigger gap** — the `pre_meeting_nudge` generator was real but its only trigger was `POST /scan`;
  the 07:00 EventBridge Lambda is a no-op stub and the in-process brain never ran the scan. Lead was
  24h, not 2h.
- **Source gap** — extraction *computed* a meeting proposal but **never persisted it**; the only
  writer was the meetings route, always `confirmed:true`.
- No per-rep timezone; nudge said only "Meeting soon — <raw>"; `pre_meeting_nudge` ranked below
  overdue-promise/cooling and shared the 2/day cap.

### What was broken vs. what already worked
| Already correct (kept) | Was broken (fixed) |
|---|---|
| `nudged_at` row-marker + `dueForNudge` (once-per-meeting idempotency) | No production trigger → **A2** meeting-nudges job on the frequent brain (60s), 2h ± 15m window, immediate-if-late, no-nudge-if-retroactive |
| The in-process `ScheduledBrain` seam (advisory lock, `scheduled_job_runs`, `/health`) | No timezone → **A3** per-rep IANA tz (migration 0042), captured at signup + Settings; meeting wall-clock resolved on the rep's clock |
| Direct-creation API (`POST /clients/:id/meetings`, `confirmed:true`) | Bare nudge → **A4** carries client + time + the single most-actionable item (open promise > unanswered question > cooling), deep-linked to the brief |
| | Rank/budget suppressed the one deadline-bound alert → **A5** meeting nudge ranks first + is exempt from the cap |
| | Meetings never persisted / only NL entry → **A6** extraction persists proposed meetings (confirmed:false) + confirm flow; **A7** a direct form + reschedule/delete nudge lifecycle |

### Timezone audit (Task A3 — reported, deliberately NOT fixed here)
Only the nudge path was moved to the rep's clock. Still on **UTC**, a real correctness bug across
three features — a Dubai rep's "Monday Statement" computes at **04:00 Monday local**, and
"silent 21 days" is counted on a clock four hours off their day:
- `monday-service.ts` `mondayOf` (`getUTCDay()`), `priorities-service.ts` `dayOf`
  (`toISOString()` UTC), `scan-service.ts` going-cold (`Date.now()` / `startOfDayUtc`).
- **Recommendation (owner-agreed): its own small batch, next after ASK-CONVO** — reuse
  `zonedTodayIso`/`zonedWallClockToInstant` from `services/time/zone.ts`. Do not leave it living in
  a report.

### The silence-budget exception (Task A5 — recorded, the first)
Brand §10 says "maximum 2 push notifications per rep per day." Pre-meeting nudges are now the
**first documented exception**: they are the only alert with a deadline (a brief is worthless after
the meeting), so a rep with three meetings gets three nudges — meeting nudges are always sent, never
suppressed by the cap, and never consume it. Everything else still shares the cap of 2. Recorded in
the code (`push-dispatch-service.ts`) and in `USER-FLOWS.md` FLOW 18.

### `meeting-nudges` in `/health`
The job is registered on the `ScheduledBrain` (lockKey 4711004, 60s) exactly like the sweep, so it
records to `scheduled_job_runs` and surfaces in `/health` `jobs[]`. **Wired + surfaced; live
confirmation is pending the next deploy** (verify `jobs[]` shows `meeting-nudges` with a recent
`lastRunAt`).

### Direct-creation audit (Task A7)
The direct-creation **API already existed** (`POST /clients/:id/meetings`, `confirmed:true`) — but
the web funnelled every creation through the NL parse box; there was **no no-parse form**. Built:
a client-picker + date + time + optional title form (client required), saving confirmed and
immediately nudge-eligible. NL entry keeps its preview-then-confirm.

### Device-only, still unverified
Actual **push delivery on an iPhone**. The service worker had **no `push`/`notificationclick`
handler at all** — a delivered push showed nothing and a tap went nowhere; A4 adds both (show the
notification, open the deep link). Correct but only exercisable on a real device.

### The pattern worth naming (owner directive)
"Extraction never persists meetings" (A1) means **FLOW 15's natural-language path and the meeting
parts of the Book Scan have effectively never reached the calendar since they were built** — yet
their acceptance tests passed, because they ran against the **in-memory** path. This is the **fourth
instance** of the same shape — *a test proving something the deployed system did not do*: **dark
metrics** (a broken cache went unnoticed because nothing reported the hit rate), **the scheduler
that never ran** (the stub EventBridge Lambda — sweep/priorities/trial-emails silent in prod), **the
import-date reference** (a promise resolved against the import date, not the message date), and now
**meetings never persisting**.

**Why it keeps happening — it is one testing-boundary problem, not four bugs.** The suite exercises
**in-memory adapters and fake runners**; the deployed path (real Postgres, the real scheduler, real
persistence, the real service worker) is a *different code path that the tests never touch*. So a
feature can be fully unit-tested and simultaneously **absent in production** — the in-memory path
passes green while the real path does not exist. Green tests are evidence the *logic* is right; they
are **not** evidence the *wired system* runs, and the two have been silently conflated. The failure
is invisible precisely because a not-running job and a running-with-nothing-to-do job look identical,
and an in-memory pass and a deployed pass read the same in CI.

**The countermeasure** is to test across the boundary, not only inside it: the INV-ISOLATION
integration suite (`test/integration`, real Postgres + real migrations) is the first of these, and
it should grow to cover the deployed seams — scheduler ticks, extraction→persistence, the service
worker — so "tested" and "runs in production" stop being conflated. Until a seam has a real-path
test, its green unit tests should be read as "the logic is correct *if* it runs", not "it runs".

---

## PART B — recall retrieval cap + conversation window

### The measured curve + session-length distribution (Task B1)
Recall was **discarding `res.usage` entirely** — there was no cost visibility at all. B1 records
each turn (turn index, retrieval tokens, history tokens, input/output, cached vs uncached, AED) and
surfaces a rolling per-rep spend + a curve on `/health` under `recall`.

**The load-bearing finding: the batch's founding premise was false.** Ask was **single-shot,
stateless** — there was no conversation, no session table, no history re-sent. So the modelled
"264 multi-turn turns/month with quadratic context growth" measured **a feature that did not exist**;
the real curve was **flat** — every turn was turn 1 with 0 history tokens. That is why B3/B4 were
replaced by ASK-CONVO: rather than cap a runaway that wasn't there, we *built* the multi-turn feature
with a bounded window from the start.

### Retrieval cap (Task B2)
Top-k caps the **item count** and is enforced on the live path by the pg `LIMIT`
(`pg-note-repository.searchSimilarByUser`) — retrieval never grows with book size (a 10k-message
corpus retrieves the same as 100, proven by a repo honouring `limit`). Added a hard cap on the
**total retrieved token budget** (`maxRetrievalTokens`, default 1200), since five long notes can
exceed twenty short ones; receipts are kept greedily within the budget, always at least the closest
match, and the trimmed set is what both the model and the UI see.

---

## ASK-CONVO — 20-turn window + certified fact capture

### The window + its derivation (Tasks 1–2)
A **fixed 20-message verbatim window, no summarisation** (owner decision): the vault is the memory,
so anything older than the window is still reachable through **retrieval**; summarising would add a
call and duplicate what retrieval already does. A session ends after **30 min idle**. History is
conversational continuity only — **never a source of truth**: a fact that exists only in dropped
history (not the vault) returns "I don't have that on record", never a fabrication (tested
deterministically). The recall prompt states **"answer only the latest question"** so a claim is
never re-asserted without re-retrieving its receipt — every citation traces to the current turn.

### Per-turn cost at the window ceiling + the hard maximum (Task 2 / Task 6)
Bounded, not quadratic. At the ceiling, per turn: retrieval ≤ **1200** tok (B2) + ~20-message
history (~**2000** tok) + question/prefix (~130) ≈ **3330 input** tok, output ≤ **512**, on **Haiku**
(1 / 5 USD per Mtok):
```
(3330·1 + 512·5) / 1e6 · 3.6725 ≈ 0.022 AED / turn   ← hard maximum
```
Before (the false model): 264 turns/month with unbounded growth. After (measured shape): a hard
ceiling per turn; even a heavy 264 turns/month ≈ **~5.8 AED/month** worst case, a fraction of
extraction cost and comfortably under the per-user ceiling. The cached prefix stays byte-identical
(guard test); the window rides the variable messages. Recall's Haiku prefix is below the cacheable
minimum, so its cache hit rate is **n/a — below minimum** by design (surfaced honestly, not as 0%).

### Fact capture — the certified path (Task 3)
Three deliberately separate stages: **detect** (cheap, recall model — classifies statement vs
question, conservative), **extract** (the **certified Sonnet engine**, held for confirmation), and
**confirm** (never silent). Recall (Haiku, disqualified for extraction) never writes facts; a
detected statement becomes a pending note run through the certified engine, held out of the vault
until the rep confirms.

- **Question-vs-statement false-positive rate (the number that matters most):** on the deterministic
  detector test set, **0 false positives** — question-shaped inputs, unparseable output, model
  errors, and empty turns all resolve to *not a statement* (conservative by construction: when in
  doubt, do not flag). The rate on **live** Haiku across a realistic set is a model-behaviour figure
  and runs in the keyed harness (see gating below).
- **Detected-statement frequency + cost:** the certified (Sonnet) extraction fires **only** when a
  statement is detected. Ask is a query surface, so statements are the minority of turns; expected
  frequency is low (a handful per active rep per month). Each such extraction is one certified note —
  the same unit cost as any note — so the impact is a small fraction of normal extraction volume.
- **Certified path confirmed:** the capture extraction call uses the certified model + prompt
  version and writes a training-log row, asserted in tests (the log row's model is the certified id,
  not the recall model).
- **Confirmation shows the receipt** — the rep's verbatim words, not a paraphrase.

### The four vault-exclusion guarantees (Task 3)
A pending capture is excluded from **everything** until confirmed:
- **recall retrieval** — held notes have no embedding, so the vector search cannot surface them
  (exclusion by construction — the exact bypass the gate exists to prevent);
- **brief, corpus, Monday, Book Scan, client detail** — all read via one `listByClient` choke point,
  which excludes `pending_confirmation`;
- **going-cold + ledger** — a capture never touches the client or writes a ledger event.
- **reject keeps the training-log row** (migration 0045: `note_id` CASCADE → SET NULL; account
  delete still purges via the user_id cascade; the composite-FK IDOR net preserved);
- **14-day expiry** — stale pending captures auto-expire, removed like a reject.

### Window-boundary behaviour, stated plainly
- A callback to something **in the vault** (even 25 turns back) is answered from **retrieval** — the
  window is only for interpreting the current turn.
- A callback to a fact that exists **only in dropped history** returns **"I don't have that on
  record"** — it does **not** fabricate from history. (Deterministic test: empty retrieval
  mid-conversation stays honest.)

### Voice (Task 4)
Unchanged: a spoken turn is transcribed client-side, fills the same box, and flows through the same
detect → certified-extract → confirm pipeline. No separate path (tested).

### Gated (model-behaviour, keyed harness — local-only forbids spend)
Two ASK-CONVO tests are model-behaviour and belong in the same keyed, budgeted harness as the P1-9
gate (Sonnet/Haiku warm), not the local no-spend suite:
- a pronoun follow-up ("what about the other one?") **resolving correctly** against the window;
- a ≥12-turn **callback** answered from retrieval **or** honestly refused — reporting the
  answered-vs-refused split and the live question-vs-statement false-positive rate.
Everything deterministic (windowing, expiry, token accounting, cap enforcement, detection
conservatism, exclusion, certified-path routing, isolation) is unit-tested at zero model cost.

---

## Follow-ups queued
1. **UTC-timezone batch** (Monday / priorities / going-cold) — next after this, its own small batch.
2. Grow the **real-Postgres integration suite** (`test/integration`) to cover the deployed seams the
   in-memory suite can't — the countermeasure to the pattern named above.
3. Live verification after deploy: `meeting-nudges` in `/health`; push delivery on a device.
