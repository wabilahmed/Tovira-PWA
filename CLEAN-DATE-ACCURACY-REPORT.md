# Clean-Input Date/Time Accuracy at N — Findings (report only)

**Prompt:** `tovira-extract-v0.9.5` (production, **unchanged**) · **model:** `claude-sonnet-5` · **N:** 25 inputs × 20 runs = **500 calls** · **spend:** $7.33 (AED 26.92).
**Anchor:** production-faithful — every input resolved against `referenceDateFor` (the latest message's date), exactly as the extraction service does for an imported chat. Thread text rendered as production renders it (`[<ISO>] sender: body`).

This is a **probe, not a fix.** Nothing was changed — not the prompt, schema, gate, or any fixture. Purpose: measure how often the certified extractor resolves an *unambiguous* date/time incorrectly, after the time-ambiguity probe found the clean control wrong on 1/5 at low N.

Unlike the ambiguity probe, **every input has a single correct answer, stated up front** (see the harness and `CLEAN-DATE-ACCURACY-DATA.md`), so correctness is mechanically checked, not judged. Relative inputs carry an earlier decoy message on a different date, so an **anchor error** (resolved against the wrong reference date) is distinguishable from a **resolution error** (wrong arithmetic from the right reference).

---

## Headline

**On clean input, v0.9.5 is accurate and — critically — never confidently wrong.** 490/500 correct (98.0%). Across all 500 runs there were **zero wrong dates, zero anchor errors, and zero fabricated times.** Every one of the 10 misses is a *conservative* failure: the fact was captured with its verbatim phrase kept, but the date/time was either left unresolved (null) or routed to a bucket with no time slot. This is exactly the direction the product doctrine wants (*"a wrong fact is worse than a missing one"*).

Two caveats temper that: (1) the misses **cluster entirely in code-switched inputs** — 9 of 10 are class G, all where the clock time is written in Arabic script (`الساعة 2`) or transliterated (`4 baje`); non-code-switched clean input was 339/340 = 99.7%. (2) A 98% clean-input accuracy still means **1 in 50 clean, resolvable dates does not make it onto the calendar**, and **nothing in the current certification measures this at all.**

---

## Task 3 — results

### Overall (N = 500)

| Metric | Value |
|---|---|
| **Correct** (right date, right time, right bucket) | **490/500 = 98.0%** |
| Error rate | **10/500 = 2.0%** (95% Wilson CI on accuracy **[96.4%, 98.9%]**) |
| Wrong dates (confidently wrong) | **0** |
| Anchor errors (resolved to the decoy date) | **0** |
| Resolution errors (wrong arithmetic, right anchor) | **0** |
| Fabricated time on a date-only input | **0** |
| Misclassification (right date, wrong bucket) | **3** (counted below under G2; time lost as a side effect) |
| Null-resolution / silent miss (fact kept, date left null) | **7** |

**What the 10 misses actually are** — none is a wrong answer:

- **7 × null-resolution.** The meeting was captured with `datetime_raw` intact but `datetime` left `null`, on a date that *was* resolvable (and resolved on the other runs of the same input). The fact is still surfaced to the rep; only the calendar date is missing.
  - A4 "Friday 5pm" — 1/20 (meeting kept, `datetime_raw:"Friday 5pm"`, date null).
  - G3 "bukra الساعة 2" — 6/20 (meeting kept, `datetime_raw:"bukra الساعة 2…"`, date null); the other 14/20 resolved 2026-09-16T14:00 correctly.
- **3 × classification-with-time-loss (G2).** "documents 5 May 2027 ko 4 baje (4pm) sign karenge" was read as a **promise** ("Sign the documents", `due_date:2027-05-05`, confidence `high`, `due_raw` keeps "4 baje (4pm)") instead of a meeting. The **date is correct**; the 4pm is lost only because a promise has no time field. The other 17/20 read it as a meeting at 2027-05-05T16:00.

### By class

| Class | correct/N | error % | notes |
|---|---|---|---|
| A · weekday + time | 79/80 | 1.3% | one null-resolution (A4 "Friday 5pm") |
| B · date + time (with year) | 80/80 | **0.0%** | perfect |
| C · date, no time | 60/60 | **0.0%** | perfect; no fabricated time added |
| D · relative | 80/80 | **0.0%** | perfect — see anchor note below |
| E · explicit + year | 60/60 | **0.0%** | perfect |
| F · time-only same-day | 60/60 | **0.0%** | perfect |
| G · code-switched | 71/80 | **11.3%** | all 9 remaining errors here |

**Errors cluster; they are not spread.** 9 of 10 errors are in class G, and within G they are two specific inputs (G2 ×3, G3 ×6). G1 (Arabic-English, explicit date) and G4 (Hindi-English weekday) were 20/20. The common factor in the failing two is a **clock time expressed outside plain Latin digits** — `الساعة 2` and `4 baje`. Everything else — including four-plus-month-out absolute dates, relative "day after tomorrow", and same-day "this evening" — resolved perfectly and repeatably. Clustering this tight points to a specific, addressable pattern (code-switched time tokens), not diffuse model variance.

### Anchor vs resolution errors — separated

**Zero anchor errors and zero resolution errors.** Every relative input (D1–D4, F1–F3, G3) resolved against the correct reference — the latest message's date — even though each thread contained an earlier decoy message on a different date. Not one run anchored to the decoy.

This is worth stating plainly against the prior probe: the time-ambiguity probe found "tomorrow"/"kal" resolving to different calendar days run-to-run. **That instability was an artifact of that probe passing an arbitrary `today` that differed from the message date — it bypassed `referenceDateFor`.** When the production anchor is used (this probe), relative-date resolution on clean input was 100% correct and stable. The anchor is not a source of clean-input error in production.

### Misclassification & silent miss

- **Misclassification:** 3/500 (0.6%) — G2's promise-vs-meeting split. The date is right in all three; the cost is a lost time and a fact on the wrong surface (promise tracker vs calendar).
- **Silent miss / null-resolution:** 7/500 (1.4%). In every case the *fact* was still emitted with its raw phrase; none was dropped entirely and none produced a wrong date. So "silent" overstates it — a rep would still see the meeting, just without a resolved calendar time.

### `confirmed` remains noisy (noted, not scored)

The same clean input produced both `confirmed:true` and `confirmed:false` across runs (e.g. A3, B2, B4, D2, F2). This matches the ambiguity probe's finding, but `confirmed`-semantics work is out of scope here, so it is recorded and not analysed further.

---

## How this compares to the published certification standard

- **Certified fabrication rate:** promise fabrication **0.61%** at N=980 (v0.9.5 = v0.9.4; the certified bar is ≤0.5%, and the 0.61% tail is a logged standing item).
- **Clean-input error rate (this probe):** **2.0%** (95% CI [1.1%, 3.6%] on the error).

Numerically, **the clean-input error rate (2.0%) materially exceeds the certified fabrication rate (0.61%)** — roughly 3×. But they are **different failure classes**, and the honest comparison must say so:

- The fabrication gate measures the extractor **inventing** a promise/date it should not have. That is the trust-destroying failure, and on clean input this probe saw **zero** of it (0 wrong dates, 0 fabricated times).
- The 2.0% here is the extractor **declining to resolve** a date it could have (or filing it in a time-less bucket) — omission, not fabrication. Less severe, and doctrine-aligned.

**The gap that is genuinely uncovered:** the existing certification measures fabrication against a fixed eval fixture. **It does not measure clean-input date-resolution accuracy, the null-resolution/silent-miss rate on resolvable dates, or code-switched clock-time handling at all.** So the finding is not "the cert is wrong" — it is that a real, repeatable 2.0% clean-input miss rate, concentrated ~9:1 in code-switched inputs, sits **entirely outside what any current gate observes.** A rep in this market (the code-switched case is the *home* market, per Rule 0) would hit the class-G miss rate of ~11%, and nothing in CI would flag it.

---

## Task 4 — spend, disclosure, open questions

**Credit spend:** **$7.33 (AED 26.92)** — 500 probe calls + 2 warm-up, warm cache, well under the AED 60 ceiling (projected AED ~48; came in lower). Credits were confirmed live by the first real call; the run completed in full (no partial run presented as findings). A hard budget-abort at AED 60 was armed and never triggered.

**Nothing was changed.** No edit to the prompt, schema, extraction gate, or any fixture. The paused Task 2 receipt-persistence work remains uncommitted and untouched. Outputs are this report + the harness + machine record + raw JSON; the commit is `[skip ci]` and does not touch `docs/`.

**What a follow-up would need to decide** (open questions, no recommendation):

1. **Is a 2.0% clean-input miss rate acceptable for a fact a rep acts on** — given it is omission, not fabrication, and the raw phrase is always retained? Where is the line between "conservative, correct" and "lost the date"?
2. **Code-switched clock times are the concentration.** `الساعة 2` and `4 baje` drove 9 of 10 misses in the rep's home market. A follow-up must decide whether code-switched time resolution needs its own measurement and bar, separate from the English-centric eval fixture.
3. **The promise-vs-meeting split (G2).** A scheduled signing read as a promise loses the time (promises have no time field). A follow-up must decide whether that is a classification bug, a schema gap (promises with times), or acceptable.
4. **Should any of this be gated?** The fabrication gate does not see clean-input resolution accuracy or silent misses. A follow-up must decide whether to add a clean-input accuracy gate, what its ground truth is, and what floor it enforces — noting these inputs, unlike the fabrication fixture, have mechanically-checkable single correct answers.
5. **Null-resolution is invisible today.** When a resolvable date comes back null, the meeting still surfaces without a calendar time, and nothing flags that a resolvable date was missed. A follow-up must decide whether that silent degradation should be observable.

**Scope note:** any prompt/schema/gate/fixture change, the `confirmed`-semantics and meeting-confidence work, the notification rework, and any remediation recommendation are explicitly **out of scope** for this probe and are not done here.
