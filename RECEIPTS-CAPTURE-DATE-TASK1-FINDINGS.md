# Receipt capture-date fallback — Task 1 findings (no edits)

## 1. Surfaces using the fact's own `createdAt` for the capture-date fallback

All go through `withReceipt(rec)` (`services/receipts/receipt.ts`), which builds the receipt with
`captureDateMs: rec.createdAt` — the fact ROW's created_at.

| Surface | file:line | fact type |
|---|---|---|
| Promise tracker | `http/facts-routes.ts:91` | promise |
| Confirmations queue | `http/facts-routes.ts:79` | promise + meeting |
| Promise PATCH result | `http/facts-routes.ts:191` | promise |
| Meeting create | `http/meetings-routes.ts:123` | meeting |
| Meeting list | `http/meetings-routes.ts:128` | meeting |
| Meeting edit | `http/meetings-routes.ts:157` | meeting |
| Meeting confirm | `http/meetings-routes.ts:171` | meeting |
| Brief openPromises | `services/brief/brief-service.ts:74` | promise |
| Brief needsConfirmation | `services/brief/brief-service.ts:75` | promise |

The per-note view (`noteWithReceipts`, wired in `notes-routes.ts`) uses `note.createdAt` and is
NOT in this list — but see §3: `note.createdAt` has the same defect for imports.

## 2. Could these surfaces join the note without an N+1?

The fact records carry `noteId` (`PromiseRecord.noteId`, `MeetingRecord.noteId`), so a join is
*possible*. But:
- There is **no batch-fetch-by-ids** on the note repo today (no `findByIds` / `WHERE id = ANY($1)`).
  A list surface (tracker returns all open promises across clients) would need either a per-fact
  `findByIdForUser` (an **N+1**) or a new batch method + a `SELECT id, created_at FROM notes WHERE
  id = ANY($1)` query.
- **It would not matter**: the column a join returns — `notes.created_at` — is the wrong value
  (see §3). Joining buys nothing here.

## 3. THE CRUX — is `notes.created_at` the conversation time or the import time?

**It is the import/insert time. Confirmed in both adapters:**
- In-memory: `create()` sets `createdAt: Date.now() + this.seq++` — insert time.
  (`adapters/notes/in-memory-note-repository.ts:36`)
- Postgres: `INSERT INTO notes (user_id, client_id, source, raw_text, audio_key, status, messages)`
  does **not** list `created_at`, so it takes the column `DEFAULT now()` — insert time.
  (`adapters/notes/pg-note-repository.ts:46`)
- `NewNote` has **no `createdAt` field**, so no caller can backdate a note to its conversation date.

So for a WhatsApp import, `notes.created_at` = **when the import ran**, not when the conversation
happened. A rep importing two years of history would get `created_at = today` on every note.

→ **This is the option (c) condition:** `notes.created_at` is import time, and neither denormalising
it nor joining it fixes the underlying problem. Per the batch, I stop here and report rather than
ship a fallback that is merely less wrong.

### But the conversation date IS carried, and is already computed

- Each imported message keeps its own timestamp: `ImportedMessage.sentAt` (ISO), stored on the note
  (`notes.messages`) and preserved by the import path.
- `referenceDateFor(note, today)` (`extraction-service.ts:87`) already derives the conversation date:
  the **latest message `sentAt`** for an imported chat, and the caller's `today` (= capture date) for
  a fresh voice/paste note. Its own comment: *"An imported chat resolves against its latest message
  date … Never the import-time now for imports."*
- `extractNote` computes this as `const referenceDate = referenceDateFor(note, today)` (line 247),
  **before** `saveExtraction` (line 337). So the correct capture date is in hand at fact write time.
- It is a `YYYY-MM-DD` date — exactly the granularity the receipt fallback renders.

This is the same fix class as the production bug where imports resolved relative dates against the
import date instead of the message date; that was fixed by `referenceDateFor`, and the receipt
fallback needs the same source.

## Recommendation (for the go/no-go on Task 2)

Neither literal option (a) (denormalise `notes.created_at`) nor (b) (join it) works. The correct fix
is **option (a) sourced from `referenceDate`, not `notes.created_at`**:

> Add a nullable `capture_at` (date) column to `promises`, `key_dates`, `meetings`, populated at
> write time in `saveExtraction` from the `referenceDate` that `extractNote` already computes, and
> use it for the capture-date fallback on all surfaces (`withReceipt`). Facts written before the
> column exists have `capture_at = NULL` and fall back honestly (Task 3).

This avoids the N+1 (no note join), and stores the conversation date, not the import date.

**Stopping for confirmation** before building Task 2, because this uses a source field the batch's
option (a) did not name (`referenceDate` vs `notes.created_at`), and option (c) explicitly says to
stop and report when `notes.created_at` is import time.
