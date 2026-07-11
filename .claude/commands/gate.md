---
description: Run the P1-9 extraction quality gate (Haiku vs Sonnet)
---

Run the **extraction quality gate** (story P1-9). This is the single most
important checkpoint in the project — everything downstream depends on it.

1. Load the eval set of real, messy voice notes from `evals/notes/`
   (each with its expected extraction in `evals/expected/`).
2. Run the extraction prompt (`docs/tovira-extraction-prompt.md`) against
   **both** Claude Haiku 4.5 and Claude Sonnet 5.
3. For each model, report per-field **precision and recall** for:
   - promises (and separately: **fabricated promises — this must be ZERO**)
   - dates (and separately: **guessed dates that should have been null**)
   - people
   - meetings
4. Report cost per extraction and cache hit rate for each model.
5. List every note where a model **fabricated** anything — quote it.

Print a table. Do NOT decide which model to use — present the numbers and stop.
**A human makes this call.**

Gate fails if: any fabricated promise, or any guessed date where the source was
ambiguous. Precision on promises matters more than recall — a missed promise is
recoverable; an invented one destroys trust.
