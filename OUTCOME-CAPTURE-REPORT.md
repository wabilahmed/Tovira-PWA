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

---

# Follow-up batch (deal outcome corrections)

## FOLLOWUP-1 — "still open" is a snooze, not a pin
Tapping "still open" no longer writes `outcome_source='rep'`. It clears to the untouched default
(`outcome='open'`, source unset) and resets the going-quiet clock, so the client stays eligible for a
later inference run. `won` / `lost_confirmed` still write `source='rep'` and still win over inference.

## FOLLOWUP-2 — outcome-transition history
`client_outcome_history` (mig 0062) is an append-only log of every transition (previous, new, actor
source, when), written at the repository chokepoint. Isolation mirrors `clients` (RLS FORCE + composite
FK); append-only via `GRANT SELECT, INSERT` only; purged on account deletion by the `users` FK cascade
(the same path that purges `extraction_logs`/`corrections` — verified against `AccountService.
deleteAccount → auth.deleteUser`, not assumed) and, in-memory, by the clients repo's `purgeUser`.

## FOLLOWUP-3 — the `last_touched_at` caveat (no behaviour change)

The `lost_inferred` rule operationalises "no message in either direction" on `clients.last_touched_at`,
which is a **touched-the-client clock, not a message clock**. Every action below resets it.

**Exhaustive list of what resets `last_touched_at` (from the code):**

*On insert (column `DEFAULT now()`, `0005`):*
- Creating a client — `clients.create` (`POST /clients`, `clients-routes.ts`).

*Via `touch()` → `UPDATE ... last_touched_at = now()` (`pg-client-repository.ts:95`):*
- `notes-routes.ts:151` — capturing a **voice note**.
- `notes-routes.ts:186` — capturing a **paste note**.
- `notes-routes.ts:349` — importing a **WhatsApp chat export**.
- `meetings-routes.ts:121` — logging a **confirmed meeting**.
- `images-routes.ts:54` — uploading an **image** (e.g. a business card) to a client.
- `ask-capture-service.ts:99` — **confirming a pending Ask-captured fact** into the vault.
- `clients-routes.ts:66` — the **"still open" snooze** (FOLLOWUP-1).

*Via `setLastTouched()` → `UPDATE ... = to_timestamp(ms)` (`pg-client-repository.ts:101`):*
- `adapters/notes/{pg,in-memory}-note-move-tx.ts` — recomputing the clock after a **misfiled note is
  moved** between clients (and restoring it on undo).

**Which of these involve no client contact at all:**
- Creating a client (administrative).
- The "still open" snooze (pure review).
- Confirming an Ask-captured fact (review / curation — "adding a fact").
- Uploading a business card / image (administrative).
- Moving a misfiled note / undo (reorganisation).

(The voice/paste/import captures and the meeting log *follow* a real interaction, but the timestamp is
the capture/log time, not the contact time — for import specifically this is the existing
import-recency caveat above: an old thread imported today reads as fresh.)

**The resulting distortion:** a diligent book-reviewer — someone who curates, files misplaced notes,
confirms Ask facts, taps "still open", scans cards, adds client records — keeps bumping
`last_touched_at` **without ever contacting the client**. Their genuinely dormant deals keep looking
active, the 90-day silence never elapses, and they **under-infer losses**. A rep who only ever captures
right after real contact has a truer clock. So `lost_inferred` rates are confounded by curation
behaviour, not deal health alone.

**`outcome_source` does not distinguish this case:** a distorted inferred loss and an undistorted one
both read `source='inferred'`. Nothing records *why* the clock sat where it did. (The new history table
records the actor of each transition, but not the actions that were resetting the clock in between.)

### What a true "last-message-either-direction" clock would take (reported, NOT implemented)

- **Imported WhatsApp threads already carry it, without extraction.** Each stored `ImportedMessage` has
  `sentAt` plus a `role` (`client` / `rep` / `unknown`) derived by a deterministic sender-vs-client-name
  **string match** (`services/import/unanswered.ts`), no model call. So `max(sentAt)` + `role` yields a
  true last-message time *and its direction* for any imported thread — derivable today from data already
  stored, purely by parsing.
- **Pastes and voice notes cannot, without extraction.** They hold free text / audio with no
  message-level timestamp or direction; recovering a message date/direction from their content needs a
  model call — out of scope by this batch's rules.
- **Nothing keeps it current.** The product has no live WhatsApp connection by design ("No WhatsApp
  access" — security §7 / FAQ), so even a perfect parse only knows messages up to the **last import**;
  between imports the clock goes stale. A genuinely current message clock would need either re-import
  discipline or an integration the product deliberately refuses.
- **Net:** partially achievable without extraction — for imported threads, from stored parse metadata —
  but not for pastes/voice, and not kept current without re-import. It would be a separate batch; this
  one changes no behaviour.

## Task 6 — suite, typecheck, lint

- **Full suite: 1591 passed / 228 files / 0 failures.** Delta from 1566 = **+25**, all new tests:
  client-outcome (5), outcome-inference (6), outcome endpoint (7), OutcomeControl (4), Alerts (+2),
  MondayDigest (+1). File count +3 = the three new test files. Nothing else moved.
- **Typecheck clean · lint clean.**
- **Follow-up batch — full suite: 1599 tests / 229 files, delta from 1591 = +8, all accounted for:**
  `client-outcome-history.test.ts` **+7** (new file); `outcome-inference-service.test.ts` **+1 net**
  (replaced the now-defunct "rep-set still open" test with two — "rep-confirmed loss is never
  re-inferred" and "a snoozed still-open client is NOT exempt"); `clients.test.ts` **+0** (the
  reversible test was reworded to assert source-unset, not added). File count **+1** = the new history
  test file. No production tests changed count.
- **All green in an un-contended run: 1599 / 1599 passed, 0 failures** (`vitest run --no-file-parallelism`,
  198 s). A separate heavily-parallel run showed 1598 + 1 failure — the documented `share-referral.test.ts`
  crediting-timeout flake (2000 ms tolerance, measured 2176 ms under load); it passes solo and in the
  un-contended full run, and is unrelated to this batch.
- **Typecheck clean · lint clean.**

## Unshipped on main

This batch adds, on top of the existing credit-blocked backlog (TRIAL-14, homepage audit, security /
referral / spend work): migration `0061_client_outcome.sql`, the outcome field + `setOutcome` /
`clearOutcome`, the nightly `outcomes-inference` job, `POST /clients/:id/outcome`, and the
`OutcomeControl` on the alerts + Monday surfaces. All sit on `main` behind `[skip ci]` — no gate, no
deploy. `0061` has been validated only in-memory (per the migrations-live-only rule); it applies live
on the next `docker compose up` / real deploy.
