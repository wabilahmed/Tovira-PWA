# Extraction Engine v0.5 — Certification & Gaps Report

**Date:** 2026-08-14 · **Model:** `claude-sonnet-5` · **Prompt:** `tovira-extract-v0.5`
**Standard:** two-tier (hard per-run on every subset · soft on the 3-run aggregate)
**Verdict:** **CERTIFIED — PASS.**

---

## 1. Why v0.5

Two trust rules were added after v0.4's gate exposed two over-extraction paths that
were not caught by the earlier standard:

- **Year-less dates (Rule 2).** A date stated without a year — "March 3rd", "next
  March", "the 14th" — now resolves to `null` with the phrase preserved in `_raw`.
  The model must never infer the year, not even the current or next one. v0.4 lapsed
  once on a "march 3rd" note; v0.5 closes it and regression-tests it in a
  code-switched note too (مارس).
- **No null-named person (Rule 5).** A role with no name — "the buyer", "their CFO",
  "the procurement lead" — is never emitted as a person. If the unnamed role carries a
  decision-relevant fact it goes to `concerns`/`next_steps`, never `people`. This was
  the people-precision culprit in v0.4 (a null-named "buyer" on the Northwind note).

## 2. The two-tier standard (why it changed)

Temperature is **deprecated for claude-sonnet-5** (the API returns HTTP 400
`temperature is deprecated for this model`). The model uses its own low-variance
sampling, so determinism can't be pinned with `temperature: 0`; it is instead
**certified by repeated runs**. The standard was redefined accordingly:

| Tier | Scope | Bars |
|---|---|---|
| **HARD** | per-run, **every subset**, zero tolerance | 0 guessed dates · 0 fabricated promises · 0 merged people |
| **SOFT** | aggregated over **3 runs** | promises recall ≥ 0.90 · people precision ≥ 0.85 · people recall ≥ 0.80 |

Rationale: *a wrong fact is worse than a missing one* — trust violations are absolute
and checked on every run; recall/precision are statistical and read cleanly only across
runs, so they're judged on the aggregate.

## 3. Certification results

### Per-run (hard gate)

| Run | Subset | promises p / r | people p / r | guessed | fabricated | merged | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Full        | 1.00 / 1.00 | 0.94 / 1.00 | 0 | 0 | 0 | **HARD PASS** |
| 1 | Multilingual| 1.00 / 1.00 | 1.00 / 1.00 | 0 | 0 | 0 | **HARD PASS** |
| 2 | Full        | 1.00 / 1.00 | 1.00 / 1.00 | 0 | 0 | 0 | **HARD PASS** |
| 2 | Multilingual| 1.00 / 1.00 | 1.00 / 1.00 | 0 | 0 | 0 | **HARD PASS** |
| 3 | Full        | 1.00 / 1.00 | 1.00 / 1.00 | 0 | 0 | 0 | **HARD PASS** |
| 3 | Multilingual| 1.00 / 1.00 | 1.00 / 1.00 | 0 | 0 | 0 | **HARD PASS** |

### 3-run aggregate (soft gate)

| Metric | Value | Bar | |
|---|---|---|---|
| promises recall | **1.00** | ≥ 0.90 | ✅ |
| people precision | **0.98** | ≥ 0.85 | ✅ |
| people recall | **1.00** | ≥ 0.80 | ✅ |
| guessed dates | **0** | 0 | ✅ |
| fabricated promises | **0** | 0 | ✅ |
| merged people | **0** | 0 | ✅ |

**CERTIFICATION: PASS** (hard per-run on both subsets, all 3 runs · soft aggregate).

## 4. Role-only regression (the v0.5 rule under test)

The three new role-only notes (`role-only-buyer-cfo`, `role-only-procurement`,
`role-only-finance-manager`) each expect `people: []`. **All held** — the multilingual
and role-only expectations produced people p=1.00 in every run.

**One residual, not a blocker:** in Run 1 only, the model emitted a null-named
`(buyer)` person on the *pre-existing* `firm-promise-resolvable-date` note ("Spoke to
the buyer at Northwind"). This is the single people-fp that pulled Run 1's full-set
people precision to 0.94. It did **not** recur in Runs 2–3, and it is a soft-precision
imperfection (0.98 aggregate, well above 0.85), **not** a hard violation — no merge, no
fabricated promise, no guessed date. Logged here as the known residual: the no-null-named
rule holds ~2/3 on that specific phrasing and is fully clean on the purpose-built
role-only notes.

## 5. Eval-set delta (v0.4 → v0.5)

| Change | Before | After |
|---|---|---|
| Multilingual named-people instances | 6 | **10** |
| Multilingual people-count spread | pairs only | **1 / 2 / 3 per note** |
| Code-switched year-less-date note | none | **1** (مارس → null) |
| Role-only (unnamed) notes → empty people | 0 | **3** |
| `_raw` verbatim in stated language | mixed | **enforced** (e.g. `date_raw: "مارس"`) |
| Date pinning | implicit | **test-locked** (runner injects `note.today`, never `new Date()`) |

New guard tests in `eval-set.test.ts` / `gate.test.ts`: ≥10 named people in the
multilingual subset; ≥2 role-only notes with empty `people`; no expected person has a
null/empty name; a code-switched note exercises the no-guessed-date rule; and the gate
injects each note's pinned `today`.

**Known coverage gap (flagged, not fixed):** `role-only-buyer-cfo` and
`role-only-finance-manager` both hinge on "the buyer" + a finance role at a company, so
they pass or fail together — less independent signal than three distinct notes suggest.
The Vertex note is also thin. Worth diversifying the role-only phrasings next time the
fixture is touched.

## 6. Governance

The eval set is now **human-certified ground truth**, treated like the acceptance tests:
the agent proposes changes, a human certifies them, and the guard hook
(`.claude/hooks/guard-protected-files.sh`) blocks Edit/Write on `eval-set.ts` /
`eval-set.test.ts`. Certified changes are applied via the reviewed script route, the same
as `docs/`. An examinee that can quietly edit its own answer key isn't being tested.

## 7. Temperature finding (accepted, closed)

`temperature` is deprecated for `claude-sonnet-5`; sending it returns HTTP 400. The
extraction path no longer sends it. The model port keeps an optional `temperature?`
field and the Anthropic adapter forwards it **only when set**, so models that still
honor it are unaffected. Determinism is certified by repeated runs, as above.
