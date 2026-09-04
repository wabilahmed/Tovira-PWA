# REQ-3P — requirements precision, the third-party class, and the gating bar (report)

The `requirements` field went from a certified-but-leaky baseline to a gated, precision-1.00 field
across three prompt versions, diagnosed rather than guessed at each step. This is the last thing
blocking inventory matching (A4–A6), because matching acts on requirements **in front of a client**,
where a false one is a wrong pitch, not a private mistake (inventory spec §4: precision over
everything).

## Precision before and after

| Prompt | Requirements precision | Recall | What changed |
|---|---|---|---|
| **v0.9.1** | **0.62** | 1.00 | the field, certified measured-not-gating; 82–91 FPs |
| **v0.9.2** | **0.86** | 1.00 | Rule 8 do-vs-find — killed the next-step leak (80 of 82) |
| **v0.9.3** | **1.00** | 1.00 | actor clause — killed the third-party leak (the last 30) |

Each step was driven by a diagnostic (`req-diag.ts`), not intuition. v0.9.1's 82 FPs classified as
**98% next-step→requirement** (the model promoting "wants the pricing in writing", "wants us live
before launch" — deliverables the rep must *do* — into stated needs), **2% past-purchase**, and **0%**
concern/question/speculation (those boundaries already held). The v0.9.2 fix targeted exactly that;
its residual 30 FPs were **one isolated class** — a need the client *reports for a third party* ("his
brother is looking for something similar"). v0.9.3 closed it. Nothing was tuned against fixtures; each
rule change was measured at N≥960 after the fact.

## Recall confirmed — and the Ravi distinction intact

**Recall held at 1.00 across all three versions.** This is the stop condition the whole batch was
written around: a rule that suppresses genuine requirements is worse than the false positives it
fixes. It did not happen.

The load-bearing case is **who is doing the looking, not who benefits**:
- **Ravi** (`requirement-beside-tier1`, certified): "looking for a 1-bed in JLT **for his son**" → a
  requirement at high confidence. **Unchanged and still passing** — the actor clause is worded on the
  *looker*, not the *beneficiary*, so an on-behalf-of need stays a requirement.
- **On-behalf-of** (`req-on-behalf-of`, fresh): "Layla is looking for a 3-bed for her elderly parents"
  → a requirement. Passed.
- **Reported third-party** (`req-third-party-referral`): "his colleague is looking for a 2-bed" →
  `requirements: []`, recorded faithfully in `next_steps` **with the budget kept** (a referral the
  rule says not to drop must not be quietly halved).
- **Actor-split** (`req-actor-split`): the client's own need *and* a reported third-party need in one
  note → the first a requirement, the second a next step. The discrimination test — it holds when both
  appear together, not only when isolated.

`stated_on` stayed exact (dateErr 0, including the import fixture) and confidence-inflation stayed 0
throughout.

## The gating bar and its derivation

Precision is now **gated**; recall is **measured and reported, never gated** (a missed requirement is
an invisible non-event; a false one is a wrong pitch in a meeting).

- **Published precision (`certifiedPct`) = 100.0%** — 0 false positives / 240 scored requirements at
  the v0.9.3 cert (8 requirement-bearing fixtures × 30 runs). Re-measured each cert, never inherited,
  like the fabrication rate: 62% → 86% → 100%.
- **Gated floor (`floorPct`) = 95.0%** — the bar, not the rate. Derivation, recorded beside the
  constant so it is never quietly re-tuned: 0/240 observed FPs gives, by the rule of three, a 95%
  lower bound of ~98.75% on the true precision. A 95% floor sits below that bound, so a healthy prompt
  false-fails **<0.1%** (it would need ~12 FPs in 240, unreachable at a true FP rate ≤1.25%), while a
  genuine regression below the product's stated 0.95 precision bar (§4 / this batch's DoD) is caught.
  Deliberately **not tighter than 0.95**: with 0 FPs observed we lack the sample to justify a tighter
  bar without risking false-fails on a true rate not yet pinned. It tightens as scored-N accumulates.
- Wired into the deploy gate and FULL CERTIFICATION alongside fabrication and the two leakage tiers;
  PROVISIONAL below `minScored`. A self-test proves it can fail (PASS at 0 FP; FAIL at 83%; recall
  reported, never gated).

## Tier-2 leakage — the four-point history

| Cert | Tier-2 | n |
|---|---|---|
| v0.8 baseline | 2.94% | 170 (cumulative) |
| v0.9.1 | 5.56% | 90 (5/90) |
| v0.9.2 | 0.00% | 90 (0/90) |
| v0.9.3 | 0.00% | 90 (0/90) |

**Honest interpretation: the mid-rise did not hold — it was small-sample noise, not a trend.** The
interval is wide at n=90: 5/90 has a 95% CI of roughly 1.8–12.5%, and 0/90 of 0–4%; these overlap
heavily, and two subsequent 0/90 certs sit at the bottom. All four are well inside the 8% ceiling. The
recommendation from the fabrication work stands — more Tier-2 fixtures would tighten the estimate — but
there is no evidence of an upward trend to act on.

## One honest flag — people precision

People precision dipped to **0.90** at v0.9.3 (from ~0.97), still **inside the soft bar (≥0.85)**. The
cause is visible in the FP dump: the model extracts the **named individual client** as a person
(`req-actor-split` predicted "Faisal", where the key has `people: []` because Faisal *is* the client).
This is a people-key nuance introduced by the new individual-name fixtures, not a requirements
regression — but it is worth deciding whether an individual client should be listed as a person, and
aligning the older individual-client fixtures (Ravi, Fatima, Ahmed) with that decision. Tracked, not
gating.

## Spend and cache

| Run | Spend | Cache hit |
|---|---|---|
| v0.9.1 cert | $14.149 (AED 51.96) | 100% |
| REQ diagnostic | $11.173 (AED 41.03) | 100% |
| v0.9.2 recert | $14.594 (AED 53.60) | 100% |
| v0.9.3 recert | $14.883 (AED 54.66) | 100% |
| **Total (this precision arc)** | **$54.80 (AED ~201)** | 100% |

Every run read the warm prefix on essentially every call — the caching contract held across three
prompt-prefix changes (each a one-time cache write, then re-warmed).

## Definition of done — met
v0.9.3 certified; **precision 1.00 (≥0.95) with recall 1.00**; the on-behalf-of case still extracts as
a requirement (Ravi intact); third-party needs land in `next_steps` with the referral kept whole; the
gating bar wired with its derivation recorded; suite green; typecheck + lint clean. **A4–A6 (matching)
may start.**
