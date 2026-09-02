# FAB-INVESTIGATE — the run-3 fabrication, diagnosed

**Bottom line:** v0.7 did **not** cause the fabrication. In 15 matched runs v0.7 fabricated
**zero** across all 32 fixtures; v0.6 fabricated zero on the shared (non-redaction) fixtures.
The rare fabrication that failed the gate is **scattered, ultra-low-frequency baseline
variance** — a stated intention occasionally extracted as a low-confidence promise — not a
prompt regression and not a specific fixture. **This is a certification-standard question,
not a prompt or fixture fix.** No prompt, fixture, or threshold was changed. v0.7 remains
**uncertified** pending an owner ruling.

---

## 0. What staging is serving (stated first)

**Staging serves `tovira-extract-v0.6` with NO ingest redaction.** The entire v0.7 / REDACT
batch is local and **unpushed** (origin/main = `d1a1bb3`, v0.6; `redact.ts` absent on
origin). Deploy (`.github/workflows/deploy.yml`) only fires after CI passes on a **push to
main**, and no push happened — so:

- **No uncertified v0.7 is live.** Staging runs the last-certified v0.6. Good.
- **But redaction protection (REDACT-1/2) is not live either** — staging is still storing
  sensitive data unredacted. This sharpens the Tier-1 backfill urgency (REDACT-REPORT §7):
  the card scan should run against staging and any PAN be remediated on sight.
- The API exposes no version/sha endpoint — "what's deployed" is currently inferred from the
  deploy chain, not reported. Worth adding a `/api/version` (git sha + PROMPT_VERSION) so
  this is never guesswork. Flagged, not done.

---

## 1. TASK 1 — did v0.7 cause it? (matched v0.6 vs v0.7)

Isolated the **system prompt** as the single variable: v0.6 (last certified, 19,139 chars)
vs v0.7 (20,841 chars, +1,702 = the redaction/health/date rules), **same** fixtures, model
(Sonnet), current user-message builder, DATE-INVARIANT post-processing, warm cache
(100% both), concurrency. 15 runs each · 32 fixtures · 480 note-extractions per version.

| version | fab-RUN rate | fab-note events | **non-redaction fab events** |
|---|---|---|---|
| v0.6 | 10/15 (67%) | 11/480 | **0** |
| v0.7 | **0/15 (0%)** | **0/480** | **0** |

**Reading:** the hypothesis "v0.7's added rules caused fabrication" is **rejected**. Matched,
v0.7 fabricated *less*. Every one of v0.6's 11 events is a **redaction-fixture scoring
artifact**, not a phantom promise:

- `redact-adjacency-inline` (v0.6 = 9): the note is *"…I'll release the shipment on 8 Sep
  2026."* v0.6 extracts the **real** promise "Release the shipment" but with **owner:
  client** — the note says "**I'll**" (= rep). Owner-misattribution against a v0.7-era key it
  can't match → counted fabricated. **v0.7 gets this right: 0 events.**
- `redact-fp-guard` (v0.6 = 2): *"…I'll confirm the PO Friday."* Same shape — v0.6 attributes
  the real "Confirm the PO" promise to **client** instead of rep. **v0.7: 0 events.**

So v0.6's apparent 67% "fabrication" is (a) confined to fixtures written for v0.7's redaction
behavior, and (b) actually an **owner-attribution** weakness in v0.6 that v0.7 fixed — not
invented promises. On the fixtures both versions are meant to handle identically, **both
fabricate zero in 15 runs.**

---

## 2. TASK 2 — force and pin the event

The gate's run-3 fabrication and a separate one seen in a 1-run smoke (`ml-urdu-two-people`:
*"his manager Fatima will give final approval"* → extracted as a low-conf **client** promise)
are the only two v0.7 events observed across **all** sampling. They are on **different**
fixtures (the gate event was non-multilingual — the ML subset was clean that run) and
**neither reproduces**:

