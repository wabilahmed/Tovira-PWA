# Book Scan streaming — Task 6: suite / typecheck / lint · delta · mutations · unshipped

## Suite / typecheck / lint
- **Full suite: 260 files / 1734 tests pass** (`npx vitest run --no-file-parallelism`, deterministic).
  The parallel run still intermittently shows the one known jsdom/scrypt timing flake under machine load
  (green in isolation) — not this batch. ([[solo-test-suite-discipline]])
- **Typecheck:** clean (api + web + test). **Lint:** clean (3 trivial issues introduced during the batch
  — an unused `useRef` import, a `let`→`const`, an unused test-helper arg — all fixed).

## Delta from 1721 → 1734 (+13), itemised
| Task | File | +tests | What |
|---|---|---|---|
| 2 | `services/book-scan/book-scan-service.test.ts` | +3 | scanProgress counts; failed stays in the denominator; empty account is done/zero |
| 2 | `bookscan/BookScan.test.tsx` | +3 | mid-scan-zero → scanning (not empty); done-zero → empty; failed visible in progress |
| 3 | `bookscan/streaming.test.ts` (new) | +4 | findingId identity; three-poll arrival order; earlier finding never moves on server reorder; idempotent re-see |
| 4 | `bookscan/BookScan.polling.test.tsx` (new) | +3 | polls while working & STOPS on done; keeps polling while working; correct state after remount mid-scan |

## Every mutation this batch (proven able to fail, then reverted)
| Task | Guard | Mutation | Result | Reverted |
|---|---|---|---|---|
| 2 | mid-scan-zero must read as scanning, not empty | gate the empty state on `isEmpty` alone (ignore `scanning`) | 2 RED (mid-scan-zero rendered the empty state) | ✅ |
| 3 | findings append, never resort | `appendFindings` sorts the full list every poll | 3 RED (arrival order broken; an earlier finding moved) | ✅ |
| 4 | polling stops on completion | remove the stop condition (poll forever) | 1 RED (called 7× instead of 2×) | ✅ |

## What is unshipped on `main` (nothing pushed, nothing deployed)
`main` is **15 commits ahead of `origin/main`**, all `[skip ci]`. The 10 before this batch (Batch B +
trial-farming + async-extraction) were named in the batch; this batch added 5:

| commit | task |
|---|---|
| `153e4d0` | Book Scan stream Task 1 — findings (STOP: scope decision) |
| `993e388` | Task 2 — progress that can't be mistaken for completion |
| `59cb24f` | Tasks 3+4 — append-never-resort + polling that stops on done |
| `b7df19d` | Task 5 — mobile (sticky progress) |
| (this) | Task 6 — suite/lint + this report |

Per your standing direction, these batch into ONE push with the trial-farming and async-extraction work,
so a single deployment is verified. This batch adds **no new config, no migration** — it is Book Scan
UI + a `scanProgress` field on the existing `GET /book-scan` response.

## Notes / still open (unchanged by this batch)
- Scope is **account-wide over imported chats** (Option A, your decision) — equals the import on day one;
  a returning rep sees whole-book progress (accepted).
- Findings are rendered as a **flat arrival-ordered list** (the section-grouped reveal was incompatible
  with append-never-resort, as flagged in Task 1 and confirmed by you); each finding still shows its kind
  via its headline.
- Prior open items remain: the trial-farming `docs/tovira-spec.md` §5g edit (guard-blocked; ready-to-paste
  in `TRIAL-FARMING-DOCS-CHANGES.md`), and the not-settled derivations (trial cap 15, trial ceiling 100,
  paid 2000, SWEEP_CONCURRENCY 5).
