# Per-account spend failsafe — report

A hard ceiling on Claude spend per account per billing period — **AED 45/rep** — so one runaway
rep or one defect cannot cost more than the account earns. Well above the modelled ~AED 19 AI COGS
and under the AED 67 margin ceiling, so it fires only on genuine abuse or a bug. **The governing
principle is degrade, never break:** at the cap, expensive deferrable work queues; the core capture
loop keeps running. Nothing is ever lost.

## Tracked cost classes — and what's excluded

Every Claude call flows through one chokepoint (`MeteredModelClient`); threading `userId` +
`spendClass` on the request records its real AED against the rep's billing period. Recorded classes:

| Class | Where | Notes |
|---|---|---|
| `extraction` | daily-note extraction | the steady path |
| `import` | chat-import extraction | the heaviest single call (see IMPORT-COST-REPORT) |
| `recall` | Ask | cheap (Haiku, ~AED 0.02/turn); the interactive path |
| `priorities` | Today's-register ranking | background precompute |
| `followup` | follow-up draft | premium, single call |
| `meeting` | NL meeting parse | single call |
| `capture` | Ask-capture statement detection | cheap classifier |

**Excluded — not Claude spend, never counted against the cap:**
- **Embeddings** (Titan/Bedrock) — the vector substrate. Provably negligible (≤ ~AED 0.001/import;
  a whole-transcript embed is capped at 8,192 tokens). Tracked separately only as an estimate in the
  import-cost metric.
- **Transcription** (Groq/Whisper) — voice-note STT. Not Claude; not metered here.
- **Briefs and cross-client patterns** make **no** Claude call at all (deterministic assembly) — so
  they contribute nothing and, by the same token, always work at the cap.

Spend is **durable** (`spend_ledger`, migration 0051), bucketed by the rep's **billing** period
(`periodKeyFrom`: active sub → renewal instant, trial → trial end, else calendar month) so the cap
and the invoice describe the same window. (No `current_period_start` is persisted; the renewal
instant is a stable within-period anchor — flagged below as a possible small migration.) Surfaced on
`/health → spend`.

## The degradation table — as built

| Behaviour at the cap | Status | How |
|---|---|---|
| **Capture** — voice, paste, import upload | **always works** | the raw note is stored before any extraction; no spend gate on capture |
| **Briefs, promises, the register, alerts** | **keep working** | read already-extracted facts; cheap or no model call |
| **Export and delete** | **keep working** | no model call; a rep is never locked out of their own data |
| **Extraction of new captures** | **queues** | `extractNote` returns `spend_capped` before any model call; the note stays `pending_extraction`, intact |
| **Bulk import extraction** | **queues** | same path; the transcript is already stored |
| **Priorities precompute / patterns / match recompute** | **defer / unaffected** | the sweep skips a capped rep; patterns + match are deterministic (no Claude) |
| **Recall (Ask)** | **keeps working, N/day** | see the decision below |

**How queuing works and why nothing is lost:** the sweep (`NoteSweepService`) skips a capped rep's
queue **entirely** — no attempt bump, no `needs_review`, no drop. The notes sit in `pending_extraction`
in Postgres (survives restarts) and drain intact once the rep is under cap again — a new billing
period, or an ops override. This reuses the existing pending-note seam; the raw content is stored and
only the extraction waits. The rep sees an honest, non-punitive state (amber, `role="status"`, no
exclamation, no claret): their notes are saved and will process shortly.

## The recall decision (Wabil's ruling, not taken unilaterally)

**Recall keeps working at the cap, on the cheap model, limited to 100/day WHILE capped.**

Reasoning, as agreed:
- Recall is **interactive** — a rep asks because they're in front of a client. A deferred answer is a
  non-answer, so recall cannot be a "defer" candidate like extraction/import.
- It is **cheap** — already on Haiku (~AED 0.02/turn). Burning the AED 45 cap on recall alone needs
  ~2,000+ questions/month; that is the abuse/bug case, not heavy use.
- The **daily limit is set from the abuse case, not the cap** — 100/day ≈ 5× the heaviest plausible
  day (~20). A genuinely chatty rep before a big meeting never sees it; 30 or 50 could be hit.
- It applies **only at the cap** — below AED 45, recall is unlimited and **unmetered** (the counter is
  never touched). The limit is part of the degraded state, not a standing meter for everyone.
- It **does double duty as the bug-case guard**: a runaway loop firing thousands of calls is stopped
  **in the hour** by a daily ceiling, which a monthly spend cap cannot manage (the cap notices after
  the money is gone; the rate limit stops it as it happens). Arguably better bug protection than the
  cap itself.
- Refusal copy is honest, never an accusation: *"You've reached today's limit for Ask. It's back
  tomorrow — your notes and everything else are unaffected."* Server-enforced (in `RecallService`,
  before any retrieval or model call); a crafted client request cannot bypass it (test proves no model
  call fires).

