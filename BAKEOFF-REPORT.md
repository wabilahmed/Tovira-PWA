# Bake-off report — Sonnet vs Haiku, five exports

Prompt v0.6 · pinned today=2026-09-01 · cached (1h TTL) · budget est $3.00, actual $0.795 (AED 2.92).
Sanctioned env-only switch (local, temporary): MODEL_EXTRACTION=claude-sonnet-5 ; MODEL_EXTRACTION=claude-haiku-4-5-20251001. Committed default stays Sonnet (routing guard).

**Hard trust rules — any non-zero on any export disqualifies a model for extraction.**


## claude-sonnet-5
Warm-up prefix hit rate: **100%** (gate passed — prefix clears this model's minimum + caches)

| export | hit% | fabricated | guessed | merged | null-named | falseCert | promises tp/fp/fn | people tp/fp/fn |
|---|---|---|---|---|---|---|---|---|
| export-1 | 100 | 0 | 0 | 0 | 0 | 0 | 1/0/0 | 2/0/0 |
| export-2 | 100 | 0 | 0 | 0 | 0 | 0 | 1/0/0 | 1/0/0 |
| export-3 | 100 | 0 | 0 | 0 | 0 | 0 | 1/0/0 | 2/0/0 |
| export-4 | 100 | 0 | 0 | 0 | 0 | 0 | 2/0/0 | 0/0/1 |
| export-5 | 100 | 0 | 0 | 0 | 0 | 0 | 1/0/0 | 1/0/0 |

**Verdict: zero hard-trust violations across scored exports.**

## claude-haiku-4-5-20251001
Warm-up prefix hit rate: **100%** (gate passed — prefix clears this model's minimum + caches)
Ladder ABORTED at export-4 on a hard-trust violation.

| export | hit% | fabricated | guessed | merged | null-named | falseCert | promises tp/fp/fn | people tp/fp/fn |
|---|---|---|---|---|---|---|---|---|
| export-1 | 100 | 0 | 0 | 0 | 0 | 0 | 1/0/0 | 2/0/0 |
| export-2 | 100 | 0 | 0 | 0 | 0 | 0 | 1/0/0 | 1/0/0 |
| export-3 | 100 | 0 | 0 | 0 | 0 | 0 | 1/0/0 | 2/0/0 |
| export-4 | 100 | 2 | 0 | 0 | 0 | 0 | 0/2/2 | 1/0/0 |

**Verdict: DISQUALIFIED (hard-trust violation at export-4).**

## Decision
- Haiku had a hard-trust violation (or an inconclusive gate) → **Sonnet stays locked.** Failure shape recorded above; the question is closed with evidence.

_Note: RU/TL lines in export-5 are uncertified filler, scored separately; a miss there is not a regression._

## Disagreement analysis — how Haiku fails (the informative part)
- **Exports 1–3: both models agree and are clean.** Baseline promise + two people (E1);
  relative date `next Thursday`→2026-09-10, soft next-step not promoted, role-only not a
  person (E2); **ambiguous `05/06/2026`→null (the v0.6 rule), Sara/Sarah not merged** (E3).
  So the v0.6 ambiguous-date rule Haiku originally failed on is now handled by BOTH — the
  hypothesis that motivated the bake-off held for that specific trap.
- **Export 4: the models diverge, and the certified key says Sonnet is right.** Sonnet:
  the retracted "SOW Thursday" is NOT an active promise, the two live commitments are
  logged low-confidence conditionals, negation ("did NOT promise a discount") yields no
  promise. Haiku: **2 fabricated promises and 0 of the 2 real ones (0/2/2)** — it invents
  commitments on exactly the hard cases (a retracted/negated/third-party statement turned
  into an active promise) and drops the correctly-hedged conditionals. This is the
  trust-critical failure mode: *a wrong promise is worse than a missing one*, and Haiku
  produces wrong promises here while Sonnet does not.

## Cost + the decision
- **Bake-off spend:** $0.795 total (AED 2.92) for both ladders, cached — well under the
  $3 estimate. Haiku is ~3x cheaper per token than Sonnet, so a switch would cut
  extraction COGS materially **if quality held**. It does not.
- **Decision — Sonnet stays locked.** Haiku's non-zero fabricated-promise count on
  export 4 disqualifies it for extraction under the hard trust rules. This is NOT a
  candidate for a formal P1-9 Haiku re-certification: the bake-off shows it would fail on
  the same fabrication class the gate exists to catch. The ~3x saving is real but is not
  worth a model that fabricates commitments on complex conversations — the exact input a
  field rep produces. The question is now closed with evidence, not vibes.
- **Routing by complexity (noted, not recommended):** Haiku matched Sonnet through E3, so
  a size/complexity router is conceivable — but it means two extraction models, split
  caches, two quality profiles, and a product that fabricates on the hard inputs it would
  route to Haiku. Recommend against; the quality gap is not nil.

## Validity + governance
- **Fixture fairness:** a first run showed BOTH models "failing" export-3 — the tell was
  Sonnet, the certified engine, extracting nothing. Cause: degenerate filler (1,500 lines
  of repeated acknowledgements read as pure small-talk). Fixed by realistic fact-free
  conversational filler; on the corrected fixture Sonnet passes all five, which is what
  makes this comparison trustworthy. "A sloppy comparison is worse than none."
- **Caching:** both models warmed to **100%** prefix hit before their ladders and every
  scored export ran at 100% — so the cost comparison is warm-vs-warm, not distorted. The
  7,036-token prefix cleared **both** minimums (Sonnet 1024 and Haiku's higher 2048),
  asserted by the ≥90% warm-up gate passing for Haiku (a below-minimum prefix would not
  cache → the gate would have failed).
- **Model state restored:** the env-only `MODEL_EXTRACTION` switch was unset after the
  run; the committed default resolves extraction to **claude-sonnet-5** (COST-GUARDS
  routing test). No prompt change in this batch.
- **Scale (export 5) + needle/sweep:** export 5 (10k lines) ran as a single extraction and
  Sonnet scored it cleanly (Haiku aborted at E4). The needle (recall) and the sweep
  whole-import drain are retrieval/queue concerns on a different path than this direct
  extraction bake-off; carry them into the B4/recall tail with the `scheduled_job_runs`
  drain check rather than reading them off this run.
