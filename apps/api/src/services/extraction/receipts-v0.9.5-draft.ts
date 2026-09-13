/**
 * [RECEIPTS-v0.9.5 DRAFT — design only, NOT wired into production]
 *
 * The extended per-fact receipt shape for the v0.9.5 extraction prompt. Today only `requirements`
 * (`requirement_raw`) and `unanswered_questions` (`question` + `sentAt`) carry a self-contained receipt;
 * the other five fact types (promise, key_date, person, personal_fact, meeting) do not. v0.9.5 gives all
 * of them the same two fields, so a fact proves itself without the raw message — the precondition for
 * safely deleting raw content.
 *
 * This file defines the DRAFT shape and is deliberately not imported by the extractor, the repos, or the
 * parser. It is promoted only after the v0.9.5 prompt is certified (a separate, credit-gated batch).
 *
 * Naming follows the two existing self-contained receipts rather than inventing a new convention:
 *  - `source_span`  mirrors `requirement_raw` — the VERBATIM excerpt the fact was drawn from, not the
 *    whole message: the specific span. Model-emitted (like `requirement_raw`). null when the model
 *    cannot identify a clear span (never guessed — same discipline as year-less dates → null).
 *  - `source_message_at` mirrors the `sentAt` on an unanswered_question — the timestamp of the message
 *    the fact came from. Deterministic ONLY where per-message timestamps exist (see below). null
 *    otherwise; never a fabricated or approximate time.
 *
 * source_message_at determinism (flagged per Task 2 — no silent fallback):
 *  - DETERMINISTIC: `whatsapp_export` — the input is the rendered thread `[sentAt] sender: body`
 *    (dedup.ts renderThread), so each message carries its own timestamp; the source message's time is
 *    recoverable.
 *  - AMBIGUOUS → MUST be null: `voice` (a transcript with no internal per-line timestamps),
 *    `paste` (a single block with no per-message timestamps), `ask_conversation` (a single statement).
 *    There is no correct single timestamp for these, so the field is null — NOT the note's created_at
 *    (that is when the rep captured it, not when the message was sent) and NOT today's date.
 *
 * Format: `source_span` is a string (the excerpt) or null; `source_message_at` is an ISO-8601 string
 * (matching `sentAt`/`stated_on` string style already stored in the extraction JSON) or null.
 */

/** The two receipt fields added to every fact in v0.9.5. Both nullable — a missing receipt is null,
 *  never a guess. */
export interface SourceReceipt {
  /** Verbatim excerpt the fact was drawn from (the specific span, not the whole message). */
  source_span: string | null;
  /** ISO-8601 timestamp of the source message; null when the source has no per-message time. */
  source_message_at: string | null;
}

/** v0.9.5 promise = the current shape + the receipt. (Base fields mirror ExtractedPromise in types.ts.) */
export interface PromiseV095 extends SourceReceipt {
  text: string;
  owner: 'rep' | 'client';
  due_date: string | null;
  due_raw: string | null;
  confidence: 'high' | 'low';
}

export interface PersonV095 extends SourceReceipt {
  name: string | null;
  role: string | null;
  reports_to: string | null;
  decision_role: 'decision_maker' | 'influencer' | 'blocker' | 'unknown';
  notes: string | null;
}

export interface PersonalFactV095 extends SourceReceipt {
  subject: string;
  fact: string;
  category: string;
}

export interface KeyDateV095 extends SourceReceipt {
  description: string;
  date: string | null;
  date_raw: string | null;
  type: string;
}

export interface MeetingV095 extends SourceReceipt {
  datetime: string | null;
  datetime_raw: string;
  confirmed: boolean;
}

/** The five fact types v0.9.5 newly gives a receipt. requirements + unanswered_questions already have
 *  one (requirement_raw / question+sentAt) and are intentionally excluded here. Used by the draft
 *  fixtures + the shape test to assert the pattern is applied consistently. */
export const V095_RECEIPT_FACT_TYPES = ['promise', 'person', 'personal_fact', 'key_date', 'meeting'] as const;
export type V095ReceiptFactType = (typeof V095_RECEIPT_FACT_TYPES)[number];

/** Sources for which source_message_at is deterministically recoverable (per-message timestamps exist). */
export const DETERMINISTIC_MESSAGE_TIME_SOURCES = ['whatsapp_export'] as const;
/** Sources for which source_message_at is ambiguous and MUST be null (no per-message timestamps). */
export const AMBIGUOUS_MESSAGE_TIME_SOURCES = ['voice', 'paste', 'ask_conversation'] as const;
