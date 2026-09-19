# RECEIPTS v0.9.5 — Task 7: batch closeout

## Suite / typecheck / lint

- **Full suite GREEN.** Main pool **1636 passed** (was 1601, **+35**); timing pool **21 passed**
  (unchanged). **Total 1657** (was **1622**, **+35**). Zero failures, zero skips.
- **Typecheck clean** (`tsc` across api / web / test projects).
- **Lint clean** (`eslint .`).
- No model calls in this batch (storage / rendering / gate-scoring only), so credit/gate posture was
  irrelevant; every commit is `[skip ci]`.

### Delta from 1622 — itemised (all additions; no test was changed or removed)

| Task | Test file | +tests |
|---|---|---|
| 2 | `adapters/facts/receipt-persistence.test.ts` | 8 |
| 2 | `adapters/meetings/receipt-persistence.test.ts` | 4 |
| 3 | `services/receipts/receipt.test.ts` | 7 |
| 3 | `services/receipts/receipt-render.integration.test.ts` | 2 |
| 4 | `services/receipts/receipt-gap.test.ts` | 4 |
| 5 | `eval/receipt-score.test.ts` | 10 |
| | **Total** | **+35** |

1601 → 1636 main; 21 timing unchanged; **1622 → 1657** overall. (One pre-existing test still logs an
`[account] archive purge incomplete` line to stderr by design — it asserts the 500 path and passes.)

## Every mutation (Tasks 2–5) — each proven able to fail, then reverted

| Task | Mutation applied | Test that went RED | Reverted |
|---|---|---|---|
| 2 | Removed `source_span` from the promises INSERT column list (`pg-facts-repository.ts`) | "the promises INSERT names both receipt columns and binds their values" | ✅ |
| 3 | Made `noteWithReceipts` source the quote from `note.rawText` | "receipts survive raw_text deletion" (both cases) | ✅ |
| 4 | Defaulted the span-less branch of `buildReceipt` to `source:'message'` ("has receipt") | all 4 honest-gap tests | ✅ |
| 5 | Forced `spanFaithful` to always return `true` | the 3 fabricated-span assertions in `receipt-score.test.ts` | ✅ |

Each mutation was applied, the suite confirmed red on exactly the intended compliance test(s), and the
change was reverted before committing. Post-revert state is what shipped in each task commit.

## What each task delivered

- **Task 2** (`1c537af`) — `source_span`/`source_message_at` persist through promises, key_dates,
  meetings (types, INSERT columns + params, COLUMNS reads, toRecord). people/personal_facts confirmed
  to need no repo change (JSONB via `asExtraction` spread) — tested and stated in the commit.
- **Task 3** (`e94553a`) — new `services/receipts/receipt.ts` renders per-fact receipts from stored
  spans only (never `raw_text`), wired into promise tracker, confirmations, promise PATCH, meeting
  list/create/edit/confirm, brief (promises + people/personal_facts), insights (stakeholders +
  personal facts), and the per-note view; fixed `aggregatePeople`'s merge-path receipt drop. relatedNotes
  left untouched. Book Scan's own synthesized receipt and DSAR export left as-is (reported).
- **Task 4** (`cbf37d4`) — pre-v0.9.5 / span-less facts render an honest no-receipt marker driven by
  `source_span IS NULL` (no date logic); `RECEIPTS-V095-BACKFILL-GAP.md` carries the exact production
  count SQL (relational + JSONB). No reconstruction attempted.
- **Task 5** (`06a4442`) — `scoreReceipts` + transliteration-aware `spanFaithful` + `GATE_RECEIPTS`
  in `score.ts`, wired into the gate runner's per-run HARD pass (typecheck-validated; the live gate
  needs a model key, out of scope here).
- **Task 6** (`a13a5f7`) — `RECEIPTS-V095-DELETION-READINESS.md`: receipts are decoupled, but raw_text
  still powers Ask, Ask-capture, follow-up drafting, Book Scan, and relatedNotes; deletion remains a
  retention trade-off for the owner, presented without a recommendation.

## What is sitting UNSHIPPED on main

`main` is **7 commits ahead of `origin/main`, all unpushed** — the 2 report-only probe commits
(`21b04e1`, `e14c659`) plus the 5 receipt-batch commits (Tasks 2–6). **Every one carries `[skip ci]`**,
so even once pushed they will **not auto-deploy**. Consequences:

- The receipt **persistence wiring** (Task 2), **rendering** (Tasks 3–4), and **gate scoring** (Task 5)
  are committed to local main but are **NOT live in production** and **NOT pushed to origin**.
- Migration `0064` (the nullable receipt columns) was shipped earlier this session (`d0dec35`, a normal
  CI deploy) and is already applied in prod, so the columns exist there; only the code that reads/writes
  and renders them is unshipped.
- To ship: push `main`, then a deploy must run **without** `[skip ci]` (a normal commit, a manual
  deploy, or re-triggering the pipeline) — none of which this batch performed.

Nothing outside the receipt work was modified. The working tree still holds only pre-existing untracked
files and two unrelated modified files (`.claude/settings.json`, `tests/staging/PART-B-B2-SPEC.md`) that
predate this batch and were left untouched.
