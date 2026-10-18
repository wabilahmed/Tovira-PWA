import { describe, it, expect } from 'vitest';
import { RecallService } from './recall-service.js';
import type { Embedder } from '../../ports/embedder.js';
import type { ModelClient, ModelCompletionRequest } from '../../ports/model.js';
import type { NoteRecord, SimilarNote } from '../../ports/note-repository.js';
import { formatMessageStamp, humanizeIsoDates } from '../text/format-date.js';

/**
 * [P21-A5] No raw timestamps anywhere a rep reads in Ask. Receipt quotes for a chat read
 * "Name, 7 May 2026, 13:02: message" (not "[2026-05-07T13:02:00] Name: message"); the receipt is dated
 * by the MESSAGE, not the import day; an ISO timestamp the model echoes is formatted in the answer.
 */
const RAW_TS = /\d{4}-\d{2}-\d{2}T/;
const embedder: Embedder = { dimension: 8, embed: async () => [1, 0, 0, 0, 0, 0, 0, 0] };
const IMPORT_DAY = Date.parse('2026-10-17T08:00:00Z');

function chat(): NoteRecord {
  return {
    id: 'n1', userId: 'u1', clientId: 'c1', source: 'whatsapp_export', rawText: null, audioKey: null, status: 'extracted', sweepAttempts: 0, extracted: null,
    messages: [
      { sender: 'QA Sara Khan', sentAt: '2026-05-07T13:02:00', body: 'I can stretch to 2.2M' },
      { sender: 'Wabil', sentAt: '2026-05-07T13:05:00', body: 'Great, I will send options' },
    ],
    createdAt: IMPORT_DAY,
  } as NoteRecord;
}

describe('[P21-A5] Ask never shows a raw timestamp', () => {
  it('receipt quotes read "Name, 7 May 2026, 13:02: message", dated by the message; the answer is formatted too', async () => {
    const seen: ModelCompletionRequest[] = [];
    const model: ModelClient = { complete: async (req) => { seen.push(req); return { text: 'On 2026-05-07T13:02:00 Sara said she can stretch to 2.2M (2026-05-07).' }; } };
    const notes = { searchSimilarByUser: async (): Promise<SimilarNote[]> => [{ note: chat(), similarity: 0.9 }] } as never;
    const svc = new RecallService(embedder, notes, model);
    const out = await svc.ask('u1', 'what is Sara\'s budget?');
    expect(out.receipts[0]!.quote).toBe('QA Sara Khan, 7 May 2026, 13:02: I can stretch to 2.2M\nWabil, 7 May 2026, 13:05: Great, I will send options');
    expect(out.receipts[0]!.date).toBe('2026-05-07'); // the message day, not the 17 Oct import
    expect(out.answer).toBe('On 7 May 2026, 13:02 Sara said she can stretch to 2.2M (7 May 2026).');
    // Nothing rep-facing carries a raw ISO timestamp…
    expect(RAW_TS.test(JSON.stringify({ a: out.answer, q: out.receipts.map((r) => r.quote) }))).toBe(false);
    // …and the excerpts the model reads are formatted the same way, so it has nothing raw to echo.
    expect(RAW_TS.test(JSON.stringify(seen[0]!.messages))).toBe(false);
  });

  it('structured receipts are humanised too, and the fallback answer carries no timestamp', async () => {
    const broken: ModelClient = { complete: async () => { throw new Error('down'); } };
    const notes = { searchSimilarByUser: async (): Promise<SimilarNote[]> => [] } as never;
    const structured = { forUser: async () => [{ quote: 'Acme — meeting: 2026-04-12T15:00 site visit', date: '2026-04-12', clientId: 'c1', noteId: 'n2' }] };
    const svc = new RecallService(embedder, notes, broken, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, structured);
    const out = await svc.ask('u1', 'meetings?');
    expect(out.receipts[0]!.quote).toBe('Acme — meeting: 12 Apr 2026, 15:00 site visit');
    expect(RAW_TS.test(JSON.stringify(out))).toBe(false);
  });
});

describe('[P21-A5] shared server-side date formatter', () => {
  it('formats a wall-clock message stamp positionally (no timezone drift)', () => {
    expect(formatMessageStamp('2026-05-07T13:02:00')).toBe('7 May 2026, 13:02');
    expect(formatMessageStamp('2026-03-02T00:15:00.000Z')).toBe('2 Mar 2026, 00:15');
    expect(formatMessageStamp('2026-03-02')).toBe('2 Mar 2026');
    expect(formatMessageStamp(null)).toBe('');
  });
  it('humanises ISO dates/timestamps inside text and leaves everything else alone', () => {
    expect(humanizeIsoDates('due (for 2026-04-06) and 2026-04-06T09:30:00Z')).toBe('due (for 6 Apr 2026) and 6 Apr 2026, 09:30');
    expect(humanizeIsoDates('ref 12345-67, 20/03/2026, 2.2M')).toBe('ref 12345-67, 20/03/2026, 2.2M');
    expect(humanizeIsoDates('2026-13-45')).toBe('2026-13-45'); // not a date → untouched
  });
});
