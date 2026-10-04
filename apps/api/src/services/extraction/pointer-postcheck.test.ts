import { describe, it, expect } from 'vitest';
import { checkPointers, RETROSPECTIVE_DISCLOSURE } from './pointer-postcheck.js';
import type { Pointer, DealState } from './types.js';

const base = (over: Partial<Parameters<typeof checkPointers>[0]> = {}) => ({
  pointers: [] as Pointer[],
  inputText: '',
  inputMessageAts: new Set<string>(),
  currentPointers: [] as Pointer[],
  dealState: 'open' as DealState,
  ...over,
});
const P = (o: Partial<Pointer> & { text: string }): Pointer => ({ section: 'relationship', receipts: [], ...o });

describe('[POINTERS] deterministic post-check', () => {
  it('keeps a pointer whose receipt cites a message in this call (by timestamp)', () => {
    const r = checkPointers(base({
      pointers: [P({ text: 'keeps asking about parking', receipts: [{ source_span: 'parking?', source_message_at: '2026-01-01T10:00' }] })],
      inputMessageAts: new Set(['2026-01-01T10:00']),
    }));
    expect(r.pointers).toHaveLength(1);
  });

  it('drops a pointer whose receipt cites nothing in the input or the current pointers (D3)', () => {
    const r = checkPointers(base({
      pointers: [P({ text: 'invented', receipts: [{ source_span: 'nope', source_message_at: '1999-01-01T00:00' }] })],
      inputMessageAts: new Set(['2026-01-01T10:00']),
    }));
    expect(r.pointers).toEqual([]);
  });

  it('drops a pointer with no receipts at all', () => {
    expect(checkPointers(base({ pointers: [P({ text: 'ungrounded', receipts: [] })] })).pointers).toEqual([]);
  });

  it('validates an untimestamped receipt by a verbatim span in the input text', () => {
    const r = checkPointers(base({
      pointers: [P({ text: 'liked the quick quote', receipts: [{ source_span: 'thanks, that was fast', source_message_at: null }] })],
      inputText: 'rep: here you go\nclient: thanks, that was fast',
    }));
    expect(r.pointers).toHaveLength(1);
  });

  it('keeps a carried-forward pointer whose receipt is an OLD message cited by the current set (D7)', () => {
    const current = [P({ text: 'old', receipts: [{ source_span: 'earlier quote', source_message_at: '2025-12-01T09:00' }] })];
    const r = checkPointers(base({
      pointers: [P({ text: 'still cares about price', receipts: [{ source_span: 'earlier quote', source_message_at: '2025-12-01T09:00' }] })],
      inputMessageAts: new Set(['2026-01-01T10:00']), // the old message is NOT in this call
      currentPointers: current,
    }));
    expect(r.pointers).toHaveLength(1);
  });

  it('drops a pointer whose text the sensitive screen flags (D5)', () => {
    const r = checkPointers(base({
      pointers: [P({ text: 'ask how his treatment is going', receipts: [{ source_span: 'treatment', source_message_at: '2026-01-01T10:00' }] })],
      inputMessageAts: new Set(['2026-01-01T10:00']),
    }));
    expect(r.pointers).toEqual([]);
  });

  it('drops a retrospective pointer unless the loss is rep-confirmed, and attaches the exact disclosure when it is (D6)', () => {
    const retro = [P({ section: 'retrospective', text: 'price was never competitive', receipts: [{ source_span: 'too expensive', source_message_at: '2026-01-01T10:00' }] })];
    const ats = new Set(['2026-01-01T10:00']);
    // going cold → no retrospective
    expect(checkPointers(base({ pointers: retro, inputMessageAts: ats, dealState: 'going_cold' })).pointers).toEqual([]);
    // rep-confirmed loss → kept + disclosure
    const lost = checkPointers(base({ pointers: retro, inputMessageAts: ats, dealState: 'lost' }));
    expect(lost.pointers).toHaveLength(1);
    expect(lost.retrospectiveDisclosure).toBe(RETROSPECTIVE_DISCLOSURE);
  });

  it('no disclosure when there is no retrospective', () => {
    const r = checkPointers(base({
      pointers: [P({ section: 'close', text: 'push the Marina unit', receipts: [{ source_span: 'Marina', source_message_at: '2026-01-01T10:00' }] })],
      inputMessageAts: new Set(['2026-01-01T10:00']),
    }));
    expect(r.retrospectiveDisclosure).toBeNull();
  });
});
