import { describe, it, expect, beforeEach } from 'vitest';
import { StructuredRecall } from './structured-recall.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';

const USER = 'user-1';
const NOW = Date.parse('2026-03-01T00:00:00Z');

let clients: InMemoryClientRepository;
let facts: InMemoryFactsRepository;
let meetings: InMemoryMeetingRepository;
let structured: StructuredRecall;

beforeEach(() => {
  clients = new InMemoryClientRepository();
  facts = new InMemoryFactsRepository();
  meetings = new InMemoryMeetingRepository();
  structured = new StructuredRecall({ facts, meetings, clients });
});

describe('[P18-5] StructuredRecall (cross-client fact retrieval)', () => {
  it('returns open promises from EVERY client, each receipt naming its client and dated by its due date', async () => {
    const acme = await clients.create(USER, 'Acme');
    const nord = await clients.create(USER, 'Nord');
    await facts.saveExtraction(USER, { noteId: 'n1', clientId: acme.id, promises: [{ text: 'send the revised quote', owner: 'rep', due_date: '2026-03-10', due_raw: 'next week', confidence: 'high' }] });
    await facts.saveExtraction(USER, { noteId: 'n2', clientId: nord.id, promises: [{ text: 'share the samples', owner: 'rep', due_date: '2026-03-05', due_raw: 'Thursday', confidence: 'high' }] });

    const receipts = await structured.forUser(USER, NOW);
    const text = receipts.map((r) => r.quote).join(' | ');
    // BOTH clients' promises surface — this is the cross-client reach vector search can't give.
    expect(text).toMatch(/Acme — you promised to send the revised quote/);
    expect(text).toMatch(/Nord — you promised to share the samples/);
    // Soonest due first (Nord 03-05 before Acme 03-10); each carries its client + source note.
    expect(receipts[0]!.quote).toContain('Nord');
    expect(receipts[0]!.date).toBe('2026-03-05');
    expect(receipts[0]!.clientId).toBe(nord.id);
    expect(receipts[0]!.noteId).toBe('n2');
  });

  it('excludes promises the rep has marked done (not open)', async () => {
    const acme = await clients.create(USER, 'Acme');
    await facts.saveExtraction(USER, { noteId: 'n1', clientId: acme.id, promises: [{ text: 'send the quote', owner: 'rep', due_date: '2026-03-10', due_raw: null, confidence: 'high' }] });
    const [p] = await facts.listPromisesByUser(USER);
    await facts.markPromiseDone(USER, p!.id);

    const receipts = await structured.forUser(USER, NOW);
    expect(receipts.some((r) => r.quote.includes('send the quote'))).toBe(false);
  });

  it('includes upcoming meetings and key dates within the window, excludes far-future ones', async () => {
    const acme = await clients.create(USER, 'Acme');
    await meetings.create(USER, { clientId: acme.id, datetime: '2026-03-04T15:00:00.000Z', datetimeRaw: 'Wed 3pm', title: 'Site visit', confirmed: true, noteId: 'n9' });
    await facts.saveExtraction(USER, {
      noteId: 'n1',
      clientId: acme.id,
      promises: [],
      keyDates: [
        { description: 'tender deadline', date: '2026-03-20', date_raw: 'the 20th', type: 'deadline' },
        { description: 'far launch', date: '2027-01-01', date_raw: null, type: 'launch' }, // beyond the window
      ],
    });

    const receipts = await structured.forUser(USER, NOW);
    const text = receipts.map((r) => r.quote).join(' | ');
    expect(text).toMatch(/Acme — meeting: Site visit/);
    expect(text).toMatch(/Acme — tender deadline/);
    expect(text).not.toMatch(/far launch/); // 10 months out — outside the 180-day window
  });

  it('caps each kind so a huge book cannot blow up the digest', async () => {
    const acme = await clients.create(USER, 'Acme');
    for (let i = 0; i < 20; i++) {
      await facts.saveExtraction(USER, { noteId: `n${i}`, clientId: acme.id, promises: [{ text: `promise ${i}`, owner: 'rep', due_date: `2026-03-${String((i % 27) + 1).padStart(2, '0')}`, due_raw: null, confidence: 'high' }] });
    }
    const receipts = await structured.forUser(USER, NOW);
    expect(receipts.length).toBeLessThanOrEqual(8); // maxPerKind default
  });
});
