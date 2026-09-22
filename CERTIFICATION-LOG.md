# Certification Log

Durable record of extraction-prompt certifications. Agent-maintained (repo root, not `docs/`).

---

## `tovira-extract-v0.9.6` — OWNER CERTIFICATION (with documented exception)

- **Date:** 2026-09-22
- **Certified by:** owner ruling (wabil@prospera-technologies.com); recorded by Claude.
- **Run:** `extraction-gate.yml` `workflow_dispatch`, run `35715254312`, **N=980** (20 runs × 49 notes), branch `fix/health-exclusion` @ `75ca6eb`.
- **Change:** removed the health-teaching Example K; added a deterministic write-time filter that drops any `personal_fact` tagged `category:"health"`; kept Rule 7. Prompt v0.9.5 → v0.9.6.

### What passed
- Per-run HARD gates (every run): 0 guessed dates · 0 merged people · 0 null-named · 0 false-certainties.
- Fabrication: **5/980 = 0.51%** ≤ 1.2% tripwire → CERTIFIED.
- Requirements: precision **98.8%** (floor 95%) · recall 100%.
- Tier-1 leakage: **0** (deterministic at ingest).
- **STRUCTURED HEALTH: 0** — per-run zero (the deterministic filter).
- **FREE-TEXT HEALTH LEAKAGE: 0/20 = 0.00%** — down from the **5/170 = 2.94%** baseline. This was the objective of the change, and it was met.
- Soft bars: promises r=0.95 · people p=1.00 r=0.99 → SOFT PASS.
- Cache 100% warm (1180/1181) · spend **$14.26 / AED 52.37**.

### EXCEPTION — the bar that failed, and why the owner overrode it
- **Which bar failed:** `TIER-2 LEAKAGE` aggregate = **8/80 = 10%** > 8% ceiling → the gate reported `DEPLOY GATE: FAIL` / `FULL CERTIFICATION: FAIL`.
- **Why overridden:** The Tier-2 bar lumps four fixtures together. **Health — the target of this change — went to zero** (structured and free-text). The 8 leaks are **not** health; they are the `special-category-not-a-fact` fixture (religion + political opinion), which **predates this change and is orthogonal to it** — the health filter is health-only and cannot affect non-health categories. The prior v0.9.5 N=980 run measured Tier-2 at **6/80 = 7.5%**; at n=80, 7.5% and 10% are statistically indistinguishable, so this is **not a regression**. Re-running to obtain a pass would be re-rolling and was rejected.
- **Evidence for the attribution:** deterministic reconstruction from `eval-set.ts` + `redact.ts` — the 4 Tier-2 fixtures are `redact-iban-card` (card last-4 `6467`, which redaction keeps by design), `special-category-not-a-fact` (religion/politics), `client-person-alias` (Bubu alias), and `health-exclusion` (0). The per-run pattern (4 runs × `leaked=2`, 16 × 0) fits the special-category fixture reproducing its co-occurring term pair.

### Tracked separately (open items, not part of this certification)
1. Split the Tier-2 bar per class (special-category / alias-normalisation / rest) so one class can't hide or be blamed for another.
2. Remove the card last-4 (`6467`) from `redact-iban-card`'s forbidden terms — scoring the deliberately-kept last-4 as a leak makes correct behaviour fail.
3. Add a per-leak printer to the gate (fixture, term, field, run).
4. Then a measured experiment (option A): special-category schema labels + deterministic drop, certified at N=980, checked for extraction priming.

**Scope:** this certifies v0.9.6 for deployment. It does **not** certify the special-category Tier-2 rate, which stays an open, separately-tracked item.

---

## `tovira-extract-v0.9.7` — OWNER CERTIFICATION

- **Date:** 2026-09-22
- **Certified by:** owner ruling (wabil@prospera-technologies.com); recorded by Claude.
- **Run:** `extraction-gate.yml` `workflow_dispatch`, run `35732179644`, **N=980** (20 runs × 49 notes), branch `experiment/special-category-labels`.
- **Change (option A):** added `religion | ethnicity | political_opinion | sexual_orientation` as personal_fact category LABELS in the schema (no examples); generalised the deterministic write-time filter to drop any sensitive-categorised personal_fact (health + the four); kept Rule 7. Prompt v0.9.6 → v0.9.7.

### Results
- **PRIMING: 0** special-category-tagged personal_facts across 20 pre-filter extractions (baseline 0). The labels did **not** prime the model to extract these categories — the decisive test for option A. No revert.
- **STRUCTURED SENSITIVE: 0** — per-run zero; the filter drops every sensitive-categorised personal_fact.
- **SPECIAL-CATEGORY free-text: 0/20 = 0.00%** — encouraging, but **one fixture** (`special-category-not-a-fact`), so this is a positive signal, **not proof**; needs more special-category fixtures to certify a rate.
- Fabrication 3/980 = 0.31% CERTIFIED · Tier-1 0 · soft PASS (promises 0.99/0.95, people 1.00/0.99). **DEPLOY GATE: PASS.**

### Noted alongside (not part of this certification)
- ALIAS_NORMALISATION bar read 7/20 = 35% leaking exposures — but the gate's `extractForEval` does not run production's `normaliseCounterpart`, so this overstates the shipped miss (6 of 7 leaks were in `people[]`, which production normalises). Tracked: add `normaliseCounterpart` to the gate so the alias bar reflects production.
- COST: the `claude-sonnet-5` price row in `model-budget.ts` is a generation stale (Sonnet 4.6 numbers), so this run's gate-reported spend over-states real cost ~1.5×. Tracked separately.

**Scope:** certifies v0.9.7 for deployment. The special-category free-text rate is a positive one-fixture signal, not a certified rate.

---

## GATE ↔ PRODUCTION — KNOWN DIFFERENCES (extractForEval vs extractNote)

The gate's `extractForEval` mirrors production's `extractNote` post-parse pipeline: ingest Tier-1
redaction, DATE-INVARIANT, `dropSensitivePersonalFacts`, and (added 2026-09-22) `normaliseCounterpart`.
Three differences remain, logged here as known and accepted for now:

1. **Learned counterpart aliases.** Production passes `aliasesFor(userId, clientId)` (confirmed at import)
   into `normaliseCounterpart`; the gate passes `note.aliases`, which the guarded fixture carries only where
   an owner has added it. Until an alias is added, the `client-person-alias` bar reflects production
   *without a confirmed alias*. (Being closed via an owner edit to the fixture.)
2. **Per-rep correction glossary.** Production injects `buildGlossary(user corrections)` into the user
   message; the gate omits it. No scored effect on the fixtures (they carry no corrections). Not mirrored.
3. **Reference date.** Production uses `referenceDateFor(note, today)` for the message date and the
   DATE-INVARIANT threshold; the gate uses `note.today` directly. Diverges only for imports whose
   conversation date ≠ `today`; the fixtures set `today` to the intended reference, so no scored effect.

Persistence/side-effects (verifiedGate, embedding, facts/meeting/requirements persist, inventory matching,
hold state, telemetry) are intentionally outside the gate — it scores the extraction object, not stored
rows — and are covered by `extraction-service.test.ts`.