- **Full-set matched sample:** v0.7 = 0 fabrications in 15 runs (480 extractions).
- **4-pass diagnostic (earlier):** 0.
- **Targeted hammer** — the 7 multilingual/third-party fixtures (where a client or third
  party states a future action), **25 runs each on v0.7, 175 extractions:**

  | fixture | fab |
  |---|---|
  | arabic-english-resolvable | 0/25 |
  | hindi-english-resolvable | 0/25 |
  | urdu-english-unresolvable-date | 0/25 |
  | ml-arabic-one-person-unresolvable | 0/25 |
  | ml-hindi-three-people | 0/25 |
  | **ml-urdu-two-people** (the smoke hit) | **0/25** |
  | ml-arabic-two-people-visit | 0/25 |

**Clustering: none.** The one fixture that produced a smoke event is 0/25 on repeat. The two
observed v0.7 events are on two different fixtures, both non-reproducing.

**Rate (be explicit about the wide interval).** Across ~23 full-set v0.7 runs (~736
extractions) + 175 targeted = ~911 extractions, **2 fabrications** → ~0.2% per extraction.
Per-run: 2 in ~23 runs ≈ **~9%**, but a 15-run window caught **zero**, so the true per-run
rate is low single digits with a wide confidence interval — **not** the original ~14% (that
came from a 3-run sample, CI roughly 1–50%). A point estimate here would be false precision;
the honest statement is **"rare, low single-digit %, scattered."**

**Mechanism (from the captured events, both versions).** Every fabrication is the same class:
a **stated future action by someone other than the rep** — a client "I'll release the
shipment", a third party "Fatima will give final approval" — pulled in as a low-confidence
promise (usually `owner: client`). It is the promise/non-promise **boundary** for
third-party intent, extracted at `low` confidence. It is never a rep commitment invented from
nothing, and never carries a guessed date beyond what the text states.

---

## 3. TASK 3 — diagnosis + options (no unilateral change)

**Diagnosis:** the fabrication is **baseline model variance at the promise boundary**, not
caused by v0.7 and not clustered on any fixture. The Task-1 branch this lands in is *"v0.6
also fabricates → variance we simply never measured; a 3-run gate catches a low-single-digit
event only sometimes, so it could have been present through every prior certification."* Both
the confidence issue (already fixed) and this fabrication are the gate correctly surfacing
the model's floor. Since it is version-independent, **the lever is the standard, not the
prompt.** Options, with what each costs and lets through — **recommend, do not decide:**

### If treated as a standard question (recommended path)
- **A. Aggregate the hard fabrication bar over N runs with a stated tolerance**, instead of
  per-run zero. E.g. "0 fabrications across a 5-run aggregate" or "≤1 in ≥50 extractions,
  investigated." *Lets through:* a genuinely rare (<~2%) event without re-roll theatre; still
  fails on any real regression (which would recur). *Cost:* a documented standard change +
  one 5-run certification (~$1.5). **This is the most honest fit for a stochastic model** —
  it states the ceiling openly rather than hiding it behind lucky 3-run draws.
- **B. Keep per-run zero but raise N** (e.g. 5 runs, all clean). *Lets through:* nothing
  per-run, but certification becomes *harder* and flakier (P(5 clean) < P(3 clean)); you'd
  re-run more often. Not recommended — it worsens the flakiness it's meant to cure.
- **C. Accept probabilistic certification + re-run once.** *Lets through:* a ~9%-per-run model
  certified on a lucky draw. Weakest — borders on the re-roll the batch explicitly forbids;
  only tenable *with* option A's stated tolerance.

### If you'd rather harden the model first (optional, before any standard change)
- **D. Tighten the promise definition for third-party intent** in a **v0.8** — one added
  clause, exact wording below — so a client/third-party stated action is a `key_date` or a
  `concern`, not a `promise`, unless the rep owns a follow-up. This targets the *mechanism*
  (the boundary case) rather than the *symptom*.

  > Proposed v0.8 clause (append to Rule 1, promises): *"A promise is a commitment the **rep**
  > or the **client** makes to act. A third party's stated intention that the rep neither owns
  > nor is party to — 'his manager will approve', 'their finance team will release it' — is
  > **not** a promise; record it as a concern or key_date if it matters. When in doubt whose
  > commitment it is, do not manufacture a promise."*

  *Cost:* a full 3-run gate to certify v0.8 (~$1). *Risk:* prompt churn to chase a ~0.2%
  event; may not fully eliminate baseline variance. **Do not apply in this batch** — proposed
  only.

