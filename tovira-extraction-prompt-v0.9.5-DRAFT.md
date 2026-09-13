# Tovira — Extraction Prompt v0.9.5 (DRAFT — per-fact receipts)

> **STATUS: DRAFT. NOT CERTIFIED. NOT WIRED.** This is a design draft only. It changes nothing in
> production. It must not be promoted to the live prompt until it is certified in a separate,
> credit-gated batch (see "Sequence to ship"). Authored at the repo root because the guard hook
> (`guard-protected-files.sh`) blocks all writes under `docs/`, including new files — the owner applies
> this into `docs/` at promotion time.
>
> **Base of this draft:** the REAL current prompt is `apps/api/src/services/extraction/prompt.ts`
> (`PROMPT_VERSION = 'tovira-extract-v0.9.4'`). The guarded doc `docs/tovira-extraction-prompt.md` is
> **stale — titled v0.5** and does not reflect v0.9.1–v0.9.4. This draft is a delta on the real
> v0.9.4 prompt. **Owner action:** reconcile the guarded doc with `prompt.ts` when applying v0.9.5.

## What changes in v0.9.5

Five fact types — **promise, key_date, person, personal_fact, meeting** — gain the two receipt fields
that `requirements` (`requirement_raw`) and `unanswered_questions` (`question` + `sentAt`) already have,
so every fact proves itself without the raw message. Nothing else about extraction changes: same facts,
same conservatism, same date discipline. This is a storage/traceability change, not an accuracy change.

Two fields, one pattern across all seven types (naming from the existing self-contained receipts):
- **`source_span`** — the VERBATIM excerpt the fact was drawn from: the specific span, not the whole
  message. Mirrors `requirement_raw`.
- **`source_message_at`** — ISO-8601 timestamp of the message the fact came from. Mirrors the `sentAt`
  on an unanswered question.

## Extended output schema (delta on the v0.9.4 block in `prompt.ts:57-111`)

Each of the five objects gains the two fields (shown for `promises`; identical shape on `people`,
`personal_facts`, `key_dates`, and `meeting`):

```
  "promises": [
    {
      "text": "the specific commitment made",
      "owner": "rep | client",
      "due_date": "YYYY-MM-DD | null",
      "due_raw": "original phrase | null",
      "confidence": "high | low",
      "source_span": "the verbatim excerpt this fact was drawn from | null",
      "source_message_at": "YYYY-MM-DDTHH:MM | null"
    }
  ]
```

`requirements` and `unanswered_questions` are unchanged — they already carry a self-contained receipt
(`requirement_raw`; `question` + `sentAt`).

## New rule (append to the numbered Rules in `prompt.ts`, in the existing style)

> **Rule 9 — Source receipts (`source_span`, `source_message_at`).** For every promise, key_date,
> person, personal_fact, and meeting, quote the VERBATIM span you drew the fact from into `source_span`
> — the specific words, not the whole message, kept exactly as written (same discipline as
> `requirement_raw` in Rule 8). If you cannot point to a clear span the fact came from, set
> `source_span` to **null** — never paraphrase it, never reconstruct it, never guess. A fact with no
> honest span is still a fact; a fabricated span is a fabricated receipt, which is worse.
>
> Set `source_message_at` to the timestamp of the message that span came from, copied from the
> per-message timestamps in the input when they are present (an imported chat is rendered as
> `[timestamp] sender: message`). When the input has no per-message timestamps — a pasted block, a
> voice-note transcript, a single Ask statement — set `source_message_at` to **null**. Never use the
> note's capture time, today's date, or any other stand-in: there is no correct single message time for
> those sources, and a wrong timestamp is a wrong fact. This mirrors the year-less-date → null and
> no-null-named-person rules: absence is null, never a guess, and this discipline must not be weakened.

(The determinism split is fixed by the input format, not the model's judgement: `whatsapp_export` input
carries per-message timestamps; `voice` / `paste` / `ask_conversation` do not. The model only ever
COPIES a timestamp it can see, or emits null.)

## Version ladder — v0.9.5 (draft entry, same style as the `prompt.ts` version note)

> **Prompt version:** `tovira-extract-v0.9.5` *(v0.9.5: adds `source_span` + `source_message_at` to
> promises, key_dates, people, personal_facts, and meeting — the per-fact receipt that requirements and
> unanswered_questions already carry — so a fact is self-contained and raw content can later be deleted
> without losing "no claim without a receipt" (RECEIPT-DECOUPLE). Rule 9 added: verbatim span or null,
> never guessed; `source_message_at` copied from per-message timestamps (whatsapp_export) or null
> (voice/paste/ask — no per-message time), never a stand-in. **DRAFT — NOT YET CERTIFIED.** No accuracy
> claim until the gate runs: the same two-tier standard as v0.9.4 (hard per-run 0 guessed dates / 0
> fabricated promises / 0 merged people, plus — new for v0.9.5 — 0 fabricated source_spans against the
> ≤0.50% published fabrication standard; soft recall floors unchanged). v0.9.4: CLIENT-PERSON. v0.9.3:
> REQ-3P actor distinction. v0.9.2: REQ-PRECISION do-vs-find. v0.9.1: requirements field.)*

## Sequence to ship (nothing below is done in this batch)

1. Owner certifies the draft fixtures (Task 4, `eval-set-v0.9.5-DRAFT.ts`) as ground truth.
2. Apply this delta to `prompt.ts` `EXTRACTION_SYSTEM_PROMPT` and bump `PROMPT_VERSION` →
   `tovira-extract-v0.9.5`. (System prompt is the certified, byte-identical cached prefix — this is a
   real prompt change requiring re-certification.)
3. Run the gate with restored credits; check the fabrication rate against the published ≤0.50% standard,
   including a new zero-tolerance check for fabricated `source_span`.
4. Promote v0.9.5 from draft to current; reconcile the guarded `docs/tovira-extraction-prompt.md`.
5. Only THEN is the 30-day raw-content deletion job safe to build (still blocked until here).
