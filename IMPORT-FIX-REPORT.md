# IMPORT-FIX — import robustness + misfiling (report)

Two related problems on the trial-critical seeding path: the importer didn't accept what WhatsApp
actually exports, and a rep could file a chat (or voice note) under the wrong client with nothing to
catch it. No extraction-prompt change and no P1-9 gate run — all file parsing, deterministic
comparison, and moving rows. Landed before inventory matching (A4–A6), because matching acts on
requirements and acting on misfiled data is what turns a filing mistake into suggestions made in
front of a client.

---

## PART A — accept what WhatsApp actually exports

### The picker diagnosis (which failure it was)
**Both (a) and (b) were real**, and both are fixed:
- **(a) the share sheet** — the Android share-target's `params.files.accept` was `['text/plain','.txt']`
  only, so WhatsApp would not offer Tovira a **.zip**, and `readSharedChat` read the shared file with
  `.text()`, which corrupts a zip. The share-target shipped in the wiring sweep but had **never run on
  a real device**, so this was invisible.
- **(b) the in-app picker** — the file input's **`accept` was exactly `"text/plain,.txt"`**, so a `.zip`
  could not be selected at all; and even a selected file was read with `FileReader.readAsText`, which
  corrupts binary bytes.

**What the picker accepted before:** `text/plain,.txt`. **Now:** `text/plain, application/zip,
application/x-zip-compressed, application/octet-stream, .txt, .zip` — and, because mobile browsers
routinely report the wrong MIME, selection is deliberately permissive and the real validation is by
**content after upload**, not by the picker filter.

### Zip handling + the caps
A real iOS export is a `.zip` containing `_chat.txt` (+ media). Rather than add an npm dependency, the
ZIP reader (`zip.ts`) is built on Node's built-in `zlib` — which gives tight control over
decompression, the point of a public upload endpoint. It parses the central directory, then, **before
decompressing**, enforces:

| Cap | Default | Why |
|---|---|---|
| entry count | 128 | a chat export is one text file + media; 128 is generous |
| per-entry decompressed | 5 MB | via `zlib` `maxOutputLength`, so a **lying** uncompressed size (a bomb) throws rather than balloons |
| total decompressed (text) | 5 MB | matches the import ceiling |
| nested archive | rejected | by name (`.zip`) **and** by magic bytes on the decompressed content (a zip smuggled under a `.txt` name) |
| unsupported compression | skipped | not fatal to the whole import |

Nothing is ever written to disk; everything stays in memory. Media/binary entries are dropped
(UTF-8 + no NUL heuristic). **Transcript selection is by content, not filename**
(`resolve.ts`): every text entry is parsed as a WhatsApp export, whichever parses wins, the largest if
several (`_chat.txt` on iOS, `WhatsApp Chat with X.txt` on Android, localised names elsewhere are all
handled without trusting the name). No parseable entry → a clear rejection **naming what was found**.
The bare `.txt` path and the paste path are unchanged; a file upload now arrives as base64 bytes and
the server detects zip-vs-text by content.

### Onboarding copy
Corrected to match reality on both platforms: iPhone yields a `.zip`, Android a `.txt`, and Tovira
accepts either. Brand voice kept — no exclamation marks, no emoji.

---

## PART B — misfiling: detect, flag, correct

Within one tenant, **RLS does not help** — it scopes by `user_id`, not `client_id` — so a chat filed
under the wrong client of the *same* rep puts Ahmed's promises, requirements and personal facts in
Meridian's vault, where the brief shows them and recall cites them **with receipts** (which makes wrong
information *more* convincing). Two detectors, both deterministic and model-free, plus a real fix.

### B1 — detect at import (deterministic)
A WhatsApp export names its participants, so we check before spending anything. The transcript's
participants are matched against the selected client by **name**, **stakeholder-map people**, and —
strongest — the client's **stored phone** (P4-7) vs a phone-number counterpart in the export. On a
mismatch we **confirm, never block** (HTTP 409 holds the import) and **suggest** the likely-correct
client when exactly one matches; the rep acknowledges to proceed, and the override is recorded. We
**never auto-reassign**.

