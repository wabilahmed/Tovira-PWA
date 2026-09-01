# Bake-off — planting spec + answer keys (AWAITING CERTIFICATION)

Ground truth by construction (planting generator). Pinned `today = 2026-09-01` (Tuesday):
`this Friday`=2026-09-04 · `next Thursday`=2026-09-10 · `in two weeks`=2026-09-15.

**Hard trust rules (any non-zero on any export disqualifies a model):** fabricated promises, guessed dates, merged people, null-named people, falseCertainties — all MUST be 0.

**★ STOP — nothing is scored until these answer keys are certified.**


## export-1 — ~50 lines (generated: 51), langs: en
Certified languages: en

**Answer key — promises:**
- "Send the pricing proposal" · owner=rep · due_date=2026-09-04 (raw="this Friday") · confidence=high

**Answer key — people (all named; zero null-named):**
- Omar, Layla

**Answer key — key_dates:**
- (none)

**Planted traps (expected behaviour):**
- **explicit-date**: this Friday → 2026-09-04, high confidence

## export-2 — ~300 lines (generated: 301), langs: en/arz
Certified languages: en/arz

**Answer key — promises:**
- "Send the revised contract" · owner=rep · due_date=2026-09-10 (raw="next Thursday") · confidence=high

**Answer key — people (all named; zero null-named):**
- Yusuf

**Answer key — key_dates:**
- (none)

**Planted traps (expected behaviour):**
- **relative-date**: next Thursday → 2026-09-10
- **soft-next-step**: "we should probably loop in procurement at some point" → next_step, NOT a promise
- **role-only**: "their finance lead hasn't approved" → NO person (role only); a concern

## export-3 — ~1500 lines (generated: 1501), langs: en/ar
Certified languages: en/ar

**Answer key — promises:**
- "Send the signed SOW" · owner=rep · due_date=2026-09-15 (raw="in two weeks") · confidence=high

**Answer key — people (all named; zero null-named):**
- Sara, Sarah

**Answer key — key_dates:**
- CFO wants pricing locked before this date: date=null (raw="05/06/2026")

**Planted traps (expected behaviour):**
- **ambiguous-date**: 05/06/2026 both components ≤12 → date NULL + raw kept (v0.6 rule); resolving it is a guessed date
- **no-merge**: Sara and Sarah are DISTINCT people — must not merge
- **unanswered**: client asks "can you also cover onboarding?" and the rep never answers → an unanswered question, NOT a promise

## export-4 — ~5000 lines (generated: 5001), langs: en/ar/hi/ur
Certified languages: en/ar/hi/ur

**Answer key — promises:**
- "Send the SOW once legal clears the new clause" · owner=rep · due_date=null (raw="once legal clears") · confidence=low
- "Start onboarding once the PO comes through" · owner=rep · due_date=null (raw="once the PO comes through") · confidence=low

**Answer key — people (all named; zero null-named):**
- Ahmed

**Answer key — key_dates:**
- Contract renewal (hard deadline): date=2026-08-22 (raw="22/08/2026")

**Planted traps (expected behaviour):**
- **supersession**: retracted Thursday SOW must NOT be an active dated promise; live state = low conditional, no Thursday
- **conditional**: onboarding "once the PO comes through" → promise, confidence low, null date
- **negation**: "I did NOT promise them a discount" → no discount promise fabricated
- **third-party**: Ahmed's boss is unnamed (role) → not a null-named person
- **arabic-indic-numerals**: a date written in ٢٢/٠٨/٢٠٢٦ must not break date handling
- **self-disambiguating-date**: 22/08/2026 → 2026-08-22 (22 can only be a day)

## export-5 — ~10000 lines (generated: 10001), langs: en/ar/hi/ur/ru/tl
Certified languages: en/ar/hi/ur · UNCERTIFIED (scored separately, a miss is not a regression): ru/tl
Needle @ line 8000: "office moved to Sheikh Zayed Road, tower 3"

**Answer key — promises:**
- "Send the integration timeline" · owner=rep · due_date=2026-09-04 (raw="this Friday") · confidence=high

**Answer key — people (all named; zero null-named):**
- Priya

**Answer key — key_dates:**
- (none)

**Planted traps (expected behaviour):**
- **needle**: at ~line 8000: "office moved to Sheikh Zayed Road, tower 3" — must be recallable
- **near-duplicate**: the integration-timeline commitment appears twice → ONE promise, not two
- **deleted**: "This message was deleted" lines carry no fact
- **media**: "<Media omitted>" lines carry no fact
- **scale-drain**: the sweep must drain the WHOLE import; scheduled_job_runs must not report ok on a partial drain

## Fairness + governance (Task 6)
- Identical prompt (v0.6), identical exports, pinned `today` per fixture. No per-model prompt tuning.
- Both models cached: warm each cache first, run each ladder back-to-back inside the 1h TTL. Report each model's prefix hit rate; **any run < ~90% is void — re-run it** (a cold run inflates cost ~9x and gives a false verdict).
- Cheapest first (export 1 → 5); abort the ladder early on any hard-trust violation.
- Budget-tracked (ModelBudget): estimate before, abort on overrun, report actual cached/uncached.

## Decision rule
- Haiku **0** hard violations across all five → recommend a formal 3-run P1-9 Haiku re-cert (the gate decides, not this bake-off).
- Haiku **any** hard violation → Sonnet stays locked; record the failure shape.
