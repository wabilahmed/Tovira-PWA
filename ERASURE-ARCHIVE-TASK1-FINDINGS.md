# Training-archive erasure — Task 1 findings (no edits)

## Archive structure

- **Object key:** `${destination}/${collection}/${userId}/${YYYY-MM}.ndjson`
  (`training-archive.ts:95`). One object **per (collection, account, month)**. `collection` is
  `'extraction_logs'` or `'corrections'` (`archive-index-repository.ts:12`). The **userId is in the
  key**, so objects are account-scoped.
- **Blob contents:** NDJSON — one JSON row per line (`toNdjson`/`parseNdjson`,
  `training-archive.ts:59-67`). Each `extraction_logs` row is a full archived extraction-log record
  (`id, createdAt, promptVersion, input, rawOutput, …` — same shape as `ExtractionLogRecord`,
  `extraction-log-repository.ts:8-29`). `input` = the redacted note text; `rawOutput` = the full
  extraction JSON (which itself carries `people[].name`, `personal_facts[].subject`,
  `unanswered_questions[].sender`, plus free-text summary/promises). `corrections` rows carry
  before/after fact values (free text). **The requester's name lives in these free-text fields and,
  for extraction_logs, in the structured who-fields inside `rawOutput`.**
- **The index:** `ArchiveIndexRepository` — one row per `(user, collection, partition)` with
  `objectKey, rowCount` (`archive-index-repository.ts`, adapters `pg-`/`in-memory-`). `listByUser`
  returns all of an account's objects (`account-service.ts:96`).

## Locatability

- **By account: YES** — `index.listByUser(userId)` gives every object key for the account, no scan.
- **By note or by requester: NO** — the index is per partition, not per note/person. Finding the
  requester's rows means reading each of the account's objects and matching rows in the NDJSON.
- **This is not a full-archive scan.** It touches only THIS account's objects; other accounts'
  objects are never read. So the STOP condition ("no way to find without scanning the entire
  archive") does NOT apply — no storage redesign is needed.

## Rewritable in place?

Yes. `Storage` (`ports/storage.ts`) has `get`, `put` (overwrite), `exists`, `delete` (idempotent).
The archiver already reads-merges-overwrites a key (`training-archive.ts:99-105`). So a per-requester
purge can: read a blob → drop matching rows → `put` the survivors back (or `delete` the object if
none remain) → update the index `rowCount`. Rows are removed **whole** (a line is kept or dropped),
never edited — satisfying "a partially-scrubbed record is not a record."

## Existing account-level purge — reuse

`AccountService.purgeArchive` (`account-service.ts:130-146`) on full account deletion: iterates
`index.listByUser`, `storage.delete`s each **whole object**, then `index.deleteByUser`. It attempts
all objects and throws an aggregate error on any failure (fail-loud, retryable — no silent partial).
**Reusable here:** the same iterate-index + fail-loud-aggregate pattern, but per-row (read → filter →
rewrite/delete + reindex) instead of delete-whole. The fail-loud discipline is exactly what Task 4's
gate needs (an unreachable object store must fail the erasure, not complete silently).

## Scale

Per erasure, the scan touches `index.listByUser(userId).length` objects = (# active months) ×
(# collections with archived rows). A heavy rep over two years ≈ 24 months × 2 collections ≈ **≤ ~50
small NDJSON objects**, each a month of that rep's rows. Reading + filtering + rewriting that handful
per request is **operationally sane**; no global index or per-note index is needed.

## Classification for Task 2 (the archive follows the DB FACT-store rules, per this batch)

An archived `extraction_logs` row is classified by parsing its `rawOutput` and applying the SAME
who-field matcher the DB stores use:
- requester is an EXACT who-field subject in `rawOutput` (people.name / personal_facts.subject /
  unanswered_questions.sender) → **exact → auto-purge the row (whole)**.
- only a FUZZY who-field match → **candidate (unticked, operator confirms)**.
- name appears only as a free-text mention (input/rawOutput, no who-field) → **mention → kept**
  (operator may flag). `corrections` rows have no who-field → mention-level (kept unless flagged).

**Flag (consistency, not a blocker):** the *hot* extraction-log purge shipped in the erasure feature
(`erasure-service.ts`) uses a **blanket name-match → purge** (ruling 3), which is more aggressive than
this batch's exact/fuzzy/mention rules for the archive. This batch's scope is the archive; I will
implement the archive per its explicit rules + tests and NOTE the hot-log divergence in the closeout
for a possible follow-up realignment (both are unpushed, so nothing is live yet). Not changing the
hot-log here would leave a mention-only training row purged while hot but kept once archived.

Proceeding to Task 2 (no STOP — the archive is locatable per-account and rewritable).
