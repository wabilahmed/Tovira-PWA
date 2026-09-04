# REQ-FIXTURES — `requirements` eval fixtures, certification-ready (Task A2)

`test(REQ-FIXTURES)`. Seven drafts for **your sign-off**. The P1-9 answer key
(`apps/api/src/eval/eval-set.ts`) is guard-protected — these are a proposal; once you sign, they go
in via the reviewed route and A3 runs. `today` (= the note's reference date) is `2026-07-09` for all.

---

## ⚠ Deploy exception on record — v0.9 shipped before certification (2026-09-03)

`tovira-extract-v0.9` (the `requirements` field, REQ-FIELD) was **deployed to staging on 2026-09-03,
before this certification ran** — a process slip against the standing rule that *no engine version
ships without passing P1-9*. Owner ruling (deliberate, time-boxed, dated):

- **It stays deployed.** No real users yet; inventory matching is inactive (A4–A6 not built); rolling
  back would cost more than it protects.
- **This is an exception, not a precedent.** Recorded here, dated, with the reason — not something
  that quietly happened.
- **If the A3 gate fails → roll back to v0.8 immediately.** Do not iterate on a live uncertified prompt.
- **The exception expires the moment beta reps touch the environment.** Before any real user, v0.9 must
  be certified (A3 passed at the v0.8 standard) or reverted.

**Deploy discipline (new, standing):** an uncertified prompt version must **never** reach an
environment with real users. Staging-before-cert is tolerable only while the population is empty; once
beta reps are on it, cert precedes deploy, always.

---

**Rulings applied (2026-09-03):**
- **#4 client question → NO requirement** (confirmed). A bare question is the client probing inventory,
  not stating a need; inferring one is what Rule 1 forbids, consistent with the Ask batch (questions
  aren't facts). It still reaches the rep as an `unanswered_question` if the source is a chat and it
  goes unanswered — a separate, deterministic P1-6 path, not exercised by a single paste.
- **`stated_on` = the note's reference date** (not extraction time; for an imported chat, the message
  timestamp; null only if the source has no timestamp). For these fresh notes the reference date **is**
  `2026-07-09`, so `stated_on` and `today` coincide here — see the note under fixture 1 on why none of
  these seven can demonstrate reference-date ≠ today, and where that distinction is guarded instead.
- A3 adds a **requirements precision/recall + false-positive** metric to the scorer (scorer code, not
  the guarded key) — else the new field is uncertified.

**How to read each fixture.** For every one: exact note text · pinned `today` + client · the **full**
expected extraction (all fields, not just `requirements` — category confusion is the risk) · and the
justifying phrase for each expected value. Empty fields are justified too (why nothing was extracted),
so an omission can't hide an inference. Baseline shape when unstated: `summary` a factual restatement,
all arrays `[]`, `meeting: null`, `unanswered_questions: []`, `multilingual: false`, `forbidden: []`.

---

### 1 · clear-requirement
- **today:** `2026-07-09` · **client:** `Palm Realty` · **source:** `paste`
- **note:** `Omar at Palm Realty is looking for a 3-bed villa in Arabian Ranches, budget around 4 million.`
- **expected:**
  - `summary`: "Omar at Palm Realty is looking for a 3-bed villa in Arabian Ranches, budget around AED 4M."
  - `people`: `[{ name: "Omar", role: null, reports_to: null, decision_role: "unknown", notes: null }]`
  - `requirements`: `[{ text: "A 3-bed villa in Arabian Ranches (~AED 4M budget)", requirement_raw: "looking for a 3-bed villa in Arabian Ranches, budget around 4 million", stated_on: "2026-07-09", confidence: "high" }]`
  - `promises: []` · `personal_facts: []` · `key_dates: []` · `concerns: []` · `next_steps: []` · `meeting: null`
- **justification:**
  - `summary` ← the whole note, restated with no added detail (AED is the local currency the "4 million" denotes; no new fact).
  - `people[0]` ← "**Omar**" (name stated). `decision_role: unknown`, `role/reports_to/notes: null` ← nothing about his role or authority is stated; "at Palm Realty" is the account (= client), not a note about him.
  - `requirements[0]` ← "**looking for** a 3-bed villa in Arabian Ranches, budget around 4 million" (a positive stated need). `confidence: high` ← unconditional, unambiguous. `stated_on: 2026-07-09` ← the note's reference date.
  - everything else empty ← the note states no commitment, personal detail, calendar date, worry, soft next step, or meeting.
- **Note on `stated_on` vs `today` (applies to all seven):** these are fresh notes, so the reference date *equals* today — the two coincide by construction, and no fresh-note fixture can separate them. The reference-date-≠-today case (an imported chat where `stated_on` must be the **message** date, not extraction day) is enforced by `referenceDateFor` + prompt Rule 8, and guarded by the existing DATE-REF fixtures; the current `EvalNote` shape (`source: voice|paste`) can't express a dated import, so I did not fake one. **Flag for your ruling:** if you want the distinction proven inside *this* set, I'd need to extend `EvalNote` with an import timestamp and add an 8th fixture — say the word.

### 2 · concern-not-requirement  ← the flagged regression's guard
- **today:** `2026-07-09` · **client:** `Marina Estates` · **source:** `voice`
- **note:** `Spoke to Layla at Marina Estates. She said the pricing on the units we showed is above her budget.`
- **expected:**
  - `summary`: "Layla at Marina Estates said the pricing on the units shown is above her budget."
  - `people`: `[{ name: "Layla", role: null, reports_to: null, decision_role: "unknown", notes: null }]`
  - `concerns`: `["Pricing on the units shown is above her budget"]`
  - `requirements`: `[]`
  - `promises: []` · `personal_facts: []` · `key_dates: []` · `next_steps: []` · `meeting: null`
- **justification:**
  - `concerns[0]` ← "the pricing on the units we showed **is above her budget**" (an objection about existing options).
  - `requirements: []` ← **nothing is a positive stated need.** A budget complaint about what she's already been shown is a concern, not a requirement (Rule 8 boundary). This empty is deliberate — the concern↔requirement neighbour confusion is exactly the regression risk, so a spurious requirement here is a false positive the scorer must catch.
  - `people[0]` ← "**Layla**" (name stated); nothing else about her stated.

### 3 · rep-speculation
- **today:** `2026-07-09` · **client:** `Nassar Family` · **source:** `voice`
- **note:** `Met the Nassar family. I think they'd probably want the corner unit, but they didn't actually say.`
- **expected:**
  - `summary`: "Met the Nassar family; the rep suspects they'd want the corner unit, but they did not say so."
  - `requirements`: `[]`
  - `people: []` · `promises: []` · `personal_facts: []` · `key_dates: []` · `concerns: []` · `next_steps: []` · `meeting: null`
- **justification:**
  - `requirements: []` ← "**I think they'd probably want**… but **they didn't actually say**" — the rep speculating, explicitly *not* stated by the client (Rule 1 + Rule 8: never infer a requirement from rep speculation).
  - `people: []` ← "the Nassar **family**" is a household, not an individually-named person; no first name is given.
  - `summary` reports the speculation *as* speculation ("suspects", "did not say") — it does not assert the corner-unit preference as fact.

### 4 · client-question  (ruling #4: NO requirement)
- **today:** `2026-07-09` · **client:** `Ahmed` · **source:** `paste`
- **note:** `Ahmed messaged asking: do you have anything with parking?`
- **expected:**
  - `summary`: "Ahmed asked whether there is anything available with parking."
  - `requirements`: `[]`
  - `people: []` · `promises: []` · `personal_facts: []` · `key_dates: []` · `concerns: []` · `next_steps: []` · `unanswered_questions: []` · `meeting: null`
- **justification:**
  - `requirements: []` ← "**do you have anything with parking?**" is an inquiry about availability, not a stated need (confirmed ruling: a question is not a requirement).
  - `unanswered_questions: []` here ← this is a single **paste**, not a speaker-attributed chat export, so the deterministic P1-6 unanswered-question path does not fire; in a real chat with no rep reply the question *would* surface there. (Flag: if you want that path asserted too, it needs a chat-export fixture, which the current `EvalNote` shape doesn't carry.)
  - `people: []` ← Ahmed is the client (the account), not a third party named within the note.

### 5 · conditional-requirement
- **today:** `2026-07-09` · **client:** `Fatima` · **source:** `voice`
- **note:** `Fatima said if the mortgage clears, they'd want two units side by side in the same tower.`
- **expected:**
  - `summary`: "Fatima said that, if the mortgage clears, they'd want two units side by side in the same tower."
  - `requirements`: `[{ text: "Two units side by side in the same tower", requirement_raw: "if the mortgage clears, they'd want two units side by side in the same tower", stated_on: "2026-07-09", confidence: "low" }]`
  - `people: []` · `promises: []` · `personal_facts: []` · `key_dates: []` · `concerns: []` · `next_steps: []` · `meeting: null`
- **justification:**
  - `requirements[0]` ← "they'd **want two units side by side in the same tower**" (a stated need). `confidence: low` ← "**if the mortgage clears**" makes it conditional (Rule 8). `stated_on: 2026-07-09` ← reference date.
  - `concerns: []` ← "if the mortgage clears" is the *condition on the requirement*, not an independent worry; it is captured inside `requirement_raw`, not duplicated as a concern.
  - `people: []` ← Fatima is the client.

### 6 · code-switched  (`multilingual: true`)
- **today:** `2026-07-09` · **client:** `Downtown Living` · **source:** `paste`
- **note:** `يدور على شقة قريبة من المترو، two bedrooms.`  *(≈ "looking for an apartment near the metro, two bedrooms")*
- **expected:**
  - `summary`: "Client is looking for a two-bedroom apartment near the metro."  *(English — Rule 0)*
  - `requirements`: `[{ text: "A two-bedroom apartment near the metro", requirement_raw: "يدور على شقة قريبة من المترو، two bedrooms", stated_on: "2026-07-09", confidence: "high" }]`
  - `multilingual: true` · `people: []` · `promises: []` · `personal_facts: []` · `key_dates: []` · `concerns: []` · `next_steps: []` · `meeting: null`
- **justification:**
  - `requirements[0]` ← "**يدور على شقة قريبة من المترو** (looking for an apartment near the metro), **two bedrooms**" — a stated need across an Arabic/English mix. `requirement_raw` preserves the original code-switched phrase verbatim (Rule 0). `confidence: high` ← unconditional. `stated_on: 2026-07-09` ← reference date.
  - `summary` in English ← Rule 0 (normalise a mixed-language note's summary to English). `multilingual: true` ← the note mixes scripts.
  - `people: []` ← no name stated.

### 7 · requirement-beside-tier1  (`forbidden: ["784-1990-1234567-1","784-1990","1234567","784 1990 1234567 1"]`)
- **today:** `2026-07-09` · **client:** `Ravi` · **source:** `paste`
- **note:** `Ravi is looking for a 1-bed in JLT for his son. He shared his Emirates ID 784-1990-1234567-1 for the paperwork.`
- **expected:**
  - `summary`: "Ravi is looking for a 1-bed in JLT for his son; he shared his Emirates ID for the paperwork."  *(no digits)*
  - `requirements`: `[{ text: "A 1-bed in JLT (for his son)", requirement_raw: "looking for a 1-bed in JLT for his son", stated_on: "2026-07-09", confidence: "high" }]`
  - `people: []` · `promises: []` · `personal_facts: []` · `key_dates: []` · `concerns: []` · `next_steps: []` · `meeting: null`
- **justification:**
  - `requirements[0]` ← "**looking for a 1-bed in JLT for his son**" (a stated need). `confidence: high` ← unconditional — captured at **full** confidence despite sitting next to a Tier-1 identifier (the over-suppression guard from the redaction batch: proximity to sensitive data never downgrades a legitimate fact). "for his son" is kept inside the requirement text as its beneficiary. `stated_on: 2026-07-09` ← reference date.
  - `forbidden` ← "Emirates ID **784-1990-1234567-1**" and its fragments must appear **nowhere** in the output (Rule 7). `summary` refers to the ID generically ("his Emirates ID") with no digits.
  - `personal_facts: []` ← "for his son" is the requirement's beneficiary, not an independent durable personal fact; extracting "has a son" separately would be reading more into the note than it states. **(Judgment call — flag: if you'd rather "has a son" be a `personal_fact{category:"family"}`, say so and I'll pin it.)**
  - `people: []` ← Ravi is the client.

---

## After your sign-off
Run A3: the full 3-run gate on **Sonnet, warm, N≥960**, both subsets, all existing metrics (leakage,
`falseCertainties`, guessed-dates, merged-people, null-named — per-run zero) at the **v0.8 standard
unchanged**, PLUS the new requirements precision/recall + false-positive metric, PLUS bake-off exports
3 & 4 on v0.9. Any hard-rule trip → **stop, report, and roll back to v0.8** (per the exception above) —
no fixture tuning. I report the **total certification API cost (AED + USD, cached vs uncached, cache
hit rate)** with the result.

## Judgment calls flagged for your ruling (before I pin the key)
1. **Fixture 1 note** — none of the seven separate `stated_on` from `today` (all fresh). Want an 8th
   import-dated fixture to prove reference-date ≠ today? (needs an `EvalNote` timestamp field).
2. **Fixture 4** — `unanswered_questions` can't fire from a paste; want a chat-export fixture to assert it?
3. **Fixture 7** — "for his son": kept inside the requirement text, or also a `personal_fact`?
