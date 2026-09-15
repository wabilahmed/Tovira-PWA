# Time-Ambiguity Probe — Findings (report only)

**Prompt:** `tovira-extract-v0.9.5` (production, **unchanged**) · **model:** `claude-sonnet-5` · **today:** 2026-09-15 (Tuesday) · **runs:** 5 per input · **inputs:** 18 across 6 classes.
**Spend:** $2.18 (AED 8.01) for 90 probe calls + 2 warm-up (see §Task 4). Cache read observed on every input.

This is a **probe, not a fix.** Nothing was changed — not the prompt, schema, gate, or any fixture. This document reports what the certified extractor *actually does* with time expressions that have no single correct answer. It does **not** grade outputs against an expected answer and it does **not** propose a behavior change. Machine record with every per-run JSON: `TIME-AMBIGUITY-PROBE-DATA.md`; raw model output: `TIME-AMBIGUITY-PROBE-RAW.json`.

Inputs were embedded in short, realistic UAE real-estate/insurance WhatsApp exchanges and fed through the exact production path (`EXTRACTION_SYSTEM_PROMPT` cached prefix + `buildUserMessage`, parsed with the production `extractJsonObject`), with chat text rendered as production renders an imported thread (`[<ISO timestamp>] sender: body`).

---

## The headline

**The resolved date/time is unstable across identical runs, and the extractor sets `confirmed: true` and/or a specific clock time on times that are genuinely unsettled.** Only **4 of 18 inputs** (A1, A3, D1, E1) produced identical output on every captured field across all 5 runs. The other 14 disagreed run-to-run on at least one of: whether a specific `datetime`/`due_date` was resolved, whether `confirmed` was true, which bucket the fact landed in, or which span was quoted.

The *verbatim* fields hold up well — `source_span` and the `_raw` phrase almost always capture the full ambiguous wording. The *interpreted* fields — `datetime`, `due_date`, `confirmed`, and sometimes `datetime_raw` — are where the ambiguity gets silently resolved, and they resolve **differently on different runs of the same input.** Variance is itself the finding: the same message can become a null "needs review" meeting on one capture and a confirmed 7pm slot on the next.

---

## Task 3 — per-class findings

Legend: `dt` = `meeting.datetime` (· = null); `conf` = `meeting.confirmed`; a specific time/date resolved from an ambiguous source is **bold**. "Rep can tell?" = would a rep reading the surfaced fact see any signal the source was ambiguous.

### Class A — explicit ranges

| Input | Phrase | Landed | dt across 5 runs | Span | Rep can tell? |
|---|---|---|---|---|---|
| A1 | "somewhere between 1-4pm" | meeting ×5 | · · · · · (all null) | full: "let's meet somewhere between 1-4pm" ×5 | **Yes** — dt null, raw keeps "between 1-4pm" |
| A2 | "10 to 12 tomorrow" | meeting ×5 | · · · **10:00** **10:00** | full: "I'm free 10 to 12 tomorrow" ×5 | **Partial** — 2/5 collapse the range to its start (10:00); raw keeps "10 to 12" but the calendar point does not |
| A3 | "between Thursday and Saturday" | meeting ×5 | · · · · · (all null) | full ×5 | **Yes** — dt null, raw keeps the range |

**Finding A:** a two-endpoint range is never kept as a range — it is either left unresolved (correct-ish) or **collapsed to the first endpoint** (A2, 2/5 runs → 10:00, `confirmed:false`). The range survives only in `datetime_raw`/`source_span`, never in the machine `datetime`. Run-to-run the same range flips between null and a point.

### Class B — self-correction / stutter

| Input | Phrase | Landed | dt / date across 5 runs | conf | Rep can tell? |
|---|---|---|---|---|---|
| B1 | "at 2 2:30 pm" | meeting ×5 | · **14:30** · **14:30** **14:30** | **true ×5** | **Weak** — 3/5 pick 2:30 as settled, all `confirmed:true`; only the raw "2 2:30 pm" hints at the stutter |
| B2 | "Monday — no wait, Tuesday" | meeting ×5 | · · · **Tue 00:00** · | true 1/5 | **Weak** — the model *does* pick Tuesday (the correction), but 2/5 collapse `datetime_raw` to just "Tuesday", dropping the visible correction; 1/5 emits a confirmed dated meeting |
| B3 | "at 5, actually make it 6" | meeting ×3, meeting+promise ×2 | **18:00** · **18:00** · **18:00** | true ×5 | **Weak** — 3/5 resolve 6pm→18:00, all confirmed; span drifts to the rep's ack "noted, will call at 6" or a fragment "actually make it 6" |

