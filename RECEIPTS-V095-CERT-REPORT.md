# v0.9.5 extraction prompt — certification + promotion report

Certified per-fact receipts (`source_span` + `source_message_at`) and promoted to production. Real
model calls were made (owner-authorized after credits were restored 2026-09-14). Production extraction
is now v0.9.5; **raw-content deletion is still NOT safe** (its own next batch — see Task 5).

## Task 0 — ambiguous-timestamp decision (owner ruling)
**(a) — `source_message_at` is null, honestly**, for voice/paste/ask (no per-message timestamp); never
a capture-time or today stand-in. Implemented in Rule 9; verified (0 false timestamps on ambiguous).

## Task 1–2 — certification (owner-signed-off)
Certified the corrected v0.9.5 via the **real gate** at N=980, plus the receipt metrics:

| Metric (real gate, 20 runs / N=980) | v0.9.4 baseline | v0.9.5 (corrected) |
|---|---|---|
| Per-run HARD (every run) | 0 guessed / 0 merged / 0 null-named | **0 / 0 / 0** |
| Soft: promises r · people p/r | 0.95 · 1.00/1.00 | **0.95 · 1.00/0.98** |
| Requirements precision (≥95%) / recall | — | **98.8% / 100%** |
| **Fabrication (0.50% std, 1.2% tripwire)** | 0.61% | **0.61% → CERTIFIED** |
| Tier-1 / Tier-2 leakage | — | 0 / 7.50% (≤8%) |
| **Gate verdict** | — | **DEPLOY GATE PASS · FULL CERTIFICATION PASS** |
| `source_span` (draft fixtures ×3) | — | **27/27 faithful, 0 fabricated** |
| `source_message_at` | — | **29/30 correct, 0 false on ambiguous** |

The earlier 0.82% fabrication was small-N noise: at N=980 v0.9.5 = v0.9.4 = **0.61%** (identical) —
proven, not argued. Owner rulings: **(1)** accepted (converged, tracks baseline); **(2)** the per-run
guessed-date tail is a pre-existing v0.9.4 property, accepted for v0.9.5 + logged as a standing item
(memory `guessed-date-tail-at-scale`); **(3)** the span checker was made transliteration-tolerant
(Latin↔Devanagari re-scripts are faithful, not fabrication) — prompt untouched.

**Correction during promotion:** the first certified candidate embedded concrete ISO dates in example P,
violating the "no date token in the cached prefix" rule. Corrected to symbolic `T1`/`T2` placeholders
(no rule/base-example change) and **re-certified** — the table above is the corrected, shipping string.

## Task 3 — promotion (DONE)
- `prompt.ts` → v0.9.5 (`EXTRACTION_SYSTEM_PROMPT` + Rule 9 + examples P/Q; `PROMPT_VERSION =
  tovira-extract-v0.9.5`). Commit `3d1d240`, pushed, **CI green (verify + gate), Deployed to prod**.
- CI extraction gate **re-enabled and green on v0.9.5**: every run HARD PASS, DEPLOY GATE PASS.
- Superseded cert scaffolding removed (draft prompt module + test + harness).
- **Production behaviour is unchanged today**: `asExtraction` still drops the new fields, so facts are
  extracted identically; the model now *produces* certified receipts, ready for the decoupling batch.

### Guard-protected promotions — LISTED for the owner to apply (docs/ + the answer key are human-owned)
1. **`docs/tovira-extraction-prompt.md`** — replace the stale **v0.5** content with the live v0.9.5
   prompt (source of truth: `apps/api/src/services/extraction/prompt.ts`; draft copy at
   `tovira-extraction-prompt-v0.9.5-DRAFT.md`), and reconcile the version ladder honestly: record the
   **v0.5 → v0.9.4 drift** (the doc lagged four prompt versions) before the new **v0.9.5** entry
   (per-fact receipts).
2. **Draft fixtures → certified gate set** — move `eval-set-v0.9.5-DRAFT.ts` into `eval-set.ts` via the
   reviewed/owner-certified route. **Note:** the standard CI gate does not yet *score* `source_span` /
   `source_message_at`; gating them needs a `score.ts` extension (the transliteration-tolerant +
   null-on-ambiguous logic proven in this cert). That scorer wiring rides with the receipt-decoupling
   batch; today the CI gate confirms base-fact non-regression on v0.9.5, and receipt accuracy is
   established by this certification.

## Task 4 — verify nothing broke
Full suite **1622/1622 green** (main 1601/233 + timing pool 21/3), typecheck + lint clean. Delta from
1622 = **0**: Task 1 added `prompt-v0.9.5-draft.test.ts` (6), promotion removed it (−6); the two
version-string test edits are value changes, not count changes. **Wiring guard:** the new prompt has a
real production caller — it is the live extraction prompt (deployed) — though the emitted fields are not
yet persisted/rendered (next batch).

## Task 5 — raw-content deletion: **NO-GO** (still depends on live raw_text)
v0.9.5 unblocks the receipt work, but deleting `raw_text` on a schedule is **not yet safe**. What still
depends on live `notes.raw_text`:
1. **Receipts are not stored.** `asExtraction` (types.ts `Extraction`) has no receipt fields, so the
   model's `source_span`/`source_message_at` are dropped before `saveExtraction` — new facts carry no
   stored receipt yet.
2. **The brief renders receipts from live `raw_text`** — `brief-service.ts:110-116` embeds
   `focus.rawText` and returns `snippet: note.rawText.slice(0,140)`; `notes.embedding` is over raw_text.
3. **Existing facts have no receipts** — no backfill has run.
So deleting raw_text would break "no claim without a receipt." **Deletion is the next batch**, and only
after the receipt-decoupling batch does the three things above: persist the emitted fields
(types + validate + repos, columns already migrated in 0064), repoint the brief to stored receipts, and
backfill existing facts. Nothing else in this batch changes that.

## Task 6 — where this leaves the documents
The privacy policy / terms **do not change yet**. v0.9.5 makes receipts *exist and certified*, but the
policy's deletion promise stays unshippable until the deletion job itself lands (after decoupling +
backfill). This is real progress — a certified receipt-producing extractor in production — not the
finish line for the privacy work.
