# Single-counterparty erasure — Task 6: closeout

## Suite / typecheck / lint

- **Full suite GREEN.** Main pool **1669 passed** (was 1652, **+17**); timing pool **21** (unchanged).
  **Total 1690** (was **1673**, **+17**). Zero failures, zero skips.
- **Typecheck clean**; **lint clean** (`eslint .`).
- No model calls anywhere (deterministic + name-match only); every commit `[skip ci]`.

### Delta from 1673 — itemised (all additions)

| Task | Test file | +tests |
|---|---|---|
| 2 | `services/erasure/erasure-service.test.ts` | 7 |
| 3 | `services/erasure/erasure-embeddings.test.ts` | 2 |
| 4 | `services/erasure/erasure-request-service.test.ts` | 5 |
| 5 | `http/ops-erasure.test.ts` | 3 |
| | **Total** | **+17** |

1652 → 1669 main; 21 timing unchanged; **1673 → 1690** overall. (The push-dispatch `TIME_CRITICAL`
assertion and the wiring guard were updated for the two new notification types — no test count change.)

## Mutations — each proven able to fail, then reverted

The batch requires every **erasure-correctness** test be proven able to fail. The two correctness
gates are the about-vs-mention rule (Task 2) and the retention window (Task 4):

| Task | Mutation applied | Test that went RED | Reverted |
|---|---|---|---|
| 2 | Made the deleter also remove mentioning promises | "a fact merely MENTIONING the requester survives, receipt byte-identical" | ✅ |
| 4 | Removed the window guard in `complete()` | "does NOT erase before the window closes" | ✅ |

Tasks 3 (embeddings — report + bounded action) and 5 (intake path) carry no erasure-correctness
assertion of their own, so no mutation was required there.

## What each task delivered

- **Task 1** (`0e7c00d`) — findings; the crux (no third-party entity; attribution is name-match;
  aliases are per-client) and the owner's rulings (auto exact-match + confirm fuzzy; keep mentions,
  operator may flag; purge training logs/archive).
- **Task 2** (`db1a187`) — `ErasureService`: preview + commit + audit. Deletes structured who-field
  facts on exact name/alias match, keeps free-text mentions byte-identical, purges matching log rows,
  records category counts (no content). No model.
- **Task 3** (`5939812`) — clears the embedding of a note WHOLLY the requester's; leaves a shared
  note's blended vector (reported residual — re-embedding is a model call, out of scope).
- **Task 4** (`2289fbf`) — `ErasureRequestService`: the rep is told (in-app + pushed, not silent) it's
  a legal request they can't decline, gets the Terms-4.9 retention window (default 14 days, derivation
  recorded, not settled), and is told what was removed on completion.
- **Task 5** (`8d95ea5`) — operator ops-token route `/ops/erasure/*` with anti-enumeration (unauth ==
  unknown-counterparty, byte-identical); persistent via migration 0066 + pg adapters, wired in index.ts.

## What is sitting UNSHIPPED on main

`main` is **24 commits ahead of `origin/main` and all unpushed, all `[skip ci]`** (18 before this
batch + 5 tasks + this closeout). None pushed, none deployed. Consequences specific to this batch:
- The erasure feature (service, request/window, operator route) is committed locally but **not pushed
  and not deployed**; the `/ops/erasure/*` routes are not reachable in production yet.
- **Migration 0066** (`erasure_requests`, `erasure_audit`) is committed but **not applied** — it runs
  on boot on a real deploy. Until then the pg adapters have no tables; the running app would need the
  migration before the ops route works against Postgres.
- To ship: push `main`, then a deploy **without** `[skip ci]` so 0066 runs and the code goes live.

## Known residuals / follow-ups (reported, not silently dropped)

1. **Shared-note embeddings** retain the requester's contribution until a re-embed pass (a model call);
   Task 3 documents the search-quality consequence.
2. **Training ARCHIVE (object storage JSONL)**: the hot extraction-log table is purged by name-match
   (ruling 3), but per-row purge of archived JSONL blobs (outside the DB cascade) is not implemented in
   this batch — the archive already has an account-level purge on full deletion; per-requester archive
   purge is a scoped follow-up.
3. **Fuzzy-match confirmation UI** and **operator flag-to-delete for a free-text mention** are supported
   in the service contract; the operator currently drives them via the preview + confirm inputs, not a
   dedicated UI (out of scope — no public/self-service surface).

## docs/ — proposed, not applied (guard-protected)

No `docs/` change was required. If the team documents erasure in `docs/`, note: erasure deletes facts
whose STRUCTURED who-field is the requester (exact/alias match) + their own messages + matching training
logs; keeps free-text mentions byte-identical; has a 14-day retention window; is operator-run via an
ops-token route with anti-enumeration; and leaves shared-note embeddings as a reported residual. Not
applied (docs/ is guarded).
