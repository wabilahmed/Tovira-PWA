# Receipt capture-date fix — Task 4: closeout

## Suite / typecheck / lint

- **Full suite GREEN.** Main pool **1642 passed** (was 1636, **+6**); timing pool **21 passed**
  (unchanged). **Total 1663** (was **1657**, **+6**). Zero failures, zero skips.
- **Typecheck clean**; **lint clean** (`eslint .`).
- No model calls (storage + rendering only); every commit `[skip ci]`.

### Delta from 1657 — itemised (all additions; the one existing `withReceipt` unit test was updated to
the new `captureAt` contract, not weakened — same assertion, correct source field)

| Task | Test file | +tests |
|---|---|---|
| 2 | `services/receipts/receipt-capture-date.test.ts` (new) | 5 |
| 2 | `adapters/facts/receipt-persistence.test.ts` (capture_at round-trip) | 1 |
| | **Total** | **+6** |

1636 → 1642 main; 21 timing unchanged; **1657 → 1663** overall.

## Mutation (Task 2) — proven able to fail, then reverted

| Mutation applied | Test that went RED | Reverted |
|---|---|---|
| Reverted `withReceipt` to use the fact's `createdAt` (the original bug) | "IMPORT GAP: a 2024 conversation imported today renders 2024, not today" (rendered the import date `2026-09-19`) + the pre-existing-fact honest-fallback test | ✅ |

## What the fix does (recap)

- Task 1: found `notes.created_at` is import/insert time in both adapters — so neither denormalising
  nor joining it fixes the bug (option c). The conversation date IS carried (message `sentAt`, via
  `referenceDateFor`). Owner confirmed: proceed with option (a) sourced from `referenceDate`.
- Task 2: migration `0065` adds nullable `capture_at text`; extraction stamps it = `referenceDate`
  onto every fact at write time; `withReceipt` uses it; `noteWithReceipts` derives it live via
  `referenceDateFor`. Import receipts now show the conversation date, not the import date.
- Task 3: pre-existing facts (`capture_at` NULL) fall back honestly — no date on aggregate surfaces,
  and the per-note view recomputes the right date live from the note's messages.

## What is sitting UNSHIPPED on main

`main` is **11 commits ahead of `origin/main`, all unpushed, all `[skip ci]`**:
- 2 report-only probes (`21b04e1`, `e14c659`)
- 5 receipt-decoupling commits (`1c537af`, `e94553a`, `cbf37d4`, `06a4442`, `a13a5f7`) + its closeout (`d8f9111`)
- **3 from this batch** (`d61336b` task 1, `1e3eca6` task 2, `1c61cbc` task 3)

(It was 8 ahead before this batch — the receipt-decoupling batch's Task 7 commit brought it to 8;
this batch added 3.)

**Nothing is deployed.** Consequences specific to this batch:
- **Migration `0065` is committed but not shipped.** It adds `capture_at` (additive, nullable, no
  default, no constraint) and runs on boot when a real deploy happens. Until then the column does
  not exist in prod, and the receipt code that reads/writes it is also unshipped, so nothing is
  half-applied.
- Once shipped, `capture_at` populates going forward from `referenceDate`; facts already in prod
  keep `capture_at` NULL and render the honest no-date fallback (Task 3) on aggregate surfaces,
  while the per-note view shows the correct date live for any note that has stored messages.
- To ship: push `main`, then a deploy **without** `[skip ci]` (so migrations run and the code goes
  live) — not performed here.

The working tree still holds only pre-existing untracked files and two unrelated modified files
(`.claude/settings.json`, `tests/staging/PART-B-B2-SPEC.md`), untouched by this batch.

## docs/ — proposed, not applied (guard-protected)

No `docs/` change was required by this fix. For the record, if the team documents storage/receipt
behavior in `docs/`, the note to add is: *facts carry `capture_at` (the note's conversation date)
for the receipt fallback; it is populated from extraction's `referenceDate`, not the note/fact row
creation time.* Not applied (docs/ is guarded).
