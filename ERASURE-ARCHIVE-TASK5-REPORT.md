# Training-archive erasure — Task 5: closeout

## Suite / typecheck / lint

- **Full suite GREEN.** Main pool **1678 passed** (was 1669, **+9**); timing pool **21** (unchanged).
  **Total 1699** (was **1690**, **+9**). Zero failures, zero skips.
- **Typecheck clean**; **lint clean** (`eslint .`). No model calls; every commit `[skip ci]`.

### Delta from 1690 — itemised (all additions)

| Task | Test file | +tests |
|---|---|---|
| 2 | `services/erasure/erasure-archive.test.ts` | 6 |
| 3 | `services/erasure/erasure-archive-audit.test.ts` | 2 |
| 4 | `services/erasure/erasure-archive-gate.test.ts` | 1 |
| | **Total** | **+9** |

1669 → 1678 main; 21 timing unchanged; **1690 → 1699** overall.

## Mutations — each proven able to fail, then reverted

| Task | Mutation applied | Test that went RED | Reverted |
|---|---|---|---|
| 2 | Made `commit` skip the archive purge (`if (false && …)`) | "an exact-match archive row is purged" + "counts the archive rows purged" | ✅ |
| 4 | Marked the request completed despite a commit failure | "archive unreachable → the erasure does NOT complete, stays open" | ✅ |

Tasks 1 (findings) and 3 (audit assertions) carry no erasure-correctness gate of their own beyond
what Tasks 2/4 mutations already prove.

## What each task delivered

- **Task 1** (`9e455a7`) — findings: archive objects are per (collection, account, month), findable
  by account via `index.listByUser` (no full-archive scan), NDJSON, rewritable in place. No STOP.
- **Task 2** (`3eb8429`) — `ErasureService` preview + commit now cover the archive: `classifyArchiveRow`
  parses each row's `rawOutput` and applies the SAME who-field rule (exact → auto-purge whole row;
  fuzzy → operator-confirm; mention → keep). Purges archive-first (fail-loud, retryable), rewrites
  survivors, re-indexes; idempotent; cross-account isolated; counted as `training_archive`. Preview
  lists archive rows in the same list as DB rows. Wired in `index.ts`.
- **Task 3** (`7aaa343`) — audit proves archive coverage (a `training_archive` category + count) and
  holds no erased content (no fact text, no `rawOutput`, no row id) — only requester name(s) + counts.
- **Task 4** (`8a90e6c`) — the gate: `complete()` wraps `commit`; on any failure (object store
  unreachable) it does NOT complete and does NOT notify — the request stays OPEN, the error surfaces,
  retryable. Never a silent gap.

## Are Privacy Policy §10 and Terms 4.9 now honest?

**Substantially yes — with one explicitly accepted residual, named below.** Erasure now removes the
requester's data from every store that holds it as content or a structured subject:
- DB (JSONB): `people`, `personal_facts`, `unanswered_questions` about them; their own `messages`
  (with `rawText` re-rendered).
- Hot training logs (`extraction_logs`) referencing them.
- **Training ARCHIVE** (object storage, `extraction_logs` + `corrections` blobs) — the store this
  batch closed. It is now part of the same preview → commit → audit flow and gated (an erasure cannot
  complete unless the archive purge ran).
- Wholly-requester note embeddings (cleared).

**Accepted residual 1 (named, not omitted): shared-note blended embeddings.** A note involving the
requester and others has ONE embedding over the whole note text; the requester's contribution cannot
be removed without re-embedding the redacted text — a model/embedder call, which is **out of scope
(no model calls)**. This is a non-content vector trace (not the name or the facts, which are erased),
accepted here and tracked for a re-embed follow-up. Every store holding the requester's **content or
identity** is now covered; the only remaining trace is this blended vector.

**One consistency note (not a correctness gap): hot-log vs archive classification.** The shipped HOT
extraction-log purge uses a blanket name-match → purge (ruling 3); the ARCHIVE (this batch) uses the
finer exact/fuzzy/mention rule the DB fact stores use. So a mention-only training row is purged while
hot but kept once archived. Both are defensible (the hot rule is stricter); realigning them is a
possible follow-up. Flagged, not silently left.

## What is sitting UNSHIPPED on main

`main` is **28 commits ahead of `origin/main`, all unpushed, all `[skip ci]`** (24 before this batch +
Tasks 1–4). None pushed, none deployed. The erasure feature — including this archive coverage — is
committed locally only. Migration 0066 (from the prior batch) remains committed-not-applied; this
batch added **no new migration** (the archive is object storage + the existing archive index). To
ship: push `main`, then a deploy **without** `[skip ci]`.

## docs/ — proposed, not applied (guard-protected)

No `docs/` change required. If erasure is documented in `docs/`, add: erasure now covers the training
archive (object-storage blobs) under the same about-vs-mention rule, gated so completion requires the
archive purge; the only accepted residual is shared-note blended embeddings (needs re-embedding). Not
applied (docs/ is guarded).
