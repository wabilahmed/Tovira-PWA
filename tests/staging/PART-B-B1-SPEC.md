# Part B · B1 — Extreme extraction, dense trap note  (SPEC + ANSWER KEY, awaiting certification)

**Status:** answer key drafted, **NOT yet certified**. Per the plan there is a hard stop
here: certify (or correct) this key before I build the scoring test and run it. Nothing
is scored until you sign off — this is the one place I must not mark my own homework.

**Run conditions to note:** email delivery was **unavailable** during the Part A run
(Resend out of quota). Part B (import / extraction / recall) does not touch email, so
this does not affect B1–B4 — recorded here only so the gap is never later misread as a
finding.

## What B1 tests
A single, realistic, code-switched (Arabic/English) sales debrief packed with the
extraction traps — the point is **precision and refusal**, not volume (volume is B3). It
exercises: relative-date resolution, the **ambiguous numeric date** (the certification
crux), a year/month-less date, a self-disambiguating numeric date, promise-vs-next-step,
a promise with no date, owner attribution, code-switch handling, and no-fabrication.

`today` = **2026-09-01** (a Tuesday). All relative dates resolve against that.

### B1 input note (source: `paste`)
```
Long day. Wrapped with Khalid at Gulf Petrochem — اجتمعت معاه اليوم, good energy.
He confirmed the board approved budget for the Q4 rollout. I told him I'll send the
revised SOW by this Thursday, and I promised to loop in their procurement lead once
it's signed. Their CFO, Mona, wants pricing locked before 03/04/2026 — she's the one
who actually signs off. The current contract renews 17/09/2026, so we have a hard wall
there. Site visit is pencilled for the 20th, still needs confirming. We should probably
get legal to look over the MSA at some point. Khalid mentioned بنته تخرجت — his daughter
graduated — he's off to London next week to celebrate.
```

## Answer key (my reading — the thing to certify)

**Promises** (2):
1. `Send the revised SOW` — owner **rep**, `due_raw: "this Thursday"`, **`due_date: 2026-09-03`** (Tue 2026-09-01 → this Thursday; day+month+year fixed), confidence high.
2. `Loop in Gulf Petrochem's procurement lead` — owner **rep**, `due_date: null`, `due_raw: "once it's signed"` (a condition, not a date), confidence high. *A promise with no resolvable date must still be logged, not dropped.*

**Next steps** (1): `Get legal to review the MSA`. — the soft "we should probably … at some point" is **not** a promise (Rule 4).

**People:** `Khalid` (contact at Gulf Petrochem; role null; decision_role unknown/influencer). `Mona` (role **CFO**; decision_role **decision_maker** — "actually signs off"). The *procurement lead* is a role-only reference and may optionally appear as `{name: null, role: "procurement lead"}`; present-or-absent is acceptable, an **empty-string name is not**.

**Personal facts:** `{subject: "Khalid", fact: "Daughter graduated; traveling to London next week to celebrate", category: family}`. — "next week" here is personal travel, not a business key_date.

**Key dates** (3) — the heart of B1:
| description | date | date_raw | why |
|---|---|---|---|
| CFO wants pricing locked by | **`null`** | `03/04/2026` | **THE PLANT** — ambiguous order (see below) |
| Contract renewal (hard wall) | **`2026-09-17`** | `17/09/2026` | resolvable — `17` can only be a day, so DD/MM is forced |
| Site visit (unconfirmed) | **`null`** | `the 20th` | no month, no year → null (Rule 2); confirmed:false |

**Concerns / meeting:** concerns may note the renewal wall (optional). The site visit may live under `meeting` instead of `key_dates` (`datetime:null`, `confirmed:false`) — placement is acceptable either way; what is **not** acceptable is resolving it to a concrete date.

**No-fabrication checks:** exactly 2 promises (not 3 — legal review is a next step); no promise invented from "board approved budget"; the ambiguous date is not silently resolved; the year-less date is not inferred.

## ⇦ CERTIFICATION CRUX — the ambiguous numeric date

`03/04/2026` is genuinely ambiguous: **3 April** (DD/MM) or **4 March** (MM/DD) — both are valid dates. `17/09/2026` is **not** ambiguous: 17 can only be a day, so it resolves to 17 Sep 2026.

**My reading:** a fully-numeric date resolves **only when its components force one ordering**; when both are ≤ 12 the order is undecidable, so the correct output is **`date: null` with the raw preserved** — flag, don't guess. Rationale: the LOCKED prompt has **no locale rule** for day/month order, Rule 2 forbids guessing a date you can't resolve with confidence, Rule 3 says prefer flagging, and "a wrong fact is worse than a missing one." Silently picking an order is the least-visible failure in the set — it shifts every such date and nothing surfaces.

**The decision you are certifying — pick one:**
- **(A) [recommended]** Ambiguous numeric (both ≤12) → **null + flag**; self-disambiguating → resolve. *No engine change; consistent with the locked rules.*
- **(B)** Locale default — UAE is day-first, so `03/04/2026` → **3 April 2026**, resolved. *This is a real product choice, but it requires ADDING a day-first rule to the extraction prompt and re-running the P1-9 certification (the engine is locked — see the cert standard). If you want B, say so and I'll treat it as a separate engine change, not part of B1.*

## After certification (for context, not now)
- I build the B1 scoring test against the certified key and run it on staging.
- **B2–B4** follow. **B3 is the scale test** (≈10,000 code-switched lines through the *async* import → the new background sweep). Given that path is new, B3 must verify the sweep **drains the whole import** — `scheduled_job_runs` shows it working through, and the note reaches `extracted`, rather than the sweep finishing early on a subset (400/2000 chunks "ok" would look exactly like success). B3 needs a raised model-cost budget; the three budget-limited Part A PARTIALs (FLOW 7/22/18) run in that same higher-budget session.