**Finding B:** self-corrections are usually resolved to the *corrected* value (Tuesday, 6, 2:30) — the model reads the correction correctly — but it does so with `confirmed:true` and often collapses the raw to the final token, so the fact that the client waffled is not surfaced. B3 also shows **span mis-targeting**: 2/5 runs quote the rep's confirmation message instead of the client's, and one run resolves `due_date` to `2026-09-14` (the source day) on the promise.

### Class C — relative religious / cultural time

| Input | Phrase | Landed | dt / date across 5 runs | conf | Rep can tell? |
|---|---|---|---|---|---|
| C1 | "after Asr" | meeting ×4, +promise ×1 | · · · · · (all null) | **true ×5** | **Partial** — dt correctly null, but `confirmed:true` on all 5 and one run also spawns a promise; the *time* is unknowable yet the meeting reads as locked |
| C2 | "بعد المغرب around 8" | meeting ×5 | **09-16 20:00** · **09-15 20:00** · · | mixed | **Weak** — 2/5 commit a precise 20:00, one of them **on the wrong day** (09-16, not "tomorrow"=09-15) |
| C3 | "before Jummah on Friday" (insurance renewal) | promise ×5 | **09-11** · · **09-18** · | conf low ×4, **high ×1** | **Weak** — 1/5 resolves due_date to Friday 09-18 *and flips confidence low→high*; 1/5 resolves to 09-11 (the message date — clearly wrong) |

**Finding C:** religious/cultural time anchors ("after Asr", "بعد المغرب") are correctly left with `datetime:null` most of the time — the model does not invent a prayer-clock time — **but** it marks the meeting `confirmed:true` (C1, all 5), and when a weekday is attached ("Friday", "around 8") it will sometimes resolve a specific slot, including to the wrong day. C3 is the clearest confidence instability: the *same* sentence is `low` on four runs and `high` on one.

### Class D — vague approximations

| Input | Phrase | Landed | dt / date across 5 runs | Rep can tell? |
|---|---|---|---|---|
| D1 | "next week sometime" | meeting ×5 | · · · · · (all null) | **Yes** — dt null, raw kept |
| D2 | "end of the month" (deposit) | promise ×5 | · **09-30** · **09-30** · — confidence **high ×5** | **Weak** — 2/5 guess 2026-09-30; **all 5 marked `high`**, so even the null runs don't route to confirmation |
| D3 | "morning is better for me" | none ×4, meeting ×1 | · · · (raw "morning") · | **Over-extraction 1/5** — a bare preference becomes a meeting once |
| D4 | "in shaa Allah tomorrow" | meeting ×5 | **09-15** · · **09-16 00:00** **09-16** | **Weak** — 3/5 resolve a date, disagreeing on which day ("tomorrow" anchored to today vs the message date); `confirmed` flips false→true |

**Finding D:** vague *word* phrases ("next week sometime", "morning") behave best — mostly null or nothing. But phrases with an embedded anchor ("end of the month", "tomorrow") get resolved to a specific date on some runs, and **`confidence:high` is emitted even when the date is left null** (D2, all 5 runs high). "tomorrow" exposes an **anchor ambiguity**: it resolves against *today's date* on some runs and against the *message's own date* on others, so the same "tomorrow" lands on two different calendar days.

### Class E — code-switched (Arabic / Hindi / Urdu — English)

