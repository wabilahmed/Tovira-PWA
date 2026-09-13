# Privacy compliance — make the policy true (batch report)

Builds the behaviour the finalised privacy policy/terms describe, so the documents are accurate when
published. No extraction, no model calls, no analysis. All commits `[skip ci]` (credits exhausted);
git-only, no gate, no deploy.

---

## Task 1 — findings (raw-content stores, retention, deletion, nightly host)

See the enumeration delivered in-session. Summary: raw conversation content lives in `notes.raw_text`
+ `notes.messages` (`0004`/`0020`), `extraction_logs.input`/`raw_output` (`0009`) + the S3 training
archive (`0060`), `corrections`, `recall_messages.content` (`0044`), with verbatim fragments also in
`notes.extracted` and `requirements.requirement_raw` (`0048`). **Nothing is deleted by age today** —
`config.ts:112` states there is deliberately no retention setting; extraction_logs/corrections are
indefinite (archive-only, disabled). Account deletion (`account-service.ts`) purges the S3 archive
(`purgeArchive`), recall (`purgeUser`), and every hot table via the `users` FK cascade — verified. The
`ScheduledBrain` (9 jobs) can host a retention sweep.

## Task 2 — raw content retention: STOPPED (two product decisions)

Not built. Two blockers the batch's guardrails say to escalate:
1. **Receipts are entangled with raw content.** The brief renders its snippets live from
   `notes.raw_text` (`brief-service.ts:110-116`) and `notes.embedding` is the note's vector — deleting
   raw content breaks the "message it came from" receipts and leaves search hits with no text.
2. **The training corpus is indefinite-retention by a locked decision** (`config.ts:109-112`, flagged
   to the lawyer). `extraction_logs.input` + the S3 archive hold raw content verbatim; a delete-after-N
   sweep reverses that and makes the policy line false for the corpus.

Owner decisions needed (scope of stores; receipts kept-inline vs lost; reconcile with training
retention). Proposed default `RAW_CONTENT_RETENTION_DAYS = 365` (k: a full annual client cycle;
**not settled** — owner sets it, policy quotes the code). Not committed, to avoid an unwired constant.

## Task 3 — account deletion covers everything (built + tested)

`account-deletion-purge.test.ts` seeds every Task-1 store + outcome history + S3 for account A and a
control B, deletes A, and asserts zero rows/objects for A while B is untouched. Postgres purges
everything via the `users` cascade (transitively through composite `clients`/`notes` FKs for
requirements/inventory_matches/aliases — verified). The in-memory purge path was completed to match
(image repo `purgeUser`; purgeables expanded), so the property is testable and a new store added
without a purge fails the test.

## Task 4 — aggregate group-size floor (built + tested)

`assertAggregateAllowed(groupSize)` — the single sanctioned gate; throws below `MIN_AGGREGATE_GROUP_SIZE`
(default 5, k-anonymity, **not settled**). No aggregation exists yet. Full mechanical enforcement across
the codebase is **not cleanly possible today** (no aggregate code; no syntactic marker for a
cross-account behavioural query); closest alternative proposed: the helper as the documented single
gate + an ESLint rule (when the first aggregate lands) flagging superuser/no-RLS aggregate queries that
don't call it + a unit-test convention.

## Task 5 — first-import acknowledgement (built + tested)

Before the first chat-export upload per account, the import returns `428` with a placeholder notice;
`firstImportAck:true` records a once-per-account, timestamped, server-side, tenant-scoped acknowledgement
(mig `0063`) and proceeds. Declining blocks and changes nothing else. Wording is a **placeholder for the
owner** (`FIRST_IMPORT_NOTICE`).

## Task 6 — rep disclosure line (built + tested)

Settings surface with a copyable one-line disclosure from a single constant `DISCLOSURE_LINE`
(**placeholder for the owner**). No tracking of whether the rep used it.

## Task 7 — third-party redaction feasibility (findings only, NOT built)

The policy promises a third party can ask for their messages to be erased from a rep's account. That
feature does not exist. What it would take, for one counterparty in one account:

