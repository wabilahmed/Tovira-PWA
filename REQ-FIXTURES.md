# REQ-FIXTURES — draft eval fixtures for the `requirements` field (Task A2)

`test(REQ-FIXTURES)`. These are **DRAFTS for your certification.** The P1-9 eval set
(`apps/api/src/eval/eval-set.ts`) is guard-protected read-only ground truth — I have not touched
it. Once you rule on the judgment call (#4) and certify these, they go in via the reviewed script
route, and only then does the A3 gate run. **No scoring run happens before that.**

`today` = `2026-07-09` for all. Convention I'm proposing (please confirm): for a fresh note where the
client states the need in this conversation, `stated_on` = the note's date; for an imported chat it
would be the message date; `null` only when neither is fixed. Rule 8's date discipline (never guess a
year, ambiguous numeric → null) applies to `stated_on` exactly as to promise/key-date dates.

---

## 1. Clear stated requirement → captured with the verbatim phrase
```
note: "Omar at Palm Realty is looking for a 3-bed villa in Arabian Ranches, budget around 4 million."
expected.requirements: [
  { text: "A 3-bed villa in Arabian Ranches (~AED 4M budget)",
    requirement_raw: "looking for a 3-bed villa in Arabian Ranches, budget around 4 million",
    stated_on: "2026-07-09", confidence: "high" }
]
```
Focus: a positive stated need is captured, verbatim phrase preserved.

## 2. A concern that is NOT a requirement
```
note: "Spoke to Layla. She said the pricing on the units we showed is above her budget."
expected.concerns:     ["Pricing on the units shown is above her budget"]
expected.requirements: []          ← the boundary: a budget complaint is a concern, not a need
```
Focus: the flagged regression — a concern must not leak into `requirements`.

## 3. A rep speculation → NO requirement
```
note: "Met the Nassar family. I think they'd probably want the corner unit given the kids, but they didn't say."
expected.requirements: []          ← "I think they'd want… but they didn't say" is the rep guessing
```
Focus: never infer a requirement the client did not state.

## 4. ★ A client question → JUDGMENT CALL (your ruling, not my assumption)
```
note: "Ahmed messaged asking: do you have anything with parking?"
```
**My reading (drafted as the expected): `requirements: []`.** Reasoning: a bare question is an
*inquiry about availability*, not a *stated need*. The client has not said "I need parking" — they
asked what exists. Capturing it as a requirement manufactures a need the client didn't assert, and §4
of the spec is explicit that this surface demands **precision over recall** (a wrong match is acted on
in front of a client). The prompt rule I drafted encodes this: "A question the client asks is not a
requirement." A question that *embeds* a stated need ("do you have parking? I've got two cars") would
capture the embedded need — but the bare form does not.

**The alternative, if you want maximum matching recall:** capture `parking` as a
`confidence: "low"` requirement so the item surfaces as a *possible* match for the rep to judge. This
trades precision for recall — defensible because low-confidence matches are pull-side and dismissible.

**Please rule.** If you choose the recall reading, I adjust both the prompt rule (Rule 8) and this
fixture before the cert runs. Default as drafted: **bare question → no requirement.**

## 5. A conditional requirement → captured, `confidence: low`
```
note: "Fatima said if the mortgage clears, they'd want two units side by side in the same tower."
expected.requirements: [
  { text: "Two units side by side in the same tower",
    requirement_raw: "if the mortgage clears, they'd want two units side by side in the same tower",
    stated_on: "2026-07-09", confidence: "low" }          ← conditional → low
]
```

## 6. A code-switched requirement (Arabic/English) → captured correctly
```
note: "يدور على شقة قريبة من المترو، two bedrooms."   (≈ "looking for an apartment near the metro, two bedrooms")
multilingual: true
expected.requirements: [
  { text: "A two-bedroom apartment near the metro",
    requirement_raw: "يدور على شقة قريبة من المترو، two bedrooms",
    stated_on: "2026-07-09", confidence: "high" }
]
```
Focus: Rule 0 (multilingual) holds for the new field; verbatim raw keeps the original mix.

## 7. A requirement beside redacted Tier-1 data → captured FULLY (over-suppression guard)
```
note: "Ravi is looking for a 1-bed in JLT for his son. He shared his Emirates ID 784-1990-1234567-1 for the paperwork."
expected.requirements: [
  { text: "A 1-bed in JLT (for his son)",
    requirement_raw: "looking for a 1-bed in JLT for his son",
    stated_on: "2026-07-09", confidence: "high" }
]
forbidden: ["784-1990-1234567-1", "784-1990", "1234567"]     ← the ID appears NOWHERE
```
Focus: the redaction batch's over-suppression rule — a legitimate requirement sitting next to a
Tier-1 value is extracted at full confidence; only the ID value is suppressed.

---

## What I need from you before A3
1. **Rule on #4** (bare client question: no requirement [default] vs. low-confidence requirement).
2. **Confirm the `stated_on` convention** (fresh note → note date; import → message date; else null).
3. **Certify these 7** (and any edits) into `eval-set.ts` via the reviewed route.

Then A3 runs the full 3-run gate on **Sonnet, warm, N≥960**, both subsets, all metrics + leakage +
`falseCertainties`, plus bake-off exports 3–4 on v0.9 — at the v0.8 standard, unchanged. I will report
the **total certification API cost (AED + USD, cached vs uncached, cache hit rate)** with the result.
Any hard-rule trip → stop and report, no fixture tuning.
