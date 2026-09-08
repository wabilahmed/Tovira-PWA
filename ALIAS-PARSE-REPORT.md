# Contact aliases + parser hardening — report

Driven by a real 5,940-message export (`WhatsApp Chat with Bilal Pak.txt`, Jul 2019 → Sep 2026;
Wabil 3,010 / Bilal Pak 2,930; 516 `<Media omitted>`; 2 system lines). The file is personal and is
**not committed** — a deterministic same-shape synthetic fixture stands in for it in the suite.

## The parser, before vs after (against the real file's properties)

| Property (real count) | BEFORE | AFTER |
|---|---|---|
| **Dash / day-first dates** `DD/MM/YYYY, h:mm am -` | Header matched, but the normaliser accepted only ISO `YYYY-MM-DD`, so **every real WhatsApp date became `sentAt: null`** — timestamps silently lost | Day-first `DD/MM/YY(YY)` parsed (12h + 24h), alongside ISO |
| **Continuation lines (276)** | **Already joined correctly** — existing imports were NOT fragmenting content (the flagged silent-failure risk was, happily, not present) | Unchanged; now proven at 5,940-message scale |
| **`<Media omitted>` (516)** | Kept as body text + a `media` flag, not turned into content | Unchanged; proven at 516 |
| **System lines (2)** | **No detection.** The first-line E2E notice was dropped as preamble, but a *mid-file* notice (no `Sender:`) was **folded into the preceding message as a continuation — corrupting it** | A dated line with no `Sender:` is recognised as a system notice and **skipped** |
| **Span 2019→2026** | With dates null, the reference date fell back to the import date — **a 2019 promise resolved as due "next week"** | Every message dated; a 2019 chat resolves relative dates against **2019** (long overdue), end-to-end asserted |

The headline correction: continuation-joining — flagged as the highest silent-failure risk — was **already
correct**, so past imports were not fragmenting messages. The real silent bug was **date loss** on the
dash/day-first format, which broke timestamps, the 2019 reference-date resolution, and the rendered
transcript (`[] Sender: …`). Plus the mid-file **system-line** corruption.

### The date-loss finding is the seventh "works, green, no live input" instance — and it's a new shape

The earlier reference-date fix was correct in code and *had nothing to operate on*: the parser handed
extraction undated messages for every real (non-ISO) export, so a historical chat could never resolve
relative dates against its own era no matter how right the logic was — a 2019 "I'll send it Thursday"
had no 2019 to anchor to. This is the seventh instance of the recurring pattern (a mechanism that
works, tests green, and receives no real production input), but it is a **new shape**: the wiring guard
catches an unwired *emitter* (nothing calls the code); this was an unwired *input* (the code is called,
but the data reaching it is silently empty/degraded). Worth considering whether the guard's remit
should extend from "is this path called?" to "does this path receive real data in production?" — the
in-memory-passes-but-prod-broken class the tests can't see because the stub feeds ISO dates the real
export never uses.

## Did the counterpart previously appear as a person in the stakeholder map?

**Yes.** The stakeholder map is derived from the model's `extraction.people[]` (there is no
stakeholders table). The model emitted the chat counterpart — under whatever nickname the transcript
used ("Bubu DXB") — into `people[]`, so the client themselves showed up as a separate "stakeholder,"
often under a name the rep didn't recognise. `normaliseCounterpart` now drops any `people[]` entry
matching the client (by real name or a learned alias) at persist time, and re-subjects that person's
personal facts to the client's real name. **Receipts/quotes are never touched — evidence stays
verbatim; only attribution is normalised.**

## Alias match order

`exact/word name → learned alias → known people (stakeholder map) → soften-and-ask`. Phone still
short-circuits when present, but the real file has **no phone numbers at all**, so name + alias is
the primary path, not the fallback.

## The confirmation gate (the ordering rule)

Parse → identify counterpart by elimination → match (name→alias→people) → **if no match, 409 before
the note is created and before extraction is queued** → on confirm, store the alias + create + queue.
Because extraction only ever runs from the sweep off a created note, gating before `notes.create`
guarantees **zero model calls before confirmation** (asserted by a spy on the extraction entrypoint).
Cancel stores nothing and spends nothing; choosing a different client imports there with nothing
wasted; an alias learned for one client never suppresses a genuine mismatch on another.

The copy softened from the accusatory *"This chat looks like it's with X, but you're filing it under
Y"* to *"This chat is with X, N messages from D to D — is that Y?"* with **confirm-and-remember** as
the primary action.

## Group chats — current behaviour + proposal

The two-speaker elimination rule does not apply to a group chat (>2 non-self speakers). **Current
behaviour:** such an import is flagged `group`, no single counterpart is asserted, and **no alias is
learned** (it would be ambiguous which speaker to alias); the name/known-people match still runs, so
a group chat whose participants include the client imports silently, and one that matches nothing
still gets a soft confirm (without alias learning). **Proposal:** keep group chats out of alias
learning — field sales is overwhelmingly 1:1, and guessing which of several speakers is "the client"
is exactly the kind of wrong-fact the product avoids. If group imports become common, add an explicit
per-speaker → client mapping in the confirm step rather than inferring one.

## The 5,940-message import as a real-world data point

- **It is ONE extraction call.** An import creates one note; the sweep extracts it in a single
  model call over the whole transcript (there is no per-message fan-out).
- **Cost:** transcript-dominated and cache-insensitive (per IMPORT-COST-REPORT, ~AED 0.34 per 1,000
  messages warm) → **~AED 2.0 for 5,940 messages**. Crucially, with the confirm gate that ~AED 2 is
  spent **only after the rep confirms the client** — a 5,940-message chat confirmed under the wrong
  client previously cost the full extraction to then move/undo; now a misfile costs **AED 0**.
- **Wall-clock:** parse + dedupe of the whole 6,259-line file is a few milliseconds (pure string
  work; the synthetic fixture parses within a test file that completes in ~20ms), and the import
  route returns **202 immediately** — extraction runs asynchronously in the sweep, so the rep never
  waits on the model regardless of transcript size.

## What shipped
`fix(PARSE-REAL)` — day-first dates, system-line skipping, synthetic fixture (Task 4).
`feat(ALIAS-PARSE)` — counterpart-by-elimination + rep name, the confirm-before-extraction gate,
learned per-client aliases (migration 0058, RLS, exported + purged), and counterpart attribution
normalisation with verbatim receipts (Tasks 1–3). Suite green (1,450); typecheck + lint clean. The
real export is never committed.
