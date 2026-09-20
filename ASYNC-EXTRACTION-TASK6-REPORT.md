# Async extraction — Task 6: suite / typecheck / lint · delta · mutations · unshipped

## Suite / typecheck / lint
- **Full suite: 258 files / 1721 tests pass** (`npx vitest run --no-file-parallelism`, deterministic).
  The parallel run (`npx vitest run`) intermittently shows ONE failure in a jsdom web test — a
  *different* test each run, all green in isolation: the known concurrency flake
  ([[solo-test-suite-discipline]]), not this batch. No new flake introduced (the changed-area tests —
  App, NotesTimeline, clientsClient — pass together in isolation).
- **Typecheck:** clean (api + web + test). **Lint:** clean.

## Delta from 1701 → 1721 (+20), itemised
| Task | File | +tests | What |
|---|---|---|---|
| 2 | `http/extract-accept-queue.test.ts` (new) | +2 | /extract returns 202 fast, zero in-request model calls; capture processed even without /extract |
| 3 | `services/notes/note-sweep-service.test.ts` | +6 | ceiling skip (+ resume), round-robin fairness, bounded concurrency == K, two-accounts progress, per-pass idempotency |
| 4 | `services/notes/extraction-state.test.ts` (new) | +6 | the four-state vocabulary + aggregate |
| 4 | `http/extraction-visibility.test.ts` (new) | +2 | queued→done transition + aggregate; a failed note reads as failed |
| 4 | `clients/NotesTimeline.test.tsx` | +2 | distinct FAILED state; queued vs processing |
| 4 | `clients/clientsClient.test.ts` | +2 | extractionStateOf + anyExtractionInProgress |

Plus **9 HTTP suites adapted** in Task 2 (no net count change) to drive the real sweep instead of a
synchronous `/extract` drain — assertions unchanged, only the drive mechanism moved to the async path.

## Every mutation this batch (proven able to fail, then reverted)
| Task | Guard | Mutation | Result | Reverted |
|---|---|---|---|---|
| 2 | no model call in the request path | restore the inline `extractNote` call in the route | latency + no-call test RED (request blocked 2s, model called) | ✅ |
| 3 | ceiling→needs_review fix (sweep skips a ceilinged rep) | remove the `allow` skip in the sweep | 2 RED (ceilinged note extracted + attempt-bumped) | ✅ |
| 4 | a failure reads as failed | map `needs_review`/`import_failed` → `processing` in extractionState | 3 RED (failed surfaced as processing) | ✅ |

## Unshipped on `main` (nothing pushed, nothing deployed)
`main` is **10 commits ahead of `origin/main`**, all `[skip ci]`. The 6 before this batch were named in
the batch; this batch added 4:

| commit | batch / task |
|---|---|
| `04949ed` | Batch B — concurrent leak test |
| `3033184` `5e1dc8d` `f8458af` `be50260` `41c60fa` | Trial-farming Tasks 1–5 |
| `dfddb27` | Async Task 1 — findings |
| `e13b28c` | Async Task 2 — accept & queue |
| `a73abb9` | Async Task 3 — sweep primary (ceiling fix, fairness, concurrency) |
| `cc4cc78` | Async Task 4 — visible state |

Per your direction, these batch into ONE push with the trial-farming work once this async work lands, so
one deployment is verified. New in this batch that applies on that deploy: config env
`SWEEP_CONCURRENCY` (default 5) and the brain tick change (30s→15s). No migration this batch.

## Open / awaiting you
- **Task 5 (Book Scan async behaviour)** — options reported in `ASYNC-EXTRACTION-TASK5-BOOKSCAN.md`;
  NOT picked. Needs your decision (wait / stream-in / partial).
- Derivations flagged NOT settled: `SWEEP_CONCURRENCY=5` (revisit vs real Bedrock TPM/RPM at pilot
  scale). Trial-farming's numbers (trial cap 15, trial ceiling 100, paid 2000) also still open.
- `docs/tovira-spec.md` §5g edit (trial-farming) remains blocked by the guard hook — ready-to-paste in
  `TRIAL-FARMING-DOCS-CHANGES.md`.