Config: `RECALL_DAILY_CAP_AT_CAP=100`.

## The 80% warning — shape and idempotency

- At **80%** of the effective cap (config `SPEND_WARN_FRACTION=0.8`), alert **ops**, never the rep — a
  rep on a generous cap is doing nothing wrong and should not be made anxious about normal use.
- Fired **exactly once**, on the call that first crosses the line (`before < warnAt ≤ after`).
- The alert names the **rep, the spend, the period, and the dominant cost class** — so ops can tell
  abuse from a bug from a heavy onboarding month.
- **Idempotent**: dedupe key `spendcap80:<user>:<period>` on a durable `ops_alerts` table (migration
  0052), `ON CONFLICT DO NOTHING` — one alert per rep per period, not one per call over the line.
- There is no ops inbox in the product, so alerts surface on **`/health → spend.alerts`** (the ops-
  watched surface), beside the cost metrics. *Flagged: wiring these to a real channel (email/Slack) is
  a follow-up; today ops reads `/health`.*

## The override's audit trail

- `POST /ops/spend-cap/override { userId, capAed, reason, raisedBy? }` raises the cap for a rep's
  **current period**; `GET /ops/spend-cap/audit` returns the trail.
- **Ops-only.** There is no admin auth in the product (`Identity` is just a `userId`), so these are
  gated by an env **`OPS_TOKEN`** — not a rep session, constant-time compared — and the write runs on
  the superuser pool. Unset token → `/ops/*` is disabled (403). A rep cannot raise their own cap.
- **Audited in one append-only table** (`spend_overrides`, migration 0054): each override is a row —
  who (`raisedBy`), when (`occurredAt`), what value (`capAed`), why (`reason`). The latest row for
  (user, period) is the effective cap; the whole set is the audit trail (no FK to the rep, so the row
  outlives account changes — the `note_move_audit` doctrine).
- **Releasing processes the queue, never discards it:** raising the cap puts the rep under cap, so the
  next sweep pass drains their queued extraction intact.

## Task 5 — Fair-use clause (draft for the lawyer brief; `docs/` is guard-blocked)

> **Fair use of AI processing.** Your subscription includes a generous allowance of AI processing
> (transcription, extraction, recall and related features) sufficient for normal field-sales use,
> including importing your existing client conversations. In the rare case of exceptional usage — for
> example, importing an unusually large volume of history in a single period — some AI processing may
> be **queued and completed shortly rather than refused**. Your data is never lost: everything you
> capture is stored immediately and processed as soon as capacity is available. If your account
> approaches the fair-use allowance, **we will contact you** to sort it out — we will not silently
> degrade your service or charge you more without telling you first. Capture, your existing notes and
> briefs, and exporting or deleting your data are never affected.

Three points it encodes, per the batch: a generous fair-use allowance; that exceptional usage may be
queued rather than refused (nothing lost); that Tovira contacts the account rather than silently
degrading.

## Sanity-checking AED 45 against reality

The `spend_ledger` is new and empty, so there is no live per-rep distribution yet (it will populate
in beta — that is what makes the cap self-tuning). Sanity check from the **measured** import-cost
numbers (IMPORT-COST-REPORT) plus the extraction/recall figures (CACHE-REPORT):

| Rep profile (per billing period) | Modelled Claude spend |
|---|---|
| Typical: ~60 daily notes + briefs + some recall | **~AED 2–5** |
| Heavy onboarding month: + ~10 large (5k-msg) imports @ ~AED 1.9 | **~AED 22** |
| Modelled "heavy user" AI COGS line (`tovira-spec`) | **~AED 19** |
| **The cap** | **AED 45** |
| Pathological: dozens of 10k-msg imports, or a recall loop | **would breach → degrades** |

So AED 45 is ~2× the heaviest *legitimate* month and ~9× a typical one — it never touches normal use,
and bites only genuine abuse or a defect. The daily recall limit (100) is ~5× the heaviest plausible
day. Both figures are set from the abuse case, not from normal usage. **Revisit both with the real
`/health → spend` distribution once beta has data** — the instrumentation is now in place to do so
with measurements rather than estimates.

## Flagged follow-ups (not built here)
- Persist `current_period_start` (a small migration + Stripe webhook field) for an unambiguous period
  window; today the renewal instant is the anchor.
- Wire `ops_alerts` to a real ops channel (email/Slack); today they surface on `/health`.
- A per-day recall counter keyed on the rep's timezone (today UTC) — a coarse guard, adequate for its
  purpose.

## What shipped
`feat(CAP-TRACK)` durable per-period spend + central recording · `feat(CAP-WARN)` idempotent 80% ops
alert · `feat(CAP-ENFORCE)` degrade-not-break (extraction/import defer, sweep skip, recall N/day at
cap) · `feat(CAP-OVERRIDE)` audited ops-only override that releases the queue. Migrations 0051–0054.
Suite green; typecheck + lint clean.
