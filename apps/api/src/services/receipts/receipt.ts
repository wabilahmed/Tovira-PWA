/**
 * [RECEIPTS-v0.9.5 Task 3] Per-fact receipt rendering.
 *
 * A receipt is what lets a rep trust a surfaced fact: the verbatim quote the fact was drawn from
 * (the stored `source_span`), plus WHEN that quote was said. It is built ONLY from fields stored on
 * the fact — never from the note's raw_text — so it survives raw-content deletion (that is the whole
 * point of decoupling: see Task 6). This module must never read raw_text.
 *
 * Three shapes:
 *  - 'message'  — an imported chat: the span carries a per-message timestamp (source_message_at).
 *  - 'capture'  — voice/paste: no per-message time exists, so we show the CAPTURE DATE (the note's
 *                 created_at), explicitly worded so it can never be mistaken for a per-message time.
 *  - 'none'     — no stored span at all (a pre-v0.9.5 fact; see Task 4). Never blank, never faked.
 */

import { referenceDateFor } from '../extraction/extraction-service.js';

export type ReceiptSource = 'message' | 'capture' | 'none';

export interface FactReceipt {
  /** The verbatim source excerpt (stored source_span), or null when none was stored. */
  quote: string | null;
  source: ReceiptSource;
  /** ISO instant of the source message ('message'), or ISO date of capture ('capture'); null for 'none'. */
  at: string | null;
  /** A ready-to-show human string for the receipt line. */
  label: string;
}

export interface ReceiptInput {
  sourceSpan: string | null;
  sourceMessageAt: string | null;
  /** The note's capture date (notes.created_at), epoch ms — used only for the 'capture' fallback. */
  captureDateMs: number | null;
}

/** Marker for a fact that predates receipts (source_span IS NULL). Task 4 renders this honestly. */
export const NO_RECEIPT_LABEL = 'No source quote was saved for this fact';

/** Epoch ms → YYYY-MM-DD (UTC). Date-only on purpose: the capture fallback is a DAY, never a
 *  per-message time, so it can never be misread as when the client actually said it. */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Build a fact's receipt from its STORED fields. Decoupling contract: this reads only source_span,
 * source_message_at, and the passed capture date — never the note body. The 'none' branch is driven
 * by `source_span IS NULL`, not by any date comparison, so it stays correct for any future fact that
 * also lacks a span.
 */
export function buildReceipt(input: ReceiptInput): FactReceipt {
  const span = input.sourceSpan?.trim() ? input.sourceSpan : null;
  if (span === null) {
    return { quote: null, source: 'none', at: null, label: NO_RECEIPT_LABEL };
  }
  if (input.sourceMessageAt !== null) {
    return { quote: span, source: 'message', at: input.sourceMessageAt, label: span };
  }
  // No per-message time: fall back to the capture date, clearly worded. Never a guessed time.
  const at = input.captureDateMs !== null ? isoDate(input.captureDateMs) : null;
  const label = at !== null ? `Quoted from your capture on ${at}` : 'Quoted from your capture';
  return { quote: span, source: 'capture', at, label };
}

/** A YYYY-MM-DD capture date → epoch ms (UTC midnight), for buildReceipt. null-safe. */
function captureDateToMs(captureAt: string | null): number | null {
  return captureAt ? Date.parse(`${captureAt}T00:00:00Z`) : null;
}

/**
 * Attach a receipt to a relational fact record. The capture-date fallback uses the fact's
 * denormalised `captureAt` (the note's conversation date — latest message date for a chat, capture
 * date for voice/paste), NEVER the fact row's own created_at (which is the import/write time and
 * would stamp an old import with today's date). captureAt null (pre-migration fact) → honest
 * fallback with no date.
 */
export function withReceipt<T extends { sourceSpan: string | null; sourceMessageAt: string | null; captureAt: string | null }>(
  rec: T,
): T & { receipt: FactReceipt } {
  return { ...rec, receipt: buildReceipt({ sourceSpan: rec.sourceSpan, sourceMessageAt: rec.sourceMessageAt, captureDateMs: captureDateToMs(rec.captureAt) }) };
}

/** Attach a receipt to a JSONB fact (person/personal_fact/etc.) whose capture date must be supplied
 *  by the caller from the originating note (these facts carry no created_at of their own). */
export function withExtractedReceipt<T extends { source_span?: string | null; source_message_at?: string | null }>(
  fact: T,
  captureDateMs: number | null,
): T & { receipt: FactReceipt } {
  return {
    ...fact,
    receipt: buildReceipt({ sourceSpan: fact.source_span ?? null, sourceMessageAt: fact.source_message_at ?? null, captureDateMs }),
  };
}

interface ReceiptFact { source_span?: string | null; source_message_at?: string | null }

/**
 * Annotate every fact inside a note's stored extraction (JSONB) with its receipt, using the note's
 * OWN capture date (notes.created_at) for the fallback. Each receipt is built from the fact's stored
 * source_span/source_message_at — NEVER from `note.rawText`. That is the decoupling contract: this
 * function does not read rawText, so a note whose raw body was deleted still renders full receipts.
 */
export function noteWithReceipts<N extends { createdAt: number; extracted: unknown; messages?: { sentAt: string | null }[] | null }>(note: N): N {
  const ex = note.extracted;
  if (!ex || typeof ex !== 'object') return note;
  // The capture-date fallback for this note's facts is its CONVERSATION date — the latest message
  // date for an imported chat, else the note's own capture date — via the canonical referenceDateFor,
  // NOT note.createdAt (which is the import/insert time and wrong for a back-dated import).
  const convDate = referenceDateFor(note, new Date(note.createdAt).toISOString().slice(0, 10));
  const at = captureDateToMs(convDate);
  const e = ex as Record<string, unknown>;
  const mapArr = (key: string) =>
    Array.isArray(e[key]) ? (e[key] as ReceiptFact[]).map((f) => withExtractedReceipt(f, at)) : e[key];
  const meeting = e.meeting && typeof e.meeting === 'object'
    ? withExtractedReceipt(e.meeting as ReceiptFact, at)
    : e.meeting ?? null;
  return {
    ...note,
    extracted: {
      ...e,
      promises: mapArr('promises'),
      people: mapArr('people'),
      personal_facts: mapArr('personal_facts'),
      key_dates: mapArr('key_dates'),
      meeting,
    },
  };
}
