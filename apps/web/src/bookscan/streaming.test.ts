import { describe, it, expect } from 'vitest';
import { findingId, appendFindings } from './streaming.js';
import type { BookScanItem } from './bookScanClient.js';

const item = (id: string, quote: string, over: Partial<BookScanItem> = {}): BookScanItem => ({
  kind: 'open_promise', id, clientId: 'c1', clientName: 'Acme', headline: quote,
  receipt: { quote, date: '2026-08-01' }, framing: 'worth_checking', ...over,
});
const A = item('id-a', 'A');
const B = item('id-b', 'B', { kind: 'unanswered_question' });
const C = item('id-c', 'C', { kind: 'going_cold' });
const ids = (xs: BookScanItem[]) => xs.map((x) => x.receipt.quote);

describe('[BOOKSCAN-STREAM] findingId + appendFindings — stable, collision-free identity', () => {
  it('findingId keys on kind|id, so it is unique even when quote/date collide', () => {
    expect(findingId(A)).toBe(findingId({ ...A }));
    expect(findingId(A)).not.toBe(findingId(B));
    // Same client/quote/date, DIFFERENT id → different key (the whole point of the fix).
    expect(findingId(item('id-1', 'same'))).not.toBe(findingId(item('id-2', 'same')));
  });

  // [PART A] Collision case 1: two pre-v0.9.5 promises, same client, same date, same quote (null span).
  // The drop happens ACROSS polls: p1 is already shown when p2 arrives; under the old quote-based key p2
  // keys identically to p1 and appendFindings filters it out (dropped, silently). With kind|id it survives.
  it('a distinct finding with the same client/quote/date is NOT dropped when it arrives after the first', () => {
    const p1 = item('promise-1', 'send the deck');
    const p2 = item('promise-2', 'send the deck'); // a second, distinct promise row, same text + date
    let shown = appendFindings([], [p1]);          // poll 1: p1 shown
    shown = appendFindings(shown, [p1, p2]);        // poll 2: p2 now present too
    expect(shown).toHaveLength(2);                  // p2 NOT dropped to a collision
    expect(shown.map((x) => x.id)).toEqual(['promise-1', 'promise-2']);
  });

  // [PART A] Collision case 2: one message → two promises with the same quote and date, across polls.
  it('two promises from one message (same quote + date) both survive across polls', () => {
    const floor = item('p-floor', 'send the floor plan and the brochure by Friday');
    const brochure = item('p-brochure', 'send the floor plan and the brochure by Friday');
    let shown = appendFindings([], [floor]);
    shown = appendFindings(shown, [floor, brochure]);
    expect(shown).toHaveLength(2);
  });

  it('findings arriving over three polls append in ARRIVAL order', () => {
    let shown: BookScanItem[] = [];
    shown = appendFindings(shown, [A]);
    shown = appendFindings(shown, [A, B]);
    shown = appendFindings(shown, [A, B, C]);
    expect(ids(shown)).toEqual(['A', 'B', 'C']);
  });

  it('an earlier finding NEVER changes position after a later one arrives — even when the server reorders', () => {
    let shown: BookScanItem[] = [];
    shown = appendFindings(shown, [A]);
    shown = appendFindings(shown, [B, A]);       // server groups by category → B before A; ignored
    expect(ids(shown)).toEqual(['A', 'B']);
    shown = appendFindings(shown, [C, B, A]);
    expect(ids(shown)).toEqual(['A', 'B', 'C']);
  });

  it('re-seeing the same findings appends nothing (idempotent)', () => {
    const shown = appendFindings([], [A, B]);
    const same = appendFindings(shown, [A, B]);
    expect(same).toBe(shown); // no change → same reference (no re-render churn)
  });
});