**My recommendation:** **A** (aggregate bar with a stated tolerance) as the durable fix,
optionally preceded by **D** if you want the mechanism narrowed first. Either way the decision
is yours; nothing here is applied.

---

## 4. TASK 4 — gate self-test (done, committed)

`daf4364 test(GATE-SELFTEST)`. Root cause of the dark-metric class: `leakedValues` was
threaded but unused, so the gate advertised a bar it never enforced (the second such case
after the confidence metric). The self-test asserts **every** GATE_HARD metric, violated by a
synthetic result, actually fails the gate and names itself; a coverage guard iterates
GATE_HARD and fails if any threshold lacks a self-test, so a future `maxX` can't be added
dark. Zero model cost, runs in CI.

**Verified able to fail:** `fabricatedPromises`, `guessedDates`, `mergedPeople`,
`falseCertainties`, `leakedValues` — all 5 — plus a clean-control that passes.

---

## 5. Spend

| phase | calls | spend |
|---|---|---|
| Post-correction 3-run gate (prior turn) | 96 | $0.800 |
| Smoke (RUNS=1, harness validation) | 84 | $0.672 |
| Matched 15-run v0.6/v0.7 sample | 980 | $8.152 |
| Targeted multilingual hammer (25×7, v0.7) | 175 | $1.703 |
| **Investigation total** | **~1,335** | **~$11.33 (AED ~41.6)** |

All warm — cache read 96–100% throughout (matched sample: 7.17M cached vs 0.088M uncached
tokens); one transient retry. Two early full-set runs aborted (one API timeout, one
credit-exhaustion 400) before the retry-robust harness; those failed fast at negligible cost.

---

## Definition of done
- [x] Investigation complete; what staging serves stated first.
- [x] v0.6 vs v0.7 rates, matched, with sample sizes.
- [x] Every fabrication captured + clustering analysis (no cluster).
- [x] Diagnosis + options (standard change and/or v0.8 clause), each with cost + what it
      lets through — recommended, not decided.
- [x] Gate self-test in CI; metrics verified able to fail.
- [x] No prompt, fixture, or threshold changed; **v0.7 remains uncertified** pending the
      owner ruling.
- [x] Total spend reported, warm/cold split.

---

# Part 2 — D-then-A: the fabrication fix, the leakage split, and certification

**v0.8 is CERTIFIED.** The confirmed standard, in two guarantees that are NEVER collapsed:

- **Certified fabrication rate 0.50% (12/2,400); gate tripwire 1.2% at N≥960.**
- **Tier-1 leakage: 0, deterministically enforced at ingest. Tier-2 leakage: 2.94% (5/170), model-enforced, aggregate bar (tripwire 8% at ≥60 exposures).**

The ceiling is never the rate; the rate is never the other tier's. Both rates are re-measured each certification (cumulative denominator), never inherited.

## The standard (what CI now enforces)

| Class | Mechanism | Bar | cert-final |
|---|---|---|---|
| Guessed dates, merges, false-certainty, null-named | per-run | **zero, every run** | 0 / 30 runs |
| **Tier-1 leakage** (card/IBAN/EID/credentials) | regex, stripped at ingest | **zero, deterministic** | 0 (`tier1Residual` = []) |
| **Tier-2 leakage** (religion/health/…) | Rule 7 (model), stochastic | **aggregate ≤ 8% @ ≥60** | 3.33% (3/90) ✓ |
| **Fabrication** | model, stochastic | **aggregate ≤ 1.2% @ ≥960** | 0.42% (4/960) ✓ |

cert-final (30 runs, N=960): DEPLOY GATE **PASS**, FULL CERTIFICATION **PASS**. Cache 100%, spend $9.87.

