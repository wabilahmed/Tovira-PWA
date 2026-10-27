import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { receiptSource } from './receipt-source.js';
import { scoreReceipts, spanFaithful } from './score.js';
import { EVAL_NOTES } from './eval-set.js';
import type { Extraction } from '../services/extraction/types.js';

// [P50 · cert finding] The full certification failed RECEIPTS FABRICATED=15 (bar 0) on a measurement error: receipts were
// checked against the RAW note, but the model (and production, which stores the redacted text) only ever sees the note
// after Tier-1 redaction. On tier1-eid-arabic-indic the model quoted exactly what it was given,
// "Yusuf أرسل رقم الهوية [Emirates ID redacted] للأوراق.", which is verbatim of the redacted note but shares one Latin
// token with the raw one. A receipt is faithful to the text the model saw; a genuinely invented span still fails.
const note = (id: string) => EVAL_NOTES.find((n) => n.id === id)!;
const SEEN = 'Yusuf أرسل رقم الهوية [Emirates ID redacted] للأوراق.';
const withSpan = (span: string) => ({ summary: '', promises: [], people: [{ name: 'Yusuf', role: null, reports_to: null, decision_role: 'unknown', notes: null, source_span: span, source_message_at: null }], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null }) as unknown as Extraction;

describe('[P50] receipts are checked against the text the model saw', () => {
  it('the receipt source is the note after Tier-1 redaction', () => {
    const n = note('tier1-eid-arabic-indic');
    expect(receiptSource(n)).toBe(SEEN);
    expect(spanFaithful(SEEN, n.note)).toBe(false); // the old measure: a false "fabricated"
    expect(scoreReceipts(receiptSource(n), withSpan(SEEN), false).spansFabricated).toBe(0);
  });
  it('NEGATIVE: an invented span is still fabricated against the redacted source', () => {
    const n = note('tier1-eid-arabic-indic');
    expect(scoreReceipts(receiptSource(n), withSpan('Yusuf will sign the lease next Monday at the bank'), false).spansFabricated).toBe(1);
  });
  it('NEGATIVE: a note with nothing to redact is scored against itself, unchanged', () => {
    const n = note('client-person-alias');
    expect(receiptSource(n)).toBe(n.note);
  });
  it('the gate scores receipts through receiptSource', () => {
    const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/scoreReceipts\(receiptSource\(note\), actual,/);
    expect(src).not.toMatch(/scoreReceipts\(note\.note,/);
  });
});
