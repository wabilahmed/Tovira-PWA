# Single-counterparty erasure — Task 1 findings (no edits)

## Foundational finding (governs the whole design)

**There is no third-party person entity in the schema.** The only structured party identity is the
**client** (`clientId` / `clients` row). A named third party like "Khalid" exists only as:
- a free-text `name` string in `notes.extracted.people[]` (types.ts:21),
- a `subject` string in `notes.extracted.personal_facts[]` (types.ts:33),
- a `sender` string on an imported message (note-repository.ts:12) or an `unanswered_questions[].sender`
  (unanswered.ts:15), or
- text mentioned inside `summary` / `promise.text` / `source_span` / a notification body / a log.

There is **no id, no foreign key, no person table** linking a third party's several names to one entity.
So identifying "all data about Khalid" is fundamentally a **name-match problem** for everything except
rows keyed by `clientId`.

**The alias system does not close this.** `client_aliases` (migration 0058) is keyed `(user_id,
client_id, alias)` — it links alternate names to the **client** (the 1:1 chat counterpart), per-client.
`normaliseCounterpart` (extraction-service.ts:65) folds a matching `people.name`/`subject` into the
*client's* name at extraction time. There is **no mechanism linking a non-client "Khalid" across notes**.
So when the requester is a third party (not the client), their aliases are unknown and their data spans
multiple clients' notes — name-match only, not client-scoped.

## Per-store attribution — deterministic vs name-match

| Store | Attributing field | file:line | Verdict |
|---|---|---|---|
| people[] | `name` (string) | types.ts:21 | structured "who", but **name-match** to resolve to the requester |
| personal_facts[] | `subject` (string) | types.ts:33 | structured "who", **name-match** to resolve |
| notes.messages[] | `sender` / `role` | note-repository.ts:12-16 | structured per-message speaker; **name-match** to resolve sender→requester |
| unanswered_questions[] | `sender` | unanswered.ts:15; extraction-service.ts:296 | structured speaker; **name-match** to resolve |
| notes.rawText | none (blob) | note-repository.ts:34 | **name-match / non-splittable** by speaker |
| promises | `client_id` + free text/source_span | pg-facts-repository.ts:69 | client=deterministic; third-party = **name-match in text** |
| key_dates | `client_id` + description | pg-facts-repository.ts:12-25 | client=deterministic; third-party = **name-match** |
| meetings | `client_id` + title/source_span | pg-meeting-repository.ts:39 | client=deterministic; third-party = **name-match** |
| requirements | `clientId` only | requirement-repository.ts:13-28 | **deterministic (client only)** — never third-party |
| notes.embedding | whole rawText, per note | extraction-service.ts:319 | **non-attributable to one speaker** (see gap 1) |
| client outcome + history | `client_id` | 0061/0062; client-repository.ts:43 | **client-level only** |
| inventory matches | requirementId+itemId+`clientId` | inventory-match-repository.ts:11-23 | **deterministic (no person)** |
| notifications | `clientId` + free-text title/body | notification-repository.ts:16-22; nudge-content.ts:68 | client=deterministic; names in body = **name-match**; retained, not purged individually |
| extraction logs (training) | `noteId` + free-text input/rawOutput | extraction-log-repository.ts:8-23 | **name-match** (see gap 2) |
| training archive (object storage) | free-text JSONL rows | account-service.ts:93-146 | **name-match; OUTSIDE the DB cascade** (see gap 2) |
| corrections | `noteId` + before/after text | correction-repository.ts:7-19 | **name-match** |
| ledger | `clientId`/`sourceId` | ledger-repository.ts:11-19 | **deterministic (client only)** |
| ask-capture note | `clientId` + rawText | ask-capture-service.ts:60-66 | client=deterministic; content = **name-match** |
| misfile MoveSuggestion | `mentioned: string[]`, `reason` | note-repository.ts:21-27 | **name-match** (holds person names) |
| client_aliases | `alias`→`client_id` | 0058; contact-alias-repository.ts:7 | links to **client, per-client**; no third-party entity |

### The clean split the RULE maps onto

The rule ("delete facts ABOUT the requester; keep facts that MENTION them") maps almost exactly onto
**structured-subject fields vs free text**:
- "Khalid has five million" → a `personal_facts` entry with `subject: "Khalid"` → **structured subject → about → DELETE.**
- "Khalid wants to see it too" → a `next_step` / mention inside another subject's fact / free text → **KEEP.**

So:
- **Deterministic-structured (automatic candidate):** delete rows whose structured *who* field —
  `people[].name`, `personal_facts[].subject`, `messages[].sender`, `unanswered_questions[].sender` —
  **exactly matches** (normalised, case-insensitive) the requester's name or a confirmed alias.
- **Free-text mentions (KEEP by default):** promises/key_dates/meetings/requirements/summary/concerns/
  next_steps/receipts and notification bodies that merely *contain* the name are mentions → kept, with
  receipts byte-identical.
- **Fuzzy identity (needs confirmation):** "Khalid" vs "Khalid Rahman" vs a nickname — a partial match on
  a structured field is not safe to auto-delete (false positives hit a different Khalid; misses leave
  data). These are candidates the operator/rep confirms, never model-inferred.

## Two erasure gaps to decide on

1. **Per-note embeddings are not per-speaker** (extraction-service.ts:319 embeds the whole `rawText`).
   A shared note's vector blends every speaker, so it cannot be cleared for one requester without
   re-embedding the redacted text (an embedder call — out of scope: no model calls). Deleting the whole
   note's vector would over-delete (kills recall for facts drawn from other participants). Task 3 covers
   this; the honest options are: leave the vector (recall could still surface the note), or drop it only
   when the entire note is the requester's own messages.
2. **Training logs + archive hold the name in free text** (extraction-log-repository.ts; archive in
   object storage, account-service.ts:93-146), are name-indexed by nothing, and the archive lives
   **outside the DB FK cascade**. This is the highest-concentration PII store and the easiest to leave
   behind. Name-match only.

## STOPPING for your ruling (the automatic-vs-confirmed split)

Nothing built. The decisions I need before Task 2:
- **Automatic set:** run the deterministic-structured deletes (exact name/alias match on
  people/personal_facts/own-messages/own-questions) automatically?
- **Fuzzy matches:** surface as operator-confirmed candidates in the preview (never auto-deleted)?
- **Free-text mentions:** keep by default (per the rule), shown in the preview as "kept"?
- **Identity:** the operator supplies the requester's name(s)/aliases at intake (Task 5), and matching is
  exact-normalised for the automatic set?
- **The two gaps:** embeddings — leave vs drop-if-whole-note; training logs/archive — purge rows naming
  the requester, or record as a known residual and flag for a follow-up?
