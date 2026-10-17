# Eval candidates — long-chat under-extraction & invented gender

**Status: CANDIDATES ONLY — not the certified eval set.** Nothing here is wired into the P1-9 gate
(`eval-set.ts`). These are two real failures from browser run 2 (test rep `8747fb0a-…`, 17 Oct),
captured so the owner can decide — after beta — whether to add them to the certified set and/or revise
the (frozen) extraction prompt through the certification gate.

The original 302-message transcript is the test rep's own chat content (prod data) and is **not committed**
(same rule as every real export). The input below is a REPRESENTATIVE synthetic chat of the same shape —
many messages across several topics, with three concrete facts spread through it — not the verbatim prod
transcript. Reproduce the real case from the prod note if a certified fixture is wanted.

---

## Candidate 1 — long chat, under-extraction

A 302-message chat yielded only **1 promise** in production. The facts below were stated in the chat and
were NOT surfaced — the model under-attended to the middle/early of a long transcript (a lost-in-the-middle
recall failure, not truncation: the input is ~tens of KB, far under the 5,000,000-char cap, and the
20,000-token output budget completed with `stop_reason=end_turn`).

### Input (representative, same shape as the 302-msg chat)

```
[2026-05-02 09:14] Client: morning — still keen on the 3-bed at Creek Harbour
[2026-05-02 09:15] Rep: great, I'll pull the latest availability
… ~90 messages of scheduling, small talk, a site-visit reschedule, photos …
[2026-06-18 17:40] Client: budget's firmed up — we can go to 3.2M all-in
… ~120 messages about fit-out, service charges, a mortgage pre-approval …
[2026-07-09 11:02] Client: we've decided — let's move on the Creek Harbour 3BR in July
… ~80 messages of logistics, parking, handover questions …
[2026-08-01 08:20] Rep: I'll send the reservation form today
```

### Expected facts (the three that must survive a long chat)

- **Budget: AED 3.2M** (stated 2026-06-18) — a `requirement`/budget fact.
- **The July decision**: the client decided to proceed in July (2026-07-09) — a `key_date` / decision.
- **Creek Harbour 3BR**: the specific unit of interest — a `requirement` (3-bed, Creek Harbour).
- Plus the rep's promise: "send the reservation form" (the one it did get).

### Bad output (observed)

Only the single promise ("send the reservation form"). The budget, the July decision, and the Creek
Harbour 3BR requirement were all dropped.

---

## Candidate 2 — invented gender ("his wife")

The model emitted a gendered relationship the chat never stated.

### Input (representative)

```
[2026-04-10 13:05] Client: I'll need to check with my partner before we commit on the villa
[2026-04-10 13:06] Rep: of course — take your time
```

### Expected

- A fact that a **partner** is involved in the decision — with NO invented gender. Acceptable:
  "needs to check with their partner" / decision involves a partner. The relationship's gender is NOT
  stated and must NOT be asserted (a wrong fact is worse than a missing one).

### Bad output (observed)

"his wife" — invented both the gender and the marital relationship from "my partner".

---

## Notes for the owner

- Neither is a code fix: the extraction prompt is frozen (certified). Candidate 1 is a recall-quality
  question (see the windowed-extraction estimate in the P20 report); candidate 2 is a prompt-rule / eval
  question (penalise invented gendered relationships).
- A deterministic write-time guard already drops a fabricated RECEIPT span (P18-8); it cannot catch an
  invented gender inside a fact's text, which is why candidate 2 belongs in the eval/prompt track.
