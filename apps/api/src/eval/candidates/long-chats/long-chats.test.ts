import { describe, it, expect } from 'vitest';
import { LONG_CHATS } from './fixtures.js';
import { scoreLongChat, amountsIn, keywordsMatch } from './score.js';
import { parseWhatsAppExport } from '../../../services/import/whatsapp.js';
import type { Extraction } from '../../../services/extraction/types.js';

/** [P23-B3] The long-chat candidates are well-formed and their scorer can both fail and pass. */
const empty = (): Extraction => ({ summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [], meeting: null });

describe('[P23-B3] long-chat fixtures', () => {
  it('three chats, 250–600 messages each, all parse as a WhatsApp export', () => {
    expect(LONG_CHATS.map((f) => f.id)).toEqual(['buyer-ranches', 'tenant-renewal', 'qa-bulk-long']);
    for (const f of LONG_CHATS) {
      const p = parseWhatsAppExport(f.transcript);
      expect(p.ok, f.id).toBe(true);
      if (p.ok) expect(p.messages.length, f.id).toBe(f.messageCount);
      expect(f.messageCount, f.id).toBeGreaterThanOrEqual(250);
      expect(f.messageCount, f.id).toBeLessThanOrEqual(600);
    }
    expect(LONG_CHATS.find((f) => f.id === 'qa-bulk-long')!.messageCount).toBe(302);
  });

  it('every expected fact is anchored in its transcript (nothing fails for the wrong reason)', () => {
    for (const f of LONG_CHATS) {
      const t = f.transcript.toLowerCase();
      for (const p of f.expected.promises) expect(f.transcript.split('\n').some((l) => keywordsMatch(p.match, l)), `${f.id}: ${p.match}`).toBe(true);
      for (const r of f.expected.requirements) expect(r.anyOf.some((a) => t.includes(a)), `${f.id}: ${r.id}`).toBe(true);
      expect(amountsIn(f.transcript), `${f.id} budget`).toContain(amountsIn(f.expected.budget.current)[0]);
      for (const m of f.expected.meetings) expect(m.anyOf.some((a) => t.includes(a)), `${f.id}: meeting ${m.day}`).toBe(true);
    }
  });

  it('QA reconstruction carries the exact missed phrase', () => {
    expect(LONG_CHATS[2]!.transcript).toContain('Final budget is 3.2M, decide by July');
  });
});