**False-positive posture:** biased against nagging. Word-token matching (so "Me" never matches
"**Me**ridian"); the rep's own `Me`/`You` labels are excluded; and on a fresh client with no phone and
no known people and no other-client match, we **stay silent** — we genuinely cannot tell yet, and a
first-import nag would train the rep to ignore the prompt.

### B2 — detect after extraction (soft, content-only)
Voice notes and pastes carry no participant metadata, so the only signal is who the note mentions.
After extraction, if a note filed under B mentions **only** people on another client's record and
**none** on B's, a soft "Move it?" rides the confirmation queue (`moveSuggestions[]`), naming the
people and the likely client. **Conservative by construction:** it requires **zero overlap** with the
filed client *and* a positive match elsewhere, so a fresh client's first note never flags. Stored on
the note (`move_suggestion`, migration 0046), computed once at extraction, cleared when the note moves.

### B3 — move a note and everything derived from it
A move carries **everything the note produced** (`NoteMoveService`):
- the note, its raw text/messages and its **embedding — re-pointed, not re-embedded** (content
  unchanged);
- the spine rows: **promises and key dates** (by `noteId`);
- its **meeting(s)** (by `noteId`);
- everything in the note's `extracted` JSONB — **people, personal facts, concerns, next steps,
  requirements, unanswered questions** — moves *with* the note by construction; **confirmation-queue
  items** and the move-suggestion are derived on read, so they follow automatically.

Rules honoured:
- **Preview before moving** — `GET /notes/:id/move-preview` returns the counts ("2 messages, 3
  promises, 1 requirement, …") and the move/undo requires confirmation.
- **State preserved** — only `clientId` changes, so a done promise stays done and a confirmed fact
  stays confirmed (asserted in tests).
- **Last-contact RECOMPUTED on BOTH clients** — the misfile wrongly reset the wrong client's
  going-cold clock while the right client silently cooled; after the move each client's clock is
  recomputed from the notes it actually owns (the easy-to-miss part, called out in the spec).
- **Corpus counts** are derived on read, so both clients recompute automatically.
- **Audit trail** — every move/undo is recorded (`note_move_audit`, migration 0047) with from, to,
  when and what moved.
- **Tenant isolation holds** — a note can only move between two clients of the *same* rep (every repo
  call is user-scoped; composite `(user_id, client_id)` FKs back it at the DB).

**Atomicity (honest status):** the move groups its mutations so that in production they MUST run inside
**one DB transaction** — one rep, both clients, enforced by RLS + the composite FKs — so a partial move
is impossible. The in-memory suite asserts the end state (per the repo's "migrations validated live"
discipline); wrapping the repo calls in a single `withTenant` transaction is the remaining live-only
step and is flagged here rather than left implicit.

### B4 — undo an import
`POST /notes/:id/undo` removes everything a single import created — the note, its messages, its
extracted facts (JSONB moves with the note), its spine rows and its meeting(s) — with the same
confirmation-with-counts and the same atomicity contract as B3. The **training/extraction log is
preserved** (migration 0045 already survives a note delete: a reverted import is genuine data about
what the extractor produced, same rule as a rejected pending note). Last-contact and corpus recompute
afterwards. A re-import after undo is treated as **new, not a duplicate** (the messages are gone, so
the content-based dedupe has nothing to match). Undo of an already-undone import is a **no-op**
(idempotent).

---

## Staging data — anything that looks misfiled
Not yet inspected: the staging DB credentials are not available in this local batch (the suite runs on
in-memory adapters; migrations 0046/0047 validate live per the standing discipline). **Action:** once
staging creds are to hand, run B1's participant check and B2's people-overlap check across the existing
staging notes and list any suspected misfiles here. Carried forward with the other staging-DB tasks.

## Test coverage
Suite green; typecheck + lint clean; no prompt change, no gate run. New: `zip.test.ts` (iOS-shaped +
DEFLATE/STORED + localised name + no-transcript + caps + nested-archive), `resolve.test.ts`,
`misfile.test.ts` (B1 + B2 boundaries), `note-move-service.test.ts` (preview, move, state-preserved,
last-contact recompute, audit, errors; undo, idempotent, isolation), plus HTTP tests for the zip
import, the 409 confirm/override flow, and the move/undo/reimport routes, and web tests for the
byte-based picker, the share-target zip, and the misfile confirm UI.