**Where their data lives.** A counterparty is a `client`. Deleting the client row cascades (composite
FKs, verified) and cleanly removes: `notes` filed under it (raw_text + messages + embedding),
`promises`/`key_dates`/`requirements` (+ requirement_raw + embeddings), `meetings`, `images`,
`notifications`, `inventory_shares`, `inventory_matches`, `client_outcome_history`, `contact_aliases`.

**Cleanly separable (keyed by `client_id`, cascade-deletable):** all of the above. If "erase this
counterparty" means "delete this client," the cascade already does it — hours of work.

**Entangled (no clean key, or shared with others):**
1. **Group-chat notes** — `notes.messages` holds multiple senders; erasing one counterparty means
   per-message surgery on the JSONB, not deleting the note (which holds others), then re-deriving facts.
2. **Facts/receipts spanning two people** — a promise/requirement/receipt quoting two counterparties, or
   a fact from a group chat: deleting loses the other's fact; keeping retains the target's words.
3. **`extraction_logs` + `corrections` + S3 archive** — hold the counterparty's messages verbatim,
   **survive note/client deletion by design** (`0045` nulls `note_id`), are indefinite-retention, and
   after the note is gone there is **no `client_id` link** to target them by. Direct conflict with the
   training-retention/lawyer decision.
4. **`recall_messages`** — Ask turns quote/name the counterparty but have **no `client_id`**; finding
   them needs content scanning, and the assistant turns embed derived facts.
5. **Cross-client mentions** — a counterparty named inside a *different* client's thread ("his brother
   Omar is also looking") lives in another client's raw_text/messages/extracted; finding these needs a
   content search across the whole book.

**Deletion enough, or recompute?** For the clean client-scoped path, deletion is enough (the client is
gone; briefs/priorities/Monday/patterns/search simply omit them). For the entangled cases, **no** — an
edited group-chat note must be **re-extracted** (a model call → re-certification) and **re-embedded**,
and cross-client facts must be edited and re-derived, so the rep's derived view must be recomputed.

**Rough size.** Clean "delete the client" path: ~hours (cascade already exists). Full "erase a
counterparty everywhere": **several engineer-weeks** plus owner/lawyer decisions and extraction
re-certification — a per-message redaction path, a re-extraction + re-embedding pipeline, targeted
training-corpus + S3 deletion (reversing indefinite retention), recall-message content search, and
cross-client mention detection. Needs owner decisions before any design. Stopped here.

## Task 8 — suite, typecheck, lint; mutations; unshipped

- **Full suite green: 1609 tests / 233 files, 0 failures** (`npm test`: main pass 1588/230 + timing
  pool 21/3). Delta from 1599 = **+10**, all new tests: `account-deletion-purge` (1), `aggregate-guard`
  (4), `first-import-ack` (3), `DisclosureLine` (2). Files +4 = the four new test files. The four adapted
  import tests (import, book-scan, import-ceiling, onboarding) changed no test counts. **Typecheck +
  lint clean.**
- **Compliance-test mutation log (each proven able to fail, then reverted):**
  - **Task 3** — removed `requirements` from the account-deletion purgeables → the purge test went red
    (a requirement survived deletion, line 55: `expected [ {…} ] to deeply equal []`); reverted, green.
  - **Task 4** — changed the floor comparison `<` to `<=` → the at-floor test went red (a group exactly
    at the floor was rejected); reverted, green.
  - **Task 5** — made the acknowledgement write unconditional (removed the gate) → the "declining blocks"
    test went red (import returned 202, not 428) and the tenant-scoped test with it; reverted, green.
  - (Task 2 built nothing — stopped. Task 6 is a UI convenience, not a compliance guard — no mutation.)

## Unshipped on main

On top of the existing credit-blocked backlog: migrations `0063` (import_acknowledgements) — `0061`/
`0062` from prior batches still pending too; the account-deletion purge completeness + test; the
aggregate floor guard; the first-import acknowledgement (with the import gate + test adaptations); the
rep disclosure line. All `[skip ci]` on `main` — no gate, no deploy. Migrations validate live only (per
the migrations-live-only rule); they apply on the next `docker compose up` / deploy once credits are
restored and the gate runs. Task 2 (raw-content retention) and Task 7 (third-party redaction) are
**reported, not built**, pending owner/lawyer decisions.