| Input | Phrase | Landed | dt across 5 runs | conf | Rep can tell? |
|---|---|---|---|---|---|
| E1 | "bukra بعد الظهر, maybe 3 or 4" | meeting ×5 | · · · · · (all null) | mixed | **Yes** — dt null, full bilingual span kept |
| E2 | "kal shaam ko, around 7 baje" | meeting ×5 | **19:00** **19:00** **19:00** **09-16 19:00** **19:00** | **true ×5** | **No** — "around 7" becomes an exact **confirmed** 19:00 on all 5 runs; only the day wobbles |
| E3 | "kal ya parso, subah ke waqt" (insurance) | meeting+promise ×3, promise ×3 | · · · · · (all null) | false | **Partial** — dt null and confidence low, but the fact flips between meeting-and-promise and promise-only run to run |

**Finding E:** code-switching does **not** degrade span capture — the full mixed-script phrase is quoted verbatim, and the model even appends a parenthetical gloss ("(tomorrow or day after, morning)"). But E2 is the single strongest fabricated-certainty case in the whole probe: an *approximate* time ("around 7") in a code-switched message becomes a **precise, confirmed 19:00 meeting on every one of 5 runs.** E3 shows the classification instability — the same insurance-signing message is sometimes a meeting+promise and sometimes only a promise.

### Class F — controls

| Input | Phrase | Landed | Outcome | Rep can tell? |
|---|---|---|---|---|
| F1 | "meeting Thursday 3pm" (should resolve cleanly) | meeting ×5 | 4/5 → **09-17 15:00** (correct Thursday), 1/5 → **09-16 15:00** (Wednesday — wrong), confirmed ×5 | n/a — but note **20% date error even on the clean control** |
| F2 | "let's meet" (should produce nothing) | none ×4, meeting ×1 | 1/5 emits a meeting object with `datetime:null` **and `datetime_raw:null`** from "yes let's meet" | **Over-extraction 1/5** — a no-time control fabricates an empty meeting once |

**Finding F:** the unambiguous control is *mostly* clean but still misfires on 1/5 (resolves Thursday to Wednesday) — so run-to-run date variance is not unique to ambiguous inputs, it is a baseline property. The no-time control fabricates a meeting on 1/5, and that meeting has `datetime_raw:null`, which the schema describes as "original phrase" (a string) — a shape the field is not meant to take.

---

## The flagged cases — fabricated certainty under the existing doctrine

The product doctrine (CLAUDE.md): *"A wrong fact is worse than a missing one… never guess a date… never present an unconfirmed guess as a fact."* The following runs emitted a **confident single time or date from a genuinely ambiguous source, with the ambiguity signals turned off** — no current gate catches these (the fabrication gate counts invented promises/dates against the eval fixture; it does not see live ambiguous input, and `confirmed:true` is not gated at all):

- **E2 — "around 7 baje" → confirmed 19:00, all 5 runs.** Strongest case. An explicit approximation becomes an exact, `confirmed:true` slot every time. A rep sees a locked 7:00 PM meeting.
- **B1 — "at 2 2:30 pm" → 14:30, `confirmed:true`, 3/5.** A verbal stutter is resolved to a precise confirmed time.
- **C2 — "بعد المغرب around 8" → 20:00, 2/5**, one of them on the **wrong day** (09-16). A prayer-relative approximation becomes an exact slot, sometimes mis-dated.
- **D2 — "end of the month" → 2026-09-30, `confidence:high`, 2/5.** A vague deadline becomes a specific high-confidence dated promise. (Rule 2 says vague → null; 2/5 runs guessed the 30th, and the confidence stays `high` even on the null runs.)
- **C3 — "before Jummah on Friday" → 09-18 at `high` (1/5) or 09-11 (1/5).** A deadline promise gets a guessed date, and confidence itself flips low↔high.
- **A2 — "10 to 12" → 10:00, 2/5** (range collapsed to its start).
- **B2 / D4 / F1 — dated & sometimes `confirmed` from "Tuesday" / "tomorrow" / a mis-resolved "Thursday".**

**Structural note on why the span may not rescue meetings:** the `meeting` object has **no `confidence` field.** Its only ambiguity signals are `datetime:null`, `confirmed:false`, the raw phrase, and the span. When a run sets a specific `datetime` **and** `confirmed:true` (E2 all 5; B1 3/5), *both* machine signals are off — the ambiguity survives **only** in `datetime_raw`/`source_span`. Downstream surfaces that key off `datetime` and `confirmed` (the calendar entry, the pre-meeting nudge, the "unconfirmed — is this right?" prompt) would treat these as settled and **would not fire the confirmation UI at all.**

