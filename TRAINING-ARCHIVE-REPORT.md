# Training corpus — indefinite retention via archival — `feat(TRAINING-RETENTION-2)`

Supersedes the 180-day deletion recommended in `TRAINING-FIX-REPORT.md`. **Ruling: retention is
indefinite. The sweep archives; it never deletes.** The corpus exists to build a distillation model
two to three years out — deleting at six months guarantees there is never a corpus to build from.

Five tasks, one commit each, tests-first, suite green throughout (final: 1541 passing), typecheck +
lint clean. No prompt change, no gate run.

| # | Task | Commit |
|---|------|--------|
| 1 | TRAINING-ARCHIVE | `16ddf32` — archive instead of delete |
| 2 | TRAINING-DELETE | `714647d` — deletion + export cover the archive |
| 4 | TRAINING-CONFIG | `0645e2b` — unambiguous config + deploy guard + archived on /health |
| 3+5 | disclosure + this report | *(this commit)* |

---

## No configuration can delete training data

This is the core safety property. The age-based delete path is **gone** — the repos no longer expose
a purge-by-age at all. Rows leave the hot table through exactly one route: `deleteByIds`, called by
the archive sweep **only after** the rows' archive object has been written and indexed. There is no
env var, flag, or code path that deletes a training row by age. The worst a misconfiguration can do
is **not archive** (leave everything hot) — never destroy.

## Archival format — and why it's loadable in three years

- **NDJSON** (newline-delimited JSON), one row object per line — the format every training pipeline,
  `pandas`, DuckDB, and `jq` read natively. A dump nobody can load is the same as deletion; this
  isn't that.
- **Partitioned by month, per tenant**: object key `‹destination›/‹collection›/‹userId›/‹YYYY-MM›.ndjson`
  (collection = `extraction_logs` | `corrections`). Month partitions keep objects bounded and let a
  training run pull a date range without scanning everything.
- **`prompt_version` is preserved on every row** — the key to training against the exact prompt that
  produced each output, across the several prompt versions the corpus will span.

## Verify-before-remove, and idempotency

- **Order is fixed:** write the archive object → upsert the archive index → *then* delete the hot
  rows. A crash anywhere before the delete leaves the rows hot — **never lost**.
- **Idempotent:** objects are keyed by (collection, user, month) and merged by row id. An interrupted
  run re-archives the same rows to the same key (overwrite — no duplication); a late-arriving row for
  an already-archived month unions into the object (no loss). Proven by a test that fails the delete
  mid-run and retries: nothing lost, nothing duplicated.
- Runs daily on the existing scheduled-job seam, recorded in `scheduled_job_runs` and surfaced on
  `/health` like every other job.

## Deletion rights still override retention

Indefinite retention is **not** "we keep your data after you leave." Account deletion purges the hot
rows (FK cascade) **and** the archived objects (explicit — the cascade can't reach object storage):
the archive objects are deleted first, then the index, then the user, so a failure leaves the archive
**intact and retryable** and is **reported** (HTTP 500), never a silent partial that orphans
third-party PII. The account **export** reads archived rows back from storage and includes them —
"all their data" stays true across the hot/archived boundary.

## Storage growth at 170 users, and cost

| | |
|---|---|
| Per rep | ~115 extractions/month × ~5,000-token inputs (+ outputs) ≈ **~20 MB/year** |
| 170 users | **~3.5 GB/year**, growing indefinitely |
| On RDS (today) | competes with the pgvector index for RAM on the instance — the binding constraint |
| Archived to object storage | S3 Standard ≈ $0.023/GB/mo → **~$0.08/month per year-of-corpus**; Glacier tiers round it to noise |

Archival keeps the full corpus forever while removing it from the RAM-bound database — the whole
point. The hot table holds only the recent window (`TRAINING_ARCHIVE_AGE_DAYS`); everything older
lives in cheap object storage, still complete, still loadable.

## ⚠️ Infra prerequisite before enabling (premise flag)

Prod `Storage` is currently **`FsStorage`** — there is **no S3 adapter in the codebase** (the "S3 in
prod" comment is aspirational; gallery images use the same FsStorage). Archival writes through the
`Storage` port (the S3-swappable seam), so it is correct by construction — but on ephemeral container
disk it would not be durable. **Before enabling archival**, a durable backend (an S3 `Storage`
adapter, or a persistent volume) must sit behind that port. Until then, `assertDeployReady` + the
default-off config keep archival inert, so no rows are ever removed with nowhere durable to go.

## TASK 3 — disclosure text for the lawyer brief

`docs/` is guarded, so this is drafted here for you to hand over — **do not let the lawyer draft
around a fixed retention period; give them the indefinite-retention position now.**

> **Model-improvement data.** "To improve the accuracy of our AI, Tovira retains the text you capture
> and the structured facts our models extract from it, together with your corrections — **indefinitely**
> — and uses it to train and evaluate our models. **This includes the content of conversations you
> import, which may contain messages written by other people** (for example, a client's messages in a
> chat you import). Before this data is stored, we automatically redact payment card numbers, bank/IBAN
> details, and government identifiers; we also make a **best-effort** attempt to remove health and other
> special-category details from the stored copy — but this automated removal is **not guaranteed to be
> complete**. You can export all of this data at any time, and **deleting your account permanently
> deletes it**, including copies moved to long-term storage."

Notes for the lawyer conversation:
- "Indefinitely" is deliberate — the data funds a future in-house model; a fixed period was considered
  and rejected.
- The third-party-content point is the sensitive part and is stated plainly (imported chats contain
  other people's messages).
- "Best-effort" on Tier-2 is accurate and must not be upgraded to a guarantee — deterministic
  detection is incomplete by nature (see `TIER2-INPUT`).
- Deletion-on-account-deletion now genuinely covers the archive (TASK 2), so that sentence is true.

---

### What still needs you
- **Give the lawyer the indefinite-retention + third-party-content disclosure above**, now.
- **Provision a durable object-storage backend** behind the `Storage` port, then set
  `TRAINING_ARCHIVE_AGE_DAYS` (+ `TRAINING_ARCHIVE_DESTINATION`) to enable archival. Until then it
  stays off and everything remains hot (safe, just heavier on RDS over time).
- The batch is committed locally on `main`; say the word to deploy and verify live.
