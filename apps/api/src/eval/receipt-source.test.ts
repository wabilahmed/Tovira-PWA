import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { receiptSource } from './receipt-source.js';
import { scoreReceipts, spanFaithful, BLANKING_PLACEHOLDER } from './score.js';
import { EVAL_NOTES } from './eval-set.js';
import type { Extraction } from '../services/extraction/types.js';

// [P50 · owner] The full certification failed RECEIPTS FABRICATED=15 (bar 0) on a measurement error: receipts were checked
// against the RAW note, but the model (and production, which stores the redacted text) only sees the note after Tier-1
// blanking. On tier1-eid-arabic-indic the model quoted exactly what it was given. The fix is narrow, by owner rule: ONLY
// an exact blanking placeholder may differ from the original. A quote carrying a placeholder must appear verbatim in the
// blanked note (no tolerance); every other quote is judged exactly as before, against the original note.
const note = (id: string) => EVAL_NOTES.find((n) => n.id === id)!;
const SEEN = 'Yusuf أرسل رقم الهوية [Emirates ID redacted] للأوراق.';
const ex = (span: string) => ({ summary: '', promises: [], people: [{ name: 'Yusuf', role: null, reports_to: null, decision_role: 'unknown', notes: null, source_span: span, source_message_at: null }], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null }) as unknown as Extraction;
const fabricated = (id: string, span: string) => scoreReceipts(note(id).note, ex(span), false, { seenText: receiptSource(note(id)) }).spansFabricated;

describe('[P50] receipts: only an exact blanking placeholder may differ from the original', () => {
  it('a verbatim quote of the blanked note (with its exact placeholder) is faithful', () => {
    expect(receiptSource(note('tier1-eid-arabic-indic'))).toBe(SEEN);
    expect(spanFaithful(SEEN, note('tier1-eid-arabic-indic').note)).toBe(false); // the old measure called it fabricated
    expect(fabricated('tier1-eid-arabic-indic', SEEN)).toBe(0);
    expect(fabricated('tier1-card-spaces', 'Omar sent his card for the deposit: [card ending 6467].')).toBe(0);
    expect(fabricated('tier1-card-split-messages', 'second half [card ending 6467]')).toBe(0);
  });

  it('NEGATIVE: an invented quote that is not in the blanked note is still fabricated', () => {
    expect(fabricated('tier1-eid-arabic-indic', 'Yusuf will sign the lease next Monday at the bank')).toBe(1);
    expect(fabricated('tier1-card-spaces', 'Omar promised to pay the balance in cash on Thursday')).toBe(1);
  });

  it('NEGATIVE: a wrong or invented placeholder is fabricated (no tolerance once a placeholder is quoted)', () => {
    expect(fabricated('tier1-card-spaces', 'Omar sent his card for the deposit: [card ending 9999].')).toBe(1); // wrong last four
    expect(fabricated('tier1-card-spaces', 'Omar sent his card for the deposit: [IBAN redacted].')).toBe(1); // wrong kind
    expect(fabricated('tier1-eid-arabic-indic', 'Yusuf emailed his [Emirates ID redacted] yesterday')).toBe(1); // altered around it
    expect(fabricated('client-person-alias', 'Bubu DXB sent [card ending 1234]')).toBe(1); // nothing was blanked there
  });

  it('NEGATIVE: a quote without a placeholder is judged exactly as before, against the original note', () => {
    for (const id of ['tier1-card-spaces', 'client-person-alias', 'hindi-english-resolvable', 'merge-shared-first-name']) {
      const n = note(id);
      for (const span of [n.note.slice(0, 40), 'an invented sentence about a villa and a deposit', n.note.split(' ').slice(2, 9).join(' ')]) {
        const before = spanFaithful(span, n.note) ? 0 : 1;
        expect(fabricated(id, span), `${id}: "${span}"`).toBe(before);
      }
    }
  });

  it('without a blanked text (the old call), scoring is unchanged', () => {
    const n = note('tier1-eid-arabic-indic');
    expect(scoreReceipts(n.note, ex(SEEN), false).spansFabricated).toBe(1);
  });

  it('NEGATIVE: every placeholder redact.ts writes is recognised (a new one cannot slip past the exact rule)', () => {
    const src = readFileSync(new URL('../services/redaction/redact.ts', import.meta.url), 'utf8');
    const fixed = [...src.matchAll(/'(\[[^'\]]+\])'/g)].map((m) => m[1]!);
    expect(fixed.length).toBeGreaterThanOrEqual(7);
    for (const p of [...fixed, '[card ending 6467]']) expect(BLANKING_PLACEHOLDER.test(p), p).toBe(true);
  });

  it('the gate passes the blanked note as the text the model saw', () => {
    const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/scoreReceipts\(note\.note, actual, note\.source === 'whatsapp_export', \{ seenText: receiptSource\(note\) \}\)/);
  });
});
