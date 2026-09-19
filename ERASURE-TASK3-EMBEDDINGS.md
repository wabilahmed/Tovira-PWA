# Single-counterparty erasure — Task 3: embeddings

## The finding

A note's embedding is **one vector over the whole `rawText`** — every speaker's text blended
(`extraction-service.ts:319`, `embedding = await this.embedder.embed(note.rawText)`). It is **not
per-message or per-speaker**. So an embedding **cannot be attributed to one counterparty's messages**,
and the requester's contribution cannot be surgically removed from it. (Requirement embeddings are
separate, one per requirement — the *client's* stated need — and carry no third-party attribution.)

## What the erasure does (rule-compliant, no model call)

- **A note WHOLLY the requester's** — every message is theirs, so no message survives the erasure —
  had a vector that was entirely their content. Its embedding is **cleared** (`embedding: null`), and
  the note drops out of semantic recall. This is correct: the whole note was about/by the requester.
- **A SHARED note** — the requester's messages are removed and `rawText` is re-rendered from the
  survivors, but the stored embedding is **left as-is**. Clearing it would delete more than the rule
  allows: the vector is the *only* search handle for the KEPT facts drawn from other participants, so
  clearing it would silently drop those from recall. Re-embedding the redacted `rawText` is the
  correct fix but requires an embedder call — **out of scope (no model calls)**.

No embedder is ever called; the only actions are deterministic (`embedding: null` on a wholly-requester
note, nothing on a shared note).

## Search-quality consequence — stated honestly, not silently

- **Wholly-requester notes:** removed from semantic recall for that client. Expected — that content is
  the requester's and is being erased.
- **Shared notes — a KNOWN RESIDUAL:** the note keeps its **stale** vector, which was computed over
  text that *included* the requester's now-removed messages. Consequences, both real:
  1. The requester's removed words can still **influence** which notes semantic recall surfaces (a
     residual trace of erased content in the vector) — until the note is re-embedded.
  2. Recall for the client's KEPT facts is **preserved** (we did not clear the vector).
  These pull opposite ways; we chose to preserve recall and report the residual, per the batch's
  instruction to report rather than over-delete.

## Recommended follow-up (out of this batch's scope)

A re-embedding pass over erasure-touched shared notes (embed the redacted `rawText`, replace the
vector) closes the residual. It needs the embedder (a model/Titan call), so it is a separate,
cost-bearing job — not part of a no-model-call erasure. Until then, the residual above stands and is
recorded in the erasure audit's category counts (`embeddings_cleared` counts only the wholly-requester
clears; shared-note vectors are deliberately untouched).
