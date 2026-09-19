import { describe, it, expect } from 'vitest';
import { spanFaithful, scoreReceipts, aggregateReceipts, GATE_RECEIPTS } from './score.js';
import type { Extraction } from '../services/extraction/types.js';

/**
 * [RECEIPTS-v0.9.5 Task 5] Gate scoring for the receipt fields. Scores a predicted extraction's
 * source_span (verbatim-or-faithful, transliteration-aware) and source_message_at (null on
 * ambiguous sources, present-in-source where determinable) against the SOURCE it was drawn from.
 */

const base = (over: Partial<Extraction>): Extraction => ({
  summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null, ...over,
});
const promise = (source_span: string | null, source_message_at: string | null = null) =>
  ({ text: 'x', owner: 'rep' as const, due_date: null, due_raw: null, confidence: 'high' as const, source_span, source_message_at });

describe('[RECEIPTS-v0.9.5 Task 5] spanFaithful — transliteration-aware, not byte-only', () => {
  const NOTE = "[2026-09-14T10:01:00] Me: I'll send the quote by Thursday";
  it('accepts a byte-verbatim span (quote/space/case-normalised)', () => {
    expect(spanFaithful("I'll send the quote by Thursday", NOTE)).toBe(true);
    expect(spanFaithful('I’ll send the quote by Thursday', NOTE)).toBe(true); // curly apostrophe
  });
  it('accepts a reordered span whose Latin tokens are all present (≥70%)', () => {
    expect(spanFaithful('quote Thursday send', NOTE)).toBe(true);
  });
  it('accepts a code-switched span: non-Latin script is stripped, Latin tokens matched', () => {
    const hinglish = 'main quote Thursday ko bhejunga';
    expect(spanFaithful('quote Thursday bhejunga', hinglish)).toBe(true);
    // Devanagari in the note does not block a Latin-token match.
    expect(spanFaithful('quote Thursday bhejunga', 'मैं quote Thursday ko bhejunga')).toBe(true);
  });
  it('rejects a fabricated span that shares too few tokens with the source', () => {
    expect(spanFaithful('I will call their finance team next month', NOTE)).toBe(false);
    expect(spanFaithful('completely invented sentence', NOTE)).toBe(false);
  });
});

describe('[RECEIPTS-v0.9.5 Task 5] scoreReceipts — known-good vs known-bad', () => {
  const CHAT = "[2026-09-14T10:01:00] Me: I'll send the quote by Thursday";

  it('known-good chat extraction scores zero on every receipt violation', () => {
    const good = base({ promises: [promise("I'll send the quote by Thursday", '2026-09-14T10:01:00')] });
    const s = scoreReceipts(CHAT, good, true);
    expect(s.spansEmitted).toBe(1);
    expect(s.spansFabricated).toBe(0);
    expect(s.messageAtOnAmbiguous).toBe(0);
    expect(s.messageAtNotInSource).toBe(0);
  });

  it('known-good paste extraction (no timestamps): null message time is fine', () => {
    const paste = "I'll send the quote by Thursday. Meeting locked for Thursday 3pm.";
    const good = base({ promises: [promise("I'll send the quote by Thursday", null)],
      meeting: { datetime: null, datetime_raw: 'Thursday 3pm', confirmed: true, source_span: 'Meeting locked for Thursday 3pm', source_message_at: null } });
    const s = scoreReceipts(paste, good, false);
    expect(s.spansFabricated).toBe(0);
    expect(s.messageAtOnAmbiguous).toBe(0);
  });

  it('RED: a fabricated span scores as a violation', () => {
    const bad = base({ promises: [promise('I promised them a 20% discount', null)] });
    const s = scoreReceipts(CHAT, bad, true);
    expect(s.spansEmitted).toBe(1);
    expect(s.spansFabricated).toBe(1); // must be caught
    expect(s.spansFabricated).toBeGreaterThan(GATE_RECEIPTS.maxFabricatedSpans); // fails the gate bar
  });

  it('RED: source_message_at on an ambiguous (voice/paste) source is a violation', () => {
    const paste = "I'll send the quote by Thursday";
    const bad = base({ promises: [promise("I'll send the quote by Thursday", '2026-09-14T10:01:00')] });
    const s = scoreReceipts(paste, bad, false); // paste has no per-message timestamps
    expect(s.messageAtOnAmbiguous).toBe(1);
    expect(s.messageAtOnAmbiguous).toBeGreaterThan(GATE_RECEIPTS.maxMessageAtOnAmbiguous);
  });

  it('RED: a made-up source_message_at not present in a timestamped source is caught', () => {
    const bad = base({ promises: [promise("I'll send the quote by Thursday", '2025-01-01T00:00:00')] });
    const s = scoreReceipts(CHAT, bad, true);
    expect(s.messageAtNotInSource).toBe(1);
  });

  it('aggregateReceipts sums across notes', () => {
    const bad = base({ promises: [promise('invented', null)] });
    const agg = aggregateReceipts([scoreReceipts(CHAT, bad, true), scoreReceipts(CHAT, bad, true)]);
    expect(agg.spansFabricated).toBe(2);
  });
});