describe('[P23-B3] scorer', () => {
  it('reads money in its common forms', () => {
    expect(amountsIn('Final budget is 3.2M')).toEqual([3_200_000]);
    expect(amountsIn('agreed 152,000 for the renewal')).toEqual([152_000]);
    expect(amountsIn('AED 3.1 million')).toEqual([3_100_000]);
    expect(amountsIn('on 25/09/2026 at 10am')).toEqual([]);
  });

  it('an empty extraction fails every bar', () => {
    const s = scoreLongChat(LONG_CHATS[2]!.expected, empty());
    expect(s.pass).toBe(false);
    expect(s.budget.found).toBe(0);
    expect(s.requirements.found).toBe(0);
  });

  it('a correct extraction passes; a duplicate or an open kept promise fails it', () => {
    const f = LONG_CHATS[2]!;
    const good: Extraction = {
      ...empty(),
      promises: [{ text: 'Send the reservation form', owner: 'rep', due_date: '2026-08-01', due_raw: 'today', confidence: 'high' }],
      requirements: [{ text: 'Creek Harbour 3BR, budget AED 3.2M', requirement_raw: 'still keen on the 3-bed at Creek Harbour', stated_on: '2026-05-02', confidence: 'high' }],
      key_dates: [{ description: 'decision on the Creek Harbour unit (by July)', date: null, date_raw: 'decide by July', type: 'deadline' }],
    };
    expect(scoreLongChat(f.expected, good).pass).toBe(true);
    const dup = { ...good, requirements: [...good.requirements!, { ...good.requirements![0]! }] };
    expect(scoreLongChat(f.expected, dup)).toMatchObject({ pass: false, duplicates: 1 });

    const buyer = LONG_CHATS[0]!;
    const openKept: Extraction = { ...empty(), promises: [{ text: 'send three villa options', owner: 'rep', due_date: '2026-02-05', due_raw: 'by Thursday', confidence: 'high' }] };
    const s = scoreLongChat(buyer.expected, openKept);
    expect(s.promiseStatus.found).toBe(0); // kept in the chat, but returned as an open promise
    const markedKept = { ...openKept, promises: [{ ...openKept.promises[0]!, kept_at: '2026-02-05T16:40' } as never] };
    expect(scoreLongChat(buyer.expected, markedKept).promiseStatus.found).toBe(1);
  });

  it('reports a budget that is only in the free-text summary (not a structured fact) separately', () => {
    const buyer = LONG_CHATS[0]!;
    const s = scoreLongChat(buyer.expected, { ...empty(), summary: 'budget moved to a final cap of AED 3.1M' });
    expect(s.budget).toMatchObject({ found: 0, inSummaryOnly: true });
  });

  it('counts a paraphrased repeat in concerns / personal facts as a duplicate', () => {
    const f = LONG_CHATS[1]!;
    const s = scoreLongChat(f.expected, { ...empty(), concerns: ['AC still not fixed after two weeks', 'AC has not been fixed for two weeks'], personal_facts: [{ subject: 'Rania', fact: 'Kids are on school holiday, keeping her busy', category: 'family' }, { subject: 'Rania', fact: 'Kids on holiday, keeping her busy', category: 'family' }] });
    expect(s.duplicates).toBe(2);
  });

  it('promise anchors are order-free whole words, so a reworded promise still matches ("landlord number" ⟵ "Confirm the landlord\'s rent number")', () => {
    const f = LONG_CHATS[1]!;
    const x = { ...empty(), promises: [
      { text: "Confirm the landlord's rent number", owner: 'rep' as const, due_date: '2026-06-10', due_raw: 'by Wednesday', confidence: 'high' as const },
      { text: 'Get the landlord to fix the leaking AC in the master bedroom', owner: 'rep' as const, due_date: '2026-06-30', due_raw: 'before the end of the month', confidence: 'high' as const },
    ] };
    expect(scoreLongChat(f.expected, x).promises.found).toBe(2);
    // NEGATIVE: a short anchor word must be a whole word ("ac" never matches "according").
    const y = { ...empty(), promises: [{ text: 'Get the landlord to fix it according to the contract', owner: 'rep' as const, due_date: '2026-06-30', due_raw: null, confidence: 'high' as const }] };
    expect(scoreLongChat(f.expected, y).promises.found).toBe(0);
  });

  it('a decision date surfaced as a promise due that day counts ("Decide on Villa 22", due 15 Jun)', () => {
    const f = LONG_CHATS[0]!;
    const x = { ...empty(), promises: [{ text: 'Decide on Villa 22', owner: 'client' as const, due_date: '2026-06-15', due_raw: 'by 15 June 2026', confidence: 'high' as const }] };
    expect(scoreLongChat(f.expected, x).decisionDate).toBe(true);
  });

  it('flags an earlier budget still presented alongside the current one', () => {
    const buyer = LONG_CHATS[0]!;
    const x: Extraction = { ...empty(), requirements: [
      { text: 'budget 2.5M', requirement_raw: 'Our budget is around 2.5M', stated_on: '2026-02-02', confidence: 'high' },
      { text: 'budget 3.1M', requirement_raw: 'final budget is 3.1M', stated_on: '2026-05-06', confidence: 'high' },
    ] };
    expect(scoreLongChat(buyer.expected, x).budget).toMatchObject({ found: 1, staleAlsoCurrent: 1 });
  });
});
