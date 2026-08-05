# Post-Audit Fixes — Report

Six tasks, worked in order, one commit each, tests-first per CLAUDE.md. No test
was weakened to pass. Full suite green after every task; typecheck + lint clean.

## Test counts (full `npm test`, before → after)

| Point | Tests | Δ |
|---|---|---|
| Baseline (before batch) | 651 | — |
| After TASK 1 `fix(CG3)` | 670 | +19 |
| After TASK 2 `feat(ROUTING)` | 685 | +15 |
| After TASK 3 `feat(P5-1-UI)` | 699 | +14 |
| After TASK 4 `feat(P5-1-CEILING-UI)` | 711 | +12 |
| After TASK 5 `feat(P4-7-PHONE)` | 729 | +18 |
| After TASK 6 `docs(SYNC)` (docs only) | 729 | +0 |
| **Total** | **729** | **+78** |

Integration (real Postgres) 10 · E2E (Playwright) 3 — unchanged. DB migrations
0001–0025.

---

## TASK 1 — `fix(CG3)` cost-guard #3: nightly-precomputed daily priorities
Commit `cfc21c8`.

- New `PrioritiesRepository` port + in-memory & pg (`daily_priorities`, RLS,
  migration 0024) adapters keyed `(user_id, day)`.
- New `PrioritiesService`: `precompute`/`precomputeAll` (idempotent — skips a day
  already computed), `getForToday` (cache hit → **zero** model calls), `refresh`
  (server-side rate limit, default 2/rep/day → `RefreshLimitError`),
  `refreshesRemaining`. Grounded ranking (reorder/select only; garbage → keep all,
  never fabricate); empty data → `[]` with no model call.
- Registered as a nightly job on the existing `Scheduler` seam
  (`priorities-nightly` → `precomputeAll(allUserIds, now)`), same port as the cold
  scan / Monday digest.
- `GET /today` serves the stored result and returns `{ actions, refreshesRemaining }`;
  `POST /today/refresh` is rate-limited (429 on limit). New signup mid-day →
  compute-once-on-first-open, then serve stored.
- Frontend: `/today` renders the cache; a Refresh button reflects the remaining
  count / rate-limit state and disables at 0.

### Measured `/today` call-count proof (cost guard)
From `apps/api/src/services/hero/priorities-service.test.ts`, run and passing:

```
✓ serves the cache on reads — 10 opens after a precompute = ZERO extra model calls
✓ computes once on first open, then serves the stored copy
✓ rate-limits manual refresh to 2 per rep per day
```

- After one nightly `precompute`, the counting model shows **1** call; **10**
  subsequent `/today` opens keep it at **1** (reads never recompute).
- With no precompute, **10** first-day opens = exactly **1** computation.
- `precompute` twice the same night = still **1** call (idempotent).
- 2 refreshes succeed (calls 2→3), the 3rd throws `RefreshLimitError` and never
  computes. → **exactly one priorities computation per rep per day**, plus at most
  2 rep-initiated refreshes.

---

## TASK 2 — `feat(ROUTING)` hybrid per-task-class model routing
Commit `4bb343b`.

- `config.models: Record<AiTaskClass, string>` for all eight classes
  (`extraction, recall, brief, priorities, summaries, patterns, drafts, card_scan`).
  Defaults: **extraction = Sonnet 5** (P1-9 gate lock), **all others = Haiku 4.5**.
  Each class is overridable via `MODEL_<CLASS>` (and the family defaults via
  `ANTHROPIC_MODEL` / `HAIKU_MODEL`) with no code change.
- `createModelClient(config, taskClass='extraction')` selects only the **model id**
  — never the system prompt. Recall → `recall`, priorities → `priorities`,
  follow-up → `drafts`; extraction and meeting-parse stay on Sonnet.
- Cache correctness verified: Haiku and Sonnet get different model ids (separate
  caches); the extraction cacheable prefix stays byte-identical regardless of how
  other classes are routed; routing injects no variable content into any cached
  prefix. Non-extraction calls never touch the extraction training log.
- All existing grounding tests pass unchanged on the new defaults.

Card scanner note: `card_scan` is defined as a config class (Haiku default,
overridable) but the current card scanner is a vision stub with **no ModelClient**
consumer yet — the setting is ready for when the vision model is wired.

---

## TASK 3 — `feat(P5-1-UI)` trial-extension incentive UI
Commit `2fe053a`. **Ordering note:** implemented in order but, due to a slip, not
committed until after TASK 4–6; it now sits at the tip. All six are committed and
the committed HEAD is green (verified in isolation — see below).

- `BillingService.extensionIncentive(userId, distinctClientsWithNotes, now)` —
  server owns eligibility; returns `progress | earned | hidden` with
  `distinctClients / needed(3) / remaining / extensionDays(7) / trialEndsAt`.
  Constants `TRIAL_EXTENSION_MIN_CLIENTS`/`_DAYS` shared with the extension
  trigger so progress can never disagree with what actually earns +7 days.
