# RECEIPTS v0.9.5 — Task 6: raw-content deletion readiness (honest assessment)

**Report only. Nothing built. No recommendation.** This states plainly what this batch did and did
not unblock, and frames the decision that actually remains.

## What this batch changed

Assuming Tasks 2–3 pass (they do), **per-fact receipts are now decoupled from `raw_text`.** A
receipt is rendered from the fact's own stored `source_span` (+ `source_message_at`, or the note's
capture date as a clearly-worded fallback), by `buildReceipt` / `noteWithReceipts`, which **never
read `raw_text`**. Proven by the "receipts survive raw_text deletion" test and its mutation.

So: *for the receipt feature specifically*, `notes.raw_text` is no longer load-bearing.

## What this batch did NOT change

`raw_text` is read by far more than receipts. Every one of these still depends on the full note body
and would break for any note whose `raw_text` was deleted:

| Consumer | File | What breaks if raw_text is gone |
|---|---|---|
| **Ask / recall retrieval** | `services/recall/recall-service.ts:93, :189` | The recall answer's quote is built from `note.rawText`; matches with empty rawText are filtered out (`:189`). Ask returns nothing usable. |
| **Ask-capture** | `services/recall/ask-capture-service.ts:80, :91, :123` | The captured statement IS `rawText`; retrieval/embedding/audit all read it. |
| **Follow-up drafting** | `services/followup/follow-up-service.ts:25, :32` | Returns null with no rawText; the draft prompt is built from the note body. No draft. |
| **Book Scan** | `services/book-scan/book-scan-service.ts:145` | The going-cold quote falls back to `last.rawText`. |
| **Brief relatedNotes** | `services/brief/brief-service.ts:117-123` | Cross-note semantic panel embeds `focus.rawText` and renders `rawText` snippets. Panel goes empty. |

These are not receipts. They are **full-text features** that need the original words, not a per-fact
span. Decoupling receipts does nothing for them.

## Therefore

**Raw-content deletion is not a receipts question, and is NOT unblocked by this batch.** Whether the
receipt work shipped or not, deleting `raw_text` on a schedule still degrades Ask, Ask-capture,
follow-up drafting, Book Scan, and the relatedNotes panel for every note older than the retention
window. The receipts decoupling removes exactly one of six dependencies.

## The decision that actually remains

The remaining question is **not** "are receipts safe from deletion" (they are). It is a product
trade-off about full-text retention:

> **Is the owner willing to lose full-text recall, Ask, Ask-capture, follow-up drafting, and Book
> Scan on notes older than the retention window — in exchange for not storing raw conversation
> content past that window?**

The two sides, stated without a preference:

- **Delete raw_text on a schedule.** Gain: raw conversation content (a WhatsApp import can contain
  anything a client typed) is not retained indefinitely — smaller breach surface, cleaner data-minimisation
  story, and it is what the indefinite-retention disclosure flagged for the lawyer is about. Cost:
  the five features above silently degrade for older notes — the rep can no longer Ask across their
  history, drafts and Book Scan lose their source, and related-note surfacing thins out. Receipts
  keep working (the one thing this batch fixed).
- **Keep raw_text (accept the retention).** Gain: every full-text feature keeps working across the
  rep's whole history — arguably core product value. Cost: raw conversation content is retained, so
  the protection story has to lean on redaction (Tier-1 stripped at ingest) and access controls
  (Postgres RLS, tenant isolation) rather than deletion.

A middle option exists and is neither recommended nor dismissed here: a longer/tiered retention, or
deleting only some sources, trades the same axes at a different point.

## Status for the deletion job

Out of scope for this batch (explicitly), and not started. The prerequisite is the trade-off decision
above — a product/privacy call for the owner, not an engineering unblock. See memory
`privacy-retention-redaction-blockers` and `training-log-retention-pending` for the surrounding state.
