import { describe, it, expect } from 'vitest';
import { findingId, appendFindings } from './streaming.js';
import type { BookScanItem } from './bookScanClient.js';

const item = (over: Partial<BookScanItem> & { quote: string }): BookScanItem => ({
  kind: 'open_promise', clientId: 'c1', clientName: 'Acme', headline: over.quote,
  receipt: { quote: over.quote, date: '2026-08-01' }, framing: 'worth_checking', ...over,
});
const A = item({ quote: 'A' });
const B = item({ quote: 'B', kind: 'unanswered_question' });
const C = item({ quote: 'C', kind: 'going_cold' });
const ids = (xs: BookScanItem[]) => xs.map((x) => x.receipt.quote);

describe('[BOOKSCAN-STREAM] findingId + appendFindings — stable client-side ordering', () => {
  it('findingId is stable and distinguishes findings by kind|client|quote|date', () => {
    expect(findingId(A)).toBe(findingId({ ...A }));
    expect(findingId(A)).not.toBe(findingId(B));
  });

  it('findings arriving over three polls append in ARRIVAL order', () => {
    let shown: BookScanItem[] = [];
    shown = appendFindings(shown, [A]);        // poll 1
    shown = appendFindings(shown, [A, B]);     // poll 2
    shown = appendFindings(shown, [A, B, C]);  // poll 3
    expect(ids(shown)).toEqual(['A', 'B', 'C']);
  });

  it('an earlier finding NEVER changes position after a later one arrives — even when the server reorders', () => {
    let shown: BookScanItem[] = [];
    shown = appendFindings(shown, [A]);            // poll 1: [A]
    // poll 2: server groups by category, so B (a different kind) comes back BEFORE A — must be ignored.
    shown = appendFindings(shown, [B, A]);
    expect(ids(shown)).toEqual(['A', 'B']);        // A stayed first; B appended
    // poll 3: server reorders again (C, B, A) — still append-only.
    shown = appendFindings(shown, [C, B, A]);
    expect(ids(shown)).toEqual(['A', 'B', 'C']);
  });

  it('re-seeing the same findings appends nothing (idempotent)', () => {
    let shown = appendFindings([], [A, B]);
    const same = appendFindings(shown, [A, B]);
    expect(same).toBe(shown); // no change → same reference (no re-render churn)
  });
});
