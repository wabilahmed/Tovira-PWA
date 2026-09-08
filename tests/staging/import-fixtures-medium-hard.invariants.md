# B1 medium + hard fixtures — invariant contracts (SYNTHETIC · for certification)

Both synthetic (no real customer content in the repo). Because full-output ground truth isn't
tractable at these sizes, each is certified as an **invariant contract**, exactly the shape you
called for: **planted anchor facts must be found · the trust rules must hold · nothing fabricated.**
For a synthetic transcript I plant the anchors by construction, so ground truth is known without a
held key. Rule on the anchor lists + invariants below; on approval I generate the transcripts to plant
exactly these, wire them behind `source: 'whatsapp_export'`, and B2 scores them.

---

## `import-medium-farah` — Farah Haddad, insurance broker (~401 messages, ~6 weeks, 2024)

Import ref `today` = 2026-09-08. A busy mid-size relationship: renewals, several commitments, some
noise. Planted anchors (the extraction must surface each; scored as recall on the planted set):

**Promises (planted 7; must find all 7, fabricate none):**
- A1 "send the renewal terms **by end of week**" (said Tue) → due_date = that Friday, due_raw kept.
- A2 "get the fleet policy quote over **on Monday**" → resolvable date.
- A3 "email the claims history **once Farah sends the schedule**" → due_date **null** (conditional on her action), due_raw kept. **TRAP: no guessed date.**
- A4 "call the underwriter **tomorrow**" (said on a dated message) → resolves off THAT message's date.
- A5 "share the comparison deck **after the board meeting**" → due_date **null**. **TRAP.**
- A6 client-owned: "Farah will confirm headcount **next week**" → owner client, resolvable.
- A7 "resend the invoice, their copy bounced" → due_date null, due_raw absent (no date stated) — present but undated, NOT null-because-guessed-wrong.

**People (planted 4):** Farah Haddad (decision_maker) · Khalid, "our finance approver" (decision_maker/approver) · Reem, "she just coordinates" (influencer/coordinator) · a one-line mention of **"my old broker at Oman Insurance"** — **TRAP: a prior vendor, NOT a Farah stakeholder.**

**Dates (planted 2):** policy renewal date (resolvable, 2024) · "Q4 review" (date null, date_raw "Q4").

**Personal (planted 1):** Farah mentions Ramadan travel plans — personal_fact, not a key_date.

**Multilingual:** Arabic/English code-switching throughout (تمام, إن شاء الله, يعني) — no fabricated facts from it.

**Invariants (any breach = stop-the-line fail):**
1. All 7 planted promises present; **0 fabricated** promises beyond them.
2. A3 and A5 due_date **null** (conditionals never get a guessed date).
3. Every resolvable date resolves to **2024**, never 2026 (message-date-relative).
4. The Oman Insurance broker appears **nowhere** in `people`.
5. Farah and Khalid never merged; Reem distinct.
6. Recall on the planted set ≥ the certified floor; precision at the v0.9.3 fabrication bar.

---

## `import-hard-imtinan` — Imtinan Qureshi, "Bubu DXB" (~5,615 messages, **2019 → 2024**)

Import ref `today` = 2026-09-08. Near Sonnet's context limit; the point is **multi-year integrity +
long-transcript recall**. Anchors are planted sparsely across five years so the fixture proves a fact
years deep isn't lost and years don't collapse:

**Cross-year promise anchors (planted 5):**
- H1 (**2019**) "I'll hold that price for you" — never retracted anywhere in 5,615 msgs → must **still surface**, stated_on 2019. **The lost-in-the-middle test.**
- H2 (**2021**) "send the renewal **before the 30th**" → due_date in 2021, not 2026.
- H3 (**2022**) a promise later **explicitly retracted** two days on ("ignore that, we're not doing it") → must **NOT** surface as an open promise. **TRAP: superseded commitment.**
- H4 (**2023**) "circle back **after the summer**" → due_date **null**. **TRAP.**
- H5 (**2024**, recent) "send the updated contract **on the 5th**" → resolvable, 2024.

**Cross-year people anchors (planted 3 + 1 trap):**
- Imtinan Qureshi — decision_maker throughout.
- A colleague **introduced in 2020** who becomes the technical decision-maker by 2023 → present, decision_role reflects the LATEST stated role, not the first.
- A person **mentioned once in 2019 who "has left"** (stated later) → must not be presented as a current active stakeholder. **TRAP: stale participant.**
- **TRAP:** a competitor named in passing in 2021 → nowhere in `people`.

**Date anchors:** a 2020 contract-signing date and a 2023 renewal date — each stated_on its own year;
**a 2019 "sometime next year" → date null.** TRAP.

**Multilingual:** Urdu/English + Arabic code-switching across the whole span.

**Invariants (any breach = stop-the-line fail):**
1. **Multi-year integrity:** every resolvable date resolves to **its own message's year** (2019/2021/2023/2024) — the flagship assertion; a 2026 or clock-relative date anywhere is an automatic fail.
2. **Long-transcript recall:** H1 (the never-retracted 2019 promise) is surfaced — a fact 5,000+ messages deep is not lost.
3. **Supersession:** H3 (retracted) does **not** appear as an open promise.
4. **Staleness:** the departed 2019 participant is not a current stakeholder; the competitor is nowhere.
5. H4 and the 2019 "next year" carry due_date/date **null** (no guessed dates across years).
6. **0 fabricated** promises/people/dates beyond the planted anchors; precision at the v0.9.3 bar.

> Scored as recall over the planted anchors + a hard zero on the fabrication/trust invariants — not
> full-output equivalence, which isn't meaningful for 5,615 messages. This is the fixture that would
> have caught a model that quietly stopped resolving multi-year dates or dropped mid-transcript facts.
