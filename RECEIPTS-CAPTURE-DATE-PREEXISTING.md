# Receipt capture-date — Task 3: how pre-existing facts render

Facts written before migration 0065 have `capture_at = NULL` (the column did not exist; nothing
backfills it). This confirms they render **honestly** — never a wrong (import) date.

## Aggregate surfaces (tracker, meeting list, brief, confirmations)

These render via `withReceipt`, which uses the fact's stored `captureAt`. For a pre-existing fact
`captureAt` is `NULL`, so `buildReceipt` produces:

```
{ quote: <source_span>, source: 'capture', at: null, label: 'Quoted from your capture' }
```

**No date is shown** — not the import date, not any guess. Per the existing doctrine ("a wrong fact
is worse than a missing one"), a missing date is the correct outcome. Verified by
`receipt-capture-date.test.ts` → *"a pre-existing fact (captureAt = null) falls back HONESTLY — no
date, never the import date"* (asserts `at === null`, label has no year, not the import date).

The three receipt shapes for a pre-existing fact:
- `source_span` present **and** `source_message_at` present (imported chat) → `source: 'message'`,
  renders the real message time. Unaffected by `capture_at` — no fallback needed.
- `source_span` present, `source_message_at` null (voice/paste, or a chat fact the model left
  untimed) → `source: 'capture'`, **no date** (the honest fallback above).
- `source_span` null (a pre-v0.9.5 fact) → `source: 'none'`, the Task-4 "no source quote saved"
  marker. No date either.

## Per-note view — actually better for old imports

The per-note view (`noteWithReceipts`) does **not** depend on the stored `capture_at`. It recomputes
the conversation date live via `referenceDateFor` over the note's own `messages`. So a pre-existing
IMPORTED note — whose messages are stored — still renders the **correct** conversation date on the
per-note view, even though its facts have `capture_at = NULL`. Only the aggregate surfaces (which
read the stored column and never load the note) fall back to no-date for pre-existing facts.

## Net

No pre-existing fact ever renders the import date. The worst case is a **missing** capture date on an
aggregate surface for a fact captured before this fix — acceptable by doctrine. As new facts are
written on the fixed path, `capture_at` populates and the aggregate surfaces show the conversation
date too. No backfill is attempted (the conversation date for an old fact is recoverable only from
its note's messages, which the per-note view already does live).