- `GET /billing/incentive` computes the distinct-clients-with-notes count with the
  **same** helper the capture path uses (`countDistinctClientsWithNotes`) — no
  client-side eligibility math.
- Web `TrialIncentive`: unearned-with-progress ("Notes on 2 of 3 clients — capture
  one more…"), earned (celebration + the server's new trial end), already-extended
  (hidden after a one-time local dismissal), converted-to-paid/expired (hidden).
  `BillingClient.incentive()` falls back to `hidden` on any error.

---

## TASK 4 — `feat(P5-1-CEILING-UI)` seeding-ceiling message
Commit `6bef2a2`.

- Import route surfaces `ceilingReached` (server-side signal) when the trial
  ceiling refused extraction; the chat is still saved (`pending_extraction`, not
  failed) and the processed portion is reported. The per-note extract endpoint
  already returns `status: 'trial_limit'`.
- Reusable `CeilingNotice` (data-safe, "upgrade to scan the rest", never "failed")
  shown in both `ImportChat` and the extracted `NotesTimeline`.
- `NotesTimeline` renders ceiling-blocked notes in the non-scary state and stops
  retrying them; `ClientDetail` tracks the blocked ids from the extract response.
  No client-side ceiling math (the existing "note untouched on trial_limit"
  extraction test is unchanged).

---

## TASK 5 — `feat(P4-7-PHONE)` optional client phone → targeted WhatsApp link
Commit `ac5cae3`.

- `ClientRecord.phone` (migration 0025) across port + in-memory + pg repos, stored
  as entered — never rewritten, never a guessed country code. `create(userId,
  name, phone?)` and `setPhone(userId, id, phone)`; RLS keeps it tenant-isolated.
- HTTP: `POST /clients` accepts `phone`; `PATCH /clients/:id` sets it; a rep can
  never set another rep's client phone (404).
- `whatsappLink` now requires an explicit country code (`+` or `00`) to target a
  contact; a bare local number or malformed input falls back to the WhatsApp
  picker rather than dialling the wrong person.
- Web: manual entry (`ClientPhoneField`) in the client detail; auto-offered,
  confirm-before-save phone from the card scan (`CardScan` → `onCreateClient(name,
  phone?)`); threaded into the follow-up draft's `wa.me` link.

---

## TASK 6 — `docs(SYNC)` sync v0.2 / go-live docs
Commit `69a8579`.

- Committed the human-owned v0.2 documents (not authored by the agent):
  `tovira-extraction-prompt.md` → v0.2 (multilingual Rule 0, `unanswered_questions`
  schema field, chat-export-only rule, version bump) and `tovira-aws-infra.md` →
  go-live budget & unit-economics section.
- **Schema verification (v0.2):** the implemented extraction schema matches on both
  named points — `unanswered_questions` is in the output type, and the
  chat-export-only rule is enforced (`extraction-service.ts:97` derives it via
  `detectUnansweredQuestions` **only** when `note.messages` exist; voice/paste get
  `[]`). No drift on the named criteria → did not stop.
- **Recorded in `BLOCKERS.md` (2 open items):**
  1. TASK 6 asked to update `docs/PROJECT-STATUS.md`, but the repo guard hook
     (`.claude/hooks/guard-protected-files.sh`) blocks **all** edits under `docs/`
     and directs changes to BLOCKERS.md. The guard was **not** overridden — the
     status doc needs a human update (or a guard exception). Stale spots listed.
  2. Benign nuance (not schema drift): the prompt file is still labelled
     `tovira-extract-v0.1` and derives `unanswered_questions` deterministically in
     code rather than via the model; the multilingual Rule 0 text isn't in the
     model prompt. Flagged so the v0.1/v0.2 label is a conscious human decision.

---

## Definition of done
- [x] All six committed: `cfc21c8` (CG3), `4bb343b` (ROUTING), `2fe053a` (P5-1-UI),
      `6bef2a2` (P5-1-CEILING-UI), `ac5cae3` (P4-7-PHONE), `69a8579` (docs SYNC).
      (P5-1-UI landed at the tip due to an ordering slip — see TASK 3 above.)
- [x] Full suite green on the **committed HEAD**, verified with the working tree
      stashed: 131 test files, **729 tests passing** (exit 0); integration 10,
      e2e 3.
- [x] Typecheck + lint clean.
- [x] No test weakened.
- [x] Unresolved questions in `BLOCKERS.md`.
- [x] This report with per-task changes, before/after counts, and the measured
      `/today` call-count proof.

**One item needs you:** `docs/PROJECT-STATUS.md` is guard-protected and could not
be updated by the agent (see BLOCKERS.md). Everything else is done.
