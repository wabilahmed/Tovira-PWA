# Closing the training-log gaps — `feat(TRAINING-FIX)`

Follow-up to the audit (`TRAINING-AUDIT-REPORT.md`). Six tasks, one commit each, tests-first, suite
green throughout (final: 1536 passing), typecheck + lint clean. No prompt change, no gate run.

| # | Task | Commit | Result |
|---|------|--------|--------|
| 1 | CORRECTIONS-WIRE | `d559dbe` | Every human verdict recorded with its original value |
| 2 | EXPORT-TRAINING | `e60cde6` | Training log + corrections now in the account export |
| 3 | TRAINING-RETENTION | `079b1e7` | Age-based sweep on the scheduled seam; window flagged for Wabil |
| 4 | TIER2-INPUT | `7a9184a` | Tier-2 scrubbed from the stored training input |
| 5 | TRAINING-METRICS | `6478651` | Training-log volume on `/health` |
| 6 | TRAINING-QUERIES | *(this)* | `TRAINING-QUERIES.md` handed over |

---

## TASK 1 — every human verdict is now training data

`corrections.record()` had one caller (promise edit). Now:
- **Promise** reject / confirm / edit — reject records the original value (after = null), the single
  most informative row; confirm records the confirmed value (model uncertain + right).
- **Meeting** reject / confirm / edit — only for MODEL-PROPOSED meetings (a source `noteId`); a
  rep-created meeting has no extraction to judge.
- **Ask-capture** reject — labels the surviving `extraction_logs` row `'rejected'` (it previously
  stayed `pending_confirmation` forever) and records the rejection.

All writes are isolated — a failed correction write never blocks the rep's action. This also unblocks
the **Condition-4 monitor**: `'__rejected__'` corrections ÷ extraction rows is the live rejection-rate
proxy (query in `TRAINING-QUERIES.md`).

**Entity types with no verdict surface yet** (recorded, not faked): key_dates, people, requirements,
personal_facts, concerns, next_steps have no per-item reject/confirm/edit route — they live inside a
note's `extracted` JSON. There is no human action to hook, so nothing is recorded for them; the shared
`recordVerdict` helper is ready the day those routes exist. No dead routes were created.

## TASK 2 — the export is now complete (and its claim is true)

`exportData()` now returns `extractionLogs` + `corrections` alongside the existing sections. The
"all their data" comment was corrected to state the scope precisely.

**Audit of what the export still omits** (operational/billing, not rep content — intentionally out,
now documented in the code comment): notifications, push subscriptions, daily priorities, the value
(`ledger`) and spend (`spend_ledger`) ledgers, email log, billing/subscription rows, referrals,
activation analytics. Extracted people/requirements/concerns/next-steps already export **inside each
note's `extracted` JSON**; the separately-stored requirement spine has no `listByUser` and is covered
by that JSON. Deletion already purges the log via the `users` FK cascade (unchanged).

## TASK 3 — retention: mechanism shipped, WINDOW IS YOUR CALL

A daily `training-retention` job sweeps BOTH `extraction_logs` and `corrections` by **age only**
(never selective), per-tenant, recorded in `scheduled_job_runs`. It is **disabled by default**
(`TRAINING_LOG_RETENTION_DAYS=0`) — it deletes nothing until you set a window, so no PII is purged on
a number I picked.

### Proposed default: **180 days (6 months)** — reasoning, for your decision

- **Training value argues longer.** Distillation wants corrections + rejections across several prompt
  versions and seasons of rep behaviour; 6 months spans multiple prompt iterations and a full sales
  quarter-cycle or two.
- **Privacy + the stated policy argue shorter.** This corpus is third-party client data (WhatsApp
  exports, personal facts) held specifically to train on. The shorter the window, the smaller the
  standing exposure and the easier the DSAR/consent story.
- **180 days balances them** and is a period a privacy page can state plainly without looking either
  cavalier (years) or useless (weeks). It also auto-clears the pre-redaction (pre-2026-09-02) rows
  once enabled.
- If the lawyer wants tighter, **90 days** is the fallback; if early distillation experiments show
  180 is too little signal, raise it deliberately. Either way it is a one-line config change
  (`TRAINING_LOG_RETENTION_DAYS`), not a code change.

### Privacy-page / lawyer-brief wording to match what's implemented

> *"Tovira logs the text you capture and the structured facts our AI extracts from it, together with
> your corrections, to improve the extraction model. This training data is retained for up to **[N]
> days** and then automatically deleted. You can export all of it, or delete it entirely by deleting
> your account, at any time."*

Set `[N]` to whatever you configure (**whatever the page says MUST equal `TRAINING_LOG_RETENTION_DAYS`**).
`docs/` is guarded, so this wording is handed over here rather than edited into the privacy doc.

## TASK 4 — Tier-2 scrubbed from the stored input (honest about the limit)

Option A (health/special-category never extracted in any field) was enforced on model OUTPUT but the
raw INPUT was archived verbatim. Now `redactTier2()` scrubs anchored Tier-2 spans from the **stored
log input only** — the model still sees the full text, so extraction is unchanged (no prompt change,
no re-cert).

- **Precision-first, by design.** Tier-2 is a semantic category, not a checksum. Patterns are
  **anchored** to explicit markers ("diagnosed with", "is a devout Muslim", "convicted of") — never
  bare ambiguous nouns. FP posture is pinned by tests: "smooth operation", "healthy margin", "sick of
  the delays", "the party is Thursday", "Christian name", "hospital procurement", "terminal-stage in
  the pipeline sense" are all left intact.
- **Honest limit.** Deterministic Tier-2 detection is inherently incomplete — this is a best-effort
  **defence-in-depth net** on the stored copy, **not a guarantee** every phrase is caught. The model's
  Rule 7 remains the precise instrument for output. **For a hard guarantee when an actual training SET
  is built, exclude flagged rows rather than trust mutation** — that is the clean alternative if you
  ever need certainty, and it avoids the over-suppression that would corrupt training data.

## TASK 5 — observable on `/health`

`/health` now carries `trainingLog`: `total`, `last24h`, `emptyOutput`, `corrections`, and
`byPromptVersion`. Cached (60s TTL, warmed at startup) so the ALB health check never triggers a DB
scan; the aggregate runs at most once per minute on the superuser pool.

## TASK 6 — live queries

`TRAINING-QUERIES.md` — ready to paste, with the **RLS-owner caveat first** (run as the `DATABASE_URL`
superuser or every count returns near-zero). Covers: counts by prompt version + by source,
empty-output count, date range, corrections baseline by field/entity, and the Tier-1 pre-2026-09-02
scan (counts only). Run them and the audit's one open question — *how much is actually in there* —
is finally answered with measured numbers.

---

### What still needs you
- **Set `TRAINING_LOG_RETENTION_DAYS`** (proposed 180) and make the privacy page say the same number.
- **Run `TRAINING-QUERIES.md`** against staging/prod (superuser) and paste the counts back.
- These changes are committed locally on `main`, not pushed — say the word to deploy and verify live.
