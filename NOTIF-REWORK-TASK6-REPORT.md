# Notification rework — Task 6: closeout

## Suite / typecheck / lint

- **Full suite GREEN.** Main pool **1652 passed** (was 1642, **+10 net**); timing pool **21 passed**
  (unchanged). **Total 1673** (was **1663**, **+10 net**). Zero failures, zero skips.
- **Typecheck clean**; **lint clean** (`eslint .`).
- No model calls anywhere; every commit `[skip ci]`.

### Delta from 1663 — itemised (net +10; two files shrank because their cap-era tests describe removed behavior)

| File | Change | Δ |
|---|---|---|
| `services/push/push-dispatch-service.test.ts` | rewritten for the capless contract (was 15 cap-era tests → 8) | **−7** |
| `services/monday/monday-service.test.ts` | 2 push-through-cap tests → 1 no-push test (ruling 3) | **−1** |
| `services/digest/daily-digest-service.test.ts` | new (Task 3) | **+9** |
| `services/notes/import-no-push.test.ts` | new (Task 4) | **+4** |
| `services/hero/group-priorities.test.ts` | new (Task 5) | **+5** |
| | **Net** | **+10** |

1642 → 1652 main; 21 timing unchanged; **1663 → 1673** overall. The two shrinks are tests updated to a
changed spec (the cap was removed by product decision), not weakened tests — each was replaced with a
test of the new behavior, and the cap's own removal is proven by the Task 2 mutation.

## Mutations (Tasks 2–4) — each proven able to fail, then reverted

| Task | Mutation applied | Test that went RED | Reverted |
|---|---|---|---|
| 2 | Reinstated a `slice(0, 2)` cap on the time-critical push list | "three meetings tomorrow produce three prep nudges" | ✅ |
| 3 | Made the digest compute its own findings instead of reading the priorities cache | "READS the precomputed cache and does not recompute" (+ the zero/meetings-only tests) | ✅ |
| 4 | Added `overdue_promise` to `TIME_CRITICAL` (let an import finding push) | "200 discretionary findings + one import-complete → exactly ONE push" | ✅ |

Task 5 specifies no mutation. Task 1 was findings-only.

## What each task delivered

- **Task 1** (`183a3de`) — findings; three ambiguous emitters ruled by the owner (overdue vs
  due-today; date_reminder; monday_digest).
- **Task 2** (`5b40ce3`) — removed the 2/day cap + ranking. Time-critical (`pre_meeting_nudge`,
  `import_complete`, new `promise_due_today`) push uncapped; discretionary recorded-only
  (`heldForDigest`). New `scan.promisesDueToday` emitter. `monday_digest` push dropped (now
  discretionary → in-app only). Dropped the PushBudgetRepository from the dispatcher.
- **Task 3** (`c494e67`) — `DailyDigestService`: one push/rep/day ("N things need you", opens the
  daily list), reads the precomputed priorities cache (never recomputes), discretionary-only count,
  no findings → no push, idempotent per rep-day, `DEFAULT_DIGEST_HOUR = 8` (derivation recorded, not
  settled). New `daily-digest` brain job.
- **Task 4** (`6cf2114`) — locked "imports never push beyond import-complete": findings are
  discretionary → digest/Book Scan/daily list, never individual pushes.
- **Task 5** (`a7eee22`) — `groupPriorities`: `/today` now returns reason-groups ("3 clients
  cooling", …) with counts, empty groups absent, volume gates respected; `actions` retained.

## What is sitting UNSHIPPED on main

`main` is **ahead of `origin/main` and all commits are unpushed, all `[skip ci]`**. Before this batch
it was **12 ahead** (the receipt/probe/capture-date work — the capture-date closeout brought it to 12;
the earlier batch spec's "11" predated that closeout commit). This batch added **6** (Tasks 1–6),
so main is now **18 commits ahead**, none pushed, none deployed.

Consequences specific to this batch:
- The push rework (capless dispatch, `promise_due_today`, the daily digest + its `daily-digest` cron,
  the grouped `/today`) is committed locally but **not pushed and not deployed**.
- **No migration** in this batch. The `push_budget` table and its adapters/`createPushBudgetRepository`
  factory are now **unused** (the dispatcher no longer reads/writes the budget); they are left in place
  to avoid a drop-migration here and are safe to remove in a follow-up.
- To ship: push `main`, then a deploy **without** `[skip ci]` so the new brain jobs register and the
  code goes live — not performed here.

## docs/ — proposed, not applied (guard-protected)

No `docs/` change was required. If the team documents the notification model in `docs/`, the note to
add: *the 2/day silence budget is removed; time-critical alerts (meeting prep, promises due today,
import-complete) push uncapped; all discretionary findings collapse into one daily digest; imports
never push findings; the daily surface groups by reason.* Not applied (docs/ is guarded).