---

## Does `source_span` alone rescue these cases?

**Partly — necessary, not sufficient.**

**Where it helps:** `source_span` almost always captures the **full** ambiguous phrase verbatim, not a truncated fragment that looks settled. "Monday — no wait, Tuesday" is kept whole (B2, all 5) even when `datetime_raw` collapses to "Tuesday"; the full range "I'm free 10 to 12 tomorrow" is kept (A2); the entire bilingual "يعني نلتقي bukra بعد الظهر, maybe 3 or 4" is kept (E1). A rep who *reads the span* can, in most cases, see the source was ambiguous. This is the strongest positive result in the probe and it survives code-switching.

**Where it does not rescue:**
1. **It is a display, not a guard.** The committed `datetime`/`due_date`/`confirmed` are what drive the calendar, nudges, and the confirm-gate. The span sits beside them; it does not stop a fabricated 19:00 from being scheduled or a Sep-30 promise from going on the tracker as `high`.
2. **The span itself is unstable in the hardest cases.** B3 quotes the rep's ack ("noted, will call at 6") or a bare fragment ("actually make it 6") instead of the client's line, and shifts `source_message_at` to the wrong message accordingly. When the source is genuinely muddled, the span can point at the wrong thing.
3. **`confirmed:true` overrides it.** For meetings there is no confidence field, so a `confirmed:true` + resolved `datetime` reads as settled regardless of what the span says — and the span is not shown on a confirmed calendar entry today.
4. **It only rescues if it is rendered *and* read.** Nothing forces a rep past the resolved time to the quote.

So: the span reliably *preserves* the ambiguity, but preservation is not the same as *surfacing* or *gating* it. Under the current schema the span can tell the truth while the machine fields next to it say something more certain.

---

## Task 4 — spend, disclosure, and what a follow-up would need

**Credit spend:** **$2.18 (AED 8.01)** total — 90 probe calls + 2 warm-up, `claude-sonnet-5`, warm cache (cache read confirmed on every input). Credits were confirmed available before the run; the probe ran in full (no partial run presented as findings).

**Nothing was changed.** No edit to the prompt, the schema, the extraction gate, or any fixture. The paused receipt-persistence work (Task 2 of the receipt-decoupling batch) remains uncommitted and untouched in the working tree. This document and the harness are the only outputs; the commit is `[skip ci]` and does not touch `docs/`.

**What a follow-up batch would need to decide** (stated as open questions, not recommendations — the decision is not proposed here):

1. **Is `confirmed:true` on an unsettled time acceptable?** The confirm-gate is the product's designed catch for uncertain items, and it is currently bypassed whenever the exchange contains an agreement token ("got it", "theek hai") regardless of whether the *time* is settled. A follow-up must decide whether `confirmed` should reflect time-certainty, message-agreement, or both.
2. **Should a range or approximation resolve to a point at all?** A2/E2/C2 collapse ranges/approximations to a single `datetime`. A follow-up must decide the intended contract: null-with-raw, a range representation the schema does not currently have, or a documented "resolve to start."
3. **`meeting` has no confidence field.** Promises/key_dates/requirements do; meetings do not. A follow-up must decide whether ambiguity on a meeting time is representable at all without one.
4. **The "tomorrow" anchor.** "tomorrow"/"kal" resolve against today's date on some runs and the message's own date on others (D4, E2), producing different calendar days. A follow-up must decide the intended anchor for relative day-words in an imported chat.
5. **Run-to-run non-determinism is baseline** (even F1, the clean control, is 20% wrong). A follow-up must decide whether that variance is acceptable for a fact a rep acts on, and whether it is measured/bounded anywhere.
6. **What would a gate for this even measure?** The existing fabrication gate scores against a fixed eval fixture; it has no notion of "confident output from an ambiguous live input." A follow-up must decide whether ambiguity-handling is gate-able and against what ground truth, given that these inputs have *no single correct answer* by construction.

**Scope note:** deciding any of the above — or changing prompt/schema/gate behavior — is explicitly **out of scope** for this probe and is not done here.