## D — the third-party promise-boundary clause (v0.8)
Rule 4 now names whose intention is a promise: a third party's stated action the rep isn't party to ("his manager will approve") is not a promise. **It did NOT reduce fabrication** — v0.8 (0.50%) is not below v0.7 (0.22%); the boundary event was already rare and this was never shown to move the rate. It stays because it is principled and costless (it correctly rules third-party intent out of promises), and it is **credited with no fabrication reduction it did not produce.**

## A — fabrication as an aggregate bar
Per-run zero-tolerance on a ~0.5% stochastic floor fails ~a third of 3-run attempts and trains re-rolling. Fabrication moved to an aggregate rate ceiling; every other hard metric stays per-run zero. My first published estimate (0.27%) was optimistic — it rode two lucky 0/480 samples and mixed in v0.7. The honest v0.8 rate is **0.50%** (≈ one low-confidence, queued item per rep every ~7 weeks — a tap to dismiss, never an asserted fact). Tripwire derivation (recorded beside `GATE_FAB`): at N=960 and p≈0.5%, ≥12 fabrications (1.25%) is the ~99th percentile → 1.2% tripwire, ~0.9% false-fail, vs 37% for per-run-zero.

## The leakage split (Tier-1 deterministic, Tier-2 aggregate)
The "test the prod pipeline" ruling only solved half the problem:
- **Tier-1 is format** — regex-stripped at ingest, the model never sees it. Verified WITHOUT the model (`redact.ts` idempotency). **0, guaranteed.** Adversarial coverage added (Arabic-Indic digits, space-grouped/newline IBANs, dotted/nbsp card separators) — `redact.ts` now carries the whole Tier-1 gate, so it is hardened where the real risk lives.
- **Tier-2 is meaning** — no regex exists, so Rule 7 (stochastic) is the only defence. Gating per-run-zero would gate a stochastic layer as if deterministic. Aggregate bar instead.

**★ The notable finding: Tier-2 health leakage is 2.94%, all on `health-exclusion`.** The model records a health detail ~1 in 34 exposures despite Rule 7 — higher than fabrication, and with no deterministic backstop. It surfaces as a low-confidence queued item, not an asserted fact, but it is the highest-risk number in this batch and worth future investment to reduce. Two caveats: the eval has only ~3 Tier-2 fixtures (≤90 exposures/cert), so the bar is coarse — **recommend adding more Tier-2 fixtures** to tighten it; and the Rule 7 isolation signal (1.43% raw) is tracked for drift.

## Three metrics shipped dark — the coverage guard now forbids it
`leakedValues` (threaded but unused), the confidence metric, and now **null-named** — Rule 5's prohibition was never enforced in P1-9, and worked Example D was actively teaching the violation (`{"name":null,"role":"buyer"}`, ~87% of runs). All three found and closed. A worked example teaches harder than a written rule, so a new test parses every example and asserts it satisfies the schema + Rule 5 + Rule 4. The GATE-SELFTEST coverage guard fails if any hard metric lacks a self-test — no metric can ship dark again.

## Condition 4 — production monitoring (the free, larger sample)
The confirmation-queue rejection rate is the live proxy: fabricated and Tier-2 items arrive as low-confidence "to confirm" entries, and a rep rejecting them at a rate implying materially more than the certified 0.50% / 2.94% is real signal at a sample far larger than any gate. **Status:** the queue exists (`brief.needsConfirmation`), but the confirm/reject *decision* is not yet captured. **Needed (flagged, not built this batch):** record the rep's accept/reject on to-confirm items and surface the rejection rate in `/health` (the model-metrics pattern), split fabrication-suspected vs Tier-2-suspected where derivable. Until then, monitoring is gate-sampling only.

## Spend (Part 2)
cert1 $4.04 · cert2 $4.99 · cert3 $5.03 · Tier-2 measurement $1 (est) · cert-final $9.87 · smaller probes ~$1 → **~$26** for the D→A certification cycle, all warm (100% cache).
