# REQ-FIXTURES — `requirements` eval fixtures, certification-ready (Task A2)

`test(REQ-FIXTURES)`. Seven drafts for **your sign-off**. The P1-9 answer key
(`apps/api/src/eval/eval-set.ts`) is guard-protected — these are a proposal; once you sign, they go
in via the reviewed route and A3 runs. `today` (= the note's reference date) is `2026-07-09` for all.

**Rulings applied (2026-09-03):**
- **#4 client question → NO requirement** (confirmed). A bare question is the client probing inventory,
  not stating a need; inferring one is what Rule 1 forbids, and it's consistent with the Ask batch
  (questions aren't facts). It still reaches the rep as an unanswered_question if unanswered.
- **`stated_on` = the note's reference date** (not extraction time; for an imported chat, the message
  timestamp; null only if the source has no timestamp). For these fresh notes that is `2026-07-09`.
- A3 will add a **requirements precision/recall + false-positive** metric to the scorer (scorer code,
  not the guarded key) — else the new field is uncertified.

Each fixture: note · expected (requirements + the neighbour field that matters) · the **justifying
phrase** per expected field.

---

### 1 · clear-requirement
**note:** "Omar at Palm Realty is looking for a 3-bed villa in Arabian Ranches, budget around 4 million."
**expected.requirements:** `[{ text: "A 3-bed villa in Arabian Ranches (~AED 4M budget)", requirement_raw: "looking for a 3-bed villa in Arabian Ranches, budget around 4 million", stated_on: "2026-07-09", confidence: "high" }]`
**justification:** `requirements[0]` ← "**looking for** a 3-bed villa in Arabian Ranches, budget around 4 million" (a positive stated need). `confidence: high` ← unconditional, unambiguous. `stated_on: 2026-07-09` ← the note's reference date (stated in this note).

### 2 · concern-not-requirement
**note:** "Spoke to Layla. She said the pricing on the units we showed is above her budget."
**expected.concerns:** `["Pricing on the units shown is above her budget"]` · **expected.requirements:** `[]`
**justification:** `concerns[0]` ← "the pricing on the units we showed **is above her budget**" (a complaint/objection about existing options). `requirements: []` ← nothing is a *positive stated need*; a budget complaint is a concern, not a requirement (Rule 8 boundary). **This is the flagged regression's guard.**

### 3 · rep-speculation
**note:** "Met the Nassar family. I think they'd probably want the corner unit given the kids, but they didn't say."
**expected.requirements:** `[]`
**justification:** `requirements: []` ← "**I think they'd probably want**… but **they didn't say**" — the rep speculating, explicitly not stated by the client. Rule 1 + Rule 8 (never infer from rep speculation).

### 4 · client-question  (ruling: NO requirement)
**note:** "Ahmed messaged asking: do you have anything with parking?"
**expected.requirements:** `[]`  ·  **expected.unanswered_questions:** the question surfaces here if unanswered (deterministic P1-6 path, unchanged)
**justification:** `requirements: []` ← "**do you have anything with parking?**" is an inquiry about availability, not a stated need. Confirmed ruling: a question is not a requirement.

### 5 · conditional-requirement
**note:** "Fatima said if the mortgage clears, they'd want two units side by side in the same tower."
**expected.requirements:** `[{ text: "Two units side by side in the same tower", requirement_raw: "if the mortgage clears, they'd want two units side by side in the same tower", stated_on: "2026-07-09", confidence: "low" }]`
**justification:** `requirements[0]` ← "they'd **want two units side by side in the same tower**" (a stated need). `confidence: low` ← "**if the mortgage clears**" makes it conditional (Rule 8).

### 6 · code-switched  (multilingual: true)
**note:** "يدور على شقة قريبة من المترو، two bedrooms."  (≈ "looking for an apartment near the metro, two bedrooms")
**expected.requirements:** `[{ text: "A two-bedroom apartment near the metro", requirement_raw: "يدور على شقة قريبة من المترو، two bedrooms", stated_on: "2026-07-09", confidence: "high" }]`
**justification:** `requirements[0]` ← "**يدور على شقة قريبة من المترو** (looking for an apartment near the metro), **two bedrooms**" — a stated need across an Arabic/English mix. `requirement_raw` keeps the original code-switched phrase (Rule 0 multilingual).

### 7 · requirement-beside-tier1  (forbidden: `["784-1990-1234567-1","784-1990","1234567"]`)
**note:** "Ravi is looking for a 1-bed in JLT for his son. He shared his Emirates ID 784-1990-1234567-1 for the paperwork."
**expected.requirements:** `[{ text: "A 1-bed in JLT (for his son)", requirement_raw: "looking for a 1-bed in JLT for his son", stated_on: "2026-07-09", confidence: "high" }]`
**justification:** `requirements[0]` ← "**looking for a 1-bed in JLT for his son**" (a stated need). `forbidden` ← "Emirates ID **784-1990-1234567-1**" must appear nowhere (Rule 7). The requirement is captured **at full confidence** despite sitting next to the ID — the over-suppression guard from the redaction batch: proximity to sensitive data never downgrades a legitimate fact.

---

## After your sign-off
Run A3: the full 3-run gate on **Sonnet, warm, N≥960**, both subsets, all existing metrics (leakage,
`falseCertainties`, guessed-dates, merged-people, null-named, falseCertainties per-run zero) at the
**v0.8 standard unchanged**, PLUS a new requirements precision/recall + false-positive metric, PLUS
bake-off exports 3 & 4 on v0.9. Any hard-rule trip → stop and report, no fixture tuning. I report the
**total certification API cost (AED + USD, cached vs uncached, cache hit rate)** with the result.
